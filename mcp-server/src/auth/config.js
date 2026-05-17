import { ConfigError } from "../core/errors.js";

const VALID_MODES = new Set(["strict", "permissive"]);
const VALID_ROLES = new Set(["admin", "verifier"]);
const VALID_JWT_BACKENDS = new Set(["hmac", "kms", "both"]);
const VALID_JWT_PRIMARY_ALGS = new Set(["hmac", "kms"]);
const DEFAULT_JWT_KID = "jwt-1";
// Mirrors KmsJwtSigner's internal defaults so the dispatcher's TTL cap
// remains consistent with the signer's own enforcement when the env
// var is unset. Keep in sync with kms-jwt-signer.js's
// DEFAULT_MAX_TTL_SECONDS / DEFAULT_CLOCK_SKEW_SECONDS.
const DEFAULT_JWT_MAX_TTL_SECONDS = 3600;
const DEFAULT_JWT_CLOCK_SKEW_SECONDS = 60;

/**
 * Load authentication configuration from the environment.
 *
 * Environment variables:
 * - AUTH_MODE: "strict" (default in production) or "permissive" (accept legacy ?wallet=).
 * - AUTH_JWT_SECRETS: comma-separated list; first is used for signing, all are accepted for verification.
 *   AUTH_JWT_SECRET (singular) is accepted as a convenience alias.
 * - AUTH_DOMAIN: expected domain in SIWE messages (e.g., "averray.io" or "localhost:8787").
 * - AUTH_CHAIN_ID: expected EVM chain id (number).
 * - AUTH_TOKEN_TTL_SECONDS: JWT lifetime (default 86400 = 24h).
 * - AUTH_NONCE_TTL_SECONDS: nonce lifetime (default 300 = 5 min).
 * - AUTH_ADMIN_WALLETS: comma-separated EVM addresses granted the "admin" role claim at sign-in.
 * - AUTH_VERIFIER_WALLETS: comma-separated EVM addresses granted the "verifier" role claim at sign-in.
 *
 * Phase 4b — KMS-signed JWTs (see docs/PHASE_4B_KMS_JWT_PLAN.md):
 * - JWT_BACKEND: "hmac" (default) | "kms" | "both". Controls which JWT
 *   algorithm(s) the dispatcher will sign and verify.
 * - JWT_PRIMARY_ALG: "hmac" (default) | "kms". Only meaningful when
 *   JWT_BACKEND=both — selects which algorithm is used for new signatures.
 * - AWS_JWT_REGION, AWS_JWT_KEY_ID, AWS_JWT_ACCESS_KEY_ID,
 *   AWS_JWT_SECRET_ACCESS_KEY: AWS credentials + key reference for
 *   KmsJwtSigner. Required when JWT_BACKEND ∈ {kms, both}.
 * - JWT_PUBLIC_KEY_PEM, JWT_PUBLIC_KEY_FINGERPRINT: rendered into env at
 *   deploy time. Required when JWT_BACKEND ∈ {kms, both}.
 * - JWT_KID: header kid (default "jwt-1").
 * - JWT_EXPECTED_ISSUER, JWT_EXPECTED_AUDIENCE: required iss/aud claims
 *   for ES256 verification. Default to "averray-backend-testnet" /
 *   "averray-backend" if unset.
 * - JWT_MAX_TTL_SECONDS, JWT_CLOCK_SKEW_SECONDS: optional overrides for
 *   KmsJwtSigner.
 */
