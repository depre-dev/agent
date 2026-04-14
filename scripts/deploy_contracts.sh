#!/usr/bin/env bash
set -euo pipefail

source /Users/pascalkuriger/.zshenv

RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
PRIVATE_KEY="${PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
DOT_NAME="${DOT_NAME:-Mock DOT}"
DOT_SYMBOL="${DOT_SYMBOL:-mDOT}"
DAILY_OUTFLOW_CAP="${DAILY_OUTFLOW_CAP:-1000000000000000000000000}"
BORROW_CAP="${BORROW_CAP:-1000000000000000000000}"
MIN_COLLATERAL_RATIO_BPS="${MIN_COLLATERAL_RATIO_BPS:-15000}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_command forge
require_command cast

DEPLOYER_ADDRESS="$(cast wallet address --private-key "$PRIVATE_KEY")"

extract_address() {
  echo "$1" | awk '/Deployed to:/ { print $3 }'
}

send_tx() {
  local to="$1"
  local signature="$2"
  shift 2
  cast send \
    --private-key "$PRIVATE_KEY" \
    --rpc-url "$RPC_URL" \
    "$to" \
    "$signature" \
    "$@" >/dev/null
}

echo "Deploying with $DEPLOYER_ADDRESS via $RPC_URL"

TREASURY_OUTPUT="$(forge create contracts/TreasuryPolicy.sol:TreasuryPolicy --broadcast --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY")"
TREASURY_POLICY="$(extract_address "$TREASURY_OUTPUT")"
echo "TreasuryPolicy: $TREASURY_POLICY"

REGISTRY_OUTPUT="$(forge create contracts/StrategyAdapterRegistry.sol:StrategyAdapterRegistry --broadcast --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --constructor-args "$TREASURY_POLICY")"
STRATEGY_REGISTRY="$(extract_address "$REGISTRY_OUTPUT")"
echo "StrategyAdapterRegistry: $STRATEGY_REGISTRY"

ACCOUNT_OUTPUT="$(forge create contracts/AgentAccountCore.sol:AgentAccountCore --broadcast --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --constructor-args "$TREASURY_POLICY" "$STRATEGY_REGISTRY")"
AGENT_ACCOUNT="$(extract_address "$ACCOUNT_OUTPUT")"
echo "AgentAccountCore: $AGENT_ACCOUNT"

REPUTATION_OUTPUT="$(forge create contracts/ReputationSBT.sol:ReputationSBT --broadcast --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --constructor-args "$TREASURY_POLICY")"
REPUTATION_SBT="$(extract_address "$REPUTATION_OUTPUT")"
echo "ReputationSBT: $REPUTATION_SBT"

ESCROW_OUTPUT="$(forge create contracts/EscrowCore.sol:EscrowCore --broadcast --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --constructor-args "$TREASURY_POLICY" "$AGENT_ACCOUNT" "$REPUTATION_SBT")"
ESCROW_CORE="$(extract_address "$ESCROW_OUTPUT")"
echo "EscrowCore: $ESCROW_CORE"

MOCK_DOT_OUTPUT="$(forge create contracts/mocks/MockERC20.sol:MockERC20 --broadcast --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" --constructor-args "$DOT_NAME" "$DOT_SYMBOL")"
MOCK_DOT="$(extract_address "$MOCK_DOT_OUTPUT")"
echo "Mock DOT: $MOCK_DOT"

echo "Configuring TreasuryPolicy"
send_tx "$TREASURY_POLICY" "setApprovedAsset(address,bool)" "$MOCK_DOT" true
send_tx "$TREASURY_POLICY" "setServiceOperator(address,bool)" "$AGENT_ACCOUNT" true
send_tx "$TREASURY_POLICY" "setServiceOperator(address,bool)" "$ESCROW_CORE" true
send_tx "$TREASURY_POLICY" "setVerifier(address,bool)" "$DEPLOYER_ADDRESS" true
send_tx "$TREASURY_POLICY" "setArbitrator(address,bool)" "$DEPLOYER_ADDRESS" true
send_tx "$TREASURY_POLICY" "setDailyOutflowCap(uint256)" "$DAILY_OUTFLOW_CAP"
send_tx "$TREASURY_POLICY" "setPerAccountBorrowCap(uint256)" "$BORROW_CAP"
send_tx "$TREASURY_POLICY" "setMinimumCollateralRatioBps(uint256)" "$MIN_COLLATERAL_RATIO_BPS"

cat <<EOF
DEPLOYER_ADDRESS=$DEPLOYER_ADDRESS
RPC_URL=$RPC_URL
TREASURY_POLICY=$TREASURY_POLICY
STRATEGY_ADAPTER_REGISTRY=$STRATEGY_REGISTRY
AGENT_ACCOUNT_ADDRESS=$AGENT_ACCOUNT
REPUTATION_SBT_ADDRESS=$REPUTATION_SBT
ESCROW_CORE_ADDRESS=$ESCROW_CORE
MOCK_DOT_ADDRESS=$MOCK_DOT
EOF
