import test from "node:test";
import assert from "node:assert/strict";

import { AccountMutationService } from "./account-mutation-service.js";
import { InsufficientLiquidityError, ValidationError } from "./errors.js";

function makeService() {
  const accounts = new Map();
  const getAccountSummary = async (wallet) => {
    const existing = accounts.get(wallet);
    if (existing) return existing;
    const blank = {
      wallet,
      liquid: {},
      reserved: {},
      strategyAllocated: {},
      collateralLocked: {},
      jobStakeLocked: {},
      debtOutstanding: {}
    };
    accounts.set(wallet, blank);
    return blank;
  };
  const service = new AccountMutationService(accounts, undefined, getAccountSummary);
  return { service, accounts, getAccountSummary };
}

async function fund(accounts, wallet, asset, amount) {
  const existing = accounts.get(wallet) ?? {
    wallet,
    liquid: {},
    reserved: {},
    strategyAllocated: {},
    collateralLocked: {},
    jobStakeLocked: {},
    debtOutstanding: {}
  };
  existing.liquid[asset] = (existing.liquid[asset] ?? 0) + amount;
  accounts.set(wallet, existing);
}

test("agentTransfer moves liquid balance from one agent to another", async () => {
  const { service, accounts } = makeService();
  await fund(accounts, "0xAlice", "DOT", 100);

  const result = await service.agentTransfer("0xAlice", "0xBob", "DOT", 30);
  assert.equal(result.from.liquid.DOT, 70);
  assert.equal(result.to.liquid.DOT, 30);
  assert.equal(accounts.get("0xAlice").liquid.DOT, 70);
  assert.equal(accounts.get("0xBob").liquid.DOT, 30);
});

test("agentTransfer rejects zero and negative amounts", async () => {
  const { service, accounts } = makeService();
  await fund(accounts, "0xAlice", "DOT", 10);
  await assert.rejects(
    () => service.agentTransfer("0xAlice", "0xBob", "DOT", 0),
    ValidationError
  );
  await assert.rejects(
    () => service.agentTransfer("0xAlice", "0xBob", "DOT", -5),
    ValidationError
  );
});

test("agentTransfer rejects self-transfer", async () => {
  const { service, accounts } = makeService();
  await fund(accounts, "0xAlice", "DOT", 10);
  await assert.rejects(
    () => service.agentTransfer("0xalice", "0xALICE", "DOT", 1),
    ValidationError
  );
});

test("agentTransfer rejects when sender has insufficient liquid", async () => {
  const { service, accounts } = makeService();
  await fund(accounts, "0xAlice", "DOT", 2);
  await assert.rejects(
    () => service.agentTransfer("0xAlice", "0xBob", "DOT", 5),
    (err) => err instanceof InsufficientLiquidityError
  );
  // Alice's balance must not have moved on failed transfer.
  assert.equal(accounts.get("0xAlice").liquid.DOT, 2);
  assert.equal(accounts.get("0xBob")?.liquid?.DOT ?? 0, 0);
});

test("agentTransfer delegates to blockchain gateway when enabled", async () => {
  const calls = [];
  const gateway = {
    isEnabled: () => true,
    sendToAgent: async (...args) => {
      calls.push(args);
    }
  };
  const accounts = new Map();
  const getAccountSummary = async (wallet) => ({
    wallet,
    liquid: { DOT: wallet === "0xAlice" ? 50 : 10 },
    reserved: {},
    strategyAllocated: {},
    collateralLocked: {},
    jobStakeLocked: {},
    debtOutstanding: {}
  });
  const service = new AccountMutationService(accounts, gateway, getAccountSummary);

  const result = await service.agentTransfer("0xAlice", "0xBob", "DOT", 5);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["0xAlice", "0xBob", "DOT", 5]);
  // When the gateway is enabled, the in-memory map isn't the source of
  // truth; we just return the fresh summaries from the gateway.
  assert.equal(result.from.liquid.DOT, 50);
  assert.equal(result.to.liquid.DOT, 10);
});