export function loadAuthConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV ?? "development";
  const rawMode = (env.AUTH_MODE ?? (nodeEnv === "production" ? "strict" : "permissive")).trim().toLowerCase();

  if (!VALID_MODES.has(rawMode)) {
    throw new ConfigError(`Invalid AUTH_MODE: ${rawMode}. Expected "strict" or "permissive".`);
  }

  const secretsRaw = env.AUTH_JWT_SECRETS ?? env.AUTH_JWT_SECRET ?? "";
  const secrets = secretsRaw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (rawMode === "strict" && secrets.length === 0) {
    throw new ConfigError(
      "AUTH_MODE=strict requires AUTH_JWT_SECRETS (or AUTH_JWT_SECRET). Set at least one secret with >=32 chars."
    );
  }

  for (const secret of secrets) {
    if (secret.length < 32) {
      throw new ConfigError(
        "AUTH_JWT_SECRETS entries must each be at least 32 characters (high-entropy recommended)."
      );
    }
  }

  const domain = (env.AUTH_DOMAIN ?? "localhost").trim();
  if (!domain) {
    throw new ConfigError("AUTH_DOMAIN must not be empty.");
  }

  const chainIdRaw = env.AUTH_CHAIN_ID ?? "0";
  const chainId = Number(chainIdRaw);
  if (!Number.isInteger(chainId) || chainId < 0) {
    throw new ConfigError(`AUTH_CHAIN_ID must be a non-negative integer, got: ${chainIdRaw}.`);
  }

  const tokenTtlSeconds = parsePositiveInt(env.AUTH_TOKEN_TTL_SECONDS, 86400, "AUTH_TOKEN_TTL_SECONDS");
  const nonceTtlSeconds = parsePositiveInt(env.AUTH_NONCE_TTL_SECONDS, 300, "AUTH_NONCE_TTL_SECONDS");

  const adminWallets = parseWalletSet(env.AUTH_ADMIN_WALLETS, "AUTH_ADMIN_WALLETS");
  const verifierWallets = parseWalletSet(env.AUTH_VERIFIER_WALLETS, "AUTH_VERIFIER_WALLETS");

  // ── Phase 4b — JWT dispatcher mode ────────────────────────────────────
  const jwtBackend = parseJwtBackend(env.JWT_BACKEND);
  const jwtPrimaryAlg = parseJwtPrimaryAlg(env.JWT_PRIMARY_ALG, jwtBackend);
  const kmsJwt = parseKmsJwtConfig(env, jwtBackend);

  return {
    mode: rawMode,
    secrets,
    signingSecret: secrets[0],
    domain,
    chainId,
    tokenTtlSeconds,
    nonceTtlSeconds,
    permissive: rawMode === "permissive",
    strict: rawMode === "strict",
    adminWallets,
    verifierWallets,
    jwtBackend,
    jwtPrimaryAlg,
    kmsJwt,
    resolveRoles(wallet) {
      return resolveRoles(wallet, { adminWallets, verifierWallets });
    }
  };
}

function parseJwtBackend(raw) {
  if (raw === undefined || raw === null || raw === "") {
    return "hmac";
  }
  const value = String(raw).trim().toLowerCase();
  if (!VALID_JWT_BACKENDS.has(value)) {
    throw new ConfigError(
      `Invalid JWT_BACKEND: "${raw}". Expected one of "hmac", "kms", or "both".`,
    );
  }
  return value;
}

function parseJwtPrimaryAlg(raw, backend) {
  // Only meaningful for backend === "both"; for "hmac" / "kms" the
  // backend itself dictates the signing alg. We still parse and return
  // a value so downstream code can treat it as always-present.
  if (raw === undefined || raw === null || raw === "") {
    return backend === "kms" ? "kms" : "hmac";
  }
  const value = String(raw).trim().toLowerCase();
  if (!VALID_JWT_PRIMARY_ALGS.has(value)) {
    throw new ConfigError(
      `Invalid JWT_PRIMARY_ALG: "${raw}". Expected "hmac" or "kms".`,
    );
  }
  return value;
}

/**
 * Build the KmsJwt config block when JWT_BACKEND requires KMS. Returns
 * `null` for pure HMAC mode so callers can treat absence as
 * "KMS is not wired in." When required vars are missing in kms / both
 * modes, throws a single ConfigError that names every missing var (so
 * the operator only has to fix env once).
 */
