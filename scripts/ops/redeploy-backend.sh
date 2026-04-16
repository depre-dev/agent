#!/usr/bin/env bash
#
# Redeploy the backend container with pre-flight pause + post-deploy health
# gating + automatic rollback on failure.
#
# Flow:
#   1. Pin the pre-deploy commit so we can roll back on failure.
#   2. Fetch + fast-forward to origin/<branch>.
#   3. Rebuild and `up -d` the backend container.
#   4. Poll the configured health URL. If it never returns 200 within the
#      timeout window, check out the pre-deploy commit and rebuild to restore
#      the previous version.
#
# Environment variables:
#   STACK_ROOT         parent dir containing docker-compose.yml (default: repo parent)
#   COMPOSE_FILE       path to docker-compose.yml
#   BRANCH             branch to pull (default: main)
#   HEALTH_URL         URL to poll for readiness (default: https://api.averray.com/health)
#   HEALTH_TIMEOUT_SEC max seconds to wait for health (default: 120)
#   HEALTH_INTERVAL_SEC seconds between health polls (default: 5)
#   SKIP_ROLLBACK=1    disable auto-rollback (useful for staged canary tests)
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
APP_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
STACK_ROOT=${STACK_ROOT:-$(cd "$APP_ROOT/.." && pwd)}
COMPOSE_FILE=${COMPOSE_FILE:-"$STACK_ROOT/docker-compose.yml"}
BRANCH=${BRANCH:-main}
HEALTH_URL=${HEALTH_URL:-https://api.averray.com/health}
HEALTH_TIMEOUT_SEC=${HEALTH_TIMEOUT_SEC:-120}
HEALTH_INTERVAL_SEC=${HEALTH_INTERVAL_SEC:-5}

if [[ ! -d "$APP_ROOT/.git" ]]; then
  echo "Expected repo checkout at $APP_ROOT" >&2
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Missing docker-compose file at $COMPOSE_FILE" >&2
  exit 1
fi

for cmd in git docker curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
done

# Pin the pre-deploy SHA before changing anything so rollback has a concrete
# target. `rev-parse HEAD` works even in detached-HEAD setups.
PREVIOUS_SHA=$(git -C "$APP_ROOT" rev-parse HEAD)
echo "Pre-deploy SHA: $PREVIOUS_SHA"

compose_up() {
  docker compose \
    --project-directory "$STACK_ROOT" \
    -f "$COMPOSE_FILE" \
    up -d --build backend
}

wait_for_health() {
  local deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SEC ))
  local attempts=0
  while [[ $(date +%s) -lt $deadline ]]; do
    attempts=$(( attempts + 1 ))
    if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
      echo "Health check passed after ${attempts} attempt(s)."
      curl -fsS "$HEALTH_URL" || true
      echo
      return 0
    fi
    sleep "$HEALTH_INTERVAL_SEC"
  done
  return 1
}

rollback() {
  if [[ "${SKIP_ROLLBACK:-}" == "1" ]]; then
    echo "SKIP_ROLLBACK=1 set; leaving the unhealthy deploy in place for inspection." >&2
    exit 1
  fi
  echo "Health check failed; rolling back to $PREVIOUS_SHA" >&2
  git -C "$APP_ROOT" checkout --quiet "$PREVIOUS_SHA"
  compose_up
  if wait_for_health; then
    echo "Rollback succeeded; service is serving the previous build."
  else
    echo "Rollback failed to restore health. Manual intervention required." >&2
  fi
  exit 1
}

echo "Updating repo in $APP_ROOT"
git -C "$APP_ROOT" fetch origin "$BRANCH"
git -C "$APP_ROOT" checkout "$BRANCH"
git -C "$APP_ROOT" pull --ff-only origin "$BRANCH"

NEW_SHA=$(git -C "$APP_ROOT" rev-parse HEAD)
echo "Deploying SHA: $NEW_SHA"

echo "Rebuilding backend container"
compose_up

echo "Waiting for health at $HEALTH_URL (timeout ${HEALTH_TIMEOUT_SEC}s)"
if ! wait_for_health; then
  rollback
fi

echo "Backend redeployed successfully."
