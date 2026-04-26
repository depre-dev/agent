"use client";

import { cn } from "@/lib/utils/cn";

/**
 * "Where is this page reading from?" indicator.
 *
 * Every operator page mixes live SWR responses with fixture fallbacks,
 * which means a stale fixture can silently render after a backend
 * outage with no visual signal. This pill makes that distinction
 * explicit in the topbar, so an operator scanning the dashboard knows
 * whether to trust the numbers in front of them.
 *
 * Three states only — keep it tight:
 *   - `live`     · everything resolved, no errors      → green
 *   - `loading`  · still waiting on the first response → blue, pulsing
 *   - `fallback` · request errored or returned nothing → amber
 *
 * "Error" is not a separate state because the UI behaviour is the
 * same in both cases (we render fixtures), and showing two different
 * pills for "the API is down" vs. "the API is intentionally not wired
 * yet" would just confuse operators who can't act on the difference.
 */
export type FreshnessState = "live" | "loading" | "fallback";

const STATE_CLS: Record<
  FreshnessState,
  { dot: string; bg: string; text: string }
> = {
  live: {
    dot: "bg-[var(--avy-accent)]",
    bg: "bg-[var(--avy-accent-soft)]",
    text: "text-[var(--avy-accent)]",
  },
  loading: {
    dot: "bg-[#254e9a] [animation:pulse_1.6s_ease-in-out_infinite]",
    bg: "bg-[#e6ecf7]",
    text: "text-[#254e9a]",
  },
  fallback: {
    dot: "bg-[var(--avy-warn)]",
    bg: "bg-[var(--avy-warn-soft)]",
    text: "text-[var(--avy-warn)]",
  },
};

const STATE_LABEL: Record<FreshnessState, string> = {
  live: "Live API",
  loading: "Loading",
  fallback: "Fixture data",
};

const STATE_TITLE: Record<FreshnessState, string> = {
  live: "Live data from the operator API.",
  loading: "Still waiting on the first API response.",
  fallback:
    "API errored or has not been wired yet — page is rendering fixture data.",
};

export function DataFreshnessPill({
  state,
  meta,
  className,
}: {
  state: FreshnessState;
  /** Optional override for the hover title — defaults are usually enough. */
  meta?: string;
  className?: string;
}) {
  const s = STATE_CLS[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 font-[family-name:var(--font-display)] text-[10px] font-extrabold uppercase",
        s.bg,
        s.text,
        className
      )}
      style={{ letterSpacing: "0.1em" }}
      title={meta ?? STATE_TITLE[state]}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
      {STATE_LABEL[state]}
    </span>
  );
}

/**
 * Derive a single freshness state from one or more SWR-style requests.
 *
 *   - if any request errored → `fallback`
 *   - else if all requests are still loading and have no data → `loading`
 *   - else → `live`
 *
 * The "error" branch comes first because once any request has failed,
 * the page is definitely rendering against the fallback path — even if
 * other requests are still in flight or have already resolved live.
 */
export function freshnessFromRequests(
  ...requests: { data?: unknown; error?: unknown; isLoading?: boolean }[]
): FreshnessState {
  if (requests.length === 0) return "fallback";
  if (requests.some((r) => Boolean(r.error))) return "fallback";
  if (requests.every((r) => !r.data && r.isLoading)) return "loading";
  return "live";
}
