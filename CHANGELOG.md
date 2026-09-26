# Changelog

All notable changes to Quorum are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Quorum has not cut a tagged release yet; every package (`contracts/*`, `sdk`,
`frontend`) is still at `0.1.0`. Changes made since the initial scaffold are
therefore listed under **Unreleased**, dated by the commit that introduced them.
Because the contracts are pre-1.0, breaking changes may land in any release and
are marked **BREAKING** below.

## [Unreleased]

### Breaking changes

- **BREAKING (token):** `approve()` now takes a fifth argument,
  `expiration_ledger: u32`, per SEP-41. Four-argument callers no longer work.
  A live approval (`amount > 0`) with an expiration in the past is rejected with
  the new `InvalidExpiration` error; an `amount` of `0` revokes and accepts any
  expiration. The stored allowance type changed from a bare amount to
  `AllowanceValue { amount, expiration_ledger }`, so allowances written by an
  earlier deployment are not readable by the new code. (2026-09-18)
- **BREAKING (governance):** voting weight is now the voter's token balance at
  the proposal's `snapshot_ledger`, read from the token via the new
  `get_past_balance`. The governance contract therefore requires a token that
  exposes `total_supply`, `balance` and `get_past_balance`. A vote from an
  address with no power at the snapshot is rejected with `NoVotingPower`
  instead of being recorded with zero weight. (2026-09-13)
- **BREAKING (governance):** `create_proposal()` now rejects proposers whose live
  token balance is below `proposal_threshold` with `BelowProposalThreshold`.
  (2026-09-13)
- **BREAKING (error codes):** new variants were added to `GovernanceError`
  (`Overflow = 13`, `NoVotingPower = 14`) and `TokenError`
  (`InvalidExpiration = 7`). Clients that map error codes exhaustively need
  updating.

### Added

- CI: `Contract specs` workflow generates the interface spec JSON for both
  contracts (`quorum-token.spec.json`, `quorum-governance.spec.json`), uploads it
  as an artifact on every contracts change and attaches it to published releases.
  (2026-09-26)
- Token: TTL extension on `Balance`, `Checkpoints` and live `Allowance` entries
  and on instance storage, using the governance thresholds (30 days / 90 days), so
  snapshot voting power survives long voting windows and idle holders. (2026-09-26)
- Token: `transfer_from()` for allowance-based spending, with the allowance
  debited only after the transfer succeeds and its original expiry preserved.
  (2026-09-18)
- Token: balance checkpoints and `get_past_balance(owner, ledger)`, a binary
  search over per-address `Checkpoint { ledger, balance }` history. (2026-09-13)
- Governance: `get_vote()` returns the choice a voter recorded (0 Against,
  1 For, 2 Abstain), or `None`. (2026-09-13)
- SDK: `getVote()` and `hasVoted()` implemented against contract simulation.
  (2026-09-13)
- Events on both contracts. Governance: `proposal_created`, `vote_cast`,
  `proposal_finalized`, `proposal_queued`, `proposal_executed`,
  `proposal_cancelled`. Token: `mint`, `burn`, `transfer`, `approve`,
  `admin_transferred`. (2026-09-15, 2026-09-16)
- Tests for governance (initialization, proposals, voting, finalize, execute,
  cancel) and the token (transfers, mint, burn, allowance, auth). (2026-09-14)
- Documentation: governance parameters, security model, deployment and glossary
  guides; test-running guide; issue templates, pull request template and
  `CODEOWNERS`. (2026-09-25)
- CI: `cargo audit`, `npm audit`, frontend lint and a real frontend test suite;
  coverage reporting, property tests and lifecycle/auth integration tests;
  visual and accessibility suites; Dependabot. (2026-09-25)

### Changed

- Governance: `quorum_required` is computed from the token's `total_supply` as
  `total_supply * quorum_bps / 10000` and frozen into the proposal at creation.
  Previously it was hardcoded to `0`, so any single vote satisfied quorum.
  (2026-09-12)
- Governance: vote tallying uses checked arithmetic and returns `Overflow`
  instead of trapping. (2026-09-13)
- Governance: proposal, vote and instance storage TTLs are extended on access
  (threshold 30 days, extended to 90 days). (2026-09-16)
- Allowances read as `0` once expired, so a lapsed approval is never treated as
  spendable. (2026-09-18)

### Fixed

- Token: `mint()` returns `Overflow` instead of trapping when the new supply or
  balance would exceed `i128::MAX`, and `burn()` returns it rather than taking
  total supply below zero. (2026-09-26)
- Token: checkpoint history older than 60 days is pruned on write, keeping the
  newest stale entry as the balance at the cutoff, so per-address history is
  bounded by time rather than growing for the life of the account. Snapshots
  older than the window read as `0`. (2026-09-26)
- CI: the contracts job now caches the cargo registry and build artifacts through
  `Swatinem/rust-cache`, keyed on `Cargo.lock`, the rustc version and workspace
  metadata. The previous `actions/cache` key only moved with `Cargo.lock`, so a
  toolchain bump restored artifacts built by the old rustc under a key that still
  hit — every crate rebuilt and the post-job step never re-saved, leaving the job
  wedged on cold builds. The job also reports its cache hit and duration in the
  run summary, so the reduction is measurable. (2026-09-26)
- Contracts: pinned `ed25519-dalek` to 2.2.0 so `cargo test` compiles.
  (2026-09-10)
- CI: repaired the frontend job, gated the contracts job on clippy, and added
  the SDK `package-lock.json` so `npm ci` works. (2026-09-10, 2026-09-12)
- Token: removed a duplicated delegate TODO comment. (2026-09-12)

## [0.1.0] - 2026-05-10

Initial scaffold (not tagged; package versions are `0.1.0`).

### Added

- Next.js frontend: home, proposal list, proposal detail and create-proposal
  pages with seed proposal data (QIP-001 to QIP-008).
- Governance contract: `initialize`, `create_proposal`, `vote`, `finalize`,
  `execute`, `cancel` and view functions.
- Token contract: SEP-41-style QUORUM token with `initialize`, `transfer`,
  `mint`, `burn`, `approve`/`allowance`, `transfer_admin`, `name`, `symbol` and
  `decimals`.
- TypeScript SDK with `QuorumClient`.
- Deployment script (`scripts/deploy.sh`), GitHub Actions CI, README,
  architecture and contributing docs.

[Unreleased]: https://github.com/StellarQuorum/StellarQuorum/commits/main
[0.1.0]: https://github.com/StellarQuorum/StellarQuorum/commit/83a5949
