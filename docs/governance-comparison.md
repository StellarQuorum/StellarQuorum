# Quorum compared with OpenZeppelin Governor and Governor Bravo

This is a comparison of Quorum's current Soroban governance contract with the
governance patterns most EVM teams already know. OpenZeppelin Governor is a
modular framework; Governor Bravo is Compound's concrete governor/timelock
composition.

| Concern | Quorum | OpenZeppelin Governor | Compound Governor Bravo |
|---|---|---|---|
| Proposal lifecycle | `create_proposal` records a snapshot ledger and opens an `Active` vote. After the voting window, `finalize` moves a successful proposal to `Queued`; `execute` is allowed after the timelock. Failed, cancelled, and expired states are explicit. | `propose` creates a proposal, voting moves through the governor's configured states, and a successful proposal is queued/executed when a timelock extension is used. The exact states depend on the extensions selected. | `propose` creates a proposal after the proposer threshold is met. After the voting period, anyone may queue a successful proposal in the Timelock; after the ETA delay, anyone may execute it. |
| Quorum | A fixed `quorum_bps` is calculated from total supply at proposal creation and frozen into the proposal. For + Against + Abstain must reach it, and For must exceed Against. | Usually a fraction of the token supply at the proposal's snapshot, via `GovernorVotesQuorumFraction`, but the quorum/counting strategy is replaceable. | A configured absolute `quorumVotes` value must be reached, and For must exceed Against. It is not automatically a percentage of the current supply. |
| Voting power source | The token's checkpointed balance at the proposal's snapshot ledger (`get_past_balance`). Later transfers, mints, and burns do not change that vote. | Normally an `ERC20Votes`/`ERC721Votes` checkpoint at the governor clock's snapshot. The token owns delegation and checkpointing. | COMP's checkpointed prior votes, read with `getPriorVotes` at the proposal start block. |
| Timelock | A passed proposal stores `queue_ledger`; execution is blocked until that ledger and can later expire after the configured grace period. A guardian can veto during the safety window. | Optional `TimelockController` or Compound-compatible timelock introduces the delay and controls execution permissions. | A separate Timelock queues the proposal with an ETA and enforces the delay before execution. |
| Delegation | Not implemented in the current Quorum contracts. `Delegate` storage exists only as reserved surface; consumers must not assume delegation works. | Delegation is provided by the voting token (for example `ERC20Votes`), not by the base Governor itself. | Delegation is provided by the COMP token's `delegate`/checkpoint mechanism. |

## Where Quorum intentionally diverges

- **Ledgers instead of blocks.** Soroban has ledger sequence numbers and a
  resource/fee model rather than EVM block numbers and gas. Quorum therefore
  snapshots and schedules by ledger, making the boundary explicit to clients.
- **Quorum is frozen at creation.** Quorum computes the required amount once
  from supply at proposal creation. This prevents a later mint or burn from
  moving the goalpost for an active proposal and makes the stored proposal
  self-describing.
- **A single Soroban governor contract.** Quorum keeps proposal state,
  checkpoint reads, voting, and timelock state in the governance contract's
  compact interface. An EVM deployment often composes a Governor, voting token,
  and separate timelock contract because EVM contract boundaries and calldata
  economics differ.
- **Guardian veto and execution grace.** Quorum adds an explicit
  guardian safety path and an execution expiry window. These are deliberate
  operational safeguards for a Soroban deployment, not assumptions inherited
  from Governor Bravo.
- **No delegation yet.** Quorum does not claim parity with the delegation
  workflows common in EVM governance. Delegation should be added as a separate
  design with its own checkpoint and security tests.

## References

- [OpenZeppelin Governor documentation](https://docs.openzeppelin.com/contracts/5.x/governance)
- [OpenZeppelin Stellar Governor documentation](https://docs.openzeppelin.com/stellar-contracts/governance/governor)
- [Compound governance documentation](https://docs.compound.finance/v2/governance/)
- [Quorum governance contract README](../contracts/governance/README.md)

