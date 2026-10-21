# Quorum Governance Contract

Soroban smart contract implementing on-chain governance for the Quorum protocol.

## Functions

- `initialize` — set config, quorum params, token address, guardian, and execution grace period
- `create_proposal` — create a new proposal (requires live token balance >= `proposal_threshold`)
- `create_proposal_with_kind` — as `create_proposal`, choosing `Signaling` (never executed) or `Executable`
- `vote` — cast For/Against/Abstain vote on active proposal
- `finalize` — evaluate quorum after voting period ends
- `execute` — execute queued proposal after timelock (must be within grace period if configured)
- `cancel` — cancel by proposer or admin while voting is open (`ProposalNotCancellable` otherwise)
- `pause` — emergency pause proposal creation and execution (admin or guardian)
- `unpause` — restore normal operation (admin only)
- `extend_proposal_ttl` — anyone can pay to extend a proposal's storage lifetime
- `get_voting_power` — view an address's voting power for a given proposal
- `create_cosponsored_proposal` — open a proposal that several addresses fund together; their combined live balance must meet `proposal_threshold`
- `create_conviction_proposal` — open a proposal decided on time-decayed support (see Conviction Voting)
- `set_proposal_deposit` — set the deposit a proposer locks when opening a proposal (admin only; `0` disables it)
- `set_proposer_cooldown` — set how many ledgers a proposer waits between proposals (admin only; `0` disables it)
- `set_proposal_action` — attach the call a proposal makes on execution (proposer only, while voting is open)
- `allow_target` / `disallow_target` — manage the contracts a proposal action may call (admin only)
- `is_target_allowed` / `get_cosponsors` / `get_conviction` — reads for the features above

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

- `get_voting_power(proposal_id, voter)` returns effective delegated weight at snapshot
- Single round-trip instead of fetching proposal + calling token contract
- Returns `0` for addresses with no voting power at that snapshot
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

The snapshot read is backed by per-address voting-power checkpoints in the token
contract (`get_past_votes`), including delegated weight. A voter with no power at the snapshot is
rejected with `NoVotingPower` rather than recording a zero-weight vote.

Voting begins at `start_ledger`, one ledger after the snapshot. Rejecting votes
before then prevents voting and re-delegating the same weight while the snapshot
ledger is still open. Delegations changed after that ledger affect subsequent
proposals, while existing proposals retain the recorded weight.

### Delegation

`delegate(delegator, delegatee)` requires the holder's authorization and forwards
the assignment to the configured token. `undelegate(delegator)` and self-delegation
restore the holder's own voting power. A holder can select one representative;
their tokens stay in their account. A representative's incoming weight is not
forwarded when they delegate their own balance.

`get_delegate(account)` reads the token's current representative, and
`get_past_votes(account, ledger)` reads its historical effective weight. The token
is authoritative even when a holder calls it directly; governance's compatibility
mapping records facade calls and is never used to calculate snapshot power.
Each change through governance emits a `Delegated` payload on the `delegated`
topic with the holder and actual representative.

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

## Proposal Deposit

`set_proposal_deposit` sets an amount that a proposer must lock when they open a
proposal. The governance contract holds the deposit until the proposal closes:

| Outcome                                           | Deposit                  |
| ------------------------------------------------- | ------------------------ |
| Passes (`finalize` → `Queued`)                    | Returned to the proposer |
| Fails (`finalize` → `Failed`)                     | Burned                   |
| Cancelled while the deposit is still held         | Burned                   |

- The deposit is separate from `proposal_threshold`. The threshold is checked
  against live balances; the deposit is paid from the proposer's balance, which
  must cover it, or creation fails with `InsufficientDeposit`.
- Each proposal keeps the deposit it was opened with, so changing the setting
  does not affect proposals already open.
- The deposit leaves the proposer's wallet while the proposal is open. Their
  snapshot balance, and so their voting power on that proposal, is reduced by it.
- The default is `0`, so nothing changes until the admin sets a deposit.

## Proposer Cooldown

`set_proposer_cooldown` sets how many ledgers a proposer must wait after opening
a proposal before they can open another. It stops one holder from flooding the
Active list with back-to-back proposals.

