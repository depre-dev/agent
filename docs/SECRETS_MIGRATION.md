# Secrets Migration — From "Starter Tier" to Pre-Mainnet Hardened

This doc is the operator's checklist for moving from where we are today
(plain-text env files + GitHub Actions secrets + ad-hoc password
managers) to where we need to be for mainnet (centralized vault for
human-managed secrets + AWS KMS for the hottest cryptographic key).

Read [`SECRETS.md`](SECRETS.md) first for the inventory. Read
[`SECRETS_INTEGRATION_PLAN.md`](SECRETS_INTEGRATION_PLAN.md) for the
security-review-grade design rationale, threat model, and mainnet
sign-off bar.

This doc assumes you're convinced *what* needs to move and just need
the *how*. The phase structure has been revised in response to an
external security review — significant changes vs. the v1 draft are
flagged in context.

The migration breaks into **5 phases** that can land independently. Each
phase is mergeable on its own and reversible if something breaks. You
can pause between any of them.

| Phase | What | Time | Reversible? |
|---|---|---|---|
| 1 | 1Password Business setup + secret inventory loaded into vault | ~1 day | Yes — old env files still authoritative |
| 2 | Sync vault → runtime (CI + VPS) | ~1 day | Yes — fall back to GitHub UI / direct env edit |
| 3 | AWS KMS for the backend signer | ~2 days | Yes — keep `SIGNER_PRIVATE_KEY` env path until cutover |
| 4 | Hardening (CI secret scanning, short-lived JWTs, expiry alarms) | ~1 day | Yes — purely additive |
| 5 | Mainnet cutover | ~1 day | No — new addresses are fresh; testnet stays as testnet |

---

## Phase 1 — 1Password Business setup

### 1a. Sign up

- Plan: **1Password Business** ($7.99/user/mo). Cheaper than Teams
  Starter for ≤2 users (where you are today), and gives you Watchtower
  + finer-grained vault sharing for the same money.
- Use a dedicated email for the team account (e.g. `secrets@averray.com`),
  not your personal one. This makes future ownership transfers
  painless.

### 1b. Create the vault structure

Build these vaults in 1Password. Each is a separate access boundary.

```
Averray/
├── Production/
│   ├── Backend           # AUTH_JWT_SECRETS, RPC URLs, external API keys
│   ├── Indexer           # DATABASE_URL, PONDER_RPC_URL_*
│   ├── CI                # VPS_SSH_KEY, ADMIN_JWT, APP_BASIC_AUTH_*
│   └── External          # Pimlico, Sentry, Subscan, GitHub PAT, Resend, RPC provider
├── Testnet/              # Mirrors Production/ but for testnet keys
│   ├── Backend
│   ├── Indexer
│   ├── CI
│   └── External
├── Multisig/             # Signer reference info ONLY — never the seeds themselves
│   └── Signer addresses, public keys, SS58 forms
├── Operators/            # Per-operator personal vaults (auto-created by 1Password)
│   ├── Pascal
│   └── …
└── Archive/              # Decommissioned secrets, kept for audit
```

Why split testnet and production: re-using testnet secrets on mainnet
is the most common pre-launch mistake. Separate vaults make accidental
cross-contamination structurally impossible.

### 1c. Migrate secrets

For **every entry** in the inventory in [`SECRETS.md`](SECRETS.md),
create a corresponding 1Password item. Use the **API Credential** item
type — it has fields for the credential value, expiration, and notes.

Suggested naming: `<service>-<purpose>-<env>`, e.g.:
- `pimlico-bundler-url-production`
- `auth-jwt-secrets-production`
- `signer-private-key-testnet` (will be deleted after Phase 3)

Required fields per item:
- The secret value
- Description: 1–2 sentences on what it unlocks
- Expiration date (where applicable; use the [`SECRETS_CALENDAR.yml`](SECRETS_CALENDAR.yml) cadence)
- Tags: `production` / `testnet` / `ci` / `runtime`
- Notes: link back to the inventory section in `SECRETS.md`

### 1d. Provision **four** scoped service accounts per environment

**Revised in v2 per security review.** A single broadly-scoped service
account is a single point of compromise. Split by runtime so a leaked
token's blast radius is bounded to one vault scope.

Service account access and vault permissions are **effectively
immutable after creation** — design scopes correctly up front rather
than assuming they can be tuned later.

Treat each token as a vault-decryption capability for its scoped
vaults, not as a low-value API token. Per 1Password's own docs,
protection of the token is the customer's responsibility.

#### Production accounts

| Service account | Read access | Used by |
|---|---|---|
| `prod-ci-deploy` | only `Averray/Production/CI` | GitHub Actions deploy workflow |
| `prod-vps-backend` | only `Averray/Production/Backend` + `Averray/Production/External` | Backend VPS `op inject` at deploy time |
| `prod-vps-indexer` | only `Averray/Production/Indexer` | Indexer VPS `op inject` at deploy time |
| `prod-smoke-tests` | only `Averray/Production/CI/admin-jwt` | Hosted product-proof smoke |

#### Testnet equivalents

Mirror the production split with `testnet-*` prefixes, scoped to the
`Averray/Testnet/*` vaults. Testnet tokens MUST NOT have access to
production vaults.

