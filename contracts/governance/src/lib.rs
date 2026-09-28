#![no_std]
#[cfg(test)]
extern crate std;

use soroban_sdk::{contract, contractclient, contractimpl, contracttype, contracterror, Address, Env, String, Symbol};

/// Subset of the QUORUM token interface the governor depends on.
///
/// Generates `TokenClient`, used to cross-invoke the token contract at the
/// address held in `Config::token`.
#[contractclient(name = "TokenClient")]
pub trait TokenInterface {
    fn total_supply(env: Env) -> i128;
    fn balance(env: Env, owner: Address) -> i128;
    fn get_past_balance(env: Env, owner: Address, ledger: u32) -> i128;
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum GovernanceError {
    AlreadyInitialized      = 1,
    Unauthorized            = 2,
    ProposalNotFound        = 3,
    VotingNotActive         = 4,
    AlreadyVoted            = 5,
    QuorumNotReached        = 6,
    ProposalNotPassed       = 7,
    AlreadyExecuted         = 8,
    BelowProposalThreshold  = 9,
    InvalidVoteChoice       = 10,
    VotingPeriodEnded       = 11,
    TimelockNotExpired      = 12,
    Overflow                = 13,
    NoVotingPower           = 14,
    ExecutionExpired        = 15,
    ContractPaused          = 16,
    InvalidQuorumBps        = 17,
    NotInitialized          = 18,
    EmptyTitle              = 19,
    TitleTooLong            = 20,
    DescriptionTooLong      = 21,
    MinimumQuorumRequired   = 22,
    MinimumTimelockRequired = 23,
}

/// Basis-point denominator: `quorum_bps` of 500 means 5% of total supply.
const BPS_DENOMINATOR: i128 = 10_000;

/// Largest `quorum_bps` that can still be reached. 10000 means "the entire
/// supply must vote", which is a legitimate (if strict) setting; anything
/// above it demands more votes than exist, so no proposal could ever reach
/// quorum and there is no way to recover the parameter.
const MAX_QUORUM_BPS: u32 = 10_000;

/// Minimum quorum in basis points to prevent governance capture.
/// A quorum of 0 means a single vote carries a proposal, which is dangerous
/// for production use. This minimum of 1 basis point (0.01%) enforces that
/// at least some meaningful participation is required.
const MIN_QUORUM_BPS: u32 = 1;

/// Minimum timelock period in ledgers to provide a safety window.
/// A timelock of 0 allows same-ledger execution after finalization, removing
/// the safety window against governance attacks described in the README as
/// a 48-hour guard. This minimum of 1 ledger enforces at least one ledger
/// delay between finalization and execution.
const MIN_TIMELOCK_PERIOD: u32 = 1;

/// Maximum length for proposal title in bytes.
/// Prevents unbounded storage costs and ensures reasonable UI display.
const MAX_TITLE_LENGTH: u32 = 200;

/// Maximum length for proposal description in bytes.
/// Prevents unbounded storage costs and rent inflation.
const MAX_DESCRIPTION_LENGTH: u32 = 10_000;

/// Ledgers in roughly one day, at Stellar's ~5 second close time.
const LEDGERS_PER_DAY: u32 = 17_280;

/// Bump persistent entries whose remaining life has fallen below 30 days.
///
/// A proposal must stay readable for its whole voting window plus the timelock
/// plus however long anyone later wants to audit the result. The create form
/// already offers a 30-day voting period, so the threshold has to exceed that
/// or a long-running proposal could expire mid-vote.
const TTL_THRESHOLD: u32 = LEDGERS_PER_DAY * 30;

/// Extend qualifying entries back out to 90 days.
const TTL_EXTEND_TO: u32 = LEDGERS_PER_DAY * 90;

/// Emitted when a proposal is opened.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalCreated {
    pub id: u64,
    pub proposer: Address,
    pub title: String,
    pub start_ledger: u32,
    pub end_ledger: u32,
    pub quorum_required: i128,
    pub metadata_uri: String,
}

/// Emitted when the contract is paused.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractPaused {
    pub caller: Address,
}

/// Emitted when the contract is unpaused.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractUnpaused {
    pub caller: Address,
}

