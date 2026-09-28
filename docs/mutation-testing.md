# Mutation Testing for the Contracts

A green `cargo test` proves the code runs under the current assertions; it does
not prove the assertions would notice a regression. Mutation testing measures
that directly. [cargo-mutants](https://mutants.rs) rewrites the contract source
one small change at a time — `<` to `<=`, `+` to `-`, a match guard to `false`,
a whole function body to `Ok(Default::default())` — and reruns the suite for
each variant. A mutated build whose tests still pass is a **survivor**: some
behaviour of the contract changed and nothing in the suite objected.

## Running it

```bash
cargo install cargo-mutants

# The baseline must be green first — cargo-mutants runs the suite unmutated
# and refuses to continue if it fails.
cargo test --workspace --manifest-path contracts/Cargo.toml

cd contracts
cargo mutants --workspace --in-place --colors never
```

- `--workspace` covers both `governance` and `token`.
- `--in-place` mutates the checkout instead of copying the tree into a scratch
  directory. The contracts workspace carries ~1.5 GB of `target/`, and one copy
  per worker does not fit on a normal developer disk. cargo-mutants restores
  each file from the text it read at startup, so uncommitted work survives the
  run — but **do not edit source files while it is running**.
- Expect roughly two hours for the current 168 mutants (baseline ~1.5 minutes,
  then 7–25 s per mutant; the token mutants are slower because every one of them
  reruns the 50-case checkpoint property test).

Results are written to `contracts/mutants.out/`:

| File | Contents |
|---|---|
| `missed.txt` | survivors — one line per mutant that no test caught |
| `caught.txt` | mutants that failed at least one test |
| `unviable.txt` | mutants that did not compile |
| `timeout.txt` | mutants that ran out of time (none so far) |
| `outcomes.json` | machine-readable outcome per mutant |
| `diff/`, `log/` | the diff and full cargo output for every mutant |

`mutants.out/` is gitignored, and a new run rotates the previous one to
`mutants.out.old/`. Narrow a run to specific mutants with `--re` (regex over
the names printed by `cargo mutants --list`):

```bash
cargo mutants --workspace --in-place --re '^token/src/lib\.rs:348'
```

## Trial run — 2026-09-27

cargo-mutants 27.1.0, rustc 1.94.1, `cargo mutants --workspace --in-place`,
against the workspace as merged (`soroban-sdk` 22.0.11).

| Outcome | Count | Share of viable mutants |
|---|---:|---:|
| Caught — at least one test failed | 148 | 94.3% |
| **Missed — survived** | **9** | **5.7%** |
| Unviable — did not compile | 11 | — |
| Timeout | 0 | — |
| Total mutants generated | 168 | |

Mutation score = caught / (total − unviable) = 148 / 157 = **94.3%**.

The suite was already strong on the guards this exercise targets: proposal
thresholds, quorum, timelock, vote deadlines and allowance expiry all killed
their mutants. Every one of the nine survivors turned out to be a real
blind spot (eight) or an unobservable difference (one) — see the triage below.

### Blockers fixed before the run could start

Neither of the first two is a mutation-testing finding per se, but the suite
could not have caught anything without them:

1. **The contract tests did not compile.** `contracts/token/src/test.rs` used
   `std::vec::Vec` / `std::vec![]` inside a `#![no_std]` crate (introduced by
   `96d0532`), so `cargo test` failed with `use of unresolved module or
   unlinked crate 'std'`. Fixed by declaring `extern crate std;` in the test
   module — the test harness links std on the host regardless.
2. **`full_lifecycle_passes_and_executes_after_timelock` failed.** The test Env
   enables soroban-env invocation metering, and that clears the host event
   buffer at the start of *every* top-level invocation, so `env.events().all()`
   only ever shows the most recent contract call. The test read finalize's
   events *after* calling `get_proposal()`, which had already wiped them.
   Fixed by capturing the event log immediately after `finalize()`.
3. **Clippy was red on the same test module** (`clippy::ptr_arg` on
   `naive_past_balance(&std::vec::Vec<_>)`, which CI runs with `-D warnings`).
   Fixed by taking `&[(u32, i128)]` instead — the call site coerces unchanged.

## Triage of the 9 surviving mutants

| # | Mutant | Verdict | Action |
|---|---|---|---|
| 1 | `governance/src/lib.rs:47:44` — `TTL_THRESHOLD = LEDGERS_PER_DAY * 30` → `+` (30 days becomes ~1 day) | Real gap: no test read the entry while it still had days of life left, so a wrong threshold was invisible | **Fixed** — `a_read_restores_the_ttl_while_the_entry_is_still_below_the_threshold` ages the entry to ~100 000 ledgers remaining, asserts it is below the threshold but above the floor, and asserts the read pushes it back out |
| 2 | `governance/src/lib.rs:256:40` — `for + against` → `for - against` in `finalize`'s tally | Real gap: every finalize test used turnout that survived the subtraction | **Fixed** — `finalize_counts_for_and_against_together_toward_quorum` (40 000 For + 20 000 Against against a 50 000 threshold: tally 60 000 → queued, mutated tally 20 000 → failed) |
| 3 | `governance/src/lib.rs:256:65` — `against + abstain` → `against - abstain` | Real gap: **no test ever finalizes a proposal that has abstain votes**, so abstentions were never shown to count toward quorum | **Fixed** — `finalize_counts_abstentions_toward_quorum` (30 000 For + 30 000 Abstain: real tally 60 000 → queued, mutated tally 0 → failed) |
| 4 | `governance/src/lib.rs:256:65` — `against + abstain` → `against * abstain` | Real gap, same line as #3 | **Fixed** — both new finalize tests catch it (abstain = 0 makes the product zero, so the mutated tally falls under quorum) |
| 5 | `token/src/lib.rs:214:16` — `burn`: `bal < amount` → `bal <= amount` | Real gap: nothing burned *exactly* the full balance, so the off-by-one boundary was untested (unlike `transfer`, which has `transfer_of_the_entire_balance_is_allowed`) | **Fixed** — `burn_of_the_entire_balance_is_allowed` |
| 6 | `token/src/lib.rs:348:27` — collapse match guard `len > 0 && last.ledger == ledger` → `false` | Real gap: `get_past_balance` reads the last duplicate either way, so the collapse is invisible through the public API; no test inspected the stored checkpoint vector | **Fixed** — `several_writes_in_one_ledger_store_a_single_checkpoint` reads `DataKey::Checkpoints` from storage and asserts one entry per ledger |
| 7 | `token/src/lib.rs:348:31` — `>` → `==` in the same guard | Same effect as #6 (guard is false whenever the vector is non-empty) | **Fixed** — same test |
| 8 | `token/src/lib.rs:348:31` — `>` → `<` in the same guard | Same effect as #6 | **Fixed** — same test |
| 9 | `token/src/lib.rs:348:31` — `>` → `>=` in the same guard | **Equivalent mutant.** With `len == 0`, `checkpoints.get(len.saturating_sub(1))` reads index 0 of an empty vector and yields `None`, so `Some(last)` already implies `len > 0`; the extra condition cannot be observed by any test | **Documented**, not fixed — the guard is defensive, not dead weight. Reported in the run as a miss so it stays visible rather than being deleted from the source |

Score after the fixes: 8 of the 9 survivors now have tests, and the ninth is a
provably equivalent mutation.

## Verification re-run

The four new tests were checked by re-running only the mutants at the nine
survivor locations plus their siblings (14 mutants total):

```bash
cd contracts
cargo mutants --workspace --in-place --colors never \
  --re '^(governance/src/lib\.rs:(47:44|256:(40|65))|token/src/lib\.rs:(214:16|348:(27|31)))'
```

Result: **14 tested in 8 min — 13 caught, 1 missed.** The only survivor left is
`token/src/lib.rs:348:31 replace > with >=`, the equivalent mutant from row 9.
Every one of the eight fixed survivors is now killed: the TTL threshold, both
tally operators on each side of the sum, the burn boundary, and all three
collapse-breaking mutations of the checkpoint guard.

## Unviable mutants (11)

These never reached the test suite — the mutated source did not compile, which
cargo-mutants reports as *unviable* rather than missed. They are excluded from
the mutation score:

| Mutant | Why it does not build |
|---|---|
| `governance/src/lib.rs:50:44` `*` → `/` | `error: this arithmetic operation will overflow` under the dev profile's `overflow-checks` |
| `governance/src/lib.rs:252:9`, `306:9` — replace `finalize` / `get_proposal` with `Ok(Default::default())` | `ProposalStatus` and `Proposal` do not implement `Default` |
| `governance/src/lib.rs:335:9` — replace `get_config` with `Default::default()` | `Config` does not implement `Default` |
| `token/src/lib.rs:273:39`, `274:41` — replace `name` / `symbol` with `String::new()` / `"xyzzy".into()` | `soroban_sdk::String` is not `From<&str>` and has no `new()` |
| `token/src/lib.rs:289:9`, `323:9` — replace `live_allowance` / `checkpoints` with `Default::default()` / `vec![]` | `AllowanceValue` has no `Default`; the `vec!` macro is out of scope in a `#![no_std]` crate |

## CI

A full run costs ~2 hours and rewrites the checkout, so it is **not** part of
the per-PR workflow in `.github/workflows/ci.yml`. Treat it as a periodic or
on-demand check: run it before releases, after a dependency bump that changes
`contracts/Cargo.lock`, or when a test file is substantially reworked, and keep
`missed.txt` here (or in the PR description) as the record of what the suite
does not yet prove. If it is ever wired into CI, give it its own
`workflow_dispatch`/scheduled job with `--in-place` and a single worker.
