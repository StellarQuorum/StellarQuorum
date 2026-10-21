# QUORUM Staking: Vote-Escrow Boost

Status: proposed. Tracks issue #248.

Written for: maintainers and contributors reviewing how QUORUM holders can lock
tokens for a longer commitment in exchange for more voting weight.

## Problem

Voting power is a 1:1 read of the QUORUM balance at a proposal's snapshot ledger
(`get_past_votes` in `contracts/token/src/lib.rs`). A holder who is committed for
the long run has the same weight as one who may sell the next day. There is no
way to trade liquidity for weight, and the README roadmap lists "QUORUM token
distribution and staking" as open.

## Goals

- A holder can lock QUORUM for a chosen duration and receive extra voting weight.
- Longer locks give more weight. The extra weight decays linearly to zero as the
  unlock ledger approaches, so the boost reflects the commitment that remains.
- Locked tokens cannot be transferred or burned until the lock expires.
- The governance contract needs no change. Its existing snapshot read,
  `get_past_votes(voter, snapshot_ledger)`, includes the boost, so weight is
  fixed at each proposal's snapshot like every other weight.

## Non-goals (v1)

- Extending or topping up an active lock. A holder unstakes after expiry and
  stakes again.
- Earning rewards or fees for locking.
- Changing `quorum_required`, which is still derived from total supply.

## Design

Locking lives in the token contract. Balances, delegation and checkpoints already
live there, and the token already reserves a `spendable_balance` entry point for a
locked-balance model.

### Parameters

| Name | Value | Meaning |
|---|---|---|
| `MIN_LOCK_LEDGERS` | 7 days (`17_280 * 7`) | Shortest allowed lock. |
| `MAX_LOCK_LEDGERS` | 365 days (`17_280 * 365`) | Longest allowed lock, and the scale of the boost. |

Durations are in ledgers, matching `voting_period` and `timelock_period` in the
governance contract.

### Boost

A lock is `(amount, unlock_ledger)`. At ledger `L` before the unlock:

```
remaining = unlock_ledger - L            (always <= MAX_LOCK_LEDGERS)
boost(L)  = amount * remaining / MAX_LOCK_LEDGERS
```

- A lock taken for the full year starts with a boost equal to the locked amount,
  so that weight is 2x. A seven-day lock starts with a boost of about 1.9%.
- The boost falls by the same amount every ledger, reaching 0 at `unlock_ledger`.
- The arithmetic is split as `(amount / M) * remaining + (amount % M) * remaining / M`
  with `M = MAX_LOCK_LEDGERS`. This gives the exact floored result and cannot
  overflow `i128`, because `remaining <= M`, so the boost never exceeds `amount`.

The boost is computed when it is read, from the lock in effect at the requested
ledger. Nothing is written per ledger, so decay costs no storage or fees.

### Operations

- `stake(owner, amount, duration)`
  - `owner` must authorize. `amount > 0` and `MIN_LOCK_LEDGERS <= duration <= MAX_LOCK_LEDGERS`,
    otherwise `InvalidAmount` or `InvalidDuration`.
  - `owner` may have only one active lock. Staking while locked fails with `AlreadyStaked`.
  - `amount` must not exceed the owner's spendable balance, otherwise `InsufficientBalance`.
  - Records `Lock { ledger: now, amount, unlock_ledger: now + duration }`.
    The balance is unchanged; the amount is now locked in place.
  - Emits `stake` with `Staked { owner, amount, unlock_ledger }`.
- `unstake(owner)`
  - `owner` must authorize. No lock gives `NotStaked`. A lock that has not reached
    `unlock_ledger` gives `LockNotExpired`.
  - Records a cleared lock (`amount = 0`) at `now`, which releases the amount.
  - Emits `unstake` with `Unstaked { owner, amount }`.
- `locked_balance(owner)` returns the active locked amount, 0 when unlocked.
- `spendable_balance(owner)` becomes `balance - locked_balance`.
  `transfer`, `transfer_from`, `burn` and `burn_from` check spendable balance,
  not total balance. Mint and receiving transfers are unaffected.
- `get_past_votes(owner, ledger)` returns the delegated votes at `ledger` plus
  `boost(owner, ledger)`.

### Storage

- `DataKey::Locks(Address)` holds a `Vec<Lock>` history, one entry per stake or
  unstake. It follows the same rules as balance checkpoints: one entry per
  ledger (the closing value wins), and entries older than `CHECKPOINT_RETENTION`
  are pruned except the newest of them, so a snapshot inside the window still
  resolves.
- The active lock is the newest entry whose `amount > 0`. The lock that counts
  for a snapshot at ledger `L` is the newest entry with `ledger < L`: a stake
  made in the snapshot ledger itself adds no boost to that snapshot.
- Balances are not touched by staking, so `get_past_balance` and supply
  checkpoints keep their current meaning.

### Delegation

The boost belongs to the staker's own address and is **not** moved by
delegation. Delegation moves the balance (including the locked part) to the
delegatee. A staker who delegates away keeps the boost on their own address.

This keeps the boost independent of delegation history. Carrying it along with
delegations would mean storing a second, per-delegatee history of boosts that
changes with every unlock.

## Security Considerations

- **No flash staking.** Power is read at the snapshot ledger, and a lock created
  after the snapshot contributes nothing to that snapshot.
- **No early exit.** Locked tokens cannot be transferred or burned, so the boost
  cannot be kept after the holder has sold the commitment.
- **No same-ledger boost.** A lock counts only from the ledger after it was
  made. Without this, a holder could stake in the ledger where a proposal is
  created, after the proposal opens, and have the boost land in its snapshot.
- **Snapshots stay fixed.** Lock history is written only on stake and unstake,
  and reads are historical. A later stake or unstake cannot rewrite a snapshot.
- **Weight can exceed supply.** Boosts are on top of balances, so the sum of
  voting power can exceed `total_supply`. Tally arithmetic in governance is
  already checked, and `quorum_required` is still derived from supply.

## Open Questions

1. **Quorum semantics.** Quorum is `supply * bps / 10000` of raw supply, but
   tallies now include boosts. A proposal can reach quorum with less than `bps`
   of circulating tokens voting, because locked holders count for more. Options:
   keep it as is and document the change, or measure quorum against
   `total_supply + total_boost`. This doc recommends the first for v1.
2. **Lock extension.** Allowing a holder to extend a lock or add to one is
   useful but needs a rule for the boost when the amount and unlock change.
   Deferred.
3. **Total boost tracking.** There is no on-chain total of active boosts, so
   question 1 cannot be answered without an extra counter. Deferred with it.

## Testing Plan

Unit tests in `contracts/token/src/test.rs`:

- stake records a lock and leaves the balance unchanged;
- stake with an invalid duration or amount is rejected, and stake while locked
  returns `AlreadyStaked`;
- transfer, burn and `transfer_from` cannot spend locked tokens;
- `unstake` before `unlock_ledger` returns `LockNotExpired`, and succeeds at it;
- the boost decays linearly: it is `amount * duration / MAX` at stake, halves
  by midpoint, and is 0 at unlock;
- a snapshot taken before a stake carries no boost.

Governance integration in `contracts/governance/src/test_delegation.rs`:

- a staked holder's proposal weight includes the boost at the snapshot ledger.
