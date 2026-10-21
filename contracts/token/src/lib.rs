#![cfg_attr(not(test), no_std)]
//! QUORUM — governance token for the Quorum protocol. SEP-41 compatible.
use soroban_sdk::{contract, contractimpl, contracttype, contracterror, Address, Env, String, Symbol, Vec};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TokenError {
    AlreadyInitialized    = 1,
    Unauthorized          = 2,
    InsufficientBalance   = 3,
    InsufficientAllowance = 4,
    InvalidAmount         = 5,
    Overflow              = 6,
    InvalidExpiration     = 7,
    InvalidSupply         = 8,
    InvalidDecimals       = 9,
    InvalidDuration       = 10,
    AlreadyStaked         = 11,
    NotStaked             = 12,
    LockNotExpired        = 13,
}

/// A balance recorded at the ledger on which it changed.
///
/// Checkpoints are what make snapshot governance possible: a proposal records
/// the ledger it was created at, and voting power is read from the balance as
/// of that ledger rather than the live balance. Tokens acquired after the
/// snapshot therefore carry no weight, which is what blocks flash-loan and
/// buy-the-vote attacks.
///
/// The same shape records total supply under `SupplyCheckpoints`, where
/// `balance` is the supply after the ledger's last mint or burn.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Checkpoint {
    pub ledger: u32,
    pub balance: i128,
}

/// Emitted when tokens move between accounts.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Transfer {
    pub from: Address,
    pub to: Address,
    pub amount: i128,
}

/// Emitted when tokens are created. `total_supply` is the value after the mint,
/// so an indexer can track supply from events alone.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Mint {
    pub to: Address,
    pub amount: i128,
    pub total_supply: i128,
}

/// Emitted when tokens are destroyed. `total_supply` is the value after the
/// burn.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Burn {
    pub from: Address,
    pub amount: i128,
    pub total_supply: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Approve {
    pub owner: Address,
    pub spender: Address,
    pub amount: i128,
    pub expiration_ledger: u32,
}

/// A stored allowance and the ledger it lapses after.
///
/// SEP-41 requires allowances to expire: a permanent approval left on a
/// compromised or abandoned spender is a standing claim on the owner's balance.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AllowanceValue {
    pub amount: i128,
    pub expiration_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminTransferred {
    pub previous_admin: Address,
    pub new_admin: Address,
}

/// Emitted when a holder changes the destination of their own voting power.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Delegated {
    pub delegator: Address,
    pub delegatee: Address,
}

/// A stake lock, recorded at the ledger it was taken or released.
///
/// `amount` is the locked part of the owner's balance, and is 0 once `unstake`
/// has released it. `unlock_ledger` is when `unstake` first succeeds.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Lock {
    pub ledger: u32,
    pub amount: i128,
    pub unlock_ledger: u32,
}

/// Emitted when a holder locks part of their balance for a voting boost.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Staked {
    pub owner: Address,
    pub amount: i128,
    pub unlock_ledger: u32,
}

/// Emitted when a holder releases a stake after its lock has expired.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Unstaked {
    pub owner: Address,
    pub amount: i128,
}

#[contracttype]
pub enum DataKey {
    Admin, Name, Symbol, Decimals, TotalSupply,
    Balance(Address),
    Allowance(Address, Address),
    Checkpoints(Address),
    PendingAdmin,
    SupplyCheckpoints,
    Delegate(Address),
    VoteCheckpoints(Address),
    Locks(Address),
}

/// Ledgers in roughly one day, at Stellar's ~5 second close time.
const LEDGERS_PER_DAY: u32 = 17_280;

/// Bump persistent entries whose remaining life has fallen below 30 days.
///
/// Snapshot voting power is read from `VoteCheckpoints` (or legacy balance
/// checkpoints), and an entry that expired
/// mid-vote would make `get_past_balance` return 0 for that holder. The
/// governance create form offers voting periods up to 30 days, so the threshold
/// has to exceed that. Matches the governance contract.
const TTL_THRESHOLD: u32 = LEDGERS_PER_DAY * 30;

/// Extend qualifying entries back out to 90 days.
const TTL_EXTEND_TO: u32 = LEDGERS_PER_DAY * 90;

