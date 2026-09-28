# Quorum Governance Contract

Soroban smart contract implementing on-chain governance for the Quorum protocol.

## Functions

- `initialize` — set config, quorum params, token address, guardian, and execution grace period
- `create_proposal` — create a new proposal (requires live token balance >= `proposal_threshold`)
- `vote` — cast For/Against/Abstain vote on active proposal
- `finalize` — evaluate quorum after voting period ends
- `execute` — execute queued proposal after timelock (must be within grace period if configured)
- `cancel` — cancel by proposer or admin
- `pause` — emergency pause proposal creation and execution (admin or guardian)
- `unpause` — restore normal operation (admin only)
- `extend_proposal_ttl` — anyone can pay to extend a proposal's storage lifetime
- `get_voting_power` — view an address's voting power for a given proposal

## Emergency Pause

The contract supports an emergency pause mechanism to halt proposal creation and
execution if a vulnerability is discovered:

- **Who can pause**: Admin or guardian
- **Who can unpause**: Admin only
- **Blocked operations**: `create_proposal()` and `execute()`
- **Unaffected operations**: `vote()`, `finalize()`, reads

This provides a protocol-wide stop distinct from the per-proposal guardian veto.

## Execution Grace Period

Queued proposals have a configurable execution window after the timelock expires:

- Set via `execution_grace_period` parameter in `initialize()`
- Execution must occur within `queue_ledger + execution_grace_period`
- Expired proposals move to `Expired` status and cannot be executed
- Set to `0` to allow indefinite execution (legacy behavior)

This prevents proposals passed under outdated conditions from being executed
arbitrarily far in the future.

## Proposal TTL Extension

Anyone can extend a proposal's storage TTL without modifying it:

- Call `extend_proposal_ttl(proposal_id)` to bump the entry's lifetime
- Useful for keeping long-running proposals alive without voting/reading
- Returns `ProposalNotFound` if the proposal doesn't exist

## Voting Power View

UIs can preview voting power before signing:

- `get_voting_power(proposal_id, voter)` returns the voter's balance at snapshot
- Single round-trip instead of fetching proposal + calling token contract
- Returns `0` for addresses with no snapshot balance
- Returns `ProposalNotFound` for unknown proposals

## Quorum derivation

`quorum_required` is computed once, at proposal creation, by cross-invoking
`total_supply()` on the token contract recorded in `Config::token`:

```
quorum_required = total_supply * quorum_bps / 10000
```

`quorum_bps` is in basis points, so 500 = 5%. Integer division truncates, so
the threshold is never rounded above what the supply supports. The value is
frozen into the proposal, meaning later mints or burns cannot move the bar for
a proposal that is already open.

### Minimum Quorum Floor

To prevent governance capture, the contract enforces a minimum `quorum_bps` of
**1 basis point (0.01%)**. A `quorum_bps` of 0 would mean a single vote carries
a proposal, which is dangerous for production use. While `quorum_bps = 0` is
legitimately useful in tests, the production contract rejects it to prevent
accidental misconfiguration.

**Initialization behavior:**

- `quorum_bps = 0` → rejected with `MinimumQuorumRequired`
- `quorum_bps >= 1 and <= 10000` → accepted
- `quorum_bps > 10000` → rejected with `InvalidQuorumBps`

## Timelock Period

The `timelock_period` parameter defines the delay (in ledgers) between a
proposal passing and becoming executable. This safety window is described in
the README as a 48-hour guard against governance attacks.

### Minimum Timelock Requirement

To preserve the safety window, the contract enforces a minimum `timelock_period`
of **1 ledger**. A `timelock_period` of 0 would allow same-ledger execution
after finalization, removing the safety guard entirely.

**Initialization behavior:**

- `timelock_period = 0` → rejected with `MinimumTimelockRequired`
- `timelock_period >= 1` → accepted

This minimum ensures there is always at least one ledger delay between
finalization and execution, maintaining the intended security model.

## Which balance is read, and when

Two different reads, deliberately:

| Check                                     | Balance read                       | Why                                                                                    |
| ----------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------- |
| `proposal_threshold` in `create_proposal` | **live**, at creation              | Gates who may open a proposal _now_, so spamming the queue costs real stake.           |
| Voting power in `vote`                    | **snapshot**, at `snapshot_ledger` | Fixed when the proposal opened, so tokens bought or borrowed mid-vote carry no weight. |

The snapshot read is backed by per-address balance checkpoints in the token
contract (`get_past_balance`). A voter with no power at the snapshot is
rejected with `NoVotingPower` rather than recording a zero-weight vote.

## Proposal Title and Description Limits

To prevent unbounded storage costs and ensure reasonable UI display, the
contract enforces length limits on proposal titles and descriptions:

| Field       | Maximum Length | Error if Exceeded    |
| ----------- | -------------: | -------------------- |
| Title       |      200 bytes | `TitleTooLong`       |
| Description |   10,000 bytes | `DescriptionTooLong` |

### Empty Title Validation

The contract rejects proposals with empty or whitespace-only titles to prevent
blank rows in UIs:

- Empty string (`""`) → rejected with `EmptyTitle`
- Whitespace-only (e.g., `"   "`) → rejected with `EmptyTitle`
- Valid non-empty title → accepted

These limits are documented here so frontend forms can validate input before
submission, improving UX and preventing wasted transaction fees.

## Resource baseline

The `create_proposal_and_vote_stay_within_resource_budgets` test records
Soroban test-host CPU and memory estimates for one `create_proposal()` and one
`vote()` invocation (Rust test contracts; these are comparative regression
signals, not production-Wasm fee estimates):

| Invocation          | CPU instructions | Memory bytes |
| ------------------- | ---------------: | -----------: |
| `create_proposal()` |          213,907 |       34,894 |
| `vote()`            |          205,390 |       33,177 |

CI assertions allow up to 25% above each baseline (267,384 / 43,618 for
`create_proposal()` and 256,738 / 41,472 for `vote()`). Re-measure and update
both this table and the thresholds when an intentional change materially
alters the contract's resource use.