#### Provisioning each token

1. In 1Password admin: **Integrations → Service Accounts → New**
2. Set name (e.g., `prod-ci-deploy`)
3. Vault access: **read-only**, scoped to the single vault listed above
4. Token expiration: set the maximum your account allows (1Password
   exposes `--expires-in` on the CLI; document the cadence in your
   account, ≤90 days target)
5. Save the token in your personal 1Password vault (so the token
   itself never leaves 1Password)
6. Add a calendar reminder in [`SECRETS_CALENDAR.yml`](SECRETS_CALENDAR.yml)
   for token rotation

#### Audit logging

- 1Password Business retains audit events for **365 days** (corrected
  from the earlier "90 days" claim; the Events API exposes the last
  **120 days**).
- Stream the Events API output to a SIEM or log store if you need
  longer retention or proactive alerting.
- Build alerts off **service account usage logs** (item-level access)
  rather than only account-level audit events — those show the
  vaults and items each token reads.

### Phase 1 done = exit criteria

- [ ] All ~70 secrets from the inventory are in 1Password
- [ ] Each item has its description and tags
- [ ] Service account token is provisioned and stored
- [ ] Migration is **purely additive** — old env files still
  authoritative; no plumbing changes yet
- [ ] You can find any secret in <30 seconds via 1Password search

### Rollback

Trivial: nothing depends on 1Password yet. Delete the vault and walk
away if the team decides to use a different tool.

---

## Phase 2 — Sync vault → runtime (with runtime hardening)

This is where rotation discipline lives. After this phase, rotating a
secret = update one entry in 1Password, redeploy. No more "did I update
GitHub Actions AND the VPS env file?".

**Honest framing** (revised in v2 per security review): Phase 2 does
**NOT** remove runtime plaintext from the VPS. Once `op inject`
renders `backend.env`, the host has plaintext secrets on disk again.
A VPS root compromise can still read them. The KMS migration in
Phase 3 is what removes the most valuable runtime plaintext (the
signer key). Phase 2 alone gives you single-source-of-truth
discipline and audit logs, not full runtime confidentiality.

To minimize the runtime-plaintext surface during Phase 2, follow the
hardening steps in 2d below (tmpfs, chmod 0400, exclude from
backups).

### 2a. Install `op` CLI on the VPS

```bash
# on the VPS, as root or via sudo
curl -sS https://downloads.1password.com/linux/keys/1password.asc \
  | gpg --dearmor --output /usr/share/keyrings/1password-archive-keyring.gpg
echo 'deb [arch=amd64 signed-by=/usr/share/keyrings/1password-archive-keyring.gpg] https://downloads.1password.com/linux/debian/amd64 stable main' \
  | tee /etc/apt/sources.list.d/1password.list
mkdir -p /etc/debsig/policies/AC2D62742012EA22 /usr/share/debsig/keyrings/AC2D62742012EA22
curl -sS https://downloads.1password.com/linux/debian/debsig/1password.pol \
  | tee /etc/debsig/policies/AC2D62742012EA22/1password.pol
curl -sS https://downloads.1password.com/linux/keys/1password.asc \
  | gpg --dearmor --output /usr/share/debsig/keyrings/AC2D62742012EA22/debsig.gpg
apt update && apt install -y 1password-cli
```

Verify: `op --version`.

### 2b. Set the runtime-scoped service account tokens

**Use the per-runtime tokens from Phase 1.** Each VPS service reads
from only its scoped token. Two separate env files (per env) — the
backend service should never have access to the indexer token, and
vice versa.

```bash
# on the VPS — backend
echo 'export OP_SERVICE_ACCOUNT_TOKEN="ops_prod-vps-backend_..."' \
  >> /etc/agent-stack/op-backend.env
chmod 600 /etc/agent-stack/op-backend.env
chown root:root /etc/agent-stack/op-backend.env

# on the VPS — indexer
echo 'export OP_SERVICE_ACCOUNT_TOKEN="ops_prod-vps-indexer_..."' \
  >> /etc/agent-stack/op-indexer.env
chmod 600 /etc/agent-stack/op-indexer.env
chown root:root /etc/agent-stack/op-indexer.env
```

The `op` CLI auto-detects `OP_SERVICE_ACCOUNT_TOKEN`. Source the
relevant file before each `op inject` call so each service sees only
its own scoped token.

### 2c. Convert `backend.env` to a template

Replace plain-text values with `op://` URI references. Save the result
as `/srv/agent-stack/backend.env.template`.

```diff
# /srv/agent-stack/backend.env (BEFORE — plain text)
- AUTH_JWT_SECRETS=abc123def456...
- SIGNER_PRIVATE_KEY=0x...
- PIMLICO_BUNDLER_URL=https://api.pimlico.io/...

# /srv/agent-stack/backend.env.template (AFTER)
+ AUTH_JWT_SECRETS=op://Averray/Production/Backend/auth-jwt-secrets/credential
+ SIGNER_PRIVATE_KEY=op://Averray/Production/Backend/signer-private-key/credential
+ PIMLICO_BUNDLER_URL=op://Averray/Production/External/pimlico-bundler-url/credential
```

