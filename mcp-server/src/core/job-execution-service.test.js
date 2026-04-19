import test from "node:test";
import assert from "node:assert/strict";

import { ValidationError } from "./errors.js";
import { JobExecutionService } from "./job-execution-service.js";
import { MemoryStateStore } from "./state-store.js";

const WALLET = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function makeJob(overrides = {}) {
  return {
    id: "pr-review-job-001",
    category: "review",
    tier: "starter",
    rewardAsset: "DOT",
    rewardAmount: 6,
    verifierMode: "benchmark",
    verifierConfig: {
      version: 1,
      handler: "benchmark",
      requiredKeywords: ["summary", "findings", "risk_level"],
      minimumMatches: 2
    },
    outputSchemaRef: "schema://jobs/pr-review-findings-output",
    claimTtlSeconds: 3600,
    ...overrides
  };
}

test("submitWork accepts structured output for built-in schemas", async () => {
  const stateStore = new MemoryStateStore();
  const job = makeJob();
  const service = new JobExecutionService(stateStore, undefined, () => job);

  const claimed = await service.claimJob(WALLET, job.id, "http", "idemp-1");
  const submitted = await service.submitWork(claimed.sessionId, "http", {
    summary: "Auth flow has one blocker.",
    findings: [
      {
        severity: "high",
        file: "frontend/auth.js",
        issue: "Session refresh is hidden behind retry logic.",
        recommendation: "Show a visible sign-in refresh path."
      }
    ],
    risk_level: "high",
    files_touched: ["frontend/auth.js"],
    recommended_next_step: "request_changes"
  });

  assert.equal(submitted.status, "submitted");
  assert.equal(submitted.submission.kind, "structured");
  assert.equal(submitted.statusHistory.length, 2);
  assert.equal(submitted.statusHistory[1].metadata.schemaRef, "schema://jobs/pr-review-findings-output");
});

test("submitWork rejects structured output when the schema ref is unknown", async () => {
  const stateStore = new MemoryStateStore();
  const job = makeJob({ outputSchemaRef: "schema://jobs/custom-output" });
  const service = new JobExecutionService(stateStore, undefined, () => job);

  const claimed = await service.claimJob(WALLET, job.id, "http", "idemp-2");

  await assert.rejects(
    () => service.submitWork(claimed.sessionId, "http", { anything: "goes" }),
    (error) => error instanceof ValidationError && /known built-in schema/.test(error.message)
  );
});
