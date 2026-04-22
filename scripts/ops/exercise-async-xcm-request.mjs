#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);

let apiUrl = process.env.API_URL ?? "";
let token = process.env.ADMIN_JWT ?? process.env.TOKEN ?? "";
let requestId = process.env.REQUEST_ID ?? "";
let mode = process.env.XCM_EXERCISE_MODE ?? "observe";
let status = process.env.XCM_EXERCISE_STATUS ?? "succeeded";
let settledAssets = process.env.XCM_SETTLED_ASSETS ?? "0";
let settledShares = process.env.XCM_SETTLED_SHARES ?? "0";
let source = process.env.XCM_EXERCISE_SOURCE ?? "manual_staging";
let remoteRef = process.env.XCM_REMOTE_REF ?? "";
let failureCode = process.env.XCM_FAILURE_CODE ?? "";
let capturePath = process.env.XCM_CAPTURE_PATH ?? "";
let pollMs = parsePositiveInt(process.env.XCM_POLL_MS, 1000);
let timeoutMs = parsePositiveInt(process.env.XCM_TIMEOUT_MS, 30000);

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--api") {
    apiUrl = args[index + 1] ?? "";
    index += 1;
    continue;
  }
  if (arg === "--token") {
    token = args[index + 1] ?? "";
    index += 1;
    continue;
  }
  if (arg === "--request-id") {
    requestId = args[index + 1] ?? "";
    index += 1;
    continue;
  }
  if (arg === "--mode") {
    mode = args[index + 1] ?? mode;
    index += 1;
    continue;
  }
  if (arg === "--status") {
    status = args[index + 1] ?? status;
    index += 1;
    continue;
  }
  if (arg === "--settled-assets") {
    settledAssets = args[index + 1] ?? settledAssets;
    index += 1;
    continue;
  }
  if (arg === "--settled-shares") {
    settledShares = args[index + 1] ?? settledShares;
    index += 1;
    continue;
  }
  if (arg === "--source") {
    source = args[index + 1] ?? source;
    index += 1;
    continue;
  }
  if (arg === "--remote-ref") {
    remoteRef = args[index + 1] ?? remoteRef;
    index += 1;
    continue;
  }
  if (arg === "--failure-code") {
    failureCode = args[index + 1] ?? failureCode;
    index += 1;
    continue;
  }
  if (arg === "--capture") {
    capturePath = args[index + 1] ?? capturePath;
    index += 1;
    continue;
  }
  if (arg === "--poll-ms") {
    pollMs = parsePositiveInt(args[index + 1], pollMs);
    index += 1;
    continue;
  }
  if (arg === "--timeout-ms") {
    timeoutMs = parsePositiveInt(args[index + 1], timeoutMs);
    index += 1;
    continue;
  }
  if (arg === "--help" || arg === "-h") {
    printHelp();
    process.exit(0);
  }
  fail(`unknown flag: ${arg}`);
}

apiUrl = trimTrailingSlash(apiUrl);
requestId = String(requestId).trim();
mode = String(mode).trim().toLowerCase();
status = String(status).trim().toLowerCase();
remoteRef = normalizeOptionalHex32(remoteRef, "remoteRef");
failureCode = normalizeOptionalHex32(failureCode, "failureCode");

if (!apiUrl) fail("missing API URL. Pass --api https://api.averray.com or set API_URL.");
if (!token) fail("missing admin token. Pass --token <jwt> or set ADMIN_JWT.");
if (!/^0x[a-fA-F0-9]{64}$/u.test(requestId)) fail("requestId must be a 0x-prefixed 32-byte hex string.");
if (!["observe", "finalize"].includes(mode)) fail('mode must be "observe" or "finalize".');
if (!["pending", "succeeded", "failed", "cancelled"].includes(status)) {
  fail('status must be one of "pending", "succeeded", "failed", "cancelled".');
}

const payload = {
  requestId,
  status,
  settledAssets: parseNonNegativeNumber(settledAssets, "settledAssets"),
  settledShares: parseNonNegativeNumber(settledShares, "settledShares"),
  remoteRef: remoteRef || undefined,
  failureCode: failureCode || undefined,
  source,
  idempotencyKey: `staging:${mode}:${requestId}:${status}:${Date.now()}`
};

const before = await readJson(`${apiUrl}/xcm/request?requestId=${encodeURIComponent(requestId)}`, token);
const adminStatusBefore = mode === "observe"
  ? await readJson(`${apiUrl}/admin/status`, token).catch(() => undefined)
  : undefined;

const actionUrl = `${apiUrl}${mode === "observe" ? "/admin/xcm/observe" : "/admin/xcm/finalize"}`;
const actionResponse = await postJson(actionUrl, payload, token);

