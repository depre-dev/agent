#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { validateEvidence } from "./validate-native-xcm-evidence.mjs";

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

const required = ["deposit", "withdraw", "failure"];
for (const key of required) {
  if (!options[key]) {
    fail(`missing --${key} <path>.`);
  }
}

const captures = [
  await loadCapture("deposit", options.deposit),
  await loadCapture("withdraw", options.withdraw),
  await loadCapture("failure", options.failure)
];

assertExpectedCapture(captures[0], { label: "deposit", direction: "deposit", status: "succeeded" });
assertExpectedCapture(captures[1], { label: "withdraw", direction: "withdraw", status: "succeeded" });
assertExpectedCapture(captures[2], { label: "failure", status: "failed" });

const methods = new Set(captures.map(({ evidence }) => evidence.correlation.method));
if (methods.has("ledger_join")) {
  fail("ledger_join evidence is staging-only and cannot satisfy the native observer launch gate.");
}
if (methods.size > 1) {
  fail(`all captures must use the same production correlation method; got ${[...methods].join(", ")}.`);
}

const [method] = methods;
const confidenceOrder = new Map([
  ["staging", 0],
  ["production_candidate", 1],
  ["production", 2]
]);

for (const { label, evidence } of captures) {
  const confidence = evidence.correlation.confidence;
  if ((confidenceOrder.get(confidence) ?? -1) < confidenceOrder.get("production_candidate")) {
    fail(`${label} evidence must be production_candidate or production; got ${confidence}.`);
  }
}

console.log("Native XCM evidence pack validated.");
console.log(`Correlation method: ${method}`);
for (const { label, outcome, evidence } of captures) {
  console.log(
    `${label}: ${outcome.requestId} ${evidence.direction}/${outcome.status} ` +
      `confidence=${evidence.correlation.confidence} remoteRef=${outcome.remoteRef ?? "none"}`
  );
}

if (method === "request_id_in_message") {
  console.log("Decision: SetTopic/request-id correlation is supported by this evidence pack.");
} else if (method === "remote_ref") {
  console.log("Decision: remote_ref fallback is supported by this evidence pack.");
} else {
  fail(`unsupported production correlation method: ${method}.`);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/gu, (_, char) => char.toUpperCase());
      parsed[key] = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/ops/check-native-xcm-evidence-pack.mjs [options]

Validates the three native XCM captures required before promoting the native
observer toward production settlement truth.

Required:
  --deposit <path>    Successful deposit evidence JSON.
  --withdraw <path>   Successful withdraw evidence JSON.
  --failure <path>    Failed request evidence JSON.

Rules:
  - each file must pass validate-native-xcm-evidence
  - deposit must be direction=deposit and status=succeeded
  - withdraw must be direction=withdraw and status=succeeded
  - failure must be status=failed and include a failureCode
  - confidence must be production_candidate or production
  - ledger_join is rejected because it is staging-only
  - all three captures must use the same production correlation method
`);
}

async function loadCapture(label, filePath) {
  const absolutePath = path.resolve(filePath);
  const evidence = JSON.parse(await readFile(absolutePath, "utf8"));
  const outcome = validateEvidence(evidence);
  return { label, filePath: absolutePath, evidence, outcome };
}

function assertExpectedCapture({ evidence, outcome }, { label, direction, status }) {
  if (direction && evidence.direction !== direction) {
    fail(`${label} evidence must have direction=${direction}; got ${evidence.direction}.`);
  }
  if (outcome.status !== status) {
    fail(`${label} evidence must have status=${status}; got ${outcome.status}.`);
  }
}

function fail(message) {
  throw new Error(message);
}