/// How far back checkpoints are kept, in ledgers (60 days).
///
/// A snapshot is only ever read while its proposal is voting, so history older
/// than the longest voting period is dead weight that costs rent and slows
/// every `get_past_balance`. This is twice the 30-day maximum the create form
/// offers. If governance is configured with a longer `voting_period`, raise it.
const CHECKPOINT_RETENTION: u32 = LEDGERS_PER_DAY * 60;

/// Maximum precision supported by the token's public formatting contract.
const MAX_DECIMALS: u32 = 18;

/// Shortest and longest stake lock, in ledgers (7 and 365 days).
///
/// `MAX_LOCK_LEDGERS` is also the scale of the voting boost: a lock with the
/// full term remaining adds its own amount to the holder's voting power. See
/// `docs/staking-vote-escrow.md`.
const MIN_LOCK_LEDGERS: u32 = LEDGERS_PER_DAY * 7;
const MAX_LOCK_LEDGERS: u32 = LEDGERS_PER_DAY * 365;

#[contract]
pub struct QuorumToken;

#[contractimpl]
impl QuorumToken {
    pub fn initialize(env: Env, admin: Address, name: String, symbol: String, decimals: u32, initial_supply: i128) -> Result<(), TokenError> {
        if env.storage().instance().has(&DataKey::Admin) { return Err(TokenError::AlreadyInitialized); }
        if initial_supply < 0 { return Err(TokenError::InvalidSupply); }
        if decimals > MAX_DECIMALS { return Err(TokenError::InvalidDecimals); }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        env.storage().instance().set(&DataKey::Decimals, &decimals);
        Self::set_total_supply(&env, initial_supply);
        Self::set_balance(&env, &admin, initial_supply)?;

        // The genesis allocation is a mint. Emitting it keeps supply
        // reconstructible from events alone, with no special-case for deploy.
        env.events().publish(
            (Symbol::new(&env, "mint"), admin.clone()),
            Mint { to: admin, amount: initial_supply, total_supply: initial_supply },
        );
        Ok(())
    }

    pub fn version(env: Env) -> String {
        String::from_str(&env, env!("CARGO_PKG_VERSION"))
    }

    /// Balance of `owner` as of the end of `ledger`.
    ///
    /// Returns the most recent checkpoint at or before `ledger`, or 0 if the
    /// address held nothing that far back. This excludes delegation;
    /// governance reads effective power through `get_past_votes`.
    pub fn get_past_balance(env: Env, owner: Address, ledger: u32) -> i128 {
        Self::touch_instance(&env);
        Self::value_at(&Self::checkpoints(&env, &owner), ledger)
    }

    /// Total supply as of the end of `ledger`.
    ///
    /// Governance freezes `quorum_required` from the live supply when a
    /// proposal is created; this lets anyone recompute that figure later from
    /// the proposal's `snapshot_ledger`. Supply history is never pruned, so
    /// the answer stays available after the proposal closes. Returns 0 for a
    /// ledger before `initialize`.
    ///
    /// The value is the supply at the close of `ledger`. A mint or burn later
    /// in the same ledger as a proposal's creation is included here but was
    /// not in the live figure the proposal saw.
    pub fn get_past_total_supply(env: Env, ledger: u32) -> i128 {
        Self::touch_instance(&env);
        Self::value_at(&Self::supply_checkpoints(&env), ledger)
    }

    pub fn balance(env: Env, owner: Address) -> i128 {
        let key = DataKey::Balance(owner);
        match env.storage().persistent().get(&key) {
            Some(balance) => {
                Self::touch(&env, &key);
                balance
            }
            None => 0,
        }
    }

    /// Balance available to spend: the balance less any amount locked by `stake`.
    pub fn spendable_balance(env: Env, owner: Address) -> i128 {
        Self::balance(env.clone(), owner.clone()) - Self::locked_amount(&env, &owner)
    }

    /// The part of `owner`'s balance locked by `stake`, or 0 once unstaked.
    pub fn locked_balance(env: Env, owner: Address) -> i128 {
        Self::locked_amount(&env, &owner)
    }

