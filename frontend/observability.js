/**
 * Frontend Sentry seam.
 *
 * Sentry is opt-in and loaded via a CDN <script> tag in index.html so we
 * don't pull a bundler into the vanilla-JS setup. When
 * `window.Sentry` is present this module initialises it with the DSN from
 * runtime config; when absent, `captureException` / `captureMessage` fall
 * back to the existing `debug` logger.
 *
 * The operator enables Sentry by:
 *   1. Uncommenting the Sentry <script> tag in index.html
 *   2. Setting `sentryDsn` on `window.__AVERRAY_CONFIG__`
 */

import { getConfig } from "./config.js";
import { debug } from "./ui-helpers.js";

let initialised = false;

export function initObservability() {
  if (initialised) return;
  initialised = true;

  const config = getConfig();
  if (!config.sentryDsn) return;
  if (typeof window === "undefined" || !window.Sentry) {
    debug.warn("[observability] sentryDsn configured but window.Sentry is not loaded");
    return;
  }

  try {
    window.Sentry.init({
      dsn: config.sentryDsn,
      environment: config.sentryEnvironment,
      release: config.sentryRelease || undefined,
      tracesSampleRate: config.sentryTracesSampleRate
    });
    // Surface otherwise-silent global errors.
    window.addEventListener("error", (event) => {
      captureException(event.error ?? new Error(event.message ?? "window.error"), {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
      });
    });
    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
      captureException(reason, { kind: "unhandledrejection" });
    });
  } catch (error) {
    debug.error("[observability] Sentry.init threw", error);
  }
}

export function captureException(error, context = {}) {
  try {
    window?.Sentry?.captureException(error, { extra: context });
  } catch {
    // Never let telemetry break the page.
  }
  debug.error(error, context);
}

export function captureMessage(message, { level = "info", ...context } = {}) {
  try {
    window?.Sentry?.captureMessage(message, { level, extra: context });
  } catch {
    // fall through
  }
  (debug[level] ?? debug.log)(message, context);
}
