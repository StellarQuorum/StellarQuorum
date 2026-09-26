# Quorum Architecture

## Overview

Quorum is a monorepo containing four main packages:

1. **frontend/** — Next.js governance explorer and voting UI
2. **contracts/** — Soroban smart contracts: `governance` (`quorum-governance`)
   and the QUORUM `token` (`quorum-token`)
3. **sdk/** — TypeScript client SDK for dApp integration
4. **scripts/** — Deployment and operational tooling

This document describes the contracts as implemented in
`contracts/governance/src/lib.rs` and `contracts/token/src/lib.rs`. For
parameter tuning see [governance-parameters.md](governance-parameters.md); for
threats and mitigations see [security-model.md](security-model.md).

## Data Flow

```
Voter (Freighter Wallet)
        │  signs XDR transaction
        ▼
QuorumClient (sdk/)
        │  submits to Stellar RPC
        ▼
GovernanceContract ──── cross-contract calls ────► QuorumToken
  (proposals, votes,     total_supply()             (balances, checkpoints,
   quorum, timelock)     balance()                   allowances, supply)
        │                get_past_balance()
        ▼
   Contract events ──► Stellar ledger ──► indexers / clients
```

The governance contract holds the address of the token in `Config.token` and
calls it through a generated `TokenClient`. The token never calls governance.

## Contract Interaction Pattern

All state-changing operations follow this pattern:
1. Client builds an unsigned transaction (XDR) via `QuorumClient.build*()`
2. User signs with Freighter wallet
3. Client submits signed XDR to the Soroban RPC node
4. Contract validates authorization via `require_auth()`
5. State is updated and an event is emitted

## Cross-contract calls made by governance

Governance depends on three token functions (the `TokenInterface` trait in
`contracts/governance/src/lib.rs`):

| Governance function | Token call | Purpose |
|---|---|---|
| `create_proposal` | `balance(proposer)` | Live balance must be at least `Config.proposal_threshold`, otherwise `BelowProposalThreshold`. Deliberately live, since the threshold is about who may open a proposal now. |
| `create_proposal` | `total_supply()` | Derives `quorum_required = total_supply * quorum_bps / 10000` (checked multiply, integer division), frozen into the proposal at creation. Mints or burns during voting do not move the bar. |
| `vote` | `get_past_balance(voter, proposal.snapshot_ledger)` | The voter's weight. A result of 0 or less is rejected with `NoVotingPower`. |

`finalize`, `execute`, `cancel` and the view functions make no token calls.

## Proposal lifecycle

`create_proposal` records `snapshot_ledger` as the current ledger sequence,
`start_ledger = snapshot_ledger + 1` and
`end_ledger = start_ledger + voting_period`, and stores the proposal as
`Active`.

- **vote** — allowed while `ledger <= end_ledger` and the status is `Active`.
  `support` is `0` Against, `1` For or `2` Abstain; anything else is
  `InvalidVoteChoice`. One vote per address per proposal (`AlreadyVoted`).
- **finalize** — callable by anyone once `ledger > end_ledger`. The proposal
  moves to `Queued` (with `queue_ledger = ledger + timelock_period`) when total
  votes (for + against + abstain) reach `quorum_required` and `for_votes >
  against_votes`; otherwise it becomes `Failed`.
- **execute** — requires `Queued` and `ledger >= queue_ledger`
  (`TimelockNotExpired` before that). It marks the proposal `Executed`; the
  dispatch of on-chain actions is still a `TODO` in the contract.
- **cancel** — the proposer or the admin may cancel (`Unauthorized` for anyone
  else).

`ProposalStatus` also defines `Pending` and `Passed`; the contract does not
currently assign either.

## Balance checkpoints and snapshot voting power

Voting power is the balance an address held at the proposal's
`snapshot_ledger`, not its live balance. Tokens acquired after a proposal opens
carry no weight, which blocks flash-loan and buy-the-vote attacks.

The token implements this with per-address checkpoints:

- `Checkpoint { ledger, balance }` entries are stored in a `Vec` under
  `DataKey::Checkpoints(owner)`, ordered by ledger.
- `set_balance()` is the single write path for balances. `initialize`,
  `transfer`, `transfer_from`, `mint` and `burn` all go through it, so every
  balance change writes a checkpoint.
- Several changes in one ledger collapse into one entry holding that ledger's
  closing balance, so each ledger appears at most once.
- `get_past_balance(owner, ledger)` binary-searches for the last checkpoint at
  or before `ledger` and returns its balance, or `0` if the address held nothing
  that far back.

Delegation (`delegate()`) and `get_past_votes()` are not implemented; both
contracts carry `TODO`s for them, and `DataKey::Delegate` in the governance
contract is reserved but unused.

## Allowances and expiry (token)

`approve(owner, spender, amount, expiration_ledger)` stores an
`AllowanceValue { amount, expiration_ledger }` under
`DataKey::Allowance(owner, spender)`, as SEP-41 requires.

- A live approval (`amount > 0`) whose `expiration_ledger` is before the current
  ledger is rejected with `InvalidExpiration`. `amount == 0` revokes and accepts
  any expiration. A negative amount is `InvalidAmount`.
- An allowance is usable through `expiration_ledger` inclusive. Afterwards
  `allowance()` returns `0` and `transfer_from` fails with
  `InsufficientAllowance`; an expired allowance never errors on read.
- `transfer_from(spender, from, to, amount)` requires the spender's auth, moves
  the balance first (so a failed spend cannot consume allowance), then debits
  the allowance while keeping its original expiry.

## Event model

Both contracts publish a typed event for every state change. Each event has a
topic tuple (a symbol first, then identifiers) and a struct payload.

### Governance

| Topics | Payload | Emitted by |
|---|---|---|
| `("proposal_created", id)` | `ProposalCreated { id, proposer, title, start_ledger, end_ledger, quorum_required }` | `create_proposal` |
| `("vote_cast", proposal_id, voter)` | `VoteCast { proposal_id, voter, support, voting_power }` | `vote` (power is the snapshot weight actually counted) |
| `("proposal_finalized", id)` | `ProposalFinalized { id, status, for_votes, against_votes, abstain_votes }` | `finalize` |
| `("proposal_queued", id)` | `ProposalQueued { id, queue_ledger }` | `finalize`, only when the proposal passes, after `proposal_finalized` |
| `("proposal_executed", id)` | `ProposalExecuted { id }` | `execute` |
| `("proposal_cancelled", id)` | `ProposalCancelled { id, caller }` | `cancel` |

### Token

| Topics | Payload | Emitted by |
|---|---|---|
| `("mint", to)` | `Mint { to, amount, total_supply }` | `mint`, and `initialize` for the genesis allocation |
| `("burn", from)` | `Burn { from, amount, total_supply }` | `burn` |
| `("transfer", from, to)` | `Transfer { from, to, amount }` | `transfer` and `transfer_from` (same event for both) |
| `("approve", owner, spender)` | `Approve { owner, spender, amount, expiration_ledger }` | `approve` |
| `("admin_transferred", previous_admin)` | `AdminTransferred { previous_admin, new_admin }` | `transfer_admin` |

`total_supply` in `Mint` and `Burn` is the value after the operation, so supply
can be reconstructed from events alone.

## Storage layout and TTL management

Soroban entries expire unless their TTL is extended.

### Governance

| Storage | Keys | Contents |
|---|---|---|
| Instance | `Config`, `ProposalCount` | Token address, `quorum_bps`, `voting_period`, `timelock_period`, `proposal_threshold`, admin; proposal counter |
| Persistent | `Proposal(id)` | The `Proposal` struct |
| Persistent | `HasVoted(id, voter)` | The voter's recorded `support` value |

Constants: `TTL_THRESHOLD` is 30 days and `TTL_EXTEND_TO` is 90 days, at 17,280
ledgers per day (about 5 seconds per ledger). When an entry's remaining life
falls below 30 days, it is extended back to 90 days. The 30-day threshold is
deliberately above the longest voting period the create form offers, so a
proposal cannot expire mid-vote.

Extensions happen on `create_proposal` (proposal and instance), `vote`
(proposal, that vote and instance), `finalize`, `execute` and `cancel`
(proposal), and on `get_proposal`, so a watched proposal stays alive even with
no voting activity.

### Token

| Storage | Keys | Contents |
|---|---|---|
| Instance | `Admin`, `Name`, `Symbol`, `Decimals`, `TotalSupply` | Token metadata, admin and supply |
| Persistent | `Balance(owner)` | Live balance |
| Persistent | `Allowance(owner, spender)` | `AllowanceValue` |
| Persistent | `Checkpoints(owner)` | `Vec<Checkpoint>` |

The token contract does not currently extend TTLs of its own entries, so
long-lived balances and checkpoints depend on being bumped externally (for
example by the network or an operator).

## Errors

Both contracts return typed errors (`#[contracterror]`) rather than panicking.
`GovernanceError` codes 1-14 and `TokenError` codes 1-7 are defined in the
respective `lib.rs`.
