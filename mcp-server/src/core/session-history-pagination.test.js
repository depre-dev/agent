import test from "node:test";
import assert from "node:assert/strict";

import { MemoryStateStore } from "./state-store.js";

// These tests guard the pagination contract that /agents/:wallet relies on
// to compute lifetime totals. If listSessionsByWallet stops honouring
// offset, the profile endpoint silently truncates stats at the first page
// — exactly the bug we just fixed.

test("MemoryStateStore.listSessionsByWallet supports offset-based pagination", async () => {
  const store = new MemoryStateStore();
  const wallet = "0xabc";
  for (let i = 0; i < 150; i += 1) {
    await store.upsertSession({
      sessionId: `s-${i}`,
      wallet,
      jobId: `j-${i % 3}`,
      idempotencyKey: `idem-${i}`,
      status: "resolved",
      protocolHistory: ["http"]
    });
  }
  const firstPage = await store.listSessionsByWallet(wallet, 64, 0);
  const secondPage = await store.listSessionsByWallet(wallet, 64, 64);
  const thirdPage = await store.listSessionsByWallet(wallet, 64, 128);
  assert.equal(firstPage.length, 64);
  assert.equal(secondPage.length, 64);
  assert.equal(thirdPage.length, 22); // 150 total
  // Pages must be disjoint: no sessionId should appear twice across them.
  const seen = new Set();
  for (const page of [firstPage, secondPage, thirdPage]) {
    for (const session of page) {
      assert.ok(!seen.has(session.sessionId), `duplicate session id in pages: ${session.sessionId}`);
      seen.add(session.sessionId);
    }
  }
  assert.equal(seen.size, 150);
});

test("MemoryStateStore.listSessionsByJob also honours offset", async () => {
  const store = new MemoryStateStore();
  const jobId = "j-shared";
  for (let i = 0; i < 80; i += 1) {
    await store.upsertSession({
      sessionId: `js-${i}`,
      wallet: `0x${i.toString(16).padStart(40, "0")}`,
      jobId,
      idempotencyKey: `idem-${i}`,
      status: "claimed",
      protocolHistory: ["http"]
    });
  }
  const page = await store.listSessionsByJob(jobId, 32, 64);
  assert.equal(page.length, 16);
});
