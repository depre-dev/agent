#!/usr/bin/env node

/**
 * Deposit a signer's existing on-chain USDC into AgentAccountCore so the
 * hosted product-proof worker loop's liquidity preflight (PR #215) sees
 * funded settlement liquidity.
 *
 * What this script does NOT do
 * ----------------------------
 * It does NOT acquire USDC. The Polkadot Hub TestNet ERC20 precompile
 * (`0x0000053900000000000000000000000001200000`, asset id 1337) does
 * NOT implement `mint` — see Polkadot docs at
 * https://docs.polkadot.com/smart-contracts/precompiles/erc20/. The
 * canonical way to acquire USDC on Hub TestNet is one of:
 *
 *   1. Swap PAS → USDC via the Substrate-side `assetConversion`
 *      pallet (Uniswap V2 AMM). Reachable from Polkadot.js Apps with
 *      the same ECDSA key the EVM signer uses, or from a `polkadot-api`
 *      script. See chain-interactions/token-operations/convert-assets.md.
 *   2. Direct ERC20 `transfer(to, amount)` from another wallet that
 *      already holds USDC.
 *
 * Use one of those routes first to put USDC at the signer's EVM
 * address, then run this script to deposit it into AgentAccountCore.
 *
 * What this script DOES
 * ----------------------
 *   1. Verifies the signer holds enough USDC at the precompile.
 *   2. Calls `usdc.approve(agentAccountCore, amount)`.
 *   3. Calls `agentAccountCore.deposit(usdc, amount)`.
 *   4. Verifies `AgentAccountCore.positions(signer, usdc).liquid`
 *      increased by `amount`.
 *
 * Modes
 * -----
 *   --dry-run     (default)   Reads everything, prints the planned
 *                             txs, exits without signing.
 *   --commit                  Actually sends the approve + deposit
 *                             transactions. Requires PRIVATE_KEY env.
 *
 * Usage
 * -----
 *   PRIVATE_KEY=0x... node scripts/ops/fund-signer-usdc-deposit.mjs \
 *     --amount 10000000 --commit
 *
 * `--amount` is in USDC base units (6 decimals). `10000000` = 10 USDC.
 *
 * Notes
 * -----
 * The script is read-only by default for safety. The dry-run output
 * includes the calldata so it can be cross-checked against an
 * independent encoder before committing.
 */

import { JsonRpcProvider, Wallet, Contract, Interface } from "ethers";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

const ERC20_READ_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)"
];
const ERC20_APPROVE_ABI = ["function approve(address spender, uint256 amount) returns (bool)"];
const AGENT_ACCOUNT_DEPOSIT_ABI = [
  "function deposit(address asset, uint256 amount)",
  "function positions(address account, address asset) view returns (uint256 liquid, uint256 reserved, uint256 strategyAllocated, uint256 collateralLocked, uint256 jobStakeLocked, uint256 debtOutstanding)"
];