- The cooldown is recorded per proposer, from the ledger of their latest proposal.
  A new proposal is accepted once `current_ledger >= last_ledger + cooldown`.
- Another proposer is not held back by it.
- A rejected attempt fails with `ProposerOnCooldown` and creates nothing.
- The default is `0`, so nothing changes until the admin sets a cooldown. The
  value is stored as `Config::proposer_cooldown`, which `get_config` returns.

## Cancellation

`cancel` is allowed only while voting is open. The proposer or the admin can
cancel an `Active` proposal whose `end_ledger` has not passed. Any other proposal
fails with `ProposalNotCancellable`: one that is already queued, executed,
failed, expired, vetoed or cancelled, and one whose voting window has closed but
which has not been finalized yet.

## Co-sponsored Proposals

`create_cosponsored_proposal` takes a list of co-sponsor addresses. Every
co-sponsor authorizes the same transaction as the proposer. The threshold is
checked against the sum of the live balances of the proposer and all
co-sponsors, using the same rule as `create_proposal`.

- Co-sponsors gain no votes. Each voter's weight is still their snapshot balance.
- At most 10 co-sponsors; no duplicates; the proposer may not be listed.
  Violations fail with `InvalidCosponsors`.
- The proposer pays any deposit alone.
- The co-sponsors are stored with the proposal and returned by `get_cosponsors`.
  They are not part of the `proposal_created` event.

The authorization model is described in
[docs/architecture.md](../../docs/architecture.md#co-sponsored-proposals).

## Conviction Voting

`create_conviction_proposal` opens a proposal whose result depends on
time-decayed support. Recent support counts more than support that has been
sitting for a long time, which suits continuous funding decisions.

- Each accepted For or Against vote adds the voter's snapshot power to that
  side's conviction tally. Abstentions add nothing to the tally.
- Support decays by half for each whole `CONVICTION_HALF_LIFE`, which is 3 days
  (51,840 ledgers). Decay is stepwise: the tally is halved once for each whole
  half-life since it was last written. A vote cast 7 days before the close
  therefore counts for a quarter of its power.
- At the close, the proposal passes if the decayed For tally is strictly greater
  than the decayed Against tally, and quorum is met. Quorum still uses the raw
  totals.
- Both tallies are decayed to the close of voting (`end_ledger`), so the result
  does not depend on when `finalize()` is called.
- `get_conviction` returns the tally decayed to the current ledger, or `None` for
  a standard proposal.
- The voting window, quorum, timelock and execution rules are unchanged. Conviction
  changes how votes are weighed, not when voting ends.

The same votes on a standard proposal are counted without decay, so a tie there
fails. The conviction design is summarized in
[docs/architecture.md](../../docs/architecture.md#conviction-voting).

## Execution Allowlist

A proposal can carry one on-chain call, made when it executes. The call takes
no arguments, and a proposal carries at most one.

- Only the admin can add or remove targets with `allow_target` and
  `disallow_target`. Each change emits `target_allowlist_updated`.
- The proposer attaches the call with `set_proposal_action(proposal_id, target,
  function)`. This works only while voting is open, and only for a target that is
  on the allowlist.
- `execute()` checks the target against the allowlist again, before it commits
  `Executed`. If the target was removed after the action was attached, `execute()`
  fails with `TargetNotAllowed` and the proposal stays `Queued`.

## Resource baseline

The `create_proposal_and_vote_stay_within_resource_budgets` test records
Soroban test-host CPU and memory estimates for one `create_proposal()` and one
`vote()` invocation (Rust test contracts; these are comparative regression
signals, not production-Wasm fee estimates):

| Invocation          | CPU instructions | Memory bytes |
| ------------------- | ---------------: | -----------: |
| `create_proposal()` |          267,369 |       47,829 |
| `vote()`            |          226,196 |       38,213 |

These measurements include delegated checkpoint reads and title validation.
CI assertions allow up to 25% above each baseline (334,212 / 59,787 for
`create_proposal()` and 282,745 / 47,767 for `vote()`). Re-measure and update
both this table and the thresholds when an intentional change materially
alters the contract's resource use.
