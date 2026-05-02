/**
 * Live session-lifecycle stages for the runs panel.
 *
 * Replaces the four FIXTURE_LIFECYCLE_* arrays at the page level. A row
 * loaded from `/jobs[]` or `/admin/jobs[]` carries `claim.state`,
 * `claim.claimedAt`, and `claim.claimExpiresAt` once the run has a
 * session in flight; this builder turns those into the 5-stage rail
 * the LifecycleRail component already knows how to render.
 *
 * Source-aware on the third stage label (PR submitted / Proposal
 * submitted / Audit submitted) so the copy matches the loaded row's
 * provenance — same split as the FIXTURE_LIFECYCLE_* variants.
 */

import type { LifecycleStage } from "./LifecycleRail";
import type { JobSource } from "./types";
import type { ClaimEffectiveState, ClaimSummary } from "@/lib/api/claim-status";

interface BuildArgs {
  /** Live claim state from the loaded row. Optional so we can still
   *  render a sensible 5-stage skeleton when the row is fixture-only. */
  claim?: ClaimSummary;
  source?: JobSource;
  /** Falls back to `Date.now()` so SSR + first paint produce a stable
   *  rail; callers in client components can pass a memoised "now" when
   *  they want to drive the deadline countdown. */
  now?: Date;
}

const SUBMITTED_LABEL: Record<string, string> = {
  github_issue: "PR submitted",
  wikipedia_article: "Proposal submitted",
  osv_advisory: "PR submitted",
  open_data_dataset: "Audit submitted",
  openapi_spec: "Audit submitted",
  standards_spec: "Audit submitted",
  native: "Submitted",
};

export function buildLifecycleStages({
  claim,
  source,
  now = new Date(),
}: BuildArgs): LifecycleStage[] {
  const submittedLabel = SUBMITTED_LABEL[source?.type ?? "native"] ?? "Submitted";
  const state: ClaimEffectiveState = claim?.state ?? "claimable";

  // The first stage is always "Ready" (the catalog row exists). We
  // only mark the rest based on what the live state tells us.
  const stages: Array<Omit<LifecycleStage, "index">> = [
    {
      label: "Ready",
      meta: "—",
      state: "done",
    },
    {
      label: "Claimed",
      meta: claim?.claimedAt
        ? `${formatTime(claim.claimedAt)}${
            claim.claimedBy ? ` · by ${shortWallet(claim.claimedBy)}` : ""
          }`
        : "—",
      state: stageStateFor(state, "claimed"),
    },
    {
      label: submittedLabel,
      meta: state === "submitted" || isPostSubmission(state)
        ? "evidence sent"
        : claim?.claimExpiresAt && state === "claimed"
          ? deadlineCountdown(claim.claimExpiresAt, now)
          : "—",
      state: stageStateFor(state, "submitted"),
    },
    {
      label: "Verified",
      meta: state === "submitted" ? "awaiting verifier" : "—",
      state: stageStateFor(state, "verified"),
    },
    {
      label: "Paid",
      meta: "—",
      state: stageStateFor(state, "paid"),
    },
  ];
  return stages.map((stage, idx) => ({ ...stage, index: idx + 1 }));
}

/**
 * For each rail stage, derive its visual state (done / current /
 * pending) from the live claim `effectiveState`.
 *
 * The mapping has to be lossy — there's no first-class "verified" or
 * "paid" claim state today (verification + settlement are downstream
 * of `submitted`). We treat `submitted` as "Submitted is done, Verified
 * is current"; once a verified/settled state surfaces we can extend
 * this without churning callers.
 */
function stageStateFor(
  state: ClaimEffectiveState,
  stage: "claimed" | "submitted" | "verified" | "paid"
): LifecycleStage["state"] {
  if (state === "exhausted" || state === "expired") {
    // The row is out of attempts; nothing past Ready is current. Mark
    // everything else as pending so the rail doesn't pretend a future
    // claim is in progress.
    return "pending";
  }
  if (state === "claimable") {
    return "pending";
  }
  if (state === "claimed") {
    if (stage === "claimed") return "current";
    return "pending";
  }
  if (state === "submitted") {
    if (stage === "claimed") return "done";
    if (stage === "submitted") return "done";
    if (stage === "verified") return "current";
    return "pending";
  }
  return "pending";
}

function isPostSubmission(state: ClaimEffectiveState): boolean {
  return state === "submitted";
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // HH:MM:SS UTC — matches the visual rhythm the fixture rail used.
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function shortWallet(wallet: string): string {
  const trimmed = wallet.trim();
  if (trimmed.length <= 10) return trimmed;
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
}

function deadlineCountdown(iso: string, now: Date): string {
  const deadline = Date.parse(iso);
  if (!Number.isFinite(deadline)) return "—";
  const diff = deadline - now.getTime();
  if (diff <= 0) return "deadline passed";
  const minutes = Math.floor(diff / 60_000);
  const seconds = Math.floor((diff % 60_000) / 1000);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `closes in ${hours}h ${mins}m`;
  }
  return `closes in ${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/**
 * Same idea as `deadlineCountdown` but exposed for the page-level
 * "Window closes in 21m 46s" header. Returns the raw ISO when no
 * deadline is known so callers can drop the line entirely.
 */
export function formatDeadline(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  return deadlineCountdown(iso, now);
}

/**
 * Friendly "by 0x30bc…ee05" / "by you" label for the CLAIMED stage.
 * Pass the connected wallet (lowercase) when known so we render
 * "(you)" instead of the bare address.
 */
export function describeClaimer(
  claimedBy: string | undefined,
  connectedWallet: string | undefined
): string {
  if (!claimedBy) return "";
  if (
    connectedWallet &&
    claimedBy.toLowerCase() === connectedWallet.toLowerCase()
  ) {
    return "by you";
  }
  return `by ${shortWallet(claimedBy)}`;
}