    pub fn total_supply(env: Env) -> i128 {
        Self::touch_instance(&env);
        env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0)
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) -> Result<(), TokenError> {
        from.require_auth();
        if amount <= 0 { return Err(TokenError::InvalidAmount); }
        Self::move_balance(&env, &from, &to, amount)
    }

    /// Moves `amount` from `from` to `to` on behalf of `spender`, drawing on an
    /// allowance the owner granted with `approve`.
    ///
    /// Required by SEP-41: without it no other contract can spend an approved
    /// balance, which is what staking and delegation flows are built on.
    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) -> Result<(), TokenError> {
        // The spender authorizes, not the owner — the owner already consented
        // by approving.
        spender.require_auth();
        if amount <= 0 { return Err(TokenError::InvalidAmount); }

        // Reads as zero if the approval has lapsed, so an expired allowance
        // fails here as InsufficientAllowance.
        let approval = Self::live_allowance(&env, &from, &spender);
        if approval.amount < amount { return Err(TokenError::InsufficientAllowance); }

        // Move first: it validates the balance and fails without touching the
        // allowance, so a rejected spend cannot consume allowance.
        Self::move_balance(&env, &from, &to, amount)?;

        // Debiting keeps the original expiry — spending part of an allowance
        // must not extend the remainder's life.
        let key = DataKey::Allowance(from, spender);
        env.storage().persistent().set(
            &key,
            &AllowanceValue {
                amount: approval.amount - amount,
                expiration_ledger: approval.expiration_ledger,
            },
        );
        Self::touch(&env, &key);
        Ok(())
    }

    /// Burns `amount` from `from` on behalf of `spender`, drawing on an
    /// allowance the owner granted with `approve`.
    ///
    /// The burn event names the owner whose balance and supply were reduced;
    /// the spender is only the authorizer.
    pub fn burn_from(env: Env, spender: Address, from: Address, amount: i128) -> Result<(), TokenError> {
        spender.require_auth();
        if amount <= 0 { return Err(TokenError::InvalidAmount); }

        let approval = Self::live_allowance(&env, &from, &spender);
        if approval.amount < amount { return Err(TokenError::InsufficientAllowance); }

        let bal = Self::balance(env.clone(), from.clone());
        if bal - Self::locked_amount(&env, &from) < amount { return Err(TokenError::InsufficientBalance); }
        let supply = Self::total_supply(env.clone());
        let total_supply = supply
            .checked_sub(amount)
            .filter(|remaining| *remaining >= 0)
            .ok_or(TokenError::Overflow)?;

        // Complete all validation before mutating the balance or allowance.
        Self::set_balance(&env, &from, bal - amount)?;
        Self::set_total_supply(&env, total_supply);

        let key = DataKey::Allowance(from.clone(), spender);
        env.storage().persistent().set(
            &key,
            &AllowanceValue {
                amount: approval.amount - amount,
                expiration_ledger: approval.expiration_ledger,
            },
        );
        Self::touch(&env, &key);

        env.events().publish(
            (Symbol::new(&env, "burn"), from.clone()),
            Burn { from, amount, total_supply },
        );
        Ok(())
    }

    pub fn mint(env: Env, to: Address, amount: i128) -> Result<(), TokenError> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        if amount <= 0 { return Err(TokenError::InvalidAmount); }
        // Checked, so an overflowing mint returns `Overflow` instead of
        // trapping. Both sums are computed before anything is written.
        let supply: i128 = Self::total_supply(env.clone());
        let total_supply = supply.checked_add(amount).ok_or(TokenError::Overflow)?;
        let bal = Self::balance(env.clone(), to.clone());
        let new_balance = bal.checked_add(amount).ok_or(TokenError::Overflow)?;
        Self::set_total_supply(&env, total_supply);
        Self::set_balance(&env, &to, new_balance)?;

        env.events().publish(
            (Symbol::new(&env, "mint"), to.clone()),
            Mint { to, amount, total_supply },
        );
        Ok(())
    }

    pub fn burn(env: Env, from: Address, amount: i128) -> Result<(), TokenError> {
        from.require_auth();
        if amount <= 0 { return Err(TokenError::InvalidAmount); }
        let bal = Self::balance(env.clone(), from.clone());
        if bal - Self::locked_amount(&env, &from) < amount { return Err(TokenError::InsufficientBalance); }
        // Supply can only be below a holder's balance if storage is
        // inconsistent; refuse rather than underflow it. Checked before any
        // write so a refused burn changes nothing.
        let supply = Self::total_supply(env.clone());
        let total_supply = supply
            .checked_sub(amount)
            .filter(|remaining| *remaining >= 0)
            .ok_or(TokenError::Overflow)?;
        Self::set_balance(&env, &from, bal - amount)?;
        Self::set_total_supply(&env, total_supply);

        env.events().publish(
            (Symbol::new(&env, "burn"), from.clone()),
            Burn { from, amount, total_supply },
        );
        Ok(())
    }

    /// Grants `spender` the right to move up to `amount` of `owner`'s balance,
    /// until `expiration_ledger` has passed.
    ///
    /// Per SEP-41, a live approval (`amount > 0`) must not expire in the past.
    /// A zero `amount` is a revocation and accepts any expiration, which is how
    /// an owner cancels an approval they can no longer honour.
    pub fn approve(env: Env, owner: Address, spender: Address, amount: i128, expiration_ledger: u32) -> Result<(), TokenError> {
        owner.require_auth();
        if amount < 0 { return Err(TokenError::InvalidAmount); }
        if amount > 0 && expiration_ledger < env.ledger().sequence() {
            return Err(TokenError::InvalidExpiration);
        }

        let key = DataKey::Allowance(owner.clone(), spender.clone());
        env.storage()
            .persistent()
            .set(&key, &AllowanceValue { amount, expiration_ledger });
        Self::touch(&env, &key);

        env.events().publish(
            (Symbol::new(&env, "approve"), owner.clone(), spender.clone()),
            Approve { owner, spender, amount, expiration_ledger },
        );
        Ok(())
    }

    /// Amount `spender` may still draw from `owner`, or 0 once the approval has
    /// lapsed.
    ///
    /// An expired allowance reads as 0 rather than erroring, so callers cannot
    /// accidentally treat a lapsed approval as spendable.
    pub fn allowance(env: Env, owner: Address, spender: Address) -> i128 {
        Self::live_allowance(&env, &owner, &spender).amount
    }

    pub fn transfer_admin(env: Env, new_admin: Address) -> Result<(), TokenError> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::PendingAdmin, &new_admin);
        Ok(())
    }

    pub fn accept_admin(env: Env) -> Result<(), TokenError> {
        let pending: Address = env.storage().instance().get(&DataKey::PendingAdmin)
            .ok_or(TokenError::Unauthorized)?;
        pending.require_auth();
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        env.storage().instance().set(&DataKey::Admin, &pending);
        env.storage().instance().remove(&DataKey::PendingAdmin);

        env.events().publish(
            (Symbol::new(&env, "admin_transferred"), admin.clone()),
            AdminTransferred { previous_admin: admin, new_admin: pending },
        );
        Ok(())
    }

    pub fn cancel_admin_transfer(env: Env) -> Result<(), TokenError> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().remove(&DataKey::PendingAdmin);
        Ok(())
    }

    pub fn name(env: Env) -> String { env.storage().instance().get(&DataKey::Name).unwrap() }
    pub fn symbol(env: Env) -> String { env.storage().instance().get(&DataKey::Symbol).unwrap() }
    pub fn decimals(env: Env) -> u32 { env.storage().instance().get(&DataKey::Decimals).unwrap() }

    /// Assigns the holder's own balance to one representative. Incoming
    /// delegations stay with their recipient: delegation is not transitive.
    /// Self-delegation (or the all-zero account) restores the holder's votes.
    pub fn delegate(env: Env, delegator: Address, delegatee: Address) -> Result<(), TokenError> {
        delegator.require_auth();
        Self::touch_instance(&env);
        let delegatee = if delegatee == Address::from_str(
            &env, "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        ) { delegator.clone() } else { delegatee };
        let previous = Self::get_delegates(env.clone(), delegator.clone());
        if previous == delegatee { return Ok(()); }

        let amount = Self::balance(env.clone(), delegator.clone());
        let previous_votes = Self::current_votes(&env, &previous)
            .checked_sub(amount).filter(|value| *value >= 0).ok_or(TokenError::Overflow)?;
        let next_votes = Self::current_votes(&env, &delegatee)
            .checked_add(amount).ok_or(TokenError::Overflow)?;
        Self::set_votes(&env, &previous, previous_votes);
        Self::set_votes(&env, &delegatee, next_votes);

        let key = DataKey::Delegate(delegator.clone());
        if delegatee == delegator {
            env.storage().persistent().remove(&key);
        } else {
            env.storage().persistent().set(&key, &delegatee);
            Self::touch(&env, &key);
        }
        env.events().publish(
            (Symbol::new(&env, "delegated"), delegator.clone(), delegatee.clone()),
            Delegated { delegator, delegatee },
        );
        Ok(())
    }

    /// The current representative; holders vote for themselves by default.
    pub fn get_delegates(env: Env, account: Address) -> Address {
        Self::touch_instance(&env);
        let key = DataKey::Delegate(account.clone());
        match env.storage().persistent().get(&key) {
            Some(delegatee) => {
                Self::touch(&env, &key);
                delegatee
            }
            None => account,
        }
    }

    /// Effective voting power at the close of `ledger`. Delegations and all
    /// balance-changing paths record weight, so later mappings cannot rewrite
    /// the weight of an existing proposal's snapshot.
    ///
    /// Adds the stake boost of `account` at that ledger. The boost is the
    /// staker's own and is not moved by delegation.
    pub fn get_past_votes(env: Env, account: Address, ledger: u32) -> i128 {
        Self::touch_instance(&env);
        let votes = Self::value_at(&Self::vote_checkpoints(&env, &account), ledger);
        votes.saturating_add(Self::lock_boost(&env, &account, ledger))
    }

    /// Locks `amount` of `owner`'s balance for `duration` ledgers.
    ///
    /// The balance does not change: the locked part stays in the balance and its
    /// checkpoints, but cannot be spent until `unstake`. In return the owner's
    /// voting power gets a boost that decays linearly to zero at the unlock
    /// ledger. See `docs/staking-vote-escrow.md`.
    pub fn stake(env: Env, owner: Address, amount: i128, duration: u32) -> Result<(), TokenError> {
        owner.require_auth();
        if amount <= 0 { return Err(TokenError::InvalidAmount); }
        if !(MIN_LOCK_LEDGERS..=MAX_LOCK_LEDGERS).contains(&duration) {
            return Err(TokenError::InvalidDuration);
        }
        if Self::current_lock(&Self::locks(&env, &owner)).is_some() {
            return Err(TokenError::AlreadyStaked);
        }
        // No lock is active, so nothing is locked yet and the whole balance is
        // available to stake.
        if amount > Self::balance(env.clone(), owner.clone()) {
            return Err(TokenError::InsufficientBalance);
        }

        let ledger = env.ledger().sequence();
        let unlock_ledger = ledger.checked_add(duration).ok_or(TokenError::Overflow)?;
        Self::record_lock(&env, &owner, Lock { ledger, amount, unlock_ledger });

        env.events().publish(
            (Symbol::new(&env, "stake"), owner.clone()),
            Staked { owner, amount, unlock_ledger },
        );
        Ok(())
    }

    /// Releases the lock on `owner`'s stake once its unlock ledger has passed.
    pub fn unstake(env: Env, owner: Address) -> Result<(), TokenError> {
        owner.require_auth();
        let lock = Self::current_lock(&Self::locks(&env, &owner)).ok_or(TokenError::NotStaked)?;
        if env.ledger().sequence() < lock.unlock_ledger {
            return Err(TokenError::LockNotExpired);
        }

        let amount = lock.amount;
        let ledger = env.ledger().sequence();
        Self::record_lock(
            &env,
            &owner,
            Lock { ledger, amount: 0, unlock_ledger: lock.unlock_ledger },
        );

        env.events().publish(
            (Symbol::new(&env, "unstake"), owner.clone()),
            Unstaked { owner, amount },
        );
        Ok(())
    }
}

