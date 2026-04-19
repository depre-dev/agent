import test from "node:test";
import assert from "node:assert/strict";

import { VerifierService } from "./verifier-service.js";
import { MemoryStateStore } from "../core/state-store.js";
import { transitionSession } from "../core/session-state-machine.js";
import { normalizeSubmission } from "../core/submission.js";

const SESSION_ID = "release-readiness-check-001:0xabc";

test("verifySubmission persists verification input and supports replay", async () => {
  const stateStore = new MemoryStateStore();
  const session = transitionSession({
    sessionId: SESSION_ID,
    wallet: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    jobId: "release-readiness-check-001",
    submission: normalizeSubmission({
      release_id: "release-2026-04-19",
      checks_passed: ["api-health", "indexer-health"],
      checks_failed: [],
      blockers: [],
      go_no_go: "go"
    })
  }, "claimed", { reason: "job_claimed" });

  const submitted = transitionSession(session, "submitted", { reason: "work_submitted" });
  await stateStore.upsertSession(submitted);

  const job = {
    id: "release-readiness-check-001",
    verifierMode: "deterministic",
    verifierConfig: {
      version: 1,
      handler: "deterministic",
      expectedOutputs: ["release_id", "checks_passed", "go_no_go"],
      matchMode: "contains_all"
    }
  };

  const platformService = {
    resumeSession: (sessionId) => stateStore.getSession(sessionId),
    getJobDefinition: () => job,
    ingestVerification: async (sessionId, verdict) => {
      const current = await stateStore.getSession(sessionId);
      const updated = transitionSession(current, verdict.outcome === "approved" ? "resolved" : "rejected", {
        reason: "verification_resolved"
      });
      await stateStore.upsertSession(updated);
      return updated;
    }
  };

  const service = new VerifierService(platformService, stateStore);
  const result = await service.verifySubmission({ sessionId: SESSION_ID });

  assert.equal(result.outcome, "approved");
  assert.equal(result.handlerVersion, 1);
  assert.equal(result.verifierConfigVersion, 1);
  assert.equal(result.verificationInput.kind, "structured");

  const replay = await service.replayVerification(SESSION_ID);
  assert.equal(replay.replay, true);
  assert.equal(replay.outcome, "approved");
  assert.equal(replay.originalOutcome, "approved");
});
