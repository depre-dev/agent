/**
 * Runtime configuration for the frontend.
 *
 * The app is served as static files, so we can't inject env vars at build
 * time the way a bundled SPA would. Instead the operator populates
 * `window.__AVERRAY_CONFIG__` via an inline <script> in index.html (or a
 * server-templated snippet), and every module calls `getConfig()` to read
 * the merged view.
 *
 * Missing or invalid values fall back to defaults that match the legacy
 * same-origin deployment, so existing testnet setups keep working without a
 * config change.
 */

const defaults = {
  apiBaseUrl: "/api",
  sentryDsn: "",
  sentryScriptUrl: "",
  sentryEnvironment: "production",
  sentryRelease: "",
  sentryTracesSampleRate: 0,
  chainId: 0,
  chainName: "",
  siweStatement: "Sign in to the Agent Platform.",
  debug: false
};

let cached;

export function getConfig() {
  if (cached) return cached;
  const raw = typeof window !== "undefined" ? window.__AVERRAY_CONFIG__ : undefined;
  cached = normalise(raw ?? {});
  return cached;
}

/** Reset the cached config. Test-only. */
export function _resetConfigCacheForTests() {
  cached = undefined;
}

function normalise(raw) {
  const apiBaseUrl = stringOr(raw.apiBaseUrl, defaults.apiBaseUrl).replace(/\/+$/, "");
  return {
    apiBaseUrl: apiBaseUrl || "/api",
    sentryDsn: stringOr(raw.sentryDsn, defaults.sentryDsn).trim(),
    sentryScriptUrl: stringOr(raw.sentryScriptUrl, defaults.sentryScriptUrl).trim(),
    sentryEnvironment: stringOr(raw.sentryEnvironment, defaults.sentryEnvironment),
    sentryRelease: stringOr(raw.sentryRelease, defaults.sentryRelease),
    sentryTracesSampleRate: clamp01(
      Number.isFinite(raw.sentryTracesSampleRate) ? raw.sentryTracesSampleRate : defaults.sentryTracesSampleRate
    ),
    chainId: Number.isInteger(raw.chainId) ? raw.chainId : defaults.chainId,
    chainName: stringOr(raw.chainName, defaults.chainName),
    siweStatement: stringOr(raw.siweStatement, defaults.siweStatement),
    debug: Boolean(raw.debug ?? defaults.debug)
  };
}

function stringOr(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Convenience: prefix a path with the configured API base URL. */
export function apiUrl(path) {
  const base = getConfig().apiBaseUrl;
  if (!path) return base;
  return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
}
