import test from "node:test";
import assert from "node:assert/strict";

import { ConflictError } from "./errors.js";
import { transitionSession } from "./session-state-machine.js";

test("transitionSession creates a claimed session from a new session", () => {
  const session = transitionSession(
    { sessionId: "job-1:wallet-1" },
    "claimed",
    { reason: "job_claimed", timestamp: "2026-04-19T10:00:00.000Z" }
  );

  assert.equal(session.status, "claimed");
  assert.equal(session.claimedAt, "2026-04-19T10:00:00.000Z");
  assert.equal(session.statusHistory.length, 1);
  assert.equal(session.statusHistory[0].from, null);
  assert.equal(session.statusHistory[0].to, "claimed");
});

test("transitionSession records submitted transition history", () => {
  const claimed = transitionSession({ sessionId: "job-1:wallet-1" }, "claimed", {
    reason: "job_claimed",
    timestamp: "2026-04-19T10:00:00.000Z"
  });

  const submitted = transitionSession(claimed, "submitted", {
    reason: "work_submitted",
    timestamp: "2026-04-19T10:05:00.000Z",
    metadata: { protocol: "http" }
  });

  assert.equal(submitted.status, "submitted");
  assert.equal(submitted.submittedAt, "2026-04-19T10:05:00.000Z");
  assert.equal(submitted.statusHistory.length, 2);
  assert.equal(submitted.statusHistory[1].metadata.protocol, "http");
});

test("transitionSession rejects illegal transitions", () => {
  const claimed = transitionSession({ sessionId: "job-1:wallet-1" }, "claimed", {
    reason: "job_claimed"
  });

  assert.throws(
    () => transitionSession(claimed, "resolved", { reason: "skip_submit" }),
    (error) => error instanceof ConflictError && error.code === "invalid_session_transition"
  );
});