/// Emitted for each accepted vote. `voting_power` is the weight actually
/// counted — the voter's balance at the snapshot ledger, not their live one.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VoteCast {
    pub proposal_id: u64,
    pub voter: Address,
    pub support: u32,
    pub voting_power: i128,
}

/// Emitted when voting closes and the outcome is decided.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalFinalized {
    pub id: u64,
    pub status: ProposalStatus,
    pub for_votes: i128,
    pub against_votes: i128,
    pub abstain_votes: i128,
}

/// Emitted alongside `ProposalFinalized` when a proposal passes and enters the
/// timelock.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalQueued {
    pub id: u64,
    pub queue_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalExecuted {
    pub id: u64,
    pub executor: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalCancelled {
    pub id: u64,
    pub caller: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminTransferred {
    pub previous_admin: Address,
    pub new_admin: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalStatus {
    Pending, Active, Passed, Failed, Queued, Executed, Cancelled, Expired,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Proposal {
    pub id: u64,
    pub proposer: Address,
    pub title: String,
    pub description: String,
    pub for_votes: i128,
    pub against_votes: i128,
    pub abstain_votes: i128,
    pub snapshot_ledger: u32,
    pub start_ledger: u32,
    pub end_ledger: u32,
    pub queue_ledger: u32,
    pub quorum_required: i128,
    pub status: ProposalStatus,
    pub metadata_uri: String,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub token: Address,
    pub quorum_bps: u32,
    pub voting_period: u32,
    pub timelock_period: u32,
    pub proposal_threshold: i128,
    pub admin: Address,
    pub guardian: Address,
    pub execution_grace_period: u32,
    pub paused: bool,
}

#[contracttype]
pub enum DataKey {
    Config,
    ProposalCount,
    Proposal(u64),
    HasVoted(u64, Address),
    Delegate(Address),
    PendingAdmin,
}

#[contract]
pub struct GovernanceContract;

#[contractimpl]
impl GovernanceContract {
    pub fn initialize(env: Env, admin: Address, guardian: Address, token: Address, quorum_bps: u32, voting_period: u32, timelock_period: u32, execution_grace_period: u32, proposal_threshold: i128) -> Result<(), GovernanceError> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(GovernanceError::AlreadyInitialized);
        }
        // Reject an unreachable quorum before any state is written. Above
        // MAX_QUORUM_BPS the required votes exceed the total supply, so every
        // proposal would fail forever and the parameter could never be fixed.
        if quorum_bps > MAX_QUORUM_BPS {
            return Err(GovernanceError::InvalidQuorumBps);
        }
        // Enforce minimum quorum to prevent governance capture at quorum_bps = 0,
        // where a single vote carries a proposal. This is useful in tests but
        // dangerous in production.
        if quorum_bps < MIN_QUORUM_BPS {
            return Err(GovernanceError::MinimumQuorumRequired);
        }
        // Enforce minimum timelock to preserve the safety window described in
        // the README. A timelock of 0 allows same-ledger execution, removing
        // the 48-hour guard against governance attacks.
        if timelock_period < MIN_TIMELOCK_PERIOD {
            return Err(GovernanceError::MinimumTimelockRequired);
        }
        admin.require_auth();
        let config = Config { token, quorum_bps, voting_period, timelock_period, proposal_threshold, admin, guardian, execution_grace_period, paused: false };
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().set(&DataKey::ProposalCount, &0u64);
        Ok(())
    }

    pub fn version(env: Env) -> String {
        String::from_str(&env, env!("CARGO_PKG_VERSION"))
    }

    pub fn create_proposal(env: Env, proposer: Address, title: String, description: String, metadata_uri: String) -> Result<u64, GovernanceError> {
        let config: Config = Self::require_config(&env)?;
        proposer.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config).unwrap();
        
        // Check if contract is paused
        if config.paused {
            return Err(GovernanceError::ContractPaused);
        }
        
        // Validate title: reject empty titles
        if title.len() == 0 {
            return Err(GovernanceError::EmptyTitle);
        }
        
        // Validate title: reject whitespace-only titles by checking if all bytes are whitespace
        let mut has_non_whitespace = false;
        for i in 0..title.len() {
            let byte = title.get(i).unwrap();
            if byte != b' ' && byte != b'\t' && byte != b'\n' && byte != b'\r' {
                has_non_whitespace = true;
                break;
            }
        }
        if !has_non_whitespace {
            return Err(GovernanceError::EmptyTitle);
        }
        
        // Validate title length
        if title.len() > MAX_TITLE_LENGTH {
            return Err(GovernanceError::TitleTooLong);
        }
        
        // Validate description length
        if description.len() > MAX_DESCRIPTION_LENGTH {
            return Err(GovernanceError::DescriptionTooLong);
        }
        
        let count: u64 = env.storage().instance().get(&DataKey::ProposalCount).unwrap_or(0);
        let id = count + 1;
        let current = env.ledger().sequence();
        let token = TokenClient::new(&env, &config.token);

        // Gate proposal creation on a real stake, so spamming the proposal
        // queue costs tokens. Checked against the live balance: the threshold
        // is about who may open a proposal now, unlike voting power, which is
        // fixed at the snapshot.
        if token.balance(&proposer) < config.proposal_threshold {
            return Err(GovernanceError::BelowProposalThreshold);
        }

        let quorum_required =
            Self::quorum_for_supply(token.total_supply(), config.quorum_bps)?;
        // Checked: initialize() accepts any u32 voting_period, so a period
        // near u32::MAX would wrap the window and trap here. A trap would be
        // unrecoverable; Overflow lets proposal creation fail cleanly instead.
        let start_ledger = current
            .checked_add(1)
            .ok_or(GovernanceError::Overflow)?;
        let end_ledger = start_ledger
            .checked_add(config.voting_period)
            .ok_or(GovernanceError::Overflow)?;
        let proposal = Proposal {
            id, proposer, title, description,
            for_votes: 0, against_votes: 0, abstain_votes: 0,
            snapshot_ledger: current,
            start_ledger,
            end_ledger,
            queue_ledger: 0,
            quorum_required,
            status: ProposalStatus::Active,
            metadata_uri: metadata_uri.clone(),
        };
        env.storage().persistent().set(&DataKey::Proposal(id), &proposal);
        env.storage().instance().set(&DataKey::ProposalCount, &id);
        Self::touch_proposal(&env, id);
        Self::touch_instance(&env);

        env.events().publish(
            (Symbol::new(&env, "proposal_created"), id),
            ProposalCreated {
                id,
                proposer: proposal.proposer,
                title: proposal.title,
                start_ledger: proposal.start_ledger,
                end_ledger: proposal.end_ledger,
                quorum_required: proposal.quorum_required,
                metadata_uri,
            },
        );
        Ok(id)
    }

    pub fn vote(env: Env, voter: Address, proposal_id: u64, support: u32) -> Result<(), GovernanceError> {
        let config: Config = Self::require_config(&env)?;
        voter.require_auth();
        if support > 2 { return Err(GovernanceError::InvalidVoteChoice); }
        if env.storage().persistent().has(&DataKey::HasVoted(proposal_id, voter.clone())) {
            return Err(GovernanceError::AlreadyVoted);
        }
        let mut proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id)).ok_or(GovernanceError::ProposalNotFound)?;
        if env.ledger().sequence() > proposal.end_ledger { return Err(GovernanceError::VotingPeriodEnded); }
        if proposal.status != ProposalStatus::Active { return Err(GovernanceError::VotingNotActive); }

        // Power is read at the proposal's snapshot ledger, not live, so tokens
        // bought or borrowed after the proposal opened carry no weight.
        let voting_power = TokenClient::new(&env, &config.token)
            .get_past_balance(&voter, &proposal.snapshot_ledger);
        if voting_power <= 0 { return Err(GovernanceError::NoVotingPower); }

        let tally = match support {
            0 => &mut proposal.against_votes,
            1 => &mut proposal.for_votes,
            _ => &mut proposal.abstain_votes,
        };
        *tally = Self::add_weight(*tally, voting_power)?;
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
        env.storage().persistent().set(&DataKey::HasVoted(proposal_id, voter.clone()), &support);
        Self::touch_proposal(&env, proposal_id);
        Self::touch_vote(&env, proposal_id, &voter);
        Self::touch_instance(&env);

        env.events().publish(
            (Symbol::new(&env, "vote_cast"), proposal_id, voter.clone()),
            VoteCast { proposal_id, voter, support, voting_power },
        );
        Ok(())
    }

    pub fn finalize(env: Env, proposal_id: u64) -> Result<ProposalStatus, GovernanceError> {
        let config: Config = Self::require_config(&env)?;
        let mut proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id)).ok_or(GovernanceError::ProposalNotFound)?;
        if env.ledger().sequence() <= proposal.end_ledger { return Err(GovernanceError::VotingNotActive); }
        let config: Config = env.storage().instance().get(&DataKey::Config).unwrap();
        // Checked, for the same reason as add_weight: honest tallies cannot
        // exceed the supply, but nothing enforces that, and a trap here would
        // be unrecoverable rather than an error a caller can handle.
        let total = proposal
            .for_votes
            .checked_add(proposal.against_votes)
            .and_then(|sum| sum.checked_add(proposal.abstain_votes))
            .ok_or(GovernanceError::Overflow)?;
        let quorum_ok = total >= proposal.quorum_required;
        let majority_for = proposal.for_votes > proposal.against_votes;
        proposal.status = if quorum_ok && majority_for {
            // initialize() accepts any u32 timelock_period; queueing must not
            // wrap the ledger sequence into a trap when it does.
            proposal.queue_ledger = env
                .ledger()
                .sequence()
                .checked_add(config.timelock_period)
                .ok_or(GovernanceError::Overflow)?;
            ProposalStatus::Queued
        } else { ProposalStatus::Failed };
        let status = proposal.status.clone();
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
        Self::touch_proposal(&env, proposal_id);

        env.events().publish(
            (Symbol::new(&env, "proposal_finalized"), proposal_id),
            ProposalFinalized {
                id: proposal_id,
                status: status.clone(),
                for_votes: proposal.for_votes,
                against_votes: proposal.against_votes,
                abstain_votes: proposal.abstain_votes,
            },
        );
        // A second event on the passing path, so indexers can watch the
        // timelock without re-reading the proposal to learn queue_ledger.
        if status == ProposalStatus::Queued {
            env.events().publish(
                (Symbol::new(&env, "proposal_queued"), proposal_id),
                ProposalQueued { id: proposal_id, queue_ledger: proposal.queue_ledger },
            );
        }
        Ok(status)
    }

    pub fn execute(env: Env, executor: Address, proposal_id: u64) -> Result<(), GovernanceError> {
        executor.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config).unwrap();
        
        // Check if contract is paused
        if config.paused {
            return Err(GovernanceError::ContractPaused);
        }
        
        let mut proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id)).ok_or(GovernanceError::ProposalNotFound)?;
        if proposal.status != ProposalStatus::Queued { return Err(GovernanceError::ProposalNotPassed); }
        if env.ledger().sequence() < proposal.queue_ledger { return Err(GovernanceError::TimelockNotExpired); }
        
        // Check if execution grace period has expired
        let execution_deadline = proposal.queue_ledger + config.execution_grace_period;
        if config.execution_grace_period > 0 && env.ledger().sequence() > execution_deadline {
            return Err(GovernanceError::ExecutionExpired);
        }

        // Commit the terminal state before dispatching any proposal actions.
        // Once action calls are added, a callee may synchronously call execute
        // again; it must observe Executed and fail rather than dispatch twice.
        proposal.status = ProposalStatus::Executed;
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
        Self::touch_proposal(&env, proposal_id);
        // TODO: dispatch on-chain actions encoded in proposal

        env.events().publish(
            (Symbol::new(&env, "proposal_executed"), proposal_id),
            ProposalExecuted { id: proposal_id, executor },
        );
        Ok(())
    }

    /// Transfer governance administration. Two-step process for safety.
    /// Only the current admin may initiate the transfer.
    pub fn transfer_admin(env: Env, new_admin: Address) -> Result<(), GovernanceError> {
        let config = Self::get_config(env.clone());
        config.admin.require_auth();
        env.storage().instance().set(&DataKey::PendingAdmin, &new_admin);
        Ok(())
    }

    /// Accept admin role. Called by the pending admin to complete the transfer.
    pub fn accept_admin(env: Env) -> Result<(), GovernanceError> {
        let pending: Address = env.storage().instance().get(&DataKey::PendingAdmin)
            .ok_or(GovernanceError::Unauthorized)?;
        pending.require_auth();
        let mut config = Self::get_config(env.clone());
        config.admin = pending;
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        Ok(())
    }

    pub fn get_proposal(env: Env, id: u64) -> Result<Proposal, GovernanceError> {
        let proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(id))
            .ok_or(GovernanceError::ProposalNotFound)?;
        // Reading keeps an entry alive: an actively watched proposal should not
        // expire just because nobody has voted on it lately.
        Self::touch_proposal(&env, id);
        Ok(proposal)
    }

    pub fn get_proposal_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::ProposalCount).unwrap_or(0)
    }

    pub fn has_voted(env: Env, proposal_id: u64, voter: Address) -> bool {
        env.storage().persistent().has(&DataKey::HasVoted(proposal_id, voter))
    }

    /// The choice `voter` recorded on `proposal_id` — 0 Against, 1 For,
    /// 2 Abstain — or `None` if they have not voted.
    ///
    /// `vote()` already stores the support value; this exposes it so clients
    /// can show *how* a wallet voted rather than only whether it did.
    pub fn get_vote(env: Env, proposal_id: u64, voter: Address) -> Option<u32> {
        env.storage().persistent().get(&DataKey::HasVoted(proposal_id, voter))
    }

    pub fn get_config(env: Env) -> Config {
        Self::require_config(&env).unwrap()
    }

    pub fn cancel(env: Env, caller: Address, proposal_id: u64) -> Result<(), GovernanceError> {
        let config: Config = Self::require_config(&env)?;
        caller.require_auth();
        let mut proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id)).ok_or(GovernanceError::ProposalNotFound)?;
        if caller != proposal.proposer && caller != config.admin {
            return Err(GovernanceError::Unauthorized);
        }
        proposal.status = ProposalStatus::Cancelled;
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
        Self::touch_proposal(&env, proposal_id);

        env.events().publish(
            (Symbol::new(&env, "proposal_cancelled"), proposal_id),
            ProposalCancelled { id: proposal_id, caller },
        );
        Ok(())
    }

    pub fn cancel_admin_transfer(env: Env) -> Result<(), GovernanceError> {
        let config = Self::get_config(env.clone());
        config.admin.require_auth();
        env.storage().instance().remove(&DataKey::PendingAdmin);
        Ok(())
    }

    /// Pause the contract. Only admin or guardian can pause.
    /// Blocks proposal creation and execution.
    pub fn pause(env: Env, caller: Address) -> Result<(), GovernanceError> {
        caller.require_auth();
        let mut config = Self::get_config(env.clone());
        
        if caller != config.admin && caller != config.guardian {
            return Err(GovernanceError::Unauthorized);
        }
        
        config.paused = true;
        env.storage().instance().set(&DataKey::Config, &config);
        
        env.events().publish(
            (Symbol::new(&env, "contract_paused"), caller.clone()),
            ContractPaused { caller },
        );
        Ok(())
    }

    /// Unpause the contract. Only admin can unpause.
    pub fn unpause(env: Env) -> Result<(), GovernanceError> {
        let mut config = Self::get_config(env.clone());
        config.admin.require_auth();
        
        config.paused = false;
        env.storage().instance().set(&DataKey::Config, &config);
        
        env.events().publish(
            (Symbol::new(&env, "contract_unpaused"), config.admin.clone()),
            ContractUnpaused { caller: config.admin },
        );
        Ok(())
    }

    /// Extend the TTL of a proposal without modifying it.
    /// Anyone can pay to keep a proposal alive.
    pub fn extend_proposal_ttl(env: Env, proposal_id: u64) -> Result<(), GovernanceError> {
        // Verify the proposal exists
        let _proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id)).ok_or(GovernanceError::ProposalNotFound)?;
        
        Self::touch_proposal(&env, proposal_id);
        Ok(())
    }

    /// Returns the voting power an address would vote with on a given proposal.
    /// Returns the voter's balance at the proposal's snapshot ledger.
    pub fn get_voting_power(env: Env, proposal_id: u64, voter: Address) -> Result<i128, GovernanceError> {
        let proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id)).ok_or(GovernanceError::ProposalNotFound)?;
        
        let config: Config = env.storage().instance().get(&DataKey::Config).unwrap();
        let voting_power = TokenClient::new(&env, &config.token)
            .get_past_balance(&voter, &proposal.snapshot_ledger);
        
        Ok(voting_power)
    }

    /// Mark a queued proposal as expired if it's past the execution grace period.
    /// Anyone can call this to update the status of an expired proposal.
    pub fn mark_expired(env: Env, proposal_id: u64) -> Result<(), GovernanceError> {
        let mut proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id)).ok_or(GovernanceError::ProposalNotFound)?;
        
        if proposal.status != ProposalStatus::Queued {
            return Err(GovernanceError::ProposalNotPassed);
        }
        
        let config: Config = env.storage().instance().get(&DataKey::Config).unwrap();
        let execution_deadline = proposal.queue_ledger + config.execution_grace_period;
        
        if config.execution_grace_period > 0 && env.ledger().sequence() > execution_deadline {
            proposal.status = ProposalStatus::Expired;
            env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
            Self::touch_proposal(&env, proposal_id);
            Ok(())
        } else {
            Err(GovernanceError::TimelockNotExpired)
        }
    }
}
/// Internal helpers — outside `#[contractimpl]` so they are not exported as
/// contract functions.
impl GovernanceContract {
    /// Returns the config if initialized, otherwise returns NotInitialized error.
    fn require_config(env: &Env) -> Result<Config, GovernanceError> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(GovernanceError::NotInitialized)
    }

    /// Quorum threshold for a given circulating supply: `supply * bps / 10000`.
    ///
    /// Integer division truncates, so the threshold is never rounded up beyond
    /// what the supply supports. Uses checked arithmetic because a large supply
    /// multiplied by `quorum_bps` can exceed `i128::MAX`.
    /// Extends the TTL of a proposal entry so a long voting window cannot
    /// outlive its own storage.
    fn touch_proposal(env: &Env, id: u64) {
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Proposal(id), TTL_THRESHOLD, TTL_EXTEND_TO);
    }

    /// Extends the TTL of a recorded vote, so `has_voted` and `get_vote` keep
    /// answering for as long as the proposal itself survives.
    fn touch_vote(env: &Env, id: u64, voter: &Address) {
        env.storage().persistent().extend_ttl(
            &DataKey::HasVoted(id, voter.clone()),
            TTL_THRESHOLD,
            TTL_EXTEND_TO,
        );
    }

    /// Extends the TTL of instance storage, which holds Config and the proposal
    /// counter. If this expired the contract would lose its configuration.
    fn touch_instance(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
    }

    /// Adds `weight` to a running vote tally.
    ///
    /// Returns `Overflow` rather than trapping. Token supply bounds the sum of
    /// all balances to `i128::MAX`, so an honest tally cannot overflow today —
    /// but nothing in the contract *enforces* that invariant, and a trap in
    /// `vote()` would be an unrecoverable panic rather than an error a caller
    /// can handle.
    fn add_weight(tally: i128, weight: i128) -> Result<i128, GovernanceError> {
        tally.checked_add(weight).ok_or(GovernanceError::Overflow)
    }

    fn quorum_for_supply(total_supply: i128, quorum_bps: u32) -> Result<i128, GovernanceError> {
        total_supply
            .checked_mul(i128::from(quorum_bps))
            .map(|scaled| scaled / BPS_DENOMINATOR)
            .ok_or(GovernanceError::Overflow)
    }
}

#[cfg(test)]
mod test;

// TODO: add delegate() for voting power delegation
// TODO: add get_past_votes(address, ledger) for snapshot-based power
