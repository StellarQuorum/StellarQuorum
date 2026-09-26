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
| Pending | Created, voting not yet started |
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

## Roadmap

- [x] Freighter wallet connection — connect, connected address, and the snapshot voting-power preview
- [ ] Sign and submit votes on Stellar testnet through Freighter
- [ ] Soroban governance contract testnet deployment
- [ ] Token delegation UI — delegate voting power without transferring tokens
- [ ] Timelock execution engine — automated execution after 48h delay
- [ ] Multi-sig proposal creation
- [ ] Governor contract security audit
- [ ] QUORUM token distribution and staking
- [ ] Off-chain signaling (Snapshot-style) before on-chain execution
- [ ] Governance analytics dashboard

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

See [docs/contributing.md](docs/contributing.md#drips-wave) for the contributor
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

---

## License

MIT — free to use, modify, and distribute.

---

## SDK Reference

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

### Contract errors

Contract failures surface as `Error(Contract, #N)`. `GovernanceError` and `TokenError` mirror the Rust `#[contracterror]` enums with the same codes:

```typescript
import { parseGovernanceError, GovernanceError } from '@quorum/sdk';

try { /* ... */ } catch (e) {
  if (parseGovernanceError(e) === GovernanceError.QuorumNotReached) { /* ... */ }
}
```

## Frontend data source

The frontend reads proposals from the governance contract through `QuorumClient`. Configure it with environment variables (e.g. in `frontend/.env.local`):

| Variable | Default | |
|---|---|---|
| `NEXT_PUBLIC_GOVERNANCE_CONTRACT_ID` | — | Governance contract to read. |
| `NEXT_PUBLIC_STELLAR_RPC_URL` | testnet RPC | Soroban RPC endpoint. |
| `NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE` | testnet | Network passphrase. |
| `NEXT_PUBLIC_TOKEN_CONTRACT_ID` | governance config | Token contract to read balances from. Optional: the client falls back to the token address in `get_config()`. |
| `NEXT_PUBLIC_USE_FIXTURE` | — | Set to `1` to serve the bundled mock proposals instead. |

The mock fixture in `frontend/lib/proposals.ts` is also used whenever no contract ID is set, so `npm run dev` works offline without a deployment. Voting power uses a matching fixture in `frontend/lib/voting-power.ts`, keyed by address suffix — an address ending `3XZK` holds 2,500 QUORUM at the snapshot and 4,000 now, one ending `7MKL` holds 150,000 at both, and any other address held nothing at the snapshot. The frontend depends on the local SDK, so build it first: `npm run build:sdk`.
