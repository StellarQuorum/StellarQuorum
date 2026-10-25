# Quorum

[![CI](https://github.com/StellarQuorum/StellarQuorum/actions/workflows/ci.yml/badge.svg)](https://github.com/StellarQuorum/StellarQuorum/actions/workflows/ci.yml)
[![contracts coverage](https://codecov.io/gh/StellarQuorum/StellarQuorum/branch/main/graph/badge.svg?flag=contracts)](https://codecov.io/gh/StellarQuorum/StellarQuorum)

Stellar Quorum is an open-source governance infrastructure layer for the Stellar and Soroban ecosystem. It provides the core primitives for decentralized, token-weighted decision-making: proposal creation, on-chain voting, delegation, timelock execution, and transparent result reporting.

As Stellar moves from a foundation-driven upgrade model to community-driven governance, the ecosystem needs reliable, auditable governance tooling that DeFi protocols, DAOs and community organizations can adopt without building from scratch.

---

## Governance Model

### Proposal Lifecycle

| State | Description |
|---|---|
| Pending | Created, voting not yet started (reported by `get_proposal_phase`; the stored status stays `Active`) |
| Active | Voting window is open |
| Failed | Quorum not reached or majority Against |
| Queued | Passed, waiting in 48-hour timelock |
| Executed | Timelock expired, on-chain actions executed |
| Cancelled | Cancelled by proposer before voting ends |

### Quorum

The quorum threshold is the minimum total voting power (For + Against + Abstain) required for a proposal to be eligible for execution. Without quorum, a proposal fails regardless of vote distribution. Default: 5% of circulating QUORUM supply.

### Voting Power

Voting power is derived from QUORUM token balance at the snapshot ledger taken at proposal creation. This prevents flash-loan manipulation of governance votes.

A voter's weight is therefore their balance *at the snapshot*, not their current balance, so the two disagree for anyone who bought or sold after the proposal opened. The proposal page reads the balance at the snapshot for the connected wallet and shows it above the vote buttons, before anything is signed — including the case where it is zero, which the contract rejects with `NoVotingPower`. See `frontend/components/VotingPowerPreview.tsx`.

### Timelock

All passed proposals enter a 48-hour timelock before execution. A guardian multisig can veto during this window as a safety net against governance attacks.

## QUORUM Token

QUORUM is the governance token of the Quorum protocol. Holding QUORUM gives
you voting power over protocol upgrades, parameter changes, and treasury
allocations.

| Parameter                    | Value                     |
| ---------------------------- | ------------------------- |
| Maximum total supply         | 1,000,000,000 QUORUM      |
| Initial circulating supply   | ~100,000,000 QUORUM (10%) |
| Decimals                     | 7                         |

**Distribution summary**:

| Category                     | Allocation |
| ---------------------------- | ---------: |
| Community treasury (DAO)     |        30% |
| Core team (1y cliff, 3y vest)|        20% |
| Drips Wave contributors      |        15% |
| Ecosystem fund (grants)      |        15% |
| Liquidity and market making  |        10% |
| Early adopter airdrop        |        10% |

See [docs/tokenomics.md](docs/tokenomics.md) for full vesting schedules and
rationale.

## Roadmap

- [x] Freighter wallet connection — connect, connected address, and the snapshot voting-power preview
- [ ] Sign and submit votes on Stellar testnet through Freighter — tracking: [Issue #](https://github.com/StellarQuorum/StellarQuorum/issues)
- [ ] Soroban governance contract testnet deployment — tracking: [Issue #](https://github.com/StellarQuorum/StellarQuorum/issues)
- [ ] Token delegation UI — delegate voting power without transferring tokens — tracking: [Issue #](https://github.com/StellarQuorum/StellarQuorum/issues)
- [ ] Timelock execution engine — automated execution after 48h delay — tracking: [Issue #](https://github.com/StellarQuorum/StellarQuorum/issues)
- [ ] Multi-sig proposal creation — tracking: [Issue #](https://github.com/StellarQuorum/StellarQuorum/issues)
- [ ] Governor contract security audit — scope: [Audit Scope](docs/audit-scope.md), tracking: [Issue #330](https://github.com/StellarQuorum/StellarQuorum/issues/330)
- [ ] QUORUM token distribution and staking — tracking: [Issue #](https://github.com/StellarQuorum/StellarQuorum/issues)
- [ ] Off-chain signaling (Snapshot-style) before on-chain execution — tracking: [Issue #](https://github.com/StellarQuorum/StellarQuorum/issues)
- [ ] Governance analytics dashboard — tracking: [Issue #](https://github.com/StellarQuorum/StellarQuorum/issues)

See [Roadmap Board](docs/roadmap-board.md) for the public GitHub Projects board tracking these items.

---

## Drips Wave

Quorum participates in the **Stellar Wave** on [Drips Network](https://www.drips.network/wave).

Rewarded issues use `drips:*` labels to show the expected points value:

| Label | Scope |
|---|---|
| `drips:1` | Small tasks such as docs, styling, and good first issues |
| `drips:3` | Medium tasks such as new components or focused test coverage |
| `drips:5` | Large tasks such as new pages or contract functions |
| `drips:8` | Complex tasks such as full features or security-sensitive work |

See [CONTRIBUTING.md](CONTRIBUTING.md#drips-wave) for the contributor
claim flow and maintainer setup checklist.

**Good first issues:**
- Build the Freighter wallet connection component
- Write the Soroban governance contract `cancel()` function
- Add proposal search and sorting to the proposals list
- Implement delegation UI
- Write unit tests for the proposal data layer

---

## Contributing

1. Fork the repo and create a feature branch
2. Make your changes with clear commit messages
3. Open a PR referencing the issue

New contributors should start with the [Contributor Checklist](CONTRIBUTOR_CHECKLIST.md) for a quick-start guide.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide, the
[Code of Conduct](CODE_OF_CONDUCT.md), and the [CHANGELOG](CHANGELOG.md).

### Governance & Community

- **Writing a proposal?** Start with the [Proposal Style Guide](docs/proposal-style-guide.md)
- **See examples first?** Check [Example Governance Proposals](docs/proposal-examples.md) for each category
- **Community calls & office hours?** Details at [Community Calls](docs/community-calls.md)
- **Good first issues?** See the [Curation Process](docs/good-first-issue-curation.md)
- **Adopting Quorum for your protocol?** Follow the [Governance Adoption Playbook](docs/governance-playbook.md), then build the integration with the [Adoption Tutorial](docs/tutorial.md)
- **Walkthrough of testnet voting?** See the [Testnet Walkthrough](docs/testnet-walkthrough.md) with video transcript
- **Governance forum?** Join discussions at [GitHub Discussions](https://github.com/StellarQuorum/StellarQuorum/discussions) — see [Governance Forum docs](docs/governance-forum.md)
- **Using Quorum?** List your protocol on [ADOPTERS.md](ADOPTERS.md)

### Documentation

- **FAQ:** Common questions for users and contributors in the [FAQ](docs/faq.md)
- **Governance parameters:** Choose your governance parameters with the [Parameter Guide](docs/governance-parameters.md)
- **Security model:** Threat assumptions and mitigations in the [Security Model](docs/security-model.md)
- **Audit scope:** What a third-party audit of the contracts covers in the [Audit Scope](docs/audit-scope.md)
- **Architecture:** Contract architecture and data flow in the [Architecture doc](docs/architecture.md)
- **Deployment:** Deploy contracts to testnet/mainnet with the [Deployment Guide](docs/deployment.md)
- **Delegate incentives:** Design thinking for delegate reward programs in the [Delegate Incentive Program](docs/delegate-incentive-program.md)
- **Governance comparisons:** Quorum, OpenZeppelin Governor, and Governor Bravo in the [Governance Comparison](docs/governance-comparison.md)
- **Paired feature test plans:** Conviction voting, proposal templates, and notification center in the [Feature Test Plans](docs/feature-test-plans.md)

---

## License

MIT — free to use, modify, and distribute.

---

## SDK Reference

### Install

```bash
npm install @quorum/sdk
# Optional — only if you use the Freighter signing helper
npm install @stellar/freighter-api
```

The package ships ESM and CJS builds, so both styles work:

```typescript
import { QuorumClient } from '@quorum/sdk';        // ESM / bundlers
const { QuorumClient } = require('@quorum/sdk');   // CommonJS
```

### `QuorumClient`

```typescript
import { QuorumClient, TESTNET } from '@quorum/sdk';

const client = new QuorumClient({ ...TESTNET, governanceContractId: 'CC...', tokenContractId: 'CC...' });

// Read proposals
await client.getProposal(1n);           // Get proposal by ID
await client.getAllProposals();          // Get all proposals
await client.getProposalCount();        // Total proposal count
await client.getConfig();               // Protocol config (quorum, voting period, etc.)
await client.hasVoted(1n, 'G...');      // Check if address voted
await client.getVote(1n, 'G...');       // How they voted: 0=Against, 1=For, 2=Abstain, null=not voted

await client.getLatestLedger();
// Current ledger sequence, for converting proposal ledgers to dates
// Build transactions (returns unsigned XDR for Freighter signing)
await client.buildCreateProposal(address, title, description);
await client.buildVote(voter, proposalId, support); // support: 0=Against, 1=For, 2=Abstain
await client.buildFinalize(proposalId);
await client.buildExecute(proposalId);
```

### Signing with Freighter

`build*` returns unsigned XDR. The helper behind the optional
`@quorum/sdk/freighter` entry point detects the extension, requests access and
signs in one call — the package root never loads it, so Node consumers are
unaffected:

```typescript
import { signWithFreighter, FreighterError, FreighterErrorCode } from '@quorum/sdk/freighter';

try {
  const xdr = await client.buildVote(voter, proposalId, 1);
  const { signedXdr, signerAddress } = await signWithFreighter(xdr, {
    networkPassphrase: TESTNET.networkPassphrase!,
  });
  // submit signedXdr with your RPC of choice
} catch (e) {
  if (e instanceof FreighterError && e.code === FreighterErrorCode.Locked) {
    // prompt the user to unlock the wallet
  }
}
```

Failures are always a `FreighterError` with a `code`: `NOT_INSTALLED`,
`LOCKED`, `ACCESS_DENIED`, `SIGNING_REJECTED` or `WALLET_ERROR`.
`isFreighterAvailable()` and `getFreighterAddress()` cover connect flows.

### Decoding contract events

Every event the governance and token contracts emit has a TypeScript type and
a decoder, so consumers (for example real-time vote counts) never touch raw
XDR:

```typescript
import { decodeEvent, decodeEvents } from '@quorum/sdk';

const events = await server.getEvents({ filters: [{ type: 'contract' }] });
for (const raw of decodeEvents(events.events)) {
  switch (raw.type) {
    case 'vote_cast':            // proposalId, voter, support, votingPower
    case 'proposal_finalized':   // id, status, forVotes, againstVotes, abstainVotes
    case 'transfer':             // from, to, amount
  }
}
```

Known topics: `proposal_created`, `vote_cast`, `proposal_finalized`,
`proposal_queued`, `proposal_executed`, `proposal_cancelled`, `transfer`,
`mint`, `burn`, `approve`, `admin_transferred`. Unknown topics decode to
`null` and are skipped rather than throwing.

### Contract errors

Contract failures surface as `Error(Contract, #N)`. `GovernanceError` and `TokenError` mirror the Rust `#[contracterror]` enums with the same codes:

```typescript
import { parseGovernanceError, GovernanceError } from '@quorum/sdk';

try { /* ... */ } catch (e) {
  if (parseGovernanceError(e) === GovernanceError.QuorumNotReached) { /* ... */ }
}
```

### Client spec

`sdk/spec/quorum-client.spec.json` describes every public `QuorumClient` method (parameters, types, return types) and the `GovernanceError` and `TokenError` codes, for bindings and docs in other languages. It is generated from `sdk/src` by `npm run spec` in `sdk/`. CI runs `npm run spec:check` and fails if the file has drifted from the source.

The generated [SDK API reference](sdk/docs/api-reference.md) lists the public
exports and their source files. Run `npm run docs` in `sdk/` to regenerate it;
CI checks that it stays current.

### Releases

`@quorum/sdk` releases are tagged `sdk-vX.Y.Z` and published to npm by CI with
provenance. Pre-1.0 the package follows `0.MINOR.PATCH`: PATCH for fixes,
MINOR for features *and* breaking changes until 1.0. See
[docs/publishing.md](docs/publishing.md) for the scope/credential setup, the
full versioning policy and the release checklist.

## Frontend data source

The frontend reads proposals from the governance contract through `QuorumClient`. Configure it with environment variables (e.g. in `frontend/.env.local`; `frontend/.env.example` documents every one of them):

| Variable | Default | |
|---|---|---|
| `NEXT_PUBLIC_GOVERNANCE_CONTRACT_ID` | — | Governance contract to read. Must be a valid contract ID. |
| `NEXT_PUBLIC_STELLAR_RPC_URL` | testnet RPC | Soroban RPC endpoint. |
| `NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE` | testnet | Network passphrase. |
| `NEXT_PUBLIC_TOKEN_CONTRACT_ID` | governance config | Token contract to read balances from. Optional: the client falls back to the token address in `get_config()`. |
| `NEXT_PUBLIC_USE_FIXTURE` | — | `1` to serve the bundled mock proposals instead; `0` to require a contract ID and fail fast without one. |
| `NEXT_PUBLIC_SITE_URL` | `https://quorum.stellar.org` | Absolute origin of the deployment, used by `robots.txt` and the sitemap. |

The environment is validated once at startup by `frontend/lib/env.ts`: contract IDs are checked as strkeys (version byte and CRC-16 included, so a transposed character is caught), URLs are checked as absolute, and every problem is reported at once with the variable that needs fixing. With no contract ID set the frontend falls back to the mock fixture in `frontend/lib/proposals.ts`, so `npm run dev` works offline without a deployment; set `NEXT_PUBLIC_USE_FIXTURE=0` in a deployment to turn that fallback into a startup failure. Voting power uses a matching fixture in `frontend/lib/voting-power.ts`, keyed by address suffix — an address ending `3XZK` holds 2,500 QUORUM at the snapshot and 4,000 now, one ending `7MKL` holds 150,000 at both, and any other address held nothing at the snapshot. The frontend depends on the local SDK, so build it first: `npm run build:sdk`.
