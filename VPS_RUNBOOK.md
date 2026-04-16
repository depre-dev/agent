# VPS Runbook

This runbook captures the production-like setup currently running on the OVH VPS for `averray.com`.

## Stack layout

- Stack root on server: `/srv/agent-stack`
- Repo checkout: `/srv/agent-stack/app`
- Compose file: `/srv/agent-stack/docker-compose.yml`
- Infra services:
  - `agent-postgres`
  - `agent-redis`
  - `agent-caddy`
- App services:
  - `agent-backend`
  - `agent-indexer`

## Public endpoints

- Discovery: [https://averray.com/.well-known/agent-tools.json](https://averray.com/.well-known/agent-tools.json)
- App: [https://app.averray.com](https://app.averray.com)
- API: [https://api.averray.com](https://api.averray.com)
- API SSE: `https://app.averray.com/api/events?token=<jwt>` (strict mode) or `?wallet=0x...` (permissive only)
- Indexer: [https://index.averray.com](https://index.averray.com)
- Gas sponsor health: [https://api.averray.com/gas/health](https://api.averray.com/gas/health)

## Quick health checks

Run these on the VPS:

```bash
cd /srv/agent-stack
docker ps
curl -fsS https://api.averray.com/health
curl -fsS https://api.averray.com/gas/health
curl -fsS https://index.averray.com/
curl -fsS https://averray.com/.well-known/agent-tools.json
```

Expected signals:

- API health returns `status: ok`
- Gas health returns Pimlico status or a clean disabled mode
- Indexer root returns `status: ok`
- Discovery manifest returns JSON with `baseUrl` set to `https://api.averray.com`

## Redeploy flows

### Frontend-only changes

Frontend files are mounted directly into Caddy, so a repo pull is enough:

```bash
cd /srv/agent-stack/app
git pull
```

Hard refresh the browser after pulling.

### Backend changes

Use the scripted flow from the repo checkout:

```bash
cd /srv/agent-stack/app
./scripts/ops/redeploy-backend.sh
```

The script now:

1. Pins the pre-deploy SHA for rollback.
2. Fast-forwards the repo to `origin/main`.
3. Rebuilds `agent-backend`.
4. Polls `HEALTH_URL` (default `https://api.averray.com/health`) for up to
   `HEALTH_TIMEOUT_SEC` (default 120) seconds.
5. **Automatically rolls back** to the previous SHA and rebuilds if health
   never turns green. Set `SKIP_ROLLBACK=1` to leave an unhealthy deploy in
   place for debugging.

Override defaults via env:

```bash
HEALTH_URL=https://staging.api.averray.com/health \
HEALTH_TIMEOUT_SEC=180 \
./scripts/ops/redeploy-backend.sh
```

Note: the staking and slashing contract changes require a contract redeploy and refreshed backend env values, not just a backend image rebuild.

### Remote hosted-stack smoke test

From the repo checkout:

```bash
cd /srv/agent-stack/app/mcp-server
REMOTE_E2E_BASE_URL=https://api.averray.com \
REMOTE_E2E_PRIVATE_KEY=0xyour-test-agent-private-key \
npm run demo:e2e:remote
```

This signs in with SIWE, creates a unique remote job, runs the full claim/submit/verify flow, and confirms the session lands in hosted history. On `AUTH_MODE=permissive` deployments you may drop the private key and pass `REMOTE_E2E_WALLET=0x...` instead.

## Backups

### Postgres export

Run:

```bash
cd /srv/agent-stack/app
./scripts/ops/backup-postgres.sh
```

Backups are written to:

```text
/srv/agent-stack/backups/postgres
```

Each backup is a gzipped SQL dump:

```text
agent-YYYYMMDD-HHMMSS.sql.gz
```

### Restore outline

Restore should be done deliberately and only after confirming the target file:

```bash
gunzip -c /srv/agent-stack/backups/postgres/<dump>.sql.gz | \
docker compose --project-directory /srv/agent-stack -f /srv/agent-stack/docker-compose.yml exec -T postgres \
  psql -U agent -d agent
```

Do not restore over a live database unless you mean to replace it.

## Useful docker commands

```bash
cd /srv/agent-stack
docker compose logs --tail=100 backend
docker compose logs --tail=100 indexer
docker compose logs --tail=100 caddy
docker compose up -d --build backend
docker compose up -d --build indexer
docker compose restart caddy
```

## Files and secrets

Important server-side files:

- `/srv/agent-stack/.env` for Postgres settings
- `/srv/agent-stack/backend.env`
- `/srv/agent-stack/indexer.env`
- `/srv/agent-stack/Caddyfile`

Optional gas sponsorship vars for `/gas/*` endpoints:

- `PIMLICO_BUNDLER_URL`
- `PIMLICO_PAYMASTER_URL`
- `PIMLICO_ENTRY_POINT`
- `PIMLICO_SPONSORSHIP_POLICY_ID`
- `PIMLICO_CHAIN_ID`

Required contract env vars for the current live-chain backend:

- `TREASURY_POLICY_ADDRESS`
- `AGENT_ACCOUNT_ADDRESS`
- `ESCROW_CORE_ADDRESS`
- `REPUTATION_SBT_ADDRESS`

Required authentication env vars (backend, strict mode):

- `AUTH_MODE=strict`
- `AUTH_JWT_SECRETS` (comma-separated HS256 secrets, each ≥32 chars)
- `AUTH_DOMAIN=api.averray.com`
- `AUTH_CHAIN_ID=420420422`

### JWT secret rotation

Zero-downtime rotation uses the multi-secret list — the **first** entry signs
new tokens, every entry in the list is accepted at verification time.

1. Generate a fresh secret (32+ chars of entropy):
   ```bash
   openssl rand -base64 48
   ```
2. Prepend it to `AUTH_JWT_SECRETS` in `/srv/agent-stack/backend.env`:
   ```text
   AUTH_JWT_SECRETS=<new>,<previous>
   ```
3. Restart the backend so new tokens are signed with the new secret:
   ```bash
   cd /srv/agent-stack/app
   ./scripts/ops/redeploy-backend.sh
   ```
4. Wait at least `AUTH_TOKEN_TTL_SECONDS` (default 24h) so every token issued
   under the old secret has expired.
5. Drop the old secret:
   ```text
   AUTH_JWT_SECRETS=<new>
   ```
   and redeploy again.

If a secret is believed compromised, skip the wait and cut the old secret
immediately — every active session is invalidated and users must re-sign.

Matching contract env vars for the indexer:

- `PONDER_TREASURY_POLICY_ADDRESS`
- `PONDER_ESCROW_CORE_ADDRESS`
- `PONDER_AGENT_ACCOUNT_ADDRESS`
- `PONDER_REPUTATION_SBT_ADDRESS`

Do not commit server secrets back into the repository.

## Failure modes

### API unhealthy

1. Check:
   ```bash
   docker compose logs --tail=100 backend
   ```
2. Confirm:
   - RPC connectivity
   - Redis connectivity
   - env file values
3. Redeploy backend if the code was just updated.

### Indexer unhealthy

1. Check:
   ```bash
   docker compose logs --tail=150 indexer
   ```
2. Confirm:
   - Postgres reachable
   - RPC reachable
   - `DATABASE_URL` and `DATABASE_SCHEMA` correct

### TLS / domain issues

1. Check DNS records in Cloudflare
2. Confirm records are `DNS only` during direct Caddy issuance
3. Inspect:
   ```bash
   docker compose logs --tail=200 caddy
   ```

## Recommended operating habit

At minimum:

- take a Postgres backup before risky backend or schema changes
- use the scripted backend redeploy instead of ad-hoc commands
- verify `api`, `index`, and discovery immediately after deploys

## Observability

- `GET /metrics` on the backend exposes Prometheus text-format metrics:
  `http_requests_total`, `http_request_duration_ms`, `auth_failures_total`,
  `rate_limit_rejections_total`, `sse_active_connections`,
  `state_store_backend`. Leave `METRICS_BEARER_TOKEN` unset for same-network
  scrapers, or set it to a random token when `/metrics` is publicly reachable.
- Sentry is opt-in. To enable on the backend:
  ```bash
  cd /srv/agent-stack/app/mcp-server
  npm install @sentry/node
  # then in backend.env:
  SENTRY_DSN=https://...
  SENTRY_ENVIRONMENT=production
  SENTRY_RELEASE=<git sha or tag>
  ```
  The error path only ships 5xx exceptions to Sentry; 4xx auth failures stay in
  logs + metrics.
- Frontend Sentry: uncomment the Sentry CDN `<script>` in `frontend/index.html`
  and set `sentryDsn` under `window.__AVERRAY_CONFIG__`.
- Structured logs are JSON on stdout with a per-request `requestId`. Filter with
  `docker compose logs backend | jq 'select(.requestId == "...")'`.

## Monthly backup-restore drill

Verifying that backups are restorable is the only way to know they work. Run
this on the first of each month in a disposable target:

```bash
# 1. Grab the most recent dump
LATEST=$(ls -1t /srv/agent-stack/backups/postgres/*.sql.gz | head -1)

# 2. Spin up a throwaway Postgres on port 55432
docker run -d --name pg-restore-test \
  -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:16

# 3. Pipe the dump in
gunzip -c "$LATEST" | docker exec -i pg-restore-test \
  psql -U postgres

# 4. Eyeball a table you care about
docker exec pg-restore-test psql -U postgres -c "\\dt"

# 5. Tear down
docker rm -f pg-restore-test
```

If the restore fails, check `docker compose logs postgres` for schema or
version drift; a failed drill is a P1 — fix it before the next risky change.

## Incident response

### Escalation ladder

1. **Detect** — alert from uptime monitor, Sentry, or user report.
2. **Stabilise** — if the protocol is moving funds in unexpected ways, call
   `setPaused(true)` from the pauser hot-key via the multisig/PolkadotJS
   extension. Pause is 1-signature (pauser role) and stops every mutating
   function on `EscrowCore` and `AgentAccountCore`. Value cannot move while
   paused.
3. **Triage** — pull the relevant `requestId` from logs, check `/metrics`
   for rate-limit or 5xx spikes, verify indexer isn't lagging (`/health` on
   the indexer service).
4. **Mitigate** — if code-level: redeploy with fix (auto-rollback on failed
   health). If config-level: edit `backend.env` and redeploy.
5. **Post-mortem** — file a note in the repo with: timeline, blast radius,
   root cause, prevention.

### Contact + roles

Fill these in as the signer set grows:

- Primary oncall: <you>
- Backup oncall: <TBD>
- Multisig signers: <TBD>
- External party auth (if any): <TBD>

### Commands you'll reach for

```bash
# Pause the protocol (hot-key pauser)
# From a machine with the pauser private key or PolkadotJS extension access:
cast send "$TREASURY_POLICY" "setPaused(bool)" true \
  --rpc-url "$RPC_URL" --private-key "$PAUSER_KEY"

# Unpause once the issue is resolved
cast send "$TREASURY_POLICY" "setPaused(bool)" false \
  --rpc-url "$RPC_URL" --private-key "$PAUSER_KEY"

# Force a rollback without health-check
SKIP_ROLLBACK=1 ./scripts/ops/redeploy-backend.sh  # leave broken build for inspection
git -C /srv/agent-stack/app checkout <known-good-sha>
docker compose --project-directory /srv/agent-stack up -d --build backend
```