/// Internal helpers — outside `#[contractimpl]` so they are not exported as
/// contract functions.
impl QuorumToken {
    /// The stored allowance if it is still live, otherwise a zero allowance.
    ///
    /// Returning a zeroed value rather than `None` keeps the expiry check in
    /// one place: every spender path treats a lapsed approval as empty.
    fn live_allowance(env: &Env, owner: &Address, spender: &Address) -> AllowanceValue {
        let key = DataKey::Allowance(owner.clone(), spender.clone());
        match env.storage().persistent().get::<_, AllowanceValue>(&key) {
            Some(allowance) if allowance.expiration_ledger >= env.ledger().sequence() => {
                Self::touch(env, &key);
                allowance
            }
            _ => AllowanceValue { amount: 0, expiration_ledger: 0 },
        }
    }

    /// Extends the TTL of a persistent entry that is known to exist, so
    /// balances, checkpoints and live allowances outlast long voting windows.
    fn touch(env: &Env, key: &DataKey) {
        env.storage()
            .persistent()
            .extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }

    /// Extends the TTL of instance storage, which holds the admin, metadata and
    /// total supply. If this expired the contract would lose its configuration.
    fn touch_instance(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
    }

    /// Debits `from`, credits `to`, and emits the transfer event.
    ///
    /// Shared by `transfer` and `transfer_from` so both paths apply the same
    /// balance checks, write the same checkpoints and emit the same event —
    /// an allowance spend is indistinguishable from a direct transfer to
    /// anything watching balances.
    fn move_balance(env: &Env, from: &Address, to: &Address, amount: i128) -> Result<(), TokenError> {
        let from_bal = Self::balance(env.clone(), from.clone());
        // Locked tokens stay in the balance but cannot move until unstaked.
        if from_bal - Self::locked_amount(env, from) < amount {
            return Err(TokenError::InsufficientBalance);
        }

        Self::set_balance(env, from, from_bal - amount)?;
        // Read `to` after debiting `from`, so a self-transfer nets to zero
        // instead of crediting a stale balance.
        let to_bal = Self::balance(env.clone(), to.clone());
        let new_balance = to_bal.checked_add(amount).ok_or(TokenError::Overflow)?;
        Self::set_balance(env, to, new_balance)?;

        env.events().publish(
            (Symbol::new(env, "transfer"), from.clone(), to.clone()),
            Transfer { from: from.clone(), to: to.clone(), amount },
        );
        Ok(())
    }

