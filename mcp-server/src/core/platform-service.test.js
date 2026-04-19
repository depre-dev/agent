import test from "node:test";
import assert from "node:assert/strict";

import { PlatformService } from "./platform-service.js";

const WALLET = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function makePlatformService() {
  const jobs = [
    {
      id: "parent-job-001",
      category: "coding",
      tier: "starter",
      rewardAsset: "DOT",
      rewardAmount: 5,
      verifierMode: "benchmark",
      verifierConfig: {
        version: 1,
        handler: "benchmark",
        requiredKeywords: ["complete"],
        minimumMatches: 1
      },
      inputSchemaRef: "schema://jobs/coding-input",
      outputSchemaRef: "schema://jobs/coding-output",
      claimTtlSeconds: 3600,
      retryLimit: 1,
      requiresSponsoredGas: true
    }
  ];
  const profiles = new Map([
    [WALLET, {
      wallet: WALLET,
      preferredCategories: ["coding"],
      verifierCompatibility: ["benchmark", "deterministic", "human_fallback"],
      preferredRiskLevel: "low",
      capabilities: ["claim_job", "submit_work"],
      supportedProtocols: ["http"],
      minLiquidReserve: 0,
      autoUnwindStrategies: false
    }]
  ]);
  const accounts = new Map([
    [WALLET, {
      wallet: WALLET,
      liquid: { DOT: 10 },
      reserved: {},
      strategyAllocated: {},
      collateralLocked: {},
      jobStakeLocked: {},
      debtOutstanding: {}
    }]
  ]);
  const reputations = new Map([
    [WALLET, { skill: 50, reliability: 50, economic: 50, tier: "starter" }]
  ]);
  return new PlatformService(jobs, profiles, accounts, reputations);
}

test("createSubJob links the child job to the active parent session", async () => {
  const service = makePlatformService();
  const session = await service.claimJob(WALLET, "parent-job-001", "http", "parent-claim");

  const subJob = await service.createSubJob(session.sessionId, WALLET, {
    id: "child-job-001",
    category: "review",
    tier: "starter",
    rewardAmount: 2,
    verifierMode: "benchmark",
    verifierTerms: ["summary"],
    verifierMinimumMatches: 1,
    inputSchemaRef: "schema://jobs/review-input",
    outputSchemaRef: "schema://jobs/pr-review-findings-output",
    claimTtlSeconds: 1800,
    retryLimit: 1,
    requiresSponsoredGas: true
  });

  assert.equal(subJob.parentSessionId, session.sessionId);
  const subJobs = await service.listSubJobs(session.sessionId);
  assert.equal(subJobs.length, 1);
  assert.equal(subJobs[0].id, "child-job-001");
});

test("getSessionTimeline includes transitions and verification state", async () => {
  const service = makePlatformService();
  const session = await service.claimJob(WALLET, "parent-job-001", "http", "timeline-claim");
  const submitted = await service.submitWork(session.sessionId, "http", "complete");
  await service.ingestVerification(submitted.sessionId, {
    jobId: submitted.jobId,
    handler: "benchmark",
    handlerVersion: 1,
    outcome: "approved",
    reasonCode: "BENCHMARK_THRESHOLD_MET"
  });

  const timeline = await service.getSessionTimeline(submitted.sessionId);
  assert.equal(timeline.session.status, "resolved");
  assert.ok(timeline.timeline.some((entry) => entry.type === "session_transition"));
  assert.ok(timeline.timeline.some((entry) => entry.type === "verification"));
});

test("getAdminStatus surfaces recurring scheduler anomalies", async () => {
  const service = makePlatformService();
  service.recurringScheduler = {
    getStatus() {
      return {
        enabled: true,
        running: true,
        templates: [
          {
            templateId: "weekly-digest",
            lastResult: {
              status: "failed"
            }
          }
        ]
      };
    }
  };

  const status = await service.getAdminStatus({
    auth: {
      wallet: WALLET,
      claims: { roles: ["admin"] },
      capabilities: ["admin:status"]
    }
  });

  assert.equal(status.auth.wallet, WALLET);
  assert.ok(status.anomalies.some((entry) => entry.code === "recurring_attention"));
});