function parseKmsJwtConfig(env, backend) {
  if (backend === "hmac") {
    return null;
  }

  // Variables that must be non-empty when KMS verify is active. Region
  // is needed only when no KMSClient is provided at runtime (it always
  // is, in normal boot) — we still enforce it so a misconfigured prod
  // boot fails loudly rather than the next time someone constructs a
  // KMSClient from defaults.
  const required = {
    AWS_JWT_REGION: env.AWS_JWT_REGION,
    AWS_JWT_KEY_ID: env.AWS_JWT_KEY_ID,
    JWT_PUBLIC_KEY_PEM: env.JWT_PUBLIC_KEY_PEM,
    JWT_PUBLIC_KEY_FINGERPRINT: env.JWT_PUBLIC_KEY_FINGERPRINT,
  };
  // Access keys are required only when JWT_BACKEND ∈ {kms, both} AND
  // the deploy is using static AWS credentials (testnet). The KMSClient
  // also honors the AWS default-credential-provider chain (IAM Roles
  // Anywhere, EC2 instance profile, etc.) — so we don't make these
  // required at the dispatcher level; if absent the SDK will fail at
  // first kms:Sign and the operator gets a clear AWS error. This matches
  // how the Phase 3 blockchain signer config behaves.

  const missing = Object.entries(required)
    .filter(([, value]) => value === undefined || value === null || String(value).trim() === "")
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new ConfigError(
      `JWT_BACKEND=${backend} requires the following env vars to be set: ${missing.join(", ")}.`,
    );
  }

  const region = String(env.AWS_JWT_REGION).trim();
  const keyId = String(env.AWS_JWT_KEY_ID).trim();
  if (keyId.startsWith("alias/")) {
    // Mirrors the constructor-level check in KmsJwtSigner — fail at
    // config-load time so an alias never reaches the signer.
    throw new ConfigError(
      `AWS_JWT_KEY_ID must be the full KMS key ARN, not an alias ("${keyId}"). Aliases can be retargeted.`,
    );
  }
  const publicKeyPem = String(env.JWT_PUBLIC_KEY_PEM);
  const publicKeyFingerprint = String(env.JWT_PUBLIC_KEY_FINGERPRINT).trim();
  const kid = (env.JWT_KID ?? DEFAULT_JWT_KID).toString().trim() || DEFAULT_JWT_KID;
  const expectedIssuer = (env.JWT_EXPECTED_ISSUER ?? "averray-backend-testnet").toString().trim();
  const expectedAudience = (env.JWT_EXPECTED_AUDIENCE ?? "averray-backend").toString().trim();
  const expectedRoles = parseJwtRoles(env.JWT_EXPECTED_ROLES) ?? [...VALID_ROLES];
  const maxTtlSeconds = parsePositiveInt(env.JWT_MAX_TTL_SECONDS, DEFAULT_JWT_MAX_TTL_SECONDS, "JWT_MAX_TTL_SECONDS");
  const clockSkewSeconds = parseNonNegativeInt(env.JWT_CLOCK_SKEW_SECONDS, DEFAULT_JWT_CLOCK_SKEW_SECONDS, "JWT_CLOCK_SKEW_SECONDS");

  return {
    region,
    keyId,
    kid,
    publicKeyPem,
    publicKeyFingerprint,
    expectedIssuer,
    expectedAudience,
    expectedRoles,
    maxTtlSeconds,
    clockSkewSeconds,
  };
}

function parseJwtRoles(raw) {
  if (raw === undefined || raw === null || raw === "") {
    return null;
  }
  const roles = String(raw)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (roles.length === 0) return null;
  for (const role of roles) {
    if (!VALID_ROLES.has(role)) {
      throw new ConfigError(`JWT_EXPECTED_ROLES contains unknown role "${role}".`);
    }
  }
  return roles;
}

/**
 * Return the set of role claims a wallet should receive at sign-in time.
 * Unknown wallets get an empty array; role membership is pinned by env config.
 */
export function resolveRoles(wallet, { adminWallets, verifierWallets }) {
  if (typeof wallet !== "string" || wallet.length === 0) {
    return [];
  }
  const key = wallet.toLowerCase();
  const roles = [];
  if (adminWallets.has(key)) {
    roles.push("admin");
  }
  if (verifierWallets.has(key)) {
    roles.push("verifier");
  }
  return roles;
}

export function hasRole(claims, role) {
  if (!VALID_ROLES.has(role)) {
    return false;
  }
  const roles = Array.isArray(claims?.roles) ? claims.roles : [];
  return roles.includes(role);
}

function parseWalletSet(raw, name) {
  if (raw === undefined || raw === null || raw === "") {
    return new Set();
  }
  const wallets = String(raw)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  for (const wallet of wallets) {
    if (!/^0x[a-fA-F0-9]{40}$/u.test(wallet)) {
      throw new ConfigError(`${name} entries must be 0x-prefixed 20-byte addresses; got: ${wallet}.`);
    }
  }
  return new Set(wallets.map((wallet) => wallet.toLowerCase()));
}

function parsePositiveInt(raw, fallback, name) {
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`${name} must be a positive integer, got: ${raw}.`);
  }
  return value;
}

function parseNonNegativeInt(raw, fallback, name) {
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new ConfigError(`${name} must be a non-negative integer, got: ${raw}.`);
  }
  return value;
}
