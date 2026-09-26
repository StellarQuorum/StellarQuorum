# QUORUM Token Contract

SEP-41 compatible governance token for the Quorum protocol.

## Functions
- `initialize` — set name, symbol, decimals, initial supply
- `transfer` — transfer tokens between accounts
- `mint` — admin-only token minting
- `burn` — holder-authorized token burning
- `approve` — set an allowance for a spender, valid until `expiration_ledger`
- `transfer_from` — spender moves tokens on behalf of an owner, against an allowance
- `allowance` — remaining allowance, or 0 once the approval has lapsed
- `get_past_balance` — balance as of a past ledger, backing snapshot voting power
- `mint` returns `Overflow` if the new total supply or balance would exceed
  `i128::MAX`, and `burn` returns `Overflow` rather than take total supply below
  zero. Neither traps, and a refused call changes nothing.

`burn_from` lets an approved spender burn against the owner's allowance and
emits a burn event naming that owner. `spendable_balance` is equal to `balance`
because this token has no locked balances.

Initialization accepts decimal precision from 0 through 18 and rejects a
negative initial supply. A zero initial supply is valid for tokens minted later.

## Allowance expiry

`approve(owner, spender, amount, expiration_ledger)` stores the expiry
alongside the amount. An allowance is spendable up to and including
`expiration_ledger` and reads as 0 from the ledger after.

Per SEP-41, a live approval (`amount > 0`) is rejected with
`InvalidExpiration` if it would expire in the past — which makes
`expiration_ledger: 0` invalid for any real ledger. A zero `amount` is a
revocation and is accepted with any expiry, so an owner can always cancel an
approval.

Spending part of an allowance keeps the original expiry: a partial spend must
not extend the life of the remainder.

## Storage lifetime

`Balance`, `Checkpoints` and live `Allowance` entries are extended to 90 days
whenever they are written or read while below 30 days remaining, mirroring the
governance contract. Instance storage (admin, metadata, total supply) is extended
on balance writes and on `total_supply` / `get_past_balance`.

The thresholds are chosen against the longest voting window: a snapshot is read
from `Checkpoints` while its proposal is open, and an entry that expired in that
time would make `get_past_balance` return `0` and drop the holder's vote weight.
30 days is above the longest voting period the create form offers.

## Checkpoint growth

Every balance change writes a `Checkpoint { ledger, balance }`, and all of an
address's checkpoints live in one `Vec` under one persistent key. That has two
consequences, both linear in the number of checkpoints `n`:

- `get_past_balance` reads and decodes the whole vector. The binary search is
  `O(log n)`, but the read is `O(n)` bytes, so the cost of every vote that
  address casts grows with its history.
- `set_balance` rewrites the whole vector on every balance change (`O(n)`
  write), and the entry's storage rent grows with its size.

Checkpoints collapse to one per ledger, so an address adds at most one entry per
ledger in which its balance changes.

**Strategy implemented: time-window pruning.** On every write, entries older than
`CHECKPOINT_RETENTION` (60 days of ledgers) are dropped, except the newest of
them, which is kept as the balance in effect at the cutoff. Any snapshot inside
the window still resolves correctly. A snapshot older than the window reads as
`0`, which is safe while the window exceeds the longest voting period. If
governance is configured with a longer `voting_period`, raise the constant.

**Strategy deferred: paging the vector across keys.** Pruning bounds history by
time, not by count. An address that changes balance in most ledgers can still
hold up to a window's worth of entries, and a single ledger entry has a
network-enforced size limit. Paging removes that limit but changes the storage
layout, needs a migration for existing holders and rewrites the lookup in
`get_past_balance`, which is out of proportion for this fix. It is the next step
if an account ever approaches the per-entry limit.

**Measurements.** The issue asks for read cost at 100, 1,000 and 10,000
checkpoints. Those were not run: the numbers above are from reading the code, not
from profiling. Add them (for example with `env.cost_estimate().budget()` in a
test) before relying on a specific figure.
