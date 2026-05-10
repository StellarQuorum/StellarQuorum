#!/usr/bin/env bash
# Deploy Quorum contracts to Stellar testnet or mainnet
# Usage: NETWORK=testnet SOURCE_ACCOUNT=G... bash scripts/deploy.sh
set -euo pipefail

NETWORK="${NETWORK:-testnet}"
SOURCE_ACCOUNT="${SOURCE_ACCOUNT:?Set SOURCE_ACCOUNT to your Stellar account}"

if [[ "$NETWORK" == "testnet" ]]; then
  RPC_URL="https://soroban-testnet.stellar.org"
  PASSPHRASE="Test SDF Network ; September 2015"
else
  RPC_URL="https://soroban-rpc.stellar.org"
  PASSPHRASE="Public Global Stellar Network ; September 2015"
fi

echo "Building contracts..."
(cd contracts && cargo build --target wasm32-unknown-unknown --release 2>&1)

WASM_DIR="contracts/target/wasm32-unknown-unknown/release"

echo "Deploying QUORUM token..."
TOKEN_ID=$(stellar contract deploy \
  --wasm "$WASM_DIR/quorum_token.wasm" \
  --source "$SOURCE_ACCOUNT" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$PASSPHRASE")
echo "  Token: $TOKEN_ID"

stellar contract invoke --id "$TOKEN_ID" --source "$SOURCE_ACCOUNT" \
  --rpc-url "$RPC_URL" --network-passphrase "$PASSPHRASE" \
  -- initialize --admin "$SOURCE_ACCOUNT" \
  --name "Quorum" --symbol "QUORUM" --decimals 7 \
  --initial_supply 100000000000000

echo "Deploying Governance contract..."
GOV_ID=$(stellar contract deploy \
  --wasm "$WASM_DIR/quorum_governance.wasm" \
  --source "$SOURCE_ACCOUNT" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$PASSPHRASE")
echo "  Governance: $GOV_ID"

stellar contract invoke --id "$GOV_ID" --source "$SOURCE_ACCOUNT" \
  --rpc-url "$RPC_URL" --network-passphrase "$PASSPHRASE" \
  -- initialize --admin "$SOURCE_ACCOUNT" \
  --token "$TOKEN_ID" --quorum_bps 500 \
  --voting_period 17280 --timelock_period 8640 \
  --proposal_threshold 500000000000

echo ""
echo "Done. Add to your .env.local:"
echo "NEXT_PUBLIC_GOVERNANCE_CONTRACT=$GOV_ID"
echo "NEXT_PUBLIC_TOKEN_CONTRACT=$TOKEN_ID"