    fn checkpoints(env: &Env, owner: &Address) -> Vec<Checkpoint> {
        let key = DataKey::Checkpoints(owner.clone());
        match env.storage().persistent().get(&key) {
            Some(checkpoints) => {
                Self::touch(env, &key);
                checkpoints
            }
            None => Vec::new(env),
        }
    }

    /// Writes `balance` for `owner` and records a checkpoint at the current
    /// ledger.
    ///
    /// Every balance mutation goes through here; a write that bypassed it would
    /// leave a gap that `get_past_balance` would silently read straight past,
    /// handing the holder the wrong voting power.
    fn set_balance(env: &Env, owner: &Address, balance: i128) -> Result<(), TokenError> {
        Self::touch_instance(env);
        let old_balance = Self::balance(env.clone(), owner.clone());
        let delegatee = Self::get_delegates(env.clone(), owner.clone());
        let votes = Self::current_votes(env, &delegatee)
            .checked_sub(old_balance).filter(|value| *value >= 0)
            .and_then(|value| value.checked_add(balance)).ok_or(TokenError::Overflow)?;
        // Read/write voting history before balances, including the lazy
        // fallback for holders whose history predates delegation support.
        Self::set_votes(env, &delegatee, votes);
        let balance_key = DataKey::Balance(owner.clone());
        env.storage().persistent().set(&balance_key, &balance);
        Self::touch(env, &balance_key);

        let ledger = env.ledger().sequence();
        let mut checkpoints = Self::checkpoints(env, owner);
        Self::record(&mut checkpoints, ledger, balance);

        // Drop history no snapshot can still ask for. Entries older than the
        // retention window are pruned, except the newest of them: that one is
        // the balance in effect at the cutoff, so a snapshot taken just inside
        // the window still resolves correctly. The entry written above is at
        // `ledger`, never before the cutoff, so it is always kept.
        let cutoff = ledger.saturating_sub(CHECKPOINT_RETENTION);
        let mut stale = 0u32;
        while stale < checkpoints.len() {
            match checkpoints.get(stale) {
                Some(entry) if entry.ledger < cutoff => stale += 1,
                _ => break,
            }
        }
        if stale > 1 {
            checkpoints = checkpoints.slice(stale - 1..);
        }

        let checkpoints_key = DataKey::Checkpoints(owner.clone());
        env.storage().persistent().set(&checkpoints_key, &checkpoints);
        Self::touch(env, &checkpoints_key);
        Ok(())
    }

