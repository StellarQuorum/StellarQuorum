# Contributing to Quorum

Thank you for your interest in contributing to Quorum — on-chain governance infrastructure for the Stellar ecosystem. This guide covers everything you need to get started contributing to any part of the project.

---

## Table of Contents

- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Contribution Workflow](#contribution-workflow)
- [Contributing to Contracts](#contributing-to-contracts)
- [Contributing to the Frontend](#contributing-to-the-frontend)
- [Contributing to the SDK](#contributing-to-the-sdk)
- [Contributing to Documentation](#contributing-to-documentation)
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
cargo test
cargo clippy -- -D warnings
```

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
npm run test:coverage       # With coverage report
npx playwright test         # E2E tests (requires dev server running)
```

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

---

## Contributing to Documentation

Good documentation is as important as code. All documentation lives in `docs/` (technical docs) and at the repo root (`README.md`, `CONTRIBUTING.md`).

### Documentation Standards

- Use clear, direct language — avoid jargon without explanation
- Code examples must be complete and runnable
- Every new contract function needs documentation in the contract's `README.md`
- Every new SDK method needs JSDoc with `@param`, `@returns`, `@throws`, and `@example`

### Markdown Style

- Use `##` for major sections, `###` for subsections
- Use tables for structured data (parameters, error codes, config options)
- Use code blocks with language tags: ` ```typescript `, ` ```rust `, ` ```bash `
- Link to relevant files and external resources

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

Quorum is committed to a welcoming, inclusive community.

- Be respectful and constructive in all interactions
- Assume good intent from other contributors
- Focus critique on code and ideas, never on people
- Report harassment or violations to the maintainers

We follow the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/).

---

## Questions?

- **GitHub Discussions** — for design questions and feature proposals
- **GitHub Issues** — for bugs and specific task tracking

Thank you for helping build decentralized governance for the Stellar ecosystem!