function parseArgs(argv) {
  const args = { dryRun: true, amount: undefined, profile: "testnet" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--commit") args.dryRun = false;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--amount") args.amount = argv[++i];
    else if (arg === "--profile") args.profile = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function printUsage() {
  console.log(
    [
      "Usage: node scripts/ops/fund-signer-usdc-deposit.mjs [options]",
      "",
      "Options:",
      "  --amount <baseUnits>   Required. USDC amount in base units (6 decimals).",
      "                         e.g. --amount 10000000 for 10 USDC.",
      "  --profile <name>       deployments/<profile>.json. Default: testnet.",
      "  --dry-run              (default) Read-only; prints planned txs.",
      "  --commit               Sends approve + deposit txs. Requires PRIVATE_KEY.",
      "",
      "Env:",
      "  PRIVATE_KEY            0x-prefixed signer key. Required only with --commit."
    ].join("\n")
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  if (!args.amount) {
    console.error("--amount is required (USDC base units).");
    printUsage();
    process.exitCode = 1;
    return;
  }

  let amountWei;
  try {
    amountWei = BigInt(args.amount);
  } catch {
    console.error(`--amount must be an integer (base units). Got: ${args.amount}`);
    process.exitCode = 1;
    return;
  }
  if (amountWei <= 0n) {
    console.error("--amount must be positive.");
    process.exitCode = 1;
    return;
  }

  const deploymentsPath = resolve(repoRoot, "deployments", `${args.profile}.json`);
  const deployments = JSON.parse(await readFile(deploymentsPath, "utf8"));

  const rpcUrl = deployments.rpcUrl;
  const usdcAddress = deployments.contracts.token;
  const agentAccountAddress = deployments.contracts.agentAccountCore;

  const provider = new JsonRpcProvider(rpcUrl);

  // Resolve the signer address from PRIVATE_KEY when committing.
  // In dry-run mode, accept --signer override or fall back to the
  // deployment file's `verifier` field, which is the canonical signer
  // wallet address on testnet.
  let signerAddress = String(process.env.SIGNER_ADDRESS_OVERRIDE ?? deployments.verifier ?? "").trim();
  let wallet;
  if (!args.dryRun) {
    const privateKey = String(process.env.PRIVATE_KEY ?? "").trim();
    if (!/^0x[a-fA-F0-9]{64}$/u.test(privateKey)) {
      console.error("PRIVATE_KEY env (0x-prefixed 32-byte hex) is required with --commit.");
      process.exitCode = 1;
      return;
    }
    wallet = new Wallet(privateKey, provider);
    signerAddress = wallet.address;
  }

  if (!/^0x[a-fA-F0-9]{40}$/u.test(signerAddress)) {
    console.error("Could not resolve signer address. Set SIGNER_ADDRESS_OVERRIDE or use --commit with PRIVATE_KEY.");
    process.exitCode = 1;
    return;
  }

  console.log(`# fund-signer-usdc-deposit`);
  console.log(`profile:           ${args.profile}`);
  console.log(`rpc:               ${rpcUrl}`);
  console.log(`usdc:              ${usdcAddress}`);
  console.log(`agentAccountCore:  ${agentAccountAddress}`);
  console.log(`signer:            ${signerAddress}`);
  console.log(`amount (base):     ${amountWei.toString()}`);
  console.log(`amount (USDC):     ${formatUsdc(amountWei)}`);
  console.log(`mode:              ${args.dryRun ? "dry-run" : "commit"}`);
  console.log("");

  const usdc = new Contract(usdcAddress, ERC20_READ_ABI, provider);
  const account = new Contract(agentAccountAddress, AGENT_ACCOUNT_DEPOSIT_ABI, provider);

  const [precompileBalance, allowance, position] = await Promise.all([
    usdc.balanceOf(signerAddress),
    usdc.allowance(signerAddress, agentAccountAddress),
    account.positions(signerAddress, usdcAddress)
  ]);

  console.log(`## Precondition check`);
  console.log(`USDC balance at precompile:               ${precompileBalance.toString()}  (${formatUsdc(precompileBalance)} USDC)`);
  console.log(`current allowance(signer, agentAccount):  ${allowance.toString()}`);
  console.log(`current AgentAccountCore.positions.liquid ${position.liquid.toString()}  (${formatUsdc(position.liquid)} USDC)`);
  console.log("");

  if (BigInt(precompileBalance) < amountWei) {
    console.error(
      `Signer's USDC precompile balance (${precompileBalance.toString()}) is less than --amount ` +
      `(${amountWei.toString()}). Acquire USDC first via PAS→USDC swap on the AssetConversion ` +
      `pallet, or by direct transfer from another USDC holder. See the script comment header.`
    );
    process.exitCode = 2;
    return;
  }

  // Encode planned txs so a reviewer can cross-check before --commit.
  const approveIface = new Interface(ERC20_APPROVE_ABI);
  const depositIface = new Interface(AGENT_ACCOUNT_DEPOSIT_ABI);
  const approveData = approveIface.encodeFunctionData("approve", [agentAccountAddress, amountWei]);
  const depositData = depositIface.encodeFunctionData("deposit", [usdcAddress, amountWei]);

  console.log(`## Planned transactions`);
  console.log(`### 1. approve`);
  console.log(`  to:    ${usdcAddress}`);
  console.log(`  data:  ${approveData}`);
  console.log(`  call:  approve(${agentAccountAddress}, ${amountWei.toString()})`);
  console.log("");
  console.log(`### 2. deposit`);
  console.log(`  to:    ${agentAccountAddress}`);
  console.log(`  data:  ${depositData}`);
  console.log(`  call:  deposit(${usdcAddress}, ${amountWei.toString()})`);
  console.log("");

  if (args.dryRun) {
    console.log("Dry-run only. Re-run with --commit (and PRIVATE_KEY env) to send.");
    return;
  }

  // Commit path.
  const usdcWriter = new Contract(usdcAddress, ERC20_APPROVE_ABI, wallet);
  const agentWriter = new Contract(agentAccountAddress, AGENT_ACCOUNT_DEPOSIT_ABI, wallet);

  console.log(`## Sending`);
  console.log(`approve…`);
  const approveTx = await usdcWriter.approve(agentAccountAddress, amountWei);
  const approveReceipt = await approveTx.wait();
  console.log(`  tx: ${approveTx.hash}  block: ${approveReceipt?.blockNumber}`);

  console.log(`deposit…`);
  const depositTx = await agentWriter.deposit(usdcAddress, amountWei);
  const depositReceipt = await depositTx.wait();
  console.log(`  tx: ${depositTx.hash}  block: ${depositReceipt?.blockNumber}`);

  console.log("");
  const newPosition = await account.positions(signerAddress, usdcAddress);
  const liquidGain = BigInt(newPosition.liquid) - BigInt(position.liquid);
  console.log(`## Postcondition check`);
  console.log(`new AgentAccountCore.positions.liquid:   ${newPosition.liquid.toString()}  (${formatUsdc(newPosition.liquid)} USDC)`);
  console.log(`gained:                                  ${liquidGain.toString()}  (${formatUsdc(liquidGain)} USDC)`);

  if (liquidGain !== amountWei) {
    console.error(
      `Liquid balance gain (${liquidGain.toString()}) does not match expected amount ` +
      `(${amountWei.toString()}). The deposit transaction landed but the resulting liquid ` +
      `delta is unexpected — investigate before relying on this funding.`
    );
    process.exitCode = 3;
    return;
  }

  console.log("");
  console.log("✅ Deposit complete. Hosted product-proof worker loop should now pass the");
  console.log("   liquidity preflight (PR #215) when triggered with PRODUCT_PROOF_REWARD_ASSET=USDC.");
}

function formatUsdc(baseUnits) {
  // 6 decimals per Polkadot docs (asset id 1337). Render with up to 6
  // fractional digits and trim trailing zeros for readability.
  const big = BigInt(baseUnits);
  const whole = big / 1_000_000n;
  const fraction = big % 1_000_000n;
  const fractionText = fraction.toString().padStart(6, "0").replace(/0+$/u, "");
  return fractionText ? `${whole}.${fractionText}` : whole.toString();
}

main().catch((error) => {
  console.error(`fund-signer-usdc-deposit failed: ${error?.stack ?? error?.message ?? error}`);
  process.exitCode = 1;
});