    fn vote_checkpoints(env: &Env, owner: &Address) -> Vec<Checkpoint> {
        let key = DataKey::VoteCheckpoints(owner.clone());
        match env.storage().persistent().get(&key) {
            Some(history) => {
                Self::touch(env, &key);
                history
            }
            // Existing holders retain their historical self-voting power.
            // Their first delegation or balance change materializes this
            // history before any change to balances or delegation mappings.
            None => Self::checkpoints(env, owner),
        }
    }

    fn current_votes(env: &Env, owner: &Address) -> i128 {
        Self::value_at(&Self::vote_checkpoints(env, owner), env.ledger().sequence())
    }

    fn set_votes(env: &Env, owner: &Address, votes: i128) {
        let mut history = Self::vote_checkpoints(env, owner);
        let ledger = env.ledger().sequence();
        Self::record(&mut history, ledger, votes);
        let cutoff = ledger.saturating_sub(CHECKPOINT_RETENTION);
        let mut stale = 0;
        while stale < history.len() && history.get(stale).unwrap().ledger < cutoff {
            stale += 1;
        }
        if stale > 1 { history = history.slice(stale - 1..); }
        let key = DataKey::VoteCheckpoints(owner.clone());
        env.storage().persistent().set(&key, &history);
        Self::touch(env, &key);
    }