### 2d. Render at deploy time (with hardening)

**Revised in v2.** Render env files to **tmpfs** so they don't persist
on the underlying disk, and lock them down:

```bash
# Ensure tmpfs mount exists (one-time setup; persist via /etc/fstab)
mountpoint -q /run/agent-stack || mount -t tmpfs -o size=8M,mode=0700 tmpfs /run/agent-stack
chmod 0700 /run/agent-stack
chown root:root /run/agent-stack

# Render backend env with the backend-scoped token
(
  source /etc/agent-stack/op-backend.env
  op inject -i /srv/agent-stack/backend.env.template -o /run/agent-stack/backend.env
  chmod 0400 /run/agent-stack/backend.env
  chown root:root /run/agent-stack/backend.env
)

# Render indexer env with the indexer-scoped token (separate subshell so
# the tokens never appear in the same env)
(
  source /etc/agent-stack/op-indexer.env
  op inject -i /srv/agent-stack/indexer.env.template -o /run/agent-stack/indexer.env
  chmod 0400 /run/agent-stack/indexer.env
  chown root:root /run/agent-stack/indexer.env
)

# Update docker-compose service definitions to read from /run/agent-stack/*.env
# (existing: docker compose pull && up)
```

Why the subshells: keeps each service token in a separate process env;
neither shows up in `cat /proc/$pid/environ` for the other render.

Additional hardening:
- **Exclude** `/run/agent-stack/*` and `/srv/agent-stack/*.env*` from
  any backup or snapshot job
- **Disable core dumps** for the backend process (`LimitCORE=0` in
  the systemd unit, or `prlimit --core=0` if managed differently)
- **Drop privileges**: the backend process should start as root only
  to read the env file, then drop to a non-root user immediately
- `journalctl -u agent-stack` should never print env values; if your
  logging library logs config at boot, scrub it

After deploy, the rendered `backend.env` is on tmpfs, never written
to disk. A reboot clears it. A `docker compose up` re-renders it
from 1Password.

### 2e. Convert GitHub Actions secrets (with environment protection)

**Revised in v2.** Wrap the deploy in a GitHub **Environment** with
required reviewers + restricted deployment branches. The CI token
(`OP_SERVICE_ACCOUNT_TOKEN_PROD_CI`) is exposed ONLY to jobs that
reference that protected environment.

```yaml
# .github/workflows/deploy-production.yml
jobs:
  deploy:
    runs-on: ubuntu-latest
    # The "production" environment must be configured in repo settings
    # with: required reviewers, restricted to main branch, prevent self-review
    environment: production
    permissions:
      # Top-level read-only; elevate per step only when needed
      contents: read
      id-token: write  # for OIDC, see Phase 3
    steps:
      - uses: actions/checkout@<commit-sha>   # pin to SHA, not tag
      - uses: 1password/load-secrets-action@<commit-sha>
        env:
          # OP_SERVICE_ACCOUNT_TOKEN_PROD_CI is configured as an
          # ENVIRONMENT secret (not a repo secret), so only this
          # environment-gated job sees it.
          OP_SERVICE_ACCOUNT_TOKEN: ${{ secrets.OP_SERVICE_ACCOUNT_TOKEN_PROD_CI }}
          VPS_SSH_KEY:                  op://Averray/Production/CI/vps-ssh-key/credential
          ADMIN_JWT:                    op://Averray/Production/CI/admin-jwt/credential
          APP_BASIC_AUTH_PASSWORD_HASH: op://Averray/Production/CI/app-basic-auth-password-hash/credential
          RESEND_API_KEY:               op://Averray/Production/CI/resend-api-key/credential
```

Configuration steps (in GitHub repo settings):
1. **Settings → Environments → New environment → production**
2. Required reviewers: add at least one human (cannot self-approve)
3. Deployment branches: restrict to `main`
4. Environment secrets: add `OP_SERVICE_ACCOUNT_TOKEN_PROD_CI`
5. Configure same for `testnet` with separate token

Now the GitHub Actions secret store contains exactly the
**environment-gated** OP tokens. Everything else flows from
1Password. A malicious PR cannot reach the production deploy
without a reviewer's explicit approval.

**Action pinning**: pin every third-party action to a commit SHA,
not a version tag. GitHub explicitly recommends this to reduce
supply-chain risk if an action's tag is moved by an attacker who
gains access to the action's repo.

### 2f. Cutover

1. **Don't delete the old plain-text values yet.** Run a deploy with
   both paths active in parallel for 24h to confirm the rendered files
   match what was there before.
2. Verify with `diff` (compare against an offline backup of the old
   `backend.env`).
3. After 24h of clean deploys, delete the legacy GitHub Actions
   secrets and the plain-text `backend.env` backups. Lock down VPS
   access so only `op inject` writes the env file.

### Phase 2 done = exit criteria

- [ ] `op` CLI installed on VPS, service account token configured
- [ ] `backend.env.template` and `indexer.env.template` exist with
  `op://` references for every secret
- [ ] Deploy script renders env from template
- [ ] GitHub Actions workflows reference only `OP_SERVICE_ACCOUNT_TOKEN`
  + the 1Password load-secrets action
