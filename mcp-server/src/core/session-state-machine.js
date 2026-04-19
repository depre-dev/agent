import { ConflictError } from "./errors.js";

const ALLOWED_TRANSITIONS = new Map([
  ["__new__", new Set(["claimed"])],
  ["claimed", new Set(["submitted", "expired", "timed_out", "closed"])],
  ["submitted", new Set(["resolved", "rejected", "disputed", "timed_out", "closed"])],
  ["disputed", new Set(["resolved", "rejected", "closed"])],
  ["resolved", new Set()],
  ["rejected", new Set()],
  ["closed", new Set()],
  ["expired", new Set()],
  ["timed_out", new Set()]
]);

export function transitionSession(session, nextStatus, { reason, timestamp = new Date().toISOString(), metadata = undefined } = {}) {
  const currentStatus = session?.status ?? "__new__";
  if (currentStatus === nextStatus) {
    return session;
  }

  const allowed = ALLOWED_TRANSITIONS.get(currentStatus) ?? new Set();
  if (!allowed.has(nextStatus)) {
    throw new ConflictError(
      `Invalid session transition: ${currentStatus} -> ${nextStatus}`,
      "invalid_session_transition",
      { currentStatus, nextStatus, reason }
    );
  }

  const history = [...(session?.statusHistory ?? []), compact({
    from: currentStatus === "__new__" ? null : currentStatus,
    to: nextStatus,
    reason,
    at: timestamp,
    metadata
  })];

  return compact({
    ...session,
    status: nextStatus,
    statusHistory: history,
    claimedAt: nextStatus === "claimed" ? timestamp : session?.claimedAt,
    submittedAt: nextStatus === "submitted" ? timestamp : session?.submittedAt,
    resolvedAt: nextStatus === "resolved" ? timestamp : session?.resolvedAt,
    rejectedAt: nextStatus === "rejected" ? timestamp : session?.rejectedAt,
    disputedAt: nextStatus === "disputed" ? timestamp : session?.disputedAt,
    closedAt: nextStatus === "closed" ? timestamp : session?.closedAt,
    expiredAt: nextStatus === "expired" ? timestamp : session?.expiredAt,
    timedOutAt: nextStatus === "timed_out" ? timestamp : session?.timedOutAt
  });
}

function compact(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  );
}