    fn locks(env: &Env, owner: &Address) -> Vec<Lock> {
        let key = DataKey::Locks(owner.clone());
        match env.storage().persistent().get(&key) {
            Some(locks) => {
                Self::touch(env, &key);
                locks
            }
            None => Vec::new(env),
        }
    }

    /// The lock in force now: the newest entry, provided it still holds an
    /// amount. `unstake` records a cleared entry, so a released stake reads as
    /// no lock.
    fn current_lock(locks: &Vec<Lock>) -> Option<Lock> {
        let len = locks.len();
        if len == 0 { return None; }
        locks.get(len - 1).filter(|lock| lock.amount > 0)
    }

    /// The amount `owner` has locked now, or 0.
    fn locked_amount(env: &Env, owner: &Address) -> i128 {
        Self::current_lock(&Self::locks(env, owner)).map(|lock| lock.amount).unwrap_or(0)
    }

    /// Appends a lock change at the current ledger. A second change in the same
    /// ledger replaces the first, and history older than the retention window is
    /// pruned as balance checkpoints are, keeping the newest pruned entry.
    fn record_lock(env: &Env, owner: &Address, lock: Lock) {
        let mut locks = Self::locks(env, owner);
        let len = locks.len();
        match locks.get(len.saturating_sub(1)) {
            Some(last) if len > 0 && last.ledger == lock.ledger => {
                locks.set(len - 1, lock);
            }
            _ => locks.push_back(lock),
        }

        let cutoff = env.ledger().sequence().saturating_sub(CHECKPOINT_RETENTION);
        let mut stale = 0u32;
        while stale < locks.len() {
            match locks.get(stale) {
                Some(entry) if entry.ledger < cutoff => stale += 1,
                _ => break,
            }
        }
        if stale > 1 {
            locks = locks.slice(stale - 1..);
        }

        let key = DataKey::Locks(owner.clone());
        env.storage().persistent().set(&key, &locks);
        Self::touch(env, &key);
    }

