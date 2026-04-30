#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildXcmRequestPayload,
  resolveDestinationParachainId
} from "../../mcp-server/src/blockchain/xcm-message-builder.js";

const REQUEST_ID = `0x${"11".repeat(32)}`;
const STRATEGY_ID = `0x${"22".repeat(32)}`;
const ACCOUNTING_ASSET = `0x${"33".repeat(20)}`;
const PLACEHOLDER_WITHDRAW_BYTES = "010203040506070809";

if (isMain()) {
  await main();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const checks = [
    await checkDeclaredTooling(),
    checkBuilderOutputs()
  ];
  if (options.strictEnv) checks.push(checkRuntimeEnv());

  const failed = checks.filter((check) => !check.ok);
  for (const check of checks) {
    const marker = check.ok ? "[ok]" : "[fail]";
    console.log(`${marker} ${check.name}`);
    for (const detail of check.details) {
      console.log(`  - ${detail}`);
    }
  }

  if (failed.length > 0) {
    console.error("");
    console.error(`Native XCM capture preflight failed (${failed.length}/${checks.length} checks).`);
    process.exit(1);
  }

  console.log("");
  console.log("Native XCM capture preflight passed.");
}

function isMain() {
  return import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
}

function parseArgs(argv) {
  const parsed = {};
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--strict-env") {
      parsed.strictEnv = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/ops/preflight-native-xcm-capture.mjs [options]

Checks whether this checkout is ready to produce real native XCM evidence.
This is intentionally stricter than validating already-captured JSON fixtures.

Options:
  --strict-env   Also require the live staging API/JWT and native endpoint env.
  --help         Show this help.

Environment checked with --strict-env:
  API_URL
  ADMIN_JWT
  WALLET_JWT
  XCM_NATIVE_HUB_WS
  XCM_NATIVE_BIFROST_WS
`);
}

async function checkDeclaredTooling() {
  const rootPackage = await readPackageJson("package.json");
  const workspacePackages = await Promise.all([
    readPackageJson("mcp-server/package.json"),
    readPackageJson("indexer/package.json")
  ]);
  const dependencyNames = new Set();
  for (const packageJson of [rootPackage, ...workspacePackages]) {
    for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
      for (const name of Object.keys(packageJson[section] ?? {})) {
        dependencyNames.add(name);
      }
    }
  }

  const missing = [];
  for (const required of ["polkadot-api", "@acala-network/chopsticks"]) {
    if (!dependencyNames.has(required)) missing.push(required);
  }

  return {
    name: "PAPI/Chopsticks tooling is declared in package manifests",
    ok: missing.length === 0,
    details: missing.length === 0
      ? ["polkadot-api and @acala-network/chopsticks are declared."]
      : [
          `missing: ${missing.join(", ")}`,
          "real capture needs reproducible PAPI/Chopsticks tooling, not ad hoc global installs"
        ]
  };
}

async function readPackageJson(relativePath) {
  return JSON.parse(await readFile(path.resolve(relativePath), "utf8"));
}

function checkBuilderOutputs() {
  const strategy = {
    strategyId: STRATEGY_ID,
    kind: "polkadot_vdot",
    asset: ACCOUNTING_ASSET,
    assetConfig: {
      assetClass: "custom",
      address: ACCOUNTING_ASSET,
      symbol: "DOT",
      decimals: 18
    },
    xcm: {
      destinationParachain: 2030
    }
  };

  const details = [];
  let ok = true;
  const destinationParaId = resolveDestinationParachainId(strategy);
  details.push(`destination parachain resolves to ${destinationParaId}`);

  const deposit = buildXcmRequestPayload({ strategy, direction: "deposit", requestId: REQUEST_ID });
  const withdraw = buildXcmRequestPayload({ strategy, direction: "withdraw", requestId: REQUEST_ID });

  for (const [label, payload] of [["deposit", deposit], ["withdraw", withdraw]]) {
    const expectedSuffix = `2c${REQUEST_ID.slice(2)}`;
    if (payload.message.toLowerCase().endsWith(expectedSuffix)) {
      details.push(`${label} message ends with SetTopic(requestId)`);
    } else {
      ok = false;
      details.push(`${label} message does not end with SetTopic(requestId)`);
    }
  }

  if (withdraw.message.toLowerCase().includes(PLACEHOLDER_WITHDRAW_BYTES)) {
    ok = false;
    details.push("withdraw message still contains the scaffold byte sequence 0x010203040506070809");
  } else {
    details.push("withdraw message does not contain the known scaffold byte sequence");
  }

  if (deposit.message === withdraw.message) {
    ok = false;
    details.push("deposit and withdraw messages are identical");
  } else {
    details.push("deposit and withdraw messages are distinct");
  }

  return {
    name: "backend vDOT XCM builder is capture-ready",
    ok,
    details
  };
}

function checkRuntimeEnv() {
  const required = [
    "API_URL",
    "ADMIN_JWT",
    "WALLET_JWT",
    "XCM_NATIVE_HUB_WS",
    "XCM_NATIVE_BIFROST_WS"
  ];
  const missing = required.filter((name) => !String(process.env[name] ?? "").trim());
  return {
    name: "live capture environment is configured",
    ok: missing.length === 0,
    details: missing.length === 0
      ? ["required live capture env vars are set"]
      : [`missing: ${missing.join(", ")}`]
  };
}
