#!/usr/bin/env bash
# WASM size regression check.
#
# Soroban charges rent/storage on contract bytes and deployment cost is
# bounded by the wasm size, so a dependency bump that quietly inflates an
# artifact costs real XLM on every deploy. This script compares the built
# artifacts against contracts/wasm-size-baseline.txt and fails when any
# artifact has grown past the allowed threshold.
#
# Usage:
#   cargo build --target wasm32-unknown-unknown --release --manifest-path contracts/Cargo.toml
#   bash scripts/check-wasm-size.sh
#
# Environment:
#   WASM_SIZE_MAX_GROWTH_PCT  allowed growth over baseline, percent (default: 10)
#   WASM_SIZE_BASELINE        baseline file   (default: contracts/wasm-size-baseline.txt)
#   WASM_SIZE_REPORT          markdown report (default: wasm-size-report.md, gitignored)
#
# Updating the baseline: run the script, copy the reported "Current" sizes
# into the baseline file, and explain the growth in the PR description.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WASM_DIR="${WASM_DIR:-$ROOT/contracts/target/wasm32-unknown-unknown/release}"
BASELINE="${WASM_SIZE_BASELINE:-$ROOT/contracts/wasm-size-baseline.txt}"
REPORT="${WASM_SIZE_REPORT:-$ROOT/wasm-size-report.md}"
MAX_GROWTH_PCT="${WASM_SIZE_MAX_GROWTH_PCT:-10}"

fail=0

die() {
  echo "check-wasm-size: $*" >&2
  exit 1
}

[[ "$MAX_GROWTH_PCT" =~ ^[0-9]+$ ]] ||
  die "WASM_SIZE_MAX_GROWTH_PCT must be a non-negative integer, got '$MAX_GROWTH_PCT'"
[[ -f "$BASELINE" ]] || die "baseline file not found: $BASELINE"
[[ -d "$WASM_DIR" ]] ||
  die "wasm build output not found: $WASM_DIR (run: cargo build --target wasm32-unknown-unknown --release --manifest-path contracts/Cargo.toml)"

file_size() {
  if stat -c %s "$1" >/dev/null 2>&1; then
    stat -c %s "$1"
  else
    stat -f %z "$1"
  fi
}

declare -A baseline current

while read -r name bytes _rest; do
  [[ -z "${name:-}" || "$name" == \#* ]] && continue
  [[ "$bytes" =~ ^[0-9]+$ ]] || die "malformed baseline line in $BASELINE: '$name $bytes'"
  baseline["$name"]="$bytes"
done < "$BASELINE"

[[ ${#baseline[@]} -gt 0 ]] || die "no entries parsed from $BASELINE"

shopt -s nullglob
for artifact in "$WASM_DIR"/*.wasm; do
  current["$(basename "$artifact")"]="$(file_size "$artifact")"
done
shopt -u nullglob

declare -a names=()
for name in "${!baseline[@]}"; do names+=("$name"); done
for name in "${!current[@]}"; do
  [[ -v "baseline[$name]" ]] || names+=("$name")
done
[[ ${#names[@]} -gt 0 ]] || die "no .wasm artifacts in $WASM_DIR"

rows=""
for name in $(printf '%s\n' "${names[@]}" | sort); do
  base="${baseline[$name]:-}"
  now="${current[$name]:-}"

  if [[ -z "$now" ]]; then
    rows+="| \`$name\` | ${base:--} | missing | - | - | ❌ missing artifact |
"
    echo "check-wasm-size: $name has a baseline of ${base}B but was not built in $WASM_DIR" >&2
    fail=1
    continue
  fi
  if [[ -z "$base" ]]; then
    rows+="| \`$name\` | missing | $now | - | - | ❌ no baseline |
"
    echo "check-wasm-size: $name ($now bytes) has no baseline entry in $BASELINE" >&2
    fail=1
    continue
  fi

  allowed=$(( base + base * MAX_GROWTH_PCT / 100 ))
  delta=$(( now - base ))
  if (( base > 0 )); then
    pct=$(awk -v d="$delta" -v b="$base" 'BEGIN { printf "%.1f", d * 100 / b }')
  else
    pct="n/a"
  fi

  if (( now > allowed )); then
    status="❌ over budget"
    fail=1
  else
    status="✅ ok"
  fi

  rows+="| \`$name\` | $base | $now | $allowed | $delta (${pct}%) | $status |
"
done

{
  echo "## WASM size check"
  echo
  echo "| Artifact | Baseline (bytes) | Current (bytes) | Allowed (+${MAX_GROWTH_PCT}%) | Delta | Status |"
  echo "| --- | ---: | ---: | ---: | ---: | --- |"
  printf '%s' "$rows"
  echo
  echo "Baseline: \`contracts/wasm-size-baseline.txt\` — threshold: growth over ${MAX_GROWTH_PCT}% fails the build."
} > "$REPORT"

cat "$REPORT"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  cat "$REPORT" >> "$GITHUB_STEP_SUMMARY"
fi

if (( fail )); then
  {
    echo
    echo "check-wasm-size: artifact grew past the allowed size (or a baseline/artifact is missing)."
    echo "If the growth is intentional, update contracts/wasm-size-baseline.txt with the"
    echo "reported 'Current' sizes and explain the growth in the PR description."
  } >&2
  exit 1
fi
