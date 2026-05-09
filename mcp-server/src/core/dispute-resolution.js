import { keccak256, toUtf8Bytes } from "ethers";
import { ValidationError } from "./errors.js";

export const ARBITRATOR_SLA_SECONDS = 14 * 24 * 60 * 60;

/**
 * Stable id for the dispute associated with a session. Hashed from
 * the session id so the same dispute id is computed everywhere
 * (HTTP route, state-store mutation receipts, profile dispute
 * history). Stays usable as a public identifier without leaking the
 * raw session id.
 */
export function disputeIdForSession(sessionId) {
  return `dispute-${keccak256(toUtf8Bytes(String(sessionId))).slice(2, 14)}`;
}

/**
 * Add a fixed seconds offset to an ISO timestamp, returning the
 * same ISO format. Used to derive the SLA window end for a dispute
 * (`openedAt + ARBITRATOR_SLA_SECONDS`). Treats unparseable inputs
 * as undefined so the caller can render `—` rather than `NaN`.
 */
export function addSecondsIso(iso, seconds) {
  if (typeof iso !== "string") return undefined;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return undefined;
  return new Date(t + seconds * 1000).toISOString();
}

export const DISPUTE_REASON_CODES = Object.freeze({
  upheld: "DISPUTE_LOST",
  dismissed: "DISPUTE_OVERTURNED",
  split: "DISPUTE_PARTIAL",
  timeout: "ARB_TIMEOUT"
});

export function normalizeDisputeVerdict(value) {
  const verdict = String(value ?? "").trim().toLowerCase();
  if (verdict === "upheld" || verdict === "uphold") return "upheld";
  if (verdict === "dismissed" || verdict === "dismiss" || verdict === "rejected" || verdict === "reject") {
    return "dismissed";
  }
  if (verdict === "split" || verdict === "partial" || verdict === "request-more") return "split";
  if (verdict === "timeout" || verdict === "arb_timeout") return "timeout";
  throw new ValidationError("verdict must be one of upheld, dismissed, split.");
}

export function buildDisputeResolution({ verdict, remainingPayout, workerPayout = undefined } = {}) {
  const normalized = normalizeDisputeVerdict(verdict);
  const remaining = normalizePayout(remainingPayout, "remainingPayout");

  if (normalized === "upheld") {
    return {
      verdict: normalized,
      workerPayout: 0,
      reasonCode: DISPUTE_REASON_CODES.upheld,
      nextSessionStatus: "rejected",
      releaseAction: "slash-to-treasury"
    };
  }

  if (normalized === "dismissed" || normalized === "timeout") {
    return {
      verdict: normalized,
      workerPayout: remaining,
      reasonCode: DISPUTE_REASON_CODES[normalized],
      nextSessionStatus: "resolved",
      releaseAction: "return-to-depositor"
    };
  }

  const explicit = workerPayout === undefined || workerPayout === null || workerPayout === ""
    ? defaultPartialPayout(remaining)
    : normalizePayout(workerPayout, "workerPayout");
  if (explicit <= 0 || explicit > remaining) {
    throw new ValidationError("workerPayout for split verdicts must be greater than zero and no more than the remaining payout.", {
      workerPayout: explicit,
      remainingPayout: remaining
    });
  }

  return {
    verdict: normalized,
    workerPayout: explicit,
    reasonCode: DISPUTE_REASON_CODES.split,
    nextSessionStatus: "resolved",
    releaseAction: "return-to-depositor",
    payoutSource: workerPayout === undefined || workerPayout === null || workerPayout === ""
      ? "default_half_remaining"
      : "operator_supplied"
  };
}

function normalizePayout(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ValidationError(`${label} must be a non-negative number.`);
  }
  return parsed;
}

function defaultPartialPayout(remaining) {
  if (remaining <= 1) {
    return remaining;
  }
  return Math.floor(remaining / 2);
}