    /// The newest lock recorded strictly before `ledger`. A lock counts only
    /// from the ledger after the one it was made in, so a stake cannot raise
    /// the weight of a snapshot taken in the same ledger. Binary search, as in
    /// `value_at`.
    fn lock_before(locks: &Vec<Lock>, ledger: u32) -> Option<Lock> {
        let mut low = 0u32;
        let mut high = locks.len();
        while low < high {
            let mid = low + (high - low) / 2;
            match locks.get(mid) {
                Some(lock) if lock.ledger < ledger => low = mid + 1,
                _ => high = mid,
            }
        }

        if low == 0 {
            None
        } else {
            locks.get(low - 1)
        }
    }

    /// The voting boost `owner` holds at the close of `ledger`:
    /// `amount * (unlock_ledger - ledger) / MAX_LOCK_LEDGERS`, zero once the
    /// lock has expired or been released.
    fn lock_boost(env: &Env, owner: &Address, ledger: u32) -> i128 {
        let locks = Self::locks(env, owner);
        let lock = match Self::lock_before(&locks, ledger) {
            Some(lock) => lock,
            None => return 0,
        };
        if lock.amount <= 0 || ledger >= lock.unlock_ledger {
            return 0;
        }

        // Split the division so the product cannot leave i128. Because
        // `remaining <= MAX_LOCK_LEDGERS`, the boost never exceeds `amount`.
        let remaining = i128::from(lock.unlock_ledger - ledger);
        let scale = i128::from(MAX_LOCK_LEDGERS);
        (lock.amount / scale) * remaining + (lock.amount % scale) * remaining / scale
    }

    fn supply_checkpoints(env: &Env) -> Vec<Checkpoint> {
        let key = DataKey::SupplyCheckpoints;
        match env.storage().persistent().get(&key) {
            Some(checkpoints) => {
                Self::touch(env, &key);
                checkpoints
            }
            None => Vec::new(env),
        }
    }

    /// Writes the total supply and records a supply checkpoint at the current
    /// ledger.
    ///
    /// Every supply change goes through here, for the same reason balances go
    /// through `set_balance`. Unlike balance history this is never pruned:
    /// supply only moves on admin mints and holder burns, so it grows slowly,
    /// and the point of keeping it is auditing quorum figures long after the
    /// proposals that used them have closed.
    fn set_total_supply(env: &Env, total_supply: i128) {
        env.storage().instance().set(&DataKey::TotalSupply, &total_supply);

        let mut checkpoints = Self::supply_checkpoints(env);
        Self::record(&mut checkpoints, env.ledger().sequence(), total_supply);

        let key = DataKey::SupplyCheckpoints;
        env.storage().persistent().set(&key, &checkpoints);
        Self::touch(env, &key);
    }

    /// Appends `value` at `ledger`, or overwrites the last entry if it is
    /// already at `ledger`.
    ///
    /// Several changes can land in one ledger. Collapsing them keeps exactly
    /// one entry per ledger — its closing value — which is what keeps the
    /// binary search in `value_at` unambiguous.
    fn record(checkpoints: &mut Vec<Checkpoint>, ledger: u32, value: i128) {
        let len = checkpoints.len();
        match checkpoints.get(len.saturating_sub(1)) {
            Some(last) if len > 0 && last.ledger == ledger => {
                checkpoints.set(len - 1, Checkpoint { ledger, balance: value });
            }
            _ => checkpoints.push_back(Checkpoint { ledger, balance: value }),
        }
    }

    /// The value in effect at the end of `ledger`: the most recent checkpoint
    /// at or before it, or 0 if there is none.
    fn value_at(checkpoints: &Vec<Checkpoint>, ledger: u32) -> i128 {
        // Binary search for the first checkpoint recorded after `ledger`; the
        // value in effect is the one immediately before it.
        let mut low = 0u32;
        let mut high = checkpoints.len();
        while low < high {
            let mid = low + (high - low) / 2;
            match checkpoints.get(mid) {
                Some(checkpoint) if checkpoint.ledger <= ledger => low = mid + 1,
                _ => high = mid,
            }
        }

        if low == 0 {
            0
        } else {
            checkpoints.get(low - 1).map(|c| c.balance).unwrap_or(0)
        }
    }
}

#[cfg(test)]
mod test;
