#!/usr/bin/env bash
#
# Rotate the TreasuryPolicy `pauser` role.
#
# The pauser is a single hot-key EOA whose only power is `setPaused(bool)`.
# You'll rotate it any time a device holding the hot key is lost, upgraded,
# or just to rehearse the flow during the multisig bring-up (docs/MULTISIG_SETUP.md).
#
# Because `setPauser(address)` is an owner-only call, the signing key here
# must be the current owner. On mainnet that's the multisig — in which case
# this script isn't the right tool, use Polkadot.js Apps → Multisig instead.
# On testnet (single-owner rehearsal) pass the owner key via OWNER_KEY.
#
# Usage:
#   ./scripts/rotate_pauser.sh <new_pauser_address> [profile]
#
# Inputs:
#   $1               new pauser address (0x + 20 bytes)
#   $2 or PROFILE    deployment profile (default: dev). Used to locate the
#                    manifest at deployments/<profile>.json for the current
#                    pauser + TreasuryPolicy address.
#   OWNER_KEY        private key of the current owner (REQUIRED). Rejected
#                    if it matches the well-known Anvil test key on
#                    non-dev profiles.
#   RPC_URL          override RPC; defaults to the manifest's rpcUrl.
#   DRY_RUN=1        skip the cast send; just print what would happen.
set -euo pipefail

# Derived address for the well-known Anvil test key (account #0). Compare the
# caller-provided private key's derived address against this instead of
# hardcoding the raw key — both because the raw key trips our own secret-scan
# pre-commit hook and because this is the canonical way to detect it anyway.
ANVIL_TEST_KEY_ADDRESS="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

fail() { echo "error: $*" >&2; exit 1; }

if [[ $# -lt 1 ]]; then
  fail "usage: $0 <new_pauser_address> [profile]"
fi

NEW_PAUSER="$1"
PROFILE="${2:-${PROFILE:-dev}}"

for cmd in cast jq; do
  command -v "$cmd" >/dev/null 2>&1 || fail "missing required command: $cmd"
done

if [[ ! "$NEW_PAUSER" =~ ^0x[a-fA-F0-9]{40}$ ]]; then
  fail "new_pauser must be a 0x-prefixed 20-byte address, got: $NEW_PAUSER"
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/.." && pwd)"
manifest="${repo_root}/deployments/${PROFILE}.json"

[[ -f "$manifest" ]] || fail "no manifest at $manifest — run scripts/deploy_contracts.sh first"
[[ -n "${OWNER_KEY:-}" ]] || fail "OWNER_KEY is required (the private key of the current owner)"

owner_key_address=$(cast wallet address --private-key "$OWNER_KEY")
if [[ "$PROFILE" != "dev" && "${owner_key_address,,}" == "${ANVIL_TEST_KEY_ADDRESS,,}" ]]; then
  fail "refusing to use the Anvil test key for PROFILE=$PROFILE"
fi

data=$(cat "$manifest")
RPC_URL="${RPC_URL:-$(echo "$data" | jq -r '.rpcUrl')}"
TREASURY_POLICY=$(echo "$data" | jq -r '.contracts.treasuryPolicy')
MANIFEST_OWNER=$(echo "$data" | jq -r '.owner')
MANIFEST_PAUSER=$(echo "$data" | jq -r '.pauser')

# Read the live on-chain owner — don't trust the manifest alone, it may be
# stale if someone rotated without updating the file.
live_owner_raw=$(cast call --rpc-url "$RPC_URL" "$TREASURY_POLICY" "owner()(address)")
live_pauser_raw=$(cast call --rpc-url "$RPC_URL" "$TREASURY_POLICY" "pauser()(address)")

echo "Profile:           $PROFILE"
echo "TreasuryPolicy:    $TREASURY_POLICY"
echo "RPC:               $RPC_URL"
echo "Manifest owner:    $MANIFEST_OWNER"
echo "Live owner:        $live_owner_raw"
echo "OWNER_KEY signs as:$owner_key_address"
echo "Manifest pauser:   $MANIFEST_PAUSER"
echo "Live pauser:       $live_pauser_raw"
echo "New pauser:        $NEW_PAUSER"
echo ""

if [[ "${live_owner_raw,,}" != "${owner_key_address,,}" ]]; then
  fail "OWNER_KEY ($owner_key_address) does not match the live owner ($live_owner_raw). If the owner is a multisig, use Polkadot.js Apps instead."
fi

if [[ "${live_pauser_raw,,}" == "${NEW_PAUSER,,}" ]]; then
  echo "Live pauser already matches target — nothing to do."
  exit 0
fi

if [[ "${DRY_RUN:-}" == "1" ]]; then
  echo "DRY_RUN=1 set; skipping cast send."
  exit 0
fi

echo "Sending setPauser transaction…"
cast send \
  --rpc-url "$RPC_URL" \
  --private-key "$OWNER_KEY" \
  "$TREASURY_POLICY" \
  "setPauser(address)" \
  "$NEW_PAUSER" >/dev/null

# Post-check: read back from chain so we report the committed state.
post_pauser_raw=$(cast call --rpc-url "$RPC_URL" "$TREASURY_POLICY" "pauser()(address)")
echo "Post-rotate pauser: $post_pauser_raw"

if [[ "${post_pauser_raw,,}" != "${NEW_PAUSER,,}" ]]; then
  fail "rotation transaction sent but live pauser ($post_pauser_raw) does not match target ($NEW_PAUSER). Check logs."
fi

# Best-effort: update the manifest so future verify_deployment runs expect
# the new pauser. Non-fatal if the update fails.
tmp=$(mktemp)
if jq --arg p "$NEW_PAUSER" '.pauser = $p' "$manifest" > "$tmp" 2>/dev/null; then
  mv "$tmp" "$manifest"
  echo "Manifest updated: $manifest"
else
  rm -f "$tmp"
  echo "warning: could not update manifest automatically; rewrite .pauser in $manifest manually." >&2
fi

echo ""
echo "Rotation complete. Run scripts/verify_deployment.sh $PROFILE to confirm the full wiring."
