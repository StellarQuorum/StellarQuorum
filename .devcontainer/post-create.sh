#!/usr/bin/env bash
# Prepare the workspace after the devcontainer is created (issue #299).
#
# Runs the same installs a contributor would run by hand after cloning, so
# opening the repo in a devcontainer leaves a working `cargo build` /
# `npm install` environment:
#
#   * sdk      — npm ci, then build dist/ (the frontend links @quorum/sdk from
#                ../sdk via `file:../sdk`, so the built dist/ must exist
#                before the frontend can resolve it)
#   * frontend — npm ci
#   * contracts — cargo fetch, so `cargo build` does not start by downloading
#                the whole registry
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Installing SDK dependencies and building dist/"
(cd "${ROOT}/sdk" && npm ci && npm run build)

echo "==> Installing frontend dependencies"
(cd "${ROOT}/frontend" && npm ci)

echo "==> Fetching contract dependencies"
cargo fetch --manifest-path "${ROOT}/contracts/Cargo.toml"

echo "==> Devcontainer ready"
echo "    contracts: cd contracts && cargo build --target wasm32-unknown-unknown --release"
echo "    frontend:  cd frontend && npm run dev"
echo "    sdk:       cd sdk && npm test"