- [ ] Old plain-text secrets are removed from GitHub Actions / VPS
- [ ] Test rotation: change one secret in 1Password → redeploy → new
  value reaches runtime

### Rollback

Per-secret: copy the value out of 1Password into the old plain-text
location (GitHub Actions secret or VPS env). Per-phase: revert the
deploy script PR and the workflow changes.

---

## Phase 3 — AWS KMS for the backend signer

This is the big security win. After this phase, the private key for
the backend signer is never on disk, in any vault, or in any backup.
Compromise of the VPS or 1Password vault no longer implies
compromise of the signer.

**Revised in v2** to use temporary credentials (IAM Roles Anywhere
on the VPS, GitHub OIDC for Actions) instead of long-lived IAM
access keys. The reviewer correctly flagged that storing access keys
in 1Password trades disk-stored-key for vault-stored-credential —
better, but still a long-lived credential. IAM Roles Anywhere /
OIDC give us short-lived (≤1h) credentials that rotate
automatically.

### 3a. AWS account + IAM policy

1. Create an AWS account
   - Hardware MFA (YubiKey) on root
   - Use root only for billing + initial IAM setup; never daily
   - Print recovery info offline
2. Create the IAM **role** `averray-signer-prod-role` (not user!) with
   only these permissions on the KMS key:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "AllowSignWithCanonicalConditions",
         "Effect": "Allow",
         "Action": ["kms:Sign", "kms:GetPublicKey"],
         "Resource": "arn:aws:kms:<region>:<account>:key/<key-id>",
         "Condition": {
           "StringEquals": {
             "kms:SigningAlgorithm": "ECDSA_SHA_256",
             "kms:MessageType":      "DIGEST"
           }
         }
       },
       {
         "Sid": "ExplicitDenyDangerousOps",
         "Effect": "Deny",
         "Action": [
           "kms:ScheduleKeyDeletion",
           "kms:DisableKey",
           "kms:PutKeyPolicy",
           "kms:CreateGrant",
           "kms:ReplicateKey",
           "kms:UpdatePrimaryRegion"
         ],
         "Resource": "arn:aws:kms:<region>:<account>:key/<key-id>"
       }
     ]
   }
   ```
   The condition keys (`kms:SigningAlgorithm`, `kms:MessageType`)
   bind the role to one signing algorithm + digest mode. Even with
   the credentials, an attacker cannot ask for a different algorithm
   or sign a raw message instead of a digest.

3. **VPS access**: configure IAM Roles Anywhere
   - Provision a private CA (AWS ACM-PCA for ~$400/month, OR
     self-managed CA with the private key stored in an HSM)
   - Create a Trust Anchor in IAM referencing the CA
   - Create a Profile referencing `averray-signer-prod-role`
   - Issue an X.509 client cert to the VPS
   - Store the client cert + private key on the VPS at
     `/etc/agent-stack/roles-anywhere/`, mode 0400
   - The backend uses the cert to call STS and obtain temporary
     credentials (≤1h lifetime); rotates automatically

4. **GitHub Actions access** (if any workflow needs to call AWS):
   configure GitHub as an OIDC provider in IAM
   - In IAM: add `token.actions.githubusercontent.com` as an
     identity provider
   - Trust policy on `averray-signer-prod-role` allows
     `sts:AssumeRoleWithWebIdentity` from workflows in
     `repo:<your-org>/<your-repo>:environment:production`
   - Workflow uses `aws-actions/configure-aws-credentials` with
     `role-to-assume:` and `aws-region:`; gets ≤1h credentials per
     job; no AWS keys ever stored in GitHub

5. **Do NOT store static IAM access keys for the signer principal
   anywhere.** If you must start with static keys during early
   testnet setup, document it as an explicit residual risk with a
   removal date, and move to temporary credentials before mainnet.

### 3b. Create the KMS key (multi-region for mainnet)

**Critical**: AWS does **not** allow converting a single-region key
into a multi-region key later. If you might ever need regional
failover for mainnet, create the mainnet key as multi-region from
day one.

**Testnet** (single region is fine):
```bash
aws kms create-key \
  --description "Averray testnet backend signer (secp256k1)" \
  --key-usage SIGN_VERIFY \
  --key-spec ECC_SECG_P256K1 \
  --region eu-central-1
```

**Mainnet** (multi-region; replicate to a second region for
failover):
```bash
# Create the primary key
aws kms create-key \
  --description "Averray mainnet backend signer (secp256k1, multi-region primary)" \
  --key-usage SIGN_VERIFY \
  --key-spec ECC_SECG_P256K1 \
  --multi-region \
  --region eu-central-1

# Replicate to a second region
aws kms replicate-key \
  --key-id <primary-key-arn> \
  --replica-region us-east-1
