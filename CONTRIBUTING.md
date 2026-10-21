# Contributing to Quorum

Thank you for your interest in contributing to Quorum — on-chain governance infrastructure for the Stellar ecosystem. This guide covers everything you need to get started contributing to any part of the project.

**New contributors?** Start with the [Contributor Checklist](CONTRIBUTOR_CHECKLIST.md) for a quick-start guide before diving into this comprehensive document.

---

## Table of Contents

- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Running Tests](#running-tests)
- [Contribution Workflow](#contribution-workflow)
- [Contributing to Contracts](#contributing-to-contracts)
- [Contributing to the Frontend](#contributing-to-the-frontend)
- [Contributing to the SDK](#contributing-to-the-sdk)
- [Contributing to Documentation](#contributing-to-documentation)
- [Drips Wave](#drips-wave)
- [Commit Convention](#commit-convention)
- [Pull Request Process](#pull-request-process)
- [Code of Conduct](#code-of-conduct)

---

## Project Structure

```
quorum/
├── frontend/     Next.js governance UI (TypeScript, Tailwind CSS)
├── contracts/    Soroban smart contracts (Rust)
│   ├── governance/   Proposal lifecycle, voting, timelock
│   └── token/        QUORUM governance token
├── sdk/          TypeScript client SDK (@quorum/sdk)
├── scripts/      Deployment and operational scripts
├── tests/        Integration test stubs
└── docs/         Architecture, whitepaper, tutorials
```

---

## Getting Started

### Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | ≥ 18 | Frontend and SDK development |
| Rust | stable | Smart contract compilation |
| wasm32-unknown-unknown | via rustup | WASM target for Soroban |
| Stellar CLI | latest | Contract deployment and invocation |
| Git | any | Version control |

### Install Prerequisites

```bash
# Node.js (via nvm recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20 && nvm use 20

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown

# Stellar CLI
cargo install stellar-cli --features opt
```

### Devcontainer (recommended)

Skip the manual setup above with a devcontainer. It installs Node 20, Rust
stable with the `wasm32-unknown-unknown` target, clippy/rustfmt and the Stellar
CLI, then installs the workspace dependencies, so opening the repo leaves a
working `cargo build` / `npm install` environment with no extra steps.

- **GitHub Codespaces** — open the repo and pick the `Quorum (Stellar)` machine.
- **VS Code** — install the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers),
  then run *Dev Containers: Reopen in Container* from the command palette.

The definition lives in [`.devcontainer/`](.devcontainer/):
[`.devcontainer/Dockerfile`](.devcontainer/Dockerfile) builds the toolchain
image and [`.devcontainer/devcontainer.json`](.devcontainer/devcontainer.json)
wires it up. The container also enables docker-in-docker, so the local
Soroban network can be started from inside it with `docker compose up -d`.

Once the container is ready:

```bash
cd contracts && cargo build --target wasm32-unknown-unknown --release
cd frontend && npm run dev   # http://localhost:3000
```

### Fork and Clone

```bash
# Fork the repo on GitHub, then:
git clone https://github.com/YOUR_USERNAME/StellarQuorum.git
cd StellarQuorum
git remote add upstream https://github.com/StellarQuorum/StellarQuorum.git
```

---

## Development Setup

### Frontend

```bash
cd frontend
npm install
npm run dev       # Start dev server at http://localhost:3000
npm run build     # Verify production build
npm run lint      # Lint TypeScript/React
npm test          # Run unit tests
```

### Contracts

```bash
cd contracts
cargo build --target wasm32-unknown-unknown --release  # Build WASMs
cargo test                                              # Run unit tests
cargo clippy                                            # Lint Rust code
```

### SDK

```bash
cd sdk
npm install
npm run build     # Compile TypeScript to dist/
npm test          # Run SDK tests
```

---

## Running Tests

All test suites and verification checks must pass before opening or merging a pull request. Below is the authoritative guide to running every test suite in the repository, matching the commands executed in GitHub Actions CI.

### Test Suites Overview

| Suite | Scope / Package | Shortcut | Primary Command | CI Equivalent |
|---|---|---|---|---|
| **All Suites** | Runs contracts, frontend, SDK, and integration suites | `make test` | — | — |
| **Contracts** | Unit and integration tests for Soroban contracts (`contracts/governance`, `contracts/token`) | `make test-contracts` | `cd contracts && cargo test` | `cargo test` |
| **Frontend** | Unit and component tests for Next.js app (`frontend/`) | `make test-frontend` | `cd frontend && npm test` | `npm test` |
| **SDK** | Client SDK tests (`sdk/`) | `make test-sdk` | `cd sdk && npm test` | `npm test` |
| **Integration Stubs** | Integration test stubs (`tests/`) | `make test-integration` | `cd frontend && npx jest ../tests` | `npx jest tests/` |

### Local Soroban Network (Docker Compose)

A `docker-compose.yml` at the repo root starts the Stellar quickstart image as a
self-contained local Soroban network — no testnet account or rate limits needed:

```bash
docker compose up -d
# Wait until healthy (Horizon responds at http://localhost:8000/)
docker compose ps
```

**Deploy both contracts against the local network:**

```bash
# Fund a local deployer account via the built-in friendbot
stellar keys generate deployer --network local --fund \
  --rpc-url http://localhost:8000/soroban/rpc \
  --network-passphrase "Standalone Network ; February 2017"

# Build
cd contracts && cargo build --target wasm32-unknown-unknown --release && cd ..

# Deploy governance contract
stellar contract deploy \
  --wasm contracts/target/wasm32-unknown-unknown/release/quorum_governance.wasm \
  --source deployer \
  --rpc-url http://localhost:8000/soroban/rpc \
  --network-passphrase "Standalone Network ; February 2017"

# Deploy token contract
stellar contract deploy \
  --wasm contracts/target/wasm32-unknown-unknown/release/quorum_token.wasm \
  --source deployer \
  --rpc-url http://localhost:8000/soroban/rpc \
  --network-passphrase "Standalone Network ; February 2017"
```

When you're done, `docker compose down` stops and removes the container.

### Local Network Lifecycle Test

`sdk/test/e2e/lifecycle.e2e.test.ts` drives a full proposal lifecycle (create,
three votes, finalize, timelock, execute) through the SDK against a real Soroban
standalone network. It is skipped by `npm test`. To run it, start the local
network with `docker compose up -d`, build the contracts, and point the suite at
the network:

```bash
cd contracts && cargo build --target wasm32-unknown-unknown --release && cd ..
cd sdk && \
QUORUM_E2E_RPC_URL=http://localhost:8000/soroban/rpc \
QUORUM_E2E_FRIENDBOT_URL=http://localhost:8000/friendbot \
npm run test:e2e
```

### Demo Proposal Seed Script

`scripts/seed-demo-proposals.mjs` fills a network with demo governance data so
the UI has something to show. It deploys both contracts (or reuses a
deployment you point it at), funds three throwaway accounts and drives four
proposals into one state each:

| Proposal | Outcome | How it gets there |
|---|---|---|
| #1 | **Queued** | Passes quorum and a vote of `for`, then waits out the timelock |
| #2 | **Failed** | Only a vote of `against`, so the quorum is not met |
| #3 | **Executed** | Passes quorum, is finalized, waits out the timelock and executes |
| #4 | **Active** | Created last, so its voting window is still open when the script ends |

**Every run creates fresh data.** New contracts, new accounts, new proposals —
nothing is reused and nothing is cleaned up, so the contract ids, the proposal
ids and the account keys printed at the end differ on every run. The script is
meant for a throwaway test network (the local quickstart network), never for a
production one.

Requirements:

```bash
# 1. The SDK's dependencies — the script uses @stellar/stellar-sdk from sdk/
cd sdk && npm ci && cd ..

# 2. The contract WASM files
cd contracts && cargo build --target wasm32-unknown-unknown --release && cd ..

# 3. A network with a friendbot, plus the Stellar CLI on PATH
docker compose up -d
```

Then:

```bash
node scripts/seed-demo-proposals.mjs
```

The script prints the governance and token contract ids at the end. Point the
frontend at them to try the seeded proposals:

```bash
NEXT_PUBLIC_GOVERNANCE_CONTRACT=<id>
NEXT_PUBLIC_TOKEN_CONTRACT=<id>
```

Point it at an existing deployment instead of deploying new contracts with
`QUORUM_GOVERNANCE_CONTRACT` (the token contract is read from the governance
contract's config, and `QUORUM_TOKEN_ADMIN_SECRET` is needed to fund the demo
voters there):

| Variable | Default | Purpose |
|---|---|---|
| `QUORUM_RPC_URL` | `http://localhost:8000/soroban/rpc` | Soroban RPC endpoint |
| `QUORUM_FRIENDBOT_URL` | `http://localhost:8000/friendbot` | Friendbot used to fund the demo accounts |
| `QUORUM_NETWORK_PASSPHRASE` | `Standalone Network ; February 2017` | Network passphrase |
| `QUORUM_WASM_DIR` | `contracts/target/wasm32-unknown-unknown/release` | Directory holding the built WASM files |
| `QUORUM_GOVERNANCE_CONTRACT` | — | Governance contract to seed instead of deploying one |
| `QUORUM_TOKEN_CONTRACT` | read from the governance config | Token contract to use |
| `QUORUM_TOKEN_ADMIN_SECRET` | — | Secret key of the token admin, needed to fund the demo voters on an existing deployment |
| `QUORUM_DEMO_VOTING_PERIOD` | `30` | Voting period of a freshly deployed contract, in ledgers |
| `QUORUM_DEMO_TIMELOCK_PERIOD` | `2` | Timelock period of a freshly deployed contract, in ledgers |

### Mutation Testing

The contract suites also have a mutation run: `cargo mutants` rewrites guards,
operators and constants in `contracts/*/src/lib.rs` one at a time and reruns the
tests, which is the only way to tell that an assertion would actually catch the
regression it claims to. It is not in per-PR CI (a full run takes ~2 hours);
the latest run, its results and the triage of every surviving mutant are
documented in [docs/mutation-testing.md](docs/mutation-testing.md).

```bash
cargo install cargo-mutants
cd contracts
cargo mutants --workspace --in-place --colors never   # results in mutants.out/
```

### Fuzz Testing

`contracts/fuzz/` holds two `cargo-fuzz` targets, `vote` and `finalize`, that
drive the governance entry points with untrusted input: raw `support` values,
full-range `u32` voting and timelock periods, supplies up to `i128::MAX`,
arbitrary proposal ids and ledger jumps. Besides success and declared contract
errors, the harness treats invoke-level failures as crashes — that is how a
trap emulated from a native panic (overflow, `panic!`, unwrap) surfaces. Two
such traps were found and fixed this way (`end_ledger` in `create_proposal`,
`queue_ledger` in `finalize`). It is not in per-PR CI; run it after touching
tally, quorum, window or timelock arithmetic.

```bash
cargo install cargo-fuzz
cd contracts
cargo +nightly fuzz run vote -- -max_total_time=120       # any nightly; set RUSTUP_TOOLCHAIN if yours is pinned
cargo +nightly fuzz run finalize -- -max_total_time=120
```

Hand-written seed cases live in `contracts/fuzz/corpus/{vote,finalize}/` and
are committed; inputs a run discovers are added to the same directories. Crashes
land in `contracts/fuzz/artifacts/` (gitignored): minimize with
`cargo fuzz tmin <target> <crash-file>` and keep the result as a corpus seed.

### Security Static Analysis

Two security analyzers run in per-PR CI: Semgrep over `frontend/` and `sdk/`
(community TypeScript/React rulesets) and cargo-geiger over `contracts/` plus
a hard gate that forbids `unsafe` in first-party contract code. How to run
them locally, how to triage findings, the inline-suppression convention for
false positives, and the justification policy for new `unsafe` are documented
in [docs/static-analysis.md](docs/static-analysis.md).

### Prerequisites and Toolchains

To run all test suites locally, ensure you have the following toolchains installed:

| Tool | Required Version | Setup Command | Used By |
|---|---|---|---|
| **Rust** | `stable` | `rustup default stable` | Smart contracts |
| **WASM Target** | `wasm32-unknown-unknown` | `rustup target add wasm32-unknown-unknown` | Smart contract compilation |
| **Clippy** | stable | `rustup component add clippy` | Rust linting |
| **cargo-audit** | latest | `cargo install cargo-audit` | Security vulnerability auditing |
| **cargo-geiger** | latest | `cargo install cargo-geiger --locked` | Unsafe-code baseline for `contracts/` |
| **Semgrep** | latest | `pipx install semgrep` | Security scanning of `frontend/` and `sdk/` |
| **Node.js** | ≥ 18 (CI uses 20) | `nvm install 20 && nvm use 20` | Frontend, SDK, integration tests |
| **npm** | ≥ 9 | Bundled with Node.js | Package management |
| **Stellar CLI** | latest | `cargo install stellar-cli --features opt` | Contract CLI invocations |

### 1. Smart Contracts (`contracts/`)

The contract test suite tests proposal lifecycle management, token checkpointing, allowance mechanisms, vote tallying, quorum calculations, and timelock logic using `soroban-sdk::testutils`.

#### Run All Contract Tests
```bash
cd contracts
cargo test
# Or shortcut from repo root:
make test-contracts
```

#### Run Tests for a Specific Contract
```bash
# Governance contract only (proposal creation, voting, execution, timelock)
cd contracts && cargo test -p quorum-governance

# Token contract only (minting, transfers, allowances, checkpoints)
cd contracts && cargo test -p quorum-token
```

#### Run a Single Test by Name
```bash
cd contracts && cargo test test_initialize
```

#### Full CI Verification (Build, Clippy, Test, Audit)
These commands match the CI workflow defined in `.github/workflows/ci.yml`:
```bash
cd contracts
cargo build --target wasm32-unknown-unknown --release
cargo clippy --all-targets --all-features -- -D warnings
cargo test
cargo audit --config audit.toml
cd .. && bash scripts/check-wasm-size.sh   # wasm size regression check

# Or run individual shortcuts from repo root:
make build-contracts
make lint-contracts  # or: make clippy
make test-contracts
make audit-contracts
make check-wasm-size
```

### 2. Frontend (`frontend/`)

The frontend test suite uses Jest and `@testing-library/react` via Next.js's built-in `next/jest` preset to test utility functions, proposal data lookup, and UI components.

#### Run Frontend Tests
```bash
cd frontend
npm test
# Or shortcut from repo root:
make test-frontend
```

#### Run Tests in Watch Mode
```bash
cd frontend
npm test -- --watch
```

#### Full CI Verification (Lint, Test, Build, Audit)
These commands match the CI workflow defined in `.github/workflows/ci.yml`:
```bash
cd frontend
npm ci
npm run lint
npm test
npm run build
npm audit --audit-level=high

# Or run individual shortcuts from repo root:
make lint-frontend
make test-frontend
make build-frontend
make audit-frontend
```

### 3. TypeScript SDK (`sdk/`)

The SDK suite verifies typed client methods, RPC simulation wrappers, and transaction builder helpers.

#### Run SDK Tests
```bash
cd sdk
npm test
# Or shortcut from repo root:
make test-sdk
```

#### Full CI Verification (Build, Test, Audit)
These commands match the CI workflow defined in `.github/workflows/ci.yml`:
```bash
cd sdk
npm ci
npm run build
npm test
npm run lint
npm audit --audit-level=high

# Or run individual shortcuts from repo root:
make build-sdk
make test-sdk
make lint-sdk
make audit-sdk
```

### 4. Integration Test Stubs (`tests/`)

The repository includes integration test stubs in `tests/` covering governance quorum calculations and proposal lookup:

```bash
cd frontend
npx jest ../tests
# Or shortcut from repo root:
make test-integration
```

### Workspace Root Helpers (Makefile & npm scripts)

For convenience, a root `Makefile` (and `justfile`) provides shortcuts that fan out to the exact per-package commands documented above. You can run all checks across the entire repo or target specific packages from the repository root:

```bash
# High-level workflows across all packages
make test        # Run all test suites (contracts, frontend, SDK, integration)
make lint        # Run all linters (contracts clippy, frontend eslint, SDK eslint)
make build       # Build all packages (SDK, frontend, contracts WASM)
make audit       # Run security vulnerability audits across all packages
make check       # Full verification (lint, test, build, audit, wasm size check)
make ci          # Alias for make check

# Per-package test shortcuts
make test-contracts    # cd contracts && cargo test
make test-frontend     # cd frontend && npm test
make test-sdk          # cd sdk && npm test
make test-integration  # cd frontend && npx jest ../tests

# Per-package lint shortcuts
make lint-contracts    # cd contracts && cargo clippy --all-targets --all-features -- -D warnings
make lint-frontend     # cd frontend && npm run lint
make lint-sdk          # cd sdk && npm run lint
make clippy            # Alias for make lint-contracts

# Per-package build shortcuts
make build-contracts   # cd contracts && cargo build --target wasm32-unknown-unknown --release
make build-frontend    # cd frontend && npm run build
make build-sdk         # cd sdk && npm run build

# Per-package audit & check shortcuts
make audit-contracts   # cd contracts && cargo audit --config audit.toml
make audit-frontend    # cd frontend && npm audit --audit-level=high
make audit-sdk         # cd sdk && npm audit --audit-level=high
make check-wasm-size   # bash scripts/check-wasm-size.sh
```

Contributors who prefer [`just`](https://github.com/casey/just) can use the equivalent `just` recipes (`just test`, `just lint`, `just build`, etc.).

The root `package.json` also provides npm scripts to run individual test suites:

```bash
npm run test:contracts   # cd contracts && cargo test
npm run test:frontend    # cd frontend && npm test
npm run test:sdk         # cd sdk && npm test
npm test                 # runs frontend tests (default)
```

---

## Contribution Workflow

1. **Find an issue** — Browse [open issues](https://github.com/StellarQuorum/StellarQuorum/issues) or create one describing your proposed change
2. **Comment on the issue** — Indicate you're working on it to avoid duplicated effort
3. **Create a branch** from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
4. **Make your changes** — follow the layer-specific guidelines below
5. **Run checks** — build, lint, and test before opening a PR
6. **Open a Pull Request** — fill out the PR template completely

### Branch Naming

| Prefix | Use for |
|---|---|
| `feat/` | New features |
| `fix/` | Bug fixes |
| `docs/` | Documentation only |
| `test/` | Test coverage |
| `refactor/` | Code restructuring |
| `style/` | Visual/CSS changes |
| `chore/` | Tooling, CI, dependencies |

---

## Contributing to Contracts

The Soroban contracts in `contracts/` are the heart of Quorum. Changes here require the most care.

### Adding a Contract Function

1. Add the function to `contracts/governance/src/lib.rs` or `contracts/token/src/lib.rs`
2. Follow existing patterns:
   - All state-changing functions must call `require_auth()` on the appropriate address
   - Use `Result<T, ContractError>` return types — never `panic!()`
   - Use `checked_add()`, `checked_sub()` for all arithmetic
   - Emit an event via `env.events().publish()` for every state change
3. Add the function to the contract's `README.md` with parameter docs
4. Write at least 2 unit tests in `src/tests.rs` (happy path + error case)

### Writing Contract Tests

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::{Address, Env};

    #[test]
    fn test_initialize() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        // ... test assertions
    }
}
```

### Building and Verifying

```bash
cd contracts
cargo build --target wasm32-unknown-unknown --release
cargo clippy --all-targets --all-features -- -D warnings
cargo test
cargo audit --config audit.toml
cd .. && bash scripts/check-wasm-size.sh   # wasm size regression check
```

### WASM Size Baseline

Soroban charges rent on the deployed contract bytes, so the size of the two
wasm artifacts is a real cost that must not grow unnoticed. CI builds both
artifacts, records their sizes in the job summary (and as the
`wasm-size-report` artifact), and fails the build if either has grown more
than **10%** over the committed baseline.

Check locally after a release build:

```bash
bash scripts/check-wasm-size.sh   # or: npm run check:wasm-size
```

**Current baseline** (`contracts/wasm-size-baseline.txt`, release profile):

| Artifact | Baseline |
| --- | ---: |
| `quorum_token.wasm` | 20,483 bytes |
| `quorum_governance.wasm` | 28,536 bytes |

The threshold is 10% per artifact (`WASM_SIZE_MAX_GROWTH_PCT` overrides it),
which leaves room for rustc/toolchain drift between your machine and CI while
still catching a dependency bump or new feature that bloats a contract.

If the growth is intentional (e.g. a deliberate feature that adds code), copy
the `Current` sizes the script prints into `contracts/wasm-size-baseline.txt`
and explain the growth in the PR description — reviewers should see the new
cost in the diff.

---

## Contributing to the Frontend

The Next.js frontend is in `frontend/`. It uses TypeScript, Tailwind CSS v4, and Lucide React icons.

### Component Guidelines

- **One component per file** — name the file the same as the component
- **Client components** (`'use client'`) only when you need interactivity (state, effects, event handlers)
- **Server components** by default — data fetching and static content
- **No inline styles** — use Tailwind classes exclusively
- **Accessible by default** — add `aria-label` to icon-only buttons, semantic HTML elements

### Tailwind Conventions

```typescript
// ✅ Good — dark bg with subtle card, blue accent
<div className="p-5 rounded-xl bg-[#0d1520] border border-[#1a2535] hover:border-blue-700 transition-colors">

// ❌ Avoid — inline styles
<div style={{ background: '#0d1520', padding: '20px' }}>
```

### Color Palette

| Purpose | Class |
|---|---|
| Page background | `bg-[#080c10]` |
| Card background | `bg-[#0d1520]` |
| Card border | `border-[#1a2535]` |
| Primary accent | `blue-500` / `blue-600` |
| Success / For | `emerald-500` |
| Danger / Against | `red-500` |
| Muted text | `text-slate-400` |
| Monospace addresses | `font-mono text-xs text-slate-400` |

### Accessibility Requirements

Every PR touching the frontend must:
- [ ] Add `aria-label` to all icon-only buttons
- [ ] Ensure keyboard navigation works (Tab, Enter, Escape)
- [ ] Not break screen reader semantics (use `<button>` not `<div onClick>`)
- [ ] Maintain sufficient color contrast (WCAG AA minimum)

### Running Tests

```bash
cd frontend
npm test                    # Unit tests
npm run lint                # Linter
npm run build               # Verify production build
```

See [Running Tests](#running-tests) for the complete list of test suites and CI-matching commands.

---

## Contributing to the SDK

The TypeScript SDK in `sdk/` provides a typed interface to the Quorum Soroban contracts.

### Implementing a New Client Method

1. Add the method signature and JSDoc to `sdk/src/client.ts`
2. For **read methods**: use `simulateTransaction` and parse the `retval`
3. For **transaction builders**: use `prepareTransaction` and return the XDR string
4. Export new types from `sdk/src/index.ts`
5. Throw `QuorumSDKError` (not generic `Error`) with appropriate error codes

### Method Pattern

```typescript
/**
 * Fetches the current governance configuration.
 *
 * @returns The GovernanceConfig object with quorum, voting period, and token address
 * @throws {QuorumSDKError} with code SIMULATION_FAILED if the RPC call fails
 */
async getConfig(): Promise<GovernanceConfig> {
  const result = await this.simulate('get_config', []);
  return this.parseConfig(result);
}
```

### Type Requirements

- All public method parameters must have explicit TypeScript types
- No `any` — use `unknown` if the type is genuinely unknown
- Return types must be explicitly annotated (no implicit inference for public APIs)

### Breaking Changes

Before 1.0, a MINOR bump may break the API ([versioning policy](docs/publishing.md)).
A PR that changes or removes a public SDK signature must:

1. Add a section to [`sdk/MIGRATIONS.md`](sdk/MIGRATIONS.md) under the version
   that will ship it, with `before` and `after` code and the reason for the change.
2. Add an `Unreleased` entry to [`sdk/CHANGELOG.md`](sdk/CHANGELOG.md) that links
   to that section.
3. Add a codemod under `sdk/scripts/` when the change is mechanical, such as a
   rename or an added or reordered parameter. Follow
   [`codemod-fee-source.mjs`](sdk/scripts/codemod-fee-source.mjs): dry run by
   default, `--write` to apply.

---

## Contributing to Documentation

Good documentation is as important as code. All documentation lives in `docs/` (technical docs) and at the repo root (`README.md`, `CONTRIBUTING.md`).

### Documentation Standards

- Use clear, direct language — avoid jargon without explanation
- Code examples must be complete and runnable
- Every new contract function needs documentation in the contract's `README.md`
- Every new SDK method needs JSDoc with `@param`, `@returns`, `@throws`, and `@example`

### FAQ

Common questions for users and contributors are answered in the [FAQ](docs/faq.md). Before opening an issue or discussion, check if your question is already answered there.

### Markdown Style

- Use `##` for major sections, `###` for subsections
- Use tables for structured data (parameters, error codes, config options)
- Use code blocks with language tags: ` ```typescript `, ` ```rust `, ` ```bash `
- Link to relevant files and external resources

---

## Contributing to Governance and Community

Proposals shape the future of Quorum governance. Before authoring or voting on a proposal, read the [Proposal Style Guide](docs/proposal-style-guide.md) to ensure your proposal includes everything voters need to make an informed decision.

### Writing a Proposal

1. **Start with examples** — read [Example Governance Proposals](docs/proposal-examples.md) to see realistic, fully-worked proposals for each category
2. **Follow the style guide** — use the required sections and tone guidance for your proposal type
3. **Get feedback** — discuss your idea in [GitHub Discussions > Governance Questions](https://github.com/StellarQuorum/StellarQuorum/discussions/categories/governance-questions) before submitting on-chain
4. **Check the acceptance criteria** — make sure your proposal meets all requirements for its category

### Governance Processes

- **Community calls & office hours** — join at [Community Calls](docs/community-calls.md) for live Q&A and governance updates
- **Good first issues** — see [Good First Issue Curation](docs/good-first-issue-curation.md) to understand how we identify beginner-friendly tasks

---

## Drips Wave

Quorum participates in the Stellar Wave on Drips Network. Tagged issues earn
Points during each sprint cycle so contributors can identify which work is
rewarded before they start.

### Points Labels

Maintainers add one `drips:*` points label to each approved issue to show the
expected reward size before work starts:

| Label | Typical scope | Examples |
|---|---|---|
| `drips:1` | Small task | Docs edits, copy fixes, styling tweaks, good first issues |
| `drips:3` | Medium task | New component, focused test coverage, SDK method |
| `drips:5` | Large task | New page, contract function, integration flow |
| `drips:8` | Complex task | Full feature, security-sensitive work, multi-package change |

If an issue grows during implementation, discuss the new scope in the issue
before changing the label. Avoid adding more than one points label to the same
issue. If an issue is missing a points label, ask for sizing before opening a PR.

### Contributor Flow

1. Pick an open issue with a `drips:*` label and confirm it is not already
   assigned or claimed.
2. Comment `/attempt #ISSUE_NUMBER` with a short plan before starting work.
3. Keep the change focused on the issue acceptance criteria.
4. Run the relevant frontend, SDK, or contract checks and include the commands
   in the pull request.
5. Open a pull request with `/claim #ISSUE_NUMBER` and link the issue.

Pull requests without an issue link or claim marker may still be reviewed, but
they may not be tracked correctly by Drips Wave automation.

### Maintainer Setup Checklist

- Apply to the Stellar Wave program at <https://www.drips.network/wave>.
- Label approved issues with exactly one `drips:*` points label.
- Pin a "Drips Wave active" issue during active sprint cycles that lists the
  eligible tasks for that cycle.
- Keep this guide updated if the reward program or sprint cadence changes.

---

## Commit Convention

Quorum uses [Conventional Commits](https://www.conventionalcommits.org/).

### Format

```
<type>(<scope>): <short description>

[optional body]
[optional footer]
```

### Types

| Type | When to Use |
|---|---|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `docs` | Documentation changes only |
| `style` | Formatting, no logic change |
| `refactor` | Code restructuring, no behavior change |
| `test` | Adding or fixing tests |
| `chore` | Build tools, dependencies, CI |
| `perf` | Performance improvement |

### Scopes

Use the package name as scope: `feat(contracts):`, `fix(frontend):`, `docs(sdk):`, `test(contracts):`

### Examples

```
feat(contracts): implement delegate() for voting power delegation
fix(frontend): handle zero total votes in VoteBar component
docs(sdk): add JSDoc to getProposal() method
test(contracts): add unit tests for governance initialize()
chore(ci): add cargo-audit security scanning to CI pipeline
```

---

## Pull Request Process

1. **Title** — follow the commit convention format
2. **Description** — fill out all sections of the PR template
3. **Checklist** — complete all applicable items before requesting review
4. **CI** — all CI checks must pass (build, lint, test, security scan)
5. **Review** — at least one maintainer approval required
6. **Squash merge** — PRs are squash-merged to keep history clean

### PR Template Checklist

- [ ] Changes are scoped to one feature/fix (not multiple unrelated changes)
- [ ] Tests added or updated for the changed code
- [ ] Documentation updated if public API changed
- [ ] No `console.log` or debugging code left in
- [ ] Conventional commit message format used
- [ ] Linked to the relevant GitHub issue

---

## Code of Conduct

Everyone taking part in this project is expected to follow our
[Code of Conduct](CODE_OF_CONDUCT.md), based on the
[Contributor Covenant](https://www.contributor-covenant.org/). It also explains
how to report a problem.

---

## Questions?

- **GitHub Discussions** — for design questions and feature proposals
- **GitHub Issues** — for bugs and specific task tracking

Thank you for helping build decentralized governance for the Stellar ecosystem!