let finalRequest = undefined;
let adminStatusAfter = undefined;
if (mode === "observe") {
  finalRequest = await pollForTerminalRequest(apiUrl, token, requestId, {
    pollMs,
    timeoutMs
  });
  adminStatusAfter = await readJson(`${apiUrl}/admin/status`, token).catch(() => undefined);
} else {
  finalRequest = actionResponse;
}

const report = {
  generatedAt: new Date().toISOString(),
  mode,
  requestId,
  payload,
  before,
  actionResponse,
  finalRequest,
  adminStatusBefore: summarizeAdminStatus(adminStatusBefore),
  adminStatusAfter: summarizeAdminStatus(adminStatusAfter)
};

if (capturePath) {
  const absoluteCapturePath = path.resolve(capturePath);
  await mkdir(path.dirname(absoluteCapturePath), { recursive: true });
  await writeFile(absoluteCapturePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Saved async XCM exercise report to ${absoluteCapturePath}`);
}

console.log(`Async XCM ${mode} completed for ${requestId}`);
console.log(`Initial status: ${before.statusLabel}`);
console.log(`Final status: ${finalRequest?.statusLabel ?? finalRequest?.strategyRequest?.statusLabel ?? "unknown"}`);
console.log(`Settled assets: ${finalRequest?.settledAssets ?? finalRequest?.strategyRequest?.settledAssets ?? payload.settledAssets}`);
console.log(`Settled shares: ${finalRequest?.settledShares ?? finalRequest?.strategyRequest?.settledShares ?? payload.settledShares}`);
if (adminStatusAfter?.xcmSettlementWatcher) {
  console.log(`Watcher pending count: ${adminStatusAfter.xcmSettlementWatcher.pendingCount}`);
}

async function pollForTerminalRequest(baseUrl, bearerToken, targetRequestId, { pollMs, timeoutMs }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const current = await readJson(
      `${baseUrl}/xcm/request?requestId=${encodeURIComponent(targetRequestId)}`,
      bearerToken
    );
    if (["succeeded", "failed", "cancelled"].includes(String(current.statusLabel ?? "").toLowerCase())) {
      return current;
    }
    await sleep(pollMs);
  }
  fail(`timed out waiting ${timeoutMs}ms for request ${targetRequestId} to reach a terminal status`);
}

function summarizeAdminStatus(statusPayload) {
  if (!statusPayload || typeof statusPayload !== "object") {
    return undefined;
  }
  return {
    watcher: statusPayload.xcmSettlementWatcher
      ? {
          enabled: statusPayload.xcmSettlementWatcher.enabled,
          running: statusPayload.xcmSettlementWatcher.running,
          pendingCount: statusPayload.xcmSettlementWatcher.pendingCount
        }
      : undefined,
    relay: statusPayload.xcmObservationRelay
      ? {
          enabled: statusPayload.xcmObservationRelay.enabled,
          running: statusPayload.xcmObservationRelay.running,
          syncing: statusPayload.xcmObservationRelay.syncing,
          lastError: statusPayload.xcmObservationRelay.lastError
        }
      : undefined
  };
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/u, "");
}

async function readJson(url, bearerToken) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${bearerToken}`
    }
  });
  if (!response.ok) {
    fail(`GET ${url} failed: ${response.status} ${response.statusText}\n${await response.text()}`);
  }
  return response.json();
}

async function postJson(url, body, bearerToken) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${bearerToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    fail(`POST ${url} failed: ${response.status} ${response.statusText}\n${await response.text()}`);
  }
  return response.json();
}

function parsePositiveInt(raw, fallback) {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeNumber(raw, field) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    fail(`${field} must be a finite non-negative number`);
  }
  return parsed;
}

function normalizeOptionalHex32(value, field) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return "";
  }
  const normalized = String(value).trim();
  if (!/^0x[a-fA-F0-9]{64}$/u.test(normalized)) {
    fail(`${field} must be a 0x-prefixed 32-byte hex string when provided`);
  }
  return normalized;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function printHelp() {
  console.log(`Exercise an existing async XCM request through the hosted API.

Usage:
  node scripts/ops/exercise-async-xcm-request.mjs \\
    --api https://api.averray.com \\
    --token <admin-jwt> \\
    --request-id 0x... \\
    --mode observe \\
    --status succeeded \\
    --settled-assets 5 \\
    --settled-shares 5

Modes:
  observe   POST /admin/xcm/observe, then wait for the watcher to auto-finalize
  finalize  POST /admin/xcm/finalize directly

Environment:
  API_URL
  ADMIN_JWT or TOKEN
  REQUEST_ID
  XCM_EXERCISE_MODE
  XCM_EXERCISE_STATUS
  XCM_SETTLED_ASSETS
  XCM_SETTLED_SHARES
  XCM_EXERCISE_SOURCE
  XCM_REMOTE_REF
  XCM_FAILURE_CODE
  XCM_CAPTURE_PATH
  XCM_POLL_MS
  XCM_TIMEOUT_MS
`);
}