```

Multi-region keys share the same key ID and key material across
regions. Each replica is managed independently — same IAM policy,
same CloudTrail trail, same alarms, on every replica.

Save the returned key ARNs. Verify with:
```bash
aws kms describe-key --key-id <key-id> --region <region>
```
Expected: `MultiRegion: true`, `KeySpec: ECC_SECG_P256K1`.

### 3b-1. Enable CloudTrail for KMS events

CloudTrail can be configured to exclude KMS events from a trail.
Verify yours doesn't:
```bash
aws cloudtrail get-event-selectors --trail-name <trail>
```
Look for `ExcludeManagementEventSources` — `kms.amazonaws.com`
should NOT be there.

### 3b-2. Configure CloudWatch alarms

All of these should trigger a notification (SNS → email, Slack,
PagerDuty):
- `kms:ScheduleKeyDeletion` on the signer key
- `kms:DisableKey` on the signer key
- `kms:PutKeyPolicy` on the signer key
- `kms:CreateGrant` on the signer key
- `kms:ReplicateKey` and `kms:UpdatePrimaryRegion` (multi-region)
- Unusual `kms:Sign` volume (e.g., >10× baseline over a 5-minute window)
- Sign requests from unusual source IPs / ASNs
- Any activity by root or admin IAM principals on this key

**Test each alarm with a synthetic event** before going to mainnet
(e.g., temporarily call `DisableKey` from an admin session and
confirm the alarm notifies). Untested alarms have a habit of being
silently broken.

### 3c. Derive the EVM address

The EVM address is the keccak256 of the public key, last 20 bytes:

```js
import { KMSClient, GetPublicKeyCommand } from "@aws-sdk/client-kms";
import { keccak256 } from "ethers";
import { secp256k1 } from "@noble/curves/secp256k1";

const kms = new KMSClient({ region: "eu-central-1" });
const { PublicKey } = await kms.send(new GetPublicKeyCommand({ KeyId: "<uuid>" }));
// PublicKey is DER-encoded; extract the 64-byte uncompressed point
const point = PublicKey.subarray(PublicKey.length - 64);
const address = "0x" + keccak256(point).slice(-40);
console.log("EVM address:", address);
```

This becomes the new on-chain verifier address.

### 3d. Wire the backend

Add `KMS_KEY_ID` and `AWS_REGION` env vars to `backend.env.template`
(they flow through 1Password). Update
`mcp-server/src/blockchain/gateway.js`:

```js
import { AwsKmsSigner } from "@rumblefishdev/eth-signer-kms";

function createSigner(provider, config) {
  if (config.kmsKeyId) {
    // Backend never holds signer private key bytes locally.
    // It still holds AWS credentials (temporary, via Roles
    // Anywhere or OIDC) capable of REQUESTING signatures.
    return new AwsKmsSigner({
      keyId: config.kmsKeyId,
      region: config.awsRegion ?? "eu-central-1",
    }, provider);
  }
  // Fallback for LOCAL DEVELOPMENT ONLY. Never enabled in any
  // production / staging path — see 3f below for mainnet posture.
  if (config.signerPrivateKey && config.allowLocalKeyFallback) {
    return new Wallet(config.signerPrivateKey, provider);
  }
  throw new Error(
    "No signer configured. Set KMS_KEY_ID for production, or " +
    "ALLOW_LOCAL_KEY_FALLBACK=1 + SIGNER_PRIVATE_KEY for local dev."
  );
}
```

The `AwsKmsSigner` is a drop-in `ethers.Signer`. All call sites
(`escrowContract.connect(signer)`, etc.) work unchanged.

### 3d-1. Non-negotiable KMS adapter tests

Add unit tests (e.g., `mcp-server/src/blockchain/kms-signer.test.js`)
that prove:

1. **Address derivation**: `GetPublicKey` → keccak256 → matches the
   expected EVM address used as the on-chain verifier
2. **Single-message sign + recover**: known digest, sign through
   KMS, parse ECDSA into `r, s`, verify recovery to the expected
   address
3. **Low-s canonicalization**: signatures where `s > secp256k1n / 2`
   are inverted to canonical low-s form. Per EIP-2, Ethereum
   rejects high-s signatures.
4. **Correct recovery id (v)**: signing the same digest multiple
   times, the adapter correctly computes `v` (27 or 28 for
   Ethereum) such that recovery yields the expected address.
5. **Bulk round-trip**: repeat (2)–(4) over ≥1000 distinct messages
   — the high-s case manifests probabilistically.

Don't write your own KMS adapter; pick a vetted one
(`@rumblefishdev/eth-signer-kms` or `ethers-aws-kms-signer`) and
pin to a specific commit SHA.

### 3d-2. Domain separation for backend-signed messages

Backend-signed payloads MUST include domain-separation fields so a
signed message in one context cannot be replayed in another:
- `chainId` — testnet vs mainnet
- `contractAddress` — TreasuryPolicy or EscrowCore as relevant
- `environment` — "production", "testnet", etc.
- `purpose` — what kind of signature this is ("verifier-approve",
  "verifier-reject", "arbitrator-resolve", etc.)
- `jobId` / `disputeId` — bound to the specific resource
- `nonce` — non-reusable per (subject, purpose) pair
- `expiry` — Unix timestamp; reject after

This is independent of the KMS migration but the migration is the
right time to verify the signed payloads carry these fields. Audit
every `signer.signMessage()` / `signer.signTypedData()` call site
in `mcp-server/src/blockchain/`.

### 3e. Test on testnet first

1. Generate a fresh KMS key in AWS for testnet (single-region OK)
2. Deploy fresh testnet contracts using the KMS-derived address as
   the verifier (multisig signs the `setVerifier` call)
3. Run the full hosted product-proof smoke loop end-to-end with the
   KMS path
4. Confirm:
   - `journalctl -u agent-stack`, `docker inspect agent-stack`,
     `cat /proc/$(pgrep -f backend)/environ | tr '\0' '\n'` — no
     plaintext private key (search for `0x[a-f0-9]{60,}` patterns
     AND for env vars named `*PRIVATE*` / `*SECRET*` referencing
     the signer key)
   - CloudTrail shows the `kms:Sign` calls and no `Decrypt` /
     `Export` ever
   - Revoking the Roles Anywhere profile temporarily breaks signing
     — proves the backend really uses temp creds, not a stashed key

### 3f. Cutover and key rotation

**Testnet cutover**: update the `verifier` field in
`deployments/testnet.json` (via the testnet multisig
`setVerifier(newKmsAddress, true)`), deploy fresh, switch. Keep the
local-dev raw-key fallback (`ALLOW_LOCAL_KEY_FALLBACK=1`) available
for one full deploy cycle for safety. After confirming KMS path
works, **rotate the testnet raw key so the old value is invalid**.

**Mainnet cutover** (Phase 5): the mainnet deploy is the first time
the KMS-managed key signs anything. **No raw-key fallback for
mainnet.** Local-dev fallback is disabled in production builds:
`config.allowLocalKeyFallback = process.env.NODE_ENV !== 'production'`.

**KMS key rotation is an on-chain migration**, not a routine
calendar rotation. AWS does NOT support automatic rotation for
asymmetric KMS keys. The procedure:

1. Create a new KMS key (same spec, same multi-region setup)
2. Derive the new EVM address from the new key's public key
3. Multisig signs `setVerifier(newKmsAddress, true)` on TreasuryPolicy
4. Update `KMS_KEY_ID` env var (via 1Password) to the new key
5. Redeploy backend
6. Grace period (e.g., 24h): both keys are valid verifiers
7. Multisig signs `setVerifier(oldKmsAddress, false)` to disable
   the old key
8. Schedule deletion of the old KMS key (7–30 day pending period)
9. After deletion period, key is permanently destroyed

The signer KMS key is **explicitly NOT tracked in
`SECRETS_CALENDAR.yml`** — see the inline note there.

IAM credentials (Roles Anywhere certs, OIDC trust relationship)
DO rotate frequently. The KMS key itself rotates only via this
multisig-controlled migration.

### Phase 3 done = exit criteria

- [ ] AWS account + IAM **role** (not user) provisioned with minimum
  permissions + condition keys (`kms:SigningAlgorithm`,
  `kms:MessageType`)
- [ ] Explicit deny on dangerous ops (ScheduleKeyDeletion, DisableKey,
  PutKeyPolicy, CreateGrant, ReplicateKey, UpdatePrimaryRegion) for
  the signer role
- [ ] Mainnet KMS key created **multi-region** from day one; testnet
  may be single-region
- [ ] CloudTrail confirmed to include KMS events (not excluded)
- [ ] CloudWatch alarms configured AND **tested with synthetic events**
- [ ] VPS: IAM Roles Anywhere configured with X.509 client cert;
  static IAM access keys for the signer role do not exist
- [ ] GitHub Actions: OIDC configured if AWS access is needed; no
  static AWS credentials in GitHub
- [ ] EVM address derived from KMS public key matches the on-chain
  verifier
- [ ] All KMS adapter tests pass over ≥1000 distinct messages
- [ ] Domain-separation audit complete (every signed payload carries
  chainId, contract, env, purpose, ID, nonce, expiry)
- [ ] Hosted product-proof smoke passes end-to-end on testnet via KMS
- [ ] Process listing on VPS shows no plaintext signer key

### Rollback

**Testnet only**: revert to `SIGNER_PRIVATE_KEY` env path with
`ALLOW_LOCAL_KEY_FALLBACK=1`. Contract-side verifier reset via
multisig.

**Mainnet**: there is no raw-key rollback. Fallback for an emergency
is multisig-controlled signer migration (`setVerifier(temporary, true)`)
or pausing the protocol via the pauser key. Plan and rehearse this
before going live.

---

## Phase 4 — Hardening

**Revised in v2 per security review.** Five additions, each
independent.

### 4a. Pre-commit + push protection + CI secret scanning

Three layers of defense in depth so a secret can't sneak in:

1. **Local pre-commit hook** (catches before push):
   ```bash
   # .githooks/pre-commit
   #!/usr/bin/env bash
   set -e
   if command -v gitleaks >/dev/null 2>&1; then
     gitleaks protect --staged --verbose
   else
     echo "warn: gitleaks not installed locally; relying on CI" >&2
   fi
   ```
   Install via `git config core.hooksPath .githooks` per operator.

2. **GitHub Secret Scanning push protection**:
   - Settings → Security → Secret scanning → Enable push protection
   - Add custom patterns for Averray-specific secret formats
     (signer key shapes, JWT shapes if they have a custom prefix,
     `ops_` 1Password tokens, etc.)
   - This blocks the push at the server side regardless of local hooks

3. **CI gitleaks** (last-resort sweep):
   ```yaml
   # .github/workflows/ci.yml
   - uses: gitleaks/gitleaks-action@<commit-sha>
     env:
       GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
   ```

CI catches what push protection misses; push protection catches
what local hooks miss; local hooks catch the common case before
the secret ever leaves the operator's machine.

### 4b. Asymmetric JWT signing via KMS

**The architectural upgrade**: today `AUTH_JWT_SECRETS` is an HMAC
secret stored in the vault and on every backend instance. A vault
breach OR a backend env breach means an attacker can mint admin
JWTs.

**Target design**:
- KMS-managed asymmetric key (RSA-2048 or ES256) signs access tokens
  at issuance / refresh time
- Backend services verify locally with the **public** key (no access
  to the signing key needed)
- Access tokens carry `kid` (key ID for rotation), `iss`, `aud`,
  `sub`, `role`, `jti`, `iat`, `nbf`, `exp`
- Access TTL: ≤1h (≤15min is better)
- Refresh tokens: **opaque random values** (not signed JWTs),
  stored server-side as hashes, rotated on every use, revoked on
  replay detection

After this change, a vault leak no longer allows JWT minting. Only
a KMS principal compromise does — same protection as the signer
key from Phase 3.

**Implementation outline**:
- New KMS key, separate from the signer key, with the same temporary-
  credential access pattern
- Update `mcp-server/src/auth/jwt.js` to sign via KMS instead of HMAC
- Update `mcp-server/src/auth/middleware.js` to verify with the
  public key (cached locally, refreshed periodically)
- Add `mcp-server/src/auth/refresh.js` with the opaque-token
  exchange endpoint + server-side hash storage
- Update `scripts/ops/mint-admin-jwt.mjs` to call the new path or
  deprecate in favor of the refresh-token flow

**If full migration is too much work pre-mainnet**, the minimum
hardening for the HMAC path is:
- Key ring with `kid` rotation
- Short access-token TTLs (≤15 min)
- Documented two-key rotation window with old-key tolerance period
- Refresh tokens are opaque random values, hashed server-side
- All flagged as residual risk in the sign-off bar

### 4c. GitHub Actions hardening (beyond Phase 2)

Already partially covered in 2e. Additional steps:
- Top-level `permissions: read-all` on every workflow; elevate
  per-job with explicit `permissions:` blocks
- Pin every third-party action to a commit SHA, never a tag
- Avoid `pull_request_target` with secrets unless workflow is
  extremely constrained
- Never inject OP service tokens into build/test jobs — only the
  job that needs them
- Require code review for any workflow file change (branch
  protection rule on `.github/workflows/**`)

### 4d. Calendar-driven CI checks

Already shipped in PR #225: `scripts/ops/check-secrets-calendar.mjs`.
Wire into CI:

```yaml
# .github/workflows/ci.yml
- name: Check secrets calendar
  run: node scripts/ops/check-secrets-calendar.mjs
```

Warns ≥7 days before any tracked token expires; fails CI on past-
expiry. **The KMS signer key is NOT in this calendar** — see the
inline note in `SECRETS_CALENDAR.yml`.

### 4e. Hardware MFA across the admin trust chain

Mainnet baseline (~$50 per operator, one-time):
- 1Password admin account: hardware key (YubiKey) required
- AWS root account: hardware key required
- AWS IAM admin users: hardware key required
- GitHub org admin: hardware key required
- Domain registrar: hardware key required
- VPS provider: hardware key required

TOTP is OK for testnet ops; for mainnet, hardware-key everywhere.
TOTP is phishable; FIDO2 is not.

### Phase 4 done = exit criteria

- [ ] Pre-commit hook, GitHub push protection, and CI gitleaks all
  configured and tested (synthetic bad-commit blocked at each layer)
- [ ] Custom secret patterns added to push protection for Averray-
  specific formats
- [ ] Either: asymmetric KMS-signed JWT path live end-to-end on
  testnet, OR: HMAC hardening path documented as residual with
  named owner and timeline
- [ ] Top-level read-only permissions on all workflows
- [ ] All third-party actions pinned to commit SHA
- [ ] GitHub Environments with required reviewers configured for
  production deploys
- [ ] Calendar check runs on every CI build
- [ ] Hardware MFA on every admin account in the trust chain

---

## Phase 5 — Mainnet cutover

This is the night-of deploy. Treat it as a one-shot ceremony with all
four prior phases already in production for ≥1 week each.

### Pre-flight checklist

The day before:

- [ ] All four prior phases live and stable on testnet for ≥7 days
- [ ] Audit script (`scripts/ops/audit-launch-readiness.mjs`) shows
  zero drift between testnet config and the planned mainnet config
- [ ] All production OP service account tokens rotated within the
  last 30 days
- [ ] AWS KMS key for mainnet created **multi-region from day one**
  (cannot convert later)
- [ ] AWS access via Roles Anywhere (VPS) + OIDC (Actions); **no
  static IAM access keys** for the signer role
- [ ] All CloudWatch alarms tested with synthetic events
- [ ] Multisig signer set established with **fresh seeds** — do not
  reuse testnet seeds
- [ ] All vendor accounts (Pimlico, Sentry, Subscan, RPC provider)
  have separate mainnet API keys minted
- [ ] On-call rotation defined in `INCIDENT_RESPONSE.md` Section 1
  (currently a blank template — fill it in)
- [ ] **Old secrets cleanup**: rotate or revoke any value that ever
  lived in GitHub secrets, local password managers, shell history,
  old VPS env files, CI logs, backups, or test deploys. Assume any
  copy-pasted value is compromised.
- [ ] Incident drills run for: OP token leak, AWS signer credential
  leak, JWT signing key leak, VPS root compromise

### Cutover sequence

1. **Generate fresh secrets**: rotate every secret listed in
   [`SECRETS.md`'s mainnet hardening checklist](SECRETS.md#mainnet-hardening-checklist).
   Each goes into a fresh 1Password item under
   `Averray/Production/<vault>/`. Never reuse a testnet value.
2. **Provision the multisig** on Polkadot.js Apps with three fresh
   signer addresses (Hot, Warm, Cold per `MULTISIG_SETUP.md`). Do
   not reuse testnet seeds.
3. **Deploy contracts** with the multisig as the owner from line 1
   (skip the EOA-then-transfer flow used on testnet — owner is the
   multisig from genesis).
4. **Update `deployments/mainnet.json`** with all addresses.
5. **Update `backend.mainnet.env.template`** to reference the new
   mainnet 1Password items. The KMS key ID, the role ARN, the
   multi-region settings — all from the mainnet vault, never from
   the testnet vault.
6. **Run the smoke** with `product_proof_reward_asset=USDC` against
   mainnet. Confirm 3 consecutive successful runs before opening to
   real users.
7. **Archive** the testnet 1Password vault — read-only, kept for
   forensics. **Do not delete** for at least 90 days.

### Post-cutover verification

- [ ] `audit-launch-readiness.mjs` shows green for mainnet
- [ ] `check-secrets-calendar.mjs` shows zero entries within 7 days
  of expiry
- [ ] Hosted product-proof smoke passes end-to-end 3 consecutive
  runs on mainnet
- [ ] No secret in any log file, process listing, or env file dump
  on the mainnet VPS (test: search for `0x[a-f0-9]{60,}` AND env
  vars named `*PRIVATE*` / `*SECRET*` / `*KEY*` referencing the
  signer key)
- [ ] **No raw `SIGNER_PRIVATE_KEY` value exists anywhere** in any
  mainnet vault, env file, backup, or operator's machine
- [ ] On-call rotation is live and first responder has been paged
  with a synthetic test alert successfully
- [ ] All Phase 4 hardening verified active on mainnet (push
  protection, environment gates, hardware MFA, etc.)

---

## Cost summary

| Item | Monthly cost |
|---|---|
| 1Password Business (1 user) | $7.99 |
| 1Password Business (3 users, post second-operator) | $23.97 |
| AWS KMS testnet key (single region) | ~$1.05 (1 key + ~$0.15 per 10k sigs) |
| AWS KMS mainnet key (multi-region, 2 replicas) | ~$2.05 (2 replica keys + signing fees) |
| AWS Roles Anywhere | $0 (no per-request fee) |
| AWS ACM-PCA (if used for Roles Anywhere CA) | ~$400 — **consider self-managed CA + HSM** for lower cost |
| AWS CloudTrail (for KMS audit) | $0 (first management trail free) |
| AWS CloudWatch (for KMS alarms) | < $5 |
| **Total at 1 user, testnet** | **~$9/mo** (or ~$409/mo if ACM-PCA used) |
| **Total at 3 users, mainnet** | **~$26/mo** (or ~$426/mo if ACM-PCA used) |
| **YubiKey hardware keys** (one-time) | ~$50 × number of operators |

The recurring cost is rounding error vs. the security improvement.
The **ACM-PCA decision is the one to think about** — $400/mo is
real money at our scale; self-managed CA with the private key in
an HSM is the cheaper alternative if the operator can run one.

Engineering time for the migration: ~5–7 working days spread over a
few weeks.

---

## When something goes wrong

Each phase has its own rollback noted above. For incidents:

- **Suspected secret compromise**: see [`INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md).
  Per-secret rotation paths are in
  [`SECRETS.md`'s runbook section](SECRETS.md#per-secret-runbook-when-something-breaks).
- **Migration step fails halfway**: roll back that step. Old path is
  still live until you explicitly remove it.
- **Vault locked / 1Password down**: the rendered env files are still
  on the VPS. Don't redeploy until 1Password recovers. If urgent, an
  operator can manually edit the rendered env file as a one-off — but
  the next deploy will overwrite it from the vault.

---

## Related

- [`SECRETS.md`](SECRETS.md) — the inventory + storage strategy
- [`SECRETS_CALENDAR.yml`](SECRETS_CALENDAR.yml) — token expiry tracking
- [`MULTISIG_SETUP.md`](MULTISIG_SETUP.md) — multisig provisioning
- [`SIGNER_POLICY.md`](SIGNER_POLICY.md) — signer roles and key handling
- [`INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md) — incident playbook
