#![no_std]
// Keep the deployed initialize ABI and its generated Soroban client/args flat.
#![allow(clippy::too_many_arguments)]
#[cfg(test)]
extern crate std;

use soroban_sdk::{contract, contractclient, contractimpl, contracttype, contracterror, Address, BytesN, Env, String, Symbol, Val};

/// Subset of the QUORUM token interface the governor depends on.
///
/// Generates `TokenClient`, used to cross-invoke the token contract at the
/// address held in `Config::token`.
#[contractclient(name = "TokenClient")]
pub trait TokenInterface {
    fn total_supply(env: Env) -> i128;
    fn balance(env: Env, owner: Address) -> i128;
    fn get_past_balance(env: Env, owner: Address, ledger: u32) -> i128;
    fn get_past_votes(env: Env, owner: Address, ledger: u32) -> i128;
    fn get_delegates(env: Env, account: Address) -> Address;
    fn delegate(env: Env, delegator: Address, delegatee: Address);
    fn transfer(env: Env, from: Address, to: Address, amount: i128);
    fn burn(env: Env, from: Address, amount: i128);
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
    EmptyVetoReason         = 24,
    VetoReasonTooLong       = 25,
    VetoWindowClosed        = 26,
    TargetNotAllowed        = 27,
    InvalidCosponsors       = 28,
    InvalidAmount           = 29,
    InsufficientDeposit     = 30,
    NotExecutable           = 31,
    ProposalNotCancellable  = 32,
    ProposerOnCooldown      = 33,
    VotingNotStarted        = 34,
    TooManyActions          = 35,
    ActionFailed            = 36,
    InvalidMaxActiveProposals = 37,
    TooManyActiveProposals  = 38,
}

/// Basis-point denominator: `quorum_bps` of 500 means 5% of total supply.
const BPS_DENOMINATOR: i128 = 10_000;

/// Largest `quorum_bps` that can still be reached. 10000 means "the entire
/// supply must vote", which is a legitimate (if strict) setting; anything
/// above it demands more votes than exist, so no proposal could ever reach
/// quorum and there is no way to recover the parameter.
const MAX_QUORUM_BPS: u32 = 10_000;

/// Ceiling for `get_quorum_progress`, in basis points. Reaching quorum is
/// 10000, and anything beyond it is reported as 10000 too.
const MAX_QUORUM_PROGRESS_BPS: u32 = 10_000;

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

/// Maximum length for a guardian veto justification in bytes.
/// Long enough for a short rationale plus a link to a full write-up.
const MAX_VETO_REASON_LENGTH: u32 = 1_000;

/// Maximum number of actions one proposal may carry. Bounds the work and
/// resources `execute()` spends dispatching them.
const MAX_PROPOSAL_ACTIONS: u32 = 10;

/// Default bound for the active proposal index. Admins may lower or raise it
/// while keeping the current active set within the configured limit.
pub const DEFAULT_MAX_ACTIVE_PROPOSALS: u32 = 25;

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

/// Most co-sponsors a proposal can name. Bounds the auth entries and the
/// storage a single co-sponsored proposal needs.
const MAX_COSPONSORS: u32 = 10;

/// Half-life of conviction support, in ledgers: three days. Each whole
/// half-life that passes halves the support a conviction vote has accumulated.
const CONVICTION_HALF_LIFE: u32 = LEDGERS_PER_DAY * 3;

/// Emitted when the contract is initialized.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractInitialized {
    pub admin: Address,
    pub guardian: Address,
    pub token: Address,
    pub quorum_bps: u32,
    pub voting_period: u32,
    pub timelock_period: u32,
    pub execution_grace_period: u32,
    pub proposal_threshold: i128,
}

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
/// counted — effective delegated power at the snapshot ledger.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VoteCast {
    pub proposal_id: u64,
    pub voter: Address,
    pub support: u32,
    pub voting_power: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Delegated {
    pub delegator: Address,
    pub delegatee: Address,
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

/// Emitted when the guardian vetoes a queued proposal. `reason` gives token
/// holders an on-chain record of why a passed proposal was blocked.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalVetoed {
    pub id: u64,
    pub guardian: Address,
    pub reason: String,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminTransferred {
    pub previous_admin: Address,
    pub new_admin: Address,
}

/// Emitted when the admin replaces the guardian allowed to veto queued proposals.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GuardianChanged {
    pub previous_guardian: Address,
    pub new_guardian: Address,
}

/// Emitted when the admin changes the deposit required to open a proposal.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalDepositUpdated {
    pub amount: i128,
}

/// Emitted when the admin changes how many ledgers a proposer must wait between
/// opening proposals.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposerCooldownUpdated {
    pub ledgers: u32,
}

/// Emitted when a passed proposal's deposit is returned to its proposer.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DepositRefunded {
    pub id: u64,
    pub proposer: Address,
    pub amount: i128,
}

/// Emitted when a failed or cancelled proposal's deposit is burned.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DepositForfeited {
    pub id: u64,
    pub amount: i128,
}

/// Emitted when a contract is added to or removed from the action allowlist.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TargetAllowlistUpdated {
    pub admin: Address,
    pub target: Address,
    pub allowed: bool,
}

/// Emitted when the governance contract WASM is replaced via `upgrade()`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Upgraded {
    pub new_wasm_hash: BytesN<32>,
}

/// Emitted when the proposer attaches the call a proposal makes on execution.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalActionSet {
    pub id: u64,
    pub target: Address,
    pub function: Symbol,
}

/// The status stored with each proposal. `Pending` (before voting opens) and
/// `Passed` are not stored: `get_proposal_phase` derives them from the ledger
/// window and the proposal kind.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalStatus {
    Active, Failed, Queued, Executed, Cancelled, Expired, Vetoed,
}

/// Whether a proposal only expresses an opinion or also dispatches actions.
/// A `Signaling` proposal goes through the same vote and finalize lifecycle,
/// but `execute()` rejects it.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalKind {
    Signaling, Executable,
}

/// The lifecycle stage of a proposal, derived from its stored status and the
/// current ledger. Unlike `ProposalStatus`, `Active` is split into `Pending`
/// (before voting opens) and `Ended` (voting closed, not yet finalized), and
/// `Queued` is split into `Queued` (timelock running) and `ReadyToExecute`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalPhase {
    Pending, Active, Ended, Queued, ReadyToExecute, Passed, Executed, Failed, Cancelled, Expired, Vetoed,
}

/// Running totals over all proposals, maintained as statuses change.
#[contracttype]
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct GovernanceStats {
    pub total_proposals: u64,
    pub active: u64,
    pub queued: u64,
    pub executed: u64,
    pub failed: u64,
    pub cancelled: u64,
    pub expired: u64,
    pub votes_cast: u64,
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
    /// Copied from `Config` when the proposal is created, so a later config
    /// change cannot alter how long this proposal waits before execution.
    pub timelock_period: u32,
    pub status: ProposalStatus,
    pub metadata_uri: String,
    pub kind: ProposalKind,
}

/// One call a proposal makes when it executes: `function` on `target` with `args`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalAction {
    pub target: Address,
    pub function: Symbol,
    pub args: soroban_sdk::Vec<Val>,
}

/// Time-decayed support for a conviction proposal, in vote-weight units.
/// `updated_ledger` is the ledger the two sides were last brought forward to.
#[contracttype]
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ConvictionTally {
    pub for_conviction: i128,
    pub against_conviction: i128,
    pub updated_ledger: u32,
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
    pub proposal_deposit: i128,
    pub proposer_cooldown: u32,
    pub max_active_proposals: u32,
}

#[contracttype]
pub enum DataKey {
    Config,
    ProposalCount,
    ActiveProposals,
    Proposal(u64),
    HasVoted(u64, Address),
    Delegate(Address),
    PendingAdmin,
    ProposerIndex(Address, u64), // (proposer, index) -> proposal_id
    ProposerCount(Address),      // proposer -> count of proposals
    Deposit(u64),                // proposal -> deposit held by the contract
    CoSponsors(u64),             // proposal -> co-sponsor addresses
    Conviction(u64),             // conviction proposal -> ConvictionTally
    ProposalAction(u64),         // proposal -> actions dispatched by execute(), in order
    AllowedTarget(Address),      // contract -> true if an action may call it
    LastProposal(Address),       // proposer -> ledger of their latest proposal
    Stats,
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
        let config = Config { token: token.clone(), quorum_bps, voting_period, timelock_period, proposal_threshold, admin: admin.clone(), guardian: guardian.clone(), execution_grace_period, paused: false, proposal_deposit: 0, proposer_cooldown: 0, max_active_proposals: DEFAULT_MAX_ACTIVE_PROPOSALS };
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().set(&DataKey::ProposalCount, &0u64);

        env.events().publish(
            (Symbol::new(&env, "contract_initialized"),),
            ContractInitialized {
                admin,
                guardian,
                token,
                quorum_bps,
                voting_period,
                timelock_period,
                execution_grace_period,
                proposal_threshold,
            },
        );
        Ok(())
    }

    pub fn version(env: Env) -> String {
        String::from_str(&env, env!("CARGO_PKG_VERSION"))
    }

    pub fn create_proposal(env: Env, proposer: Address, title: String, description: String, metadata_uri: String) -> Result<u64, GovernanceError> {
        let cosponsors = soroban_sdk::Vec::new(&env);
        Self::open_proposal(&env, proposer, &cosponsors, title, description, metadata_uri, false)
    }

    /// As `create_proposal`, but `cosponsors` authorize the same transaction and
    /// their live balances count toward the proposal threshold. See the README.
    pub fn create_cosponsored_proposal(env: Env, proposer: Address, cosponsors: soroban_sdk::Vec<Address>, title: String, description: String, metadata_uri: String) -> Result<u64, GovernanceError> {
        Self::open_proposal(&env, proposer, &cosponsors, title, description, metadata_uri, false)
    }

    /// As `create_proposal`, but the proposal is decided on time-decayed support
    /// rather than on the raw For and Against totals. See the README for the
    /// accumulation and decay rules.
    pub fn create_conviction_proposal(env: Env, proposer: Address, title: String, description: String, metadata_uri: String) -> Result<u64, GovernanceError> {
        let cosponsors = soroban_sdk::Vec::new(&env);
        Self::open_proposal(&env, proposer, &cosponsors, title, description, metadata_uri, true)
    }

    /// Records `voter`'s choice on `proposal_id`.
    ///
    /// While the window is open a voter may call again to change their choice;
    /// the weight counted for the earlier choice is moved out of its tally
    /// first. After `end_ledger` a repeat call is rejected with `AlreadyVoted`.
    pub fn vote(env: Env, voter: Address, proposal_id: u64, support: u32) -> Result<(), GovernanceError> {
        let config: Config = Self::require_config(&env)?;
        voter.require_auth();
        if support > 2 { return Err(GovernanceError::InvalidVoteChoice); }
        let mut proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id)).ok_or(GovernanceError::ProposalNotFound)?;
        let previous: Option<u32> = env.storage().persistent()
            .get(&DataKey::HasVoted(proposal_id, voter.clone()));
        if env.ledger().sequence() > proposal.end_ledger {
            return Err(if previous.is_some() {
                GovernanceError::AlreadyVoted
            } else {
                GovernanceError::VotingPeriodEnded
            });
        }
        if proposal.status != ProposalStatus::Active { return Err(GovernanceError::VotingNotActive); }
        // The snapshot ledger must close before anyone votes. Otherwise a
        // holder could vote, re-delegate within that same ledger, and let the
        // recipient vote the same weight again as its checkpoint changes.
        if env.ledger().sequence() < proposal.start_ledger { return Err(GovernanceError::VotingNotStarted); }

        // Power is read at the proposal's snapshot ledger, not live, so tokens
        // bought or borrowed after the proposal opened carry no weight.
        let voting_power = TokenClient::new(&env, &config.token)
            .get_past_votes(&voter, &proposal.snapshot_ledger);
        if voting_power <= 0 { return Err(GovernanceError::NoVotingPower); }

        // Remove the earlier choice's weight before counting the new one. The
        // snapshot closed when voting opened, so this read returns the same
        // weight that was counted then.
        if let Some(previous_support) = previous {
            let previous_tally = Self::tally_mut(&mut proposal, previous_support);
            *previous_tally = Self::remove_weight(*previous_tally, voting_power)?;
        }
        let tally = Self::tally_mut(&mut proposal, support);
        *tally = Self::add_weight(*tally, voting_power)?;

        // Conviction proposals also keep time-decayed support. Abstentions are
        // not part of the conviction majority, so they add nothing here.
        let conviction_key = DataKey::Conviction(proposal_id);
        if let Some(stored) = env.storage().persistent().get::<DataKey, ConvictionTally>(&conviction_key) {
            let mut conviction = Self::decay_to(&stored, env.ledger().sequence());
            match support {
                0 => conviction.against_conviction = Self::add_weight(conviction.against_conviction, voting_power)?,
                1 => conviction.for_conviction = Self::add_weight(conviction.for_conviction, voting_power)?,
                _ => {}
            }
            env.storage().persistent().set(&conviction_key, &conviction);
            Self::touch_persistent(&env, &conviction_key);
        }

        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
        env.storage().persistent().set(&DataKey::HasVoted(proposal_id, voter.clone()), &support);
        Self::touch_proposal(&env, proposal_id);
        Self::touch_vote(&env, proposal_id, &voter);
        Self::touch_instance(&env);
        Self::update_stats(&env, |stats| {
            stats.votes_cast = stats.votes_cast.saturating_add(1);
        });

        env.events().publish(
            (Symbol::new(&env, "vote_cast"), proposal_id, voter.clone()),
            VoteCast { proposal_id, voter, support, voting_power },
        );
        Ok(())
    }

    /// Delegation is owned by the token so transfers and delegation share the
    /// same checkpoint history. This facade preserves the governance API.
    pub fn delegate(env: Env, delegator: Address, delegatee: Address) -> Result<(), GovernanceError> {
        let config = Self::require_config(&env)?;
        delegator.require_auth();
        let token = TokenClient::new(&env, &config.token);
        let previous = token.get_delegates(&delegator);
        match token.try_delegate(&delegator, &delegatee) {
            Ok(Ok(())) => (),
            Err(Ok(error)) => {
                // TokenError::Overflow is 6; keep the governor's public code.
                if error == soroban_sdk::Error::from_contract_error(6) {
                    return Err(GovernanceError::Overflow);
                }
                env.panic_with_error(error);
            }
            _ => panic!("token delegation invocation failed"),
        }
        let delegatee = token.get_delegates(&delegator);
        // Record facade calls for compatibility, but never resolve votes or
        // views from this mapping: users may also delegate directly on token.
        let key = DataKey::Delegate(delegator.clone());
        if delegatee == delegator {
            env.storage().persistent().remove(&key);
        } else {
            env.storage().persistent().set(&key, &delegatee);
            env.storage().persistent().extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        }
        Self::touch_instance(&env);
        if previous != delegatee {
            env.events().publish(
                (Symbol::new(&env, "delegated"), delegator.clone(), delegatee.clone()),
                Delegated { delegator, delegatee },
            );
        }
        Ok(())
    }

    pub fn undelegate(env: Env, delegator: Address) -> Result<(), GovernanceError> {
        Self::delegate(env, delegator.clone(), delegator)
    }

    pub fn get_delegate(env: Env, account: Address) -> Result<Address, GovernanceError> {
        let config = Self::require_config(&env)?;
        Self::touch_instance(&env);
        Ok(TokenClient::new(&env, &config.token).get_delegates(&account))
    }

    pub fn get_past_votes(env: Env, account: Address, ledger: u32) -> Result<i128, GovernanceError> {
        let config = Self::require_config(&env)?;
        Self::touch_instance(&env);
        Ok(TokenClient::new(&env, &config.token).get_past_votes(&account, &ledger))
    }

    pub fn finalize(env: Env, proposal_id: u64) -> Result<ProposalStatus, GovernanceError> {
        let config: Config = Self::require_config(&env)?;
        let mut proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id)).ok_or(GovernanceError::ProposalNotFound)?;
        if env.ledger().sequence() <= proposal.end_ledger { return Err(GovernanceError::VotingNotActive); }
        // Only an open proposal can be decided. Without this, finalize() could
        // re-tally a Vetoed, Cancelled or Executed proposal back into Queued.
        if proposal.status != ProposalStatus::Active { return Err(GovernanceError::VotingNotActive); }
        // Checked, for the same reason as add_weight: honest tallies cannot
        // exceed the supply, but nothing enforces that, and a trap here would
        // be unrecoverable rather than an error a caller can handle.
        let total = Self::total_votes(&proposal)?;
        let quorum_ok = total >= proposal.quorum_required;
        // Conviction proposals are decided on their support decayed to the close
        // of voting, so the result does not depend on when finalize() is called.
        let majority_for = match env.storage().persistent().get::<DataKey, ConvictionTally>(&DataKey::Conviction(proposal_id)) {
            Some(stored) => {
                let at_close = Self::decay_to(&stored, proposal.end_ledger);
                at_close.for_conviction > at_close.against_conviction
            }
            None => proposal.for_votes > proposal.against_votes,
        };
        let previous = proposal.status.clone();
        proposal.status = if quorum_ok && majority_for {
            // initialize() accepts any u32 timelock_period; queueing must not
            // wrap the ledger sequence into a trap when it does. The delay is
            // the one captured at creation, not the live config value.
            proposal.queue_ledger = env
                .ledger()
                .sequence()
                .checked_add(proposal.timelock_period)
                .ok_or(GovernanceError::Overflow)?;
            ProposalStatus::Queued
        } else { ProposalStatus::Failed };
        let status = proposal.status.clone();
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
        Self::remove_active_proposal(&env, proposal_id);
        Self::touch_proposal(&env, proposal_id);
        Self::record_status_change(&env, &previous, &status);

        // A passed proposal gets its deposit back; a failed one forfeits it.
        match status {
            ProposalStatus::Queued => Self::refund_deposit(&env, &config.token, &proposal),
            ProposalStatus::Failed => Self::forfeit_deposit(&env, &config.token, proposal_id),
            _ => {}
        }

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

        let active = env.storage().persistent().get::<DataKey, soroban_sdk::Vec<u64>>(&DataKey::ActiveProposals).unwrap_or_else(|| soroban_sdk::Vec::new(env));
        if active.len() >= config.max_active_proposals {
            return Err(GovernanceError::TooManyActiveProposals);
        }

        let mut proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id)).ok_or(GovernanceError::ProposalNotFound)?;
        if proposal.status != ProposalStatus::Queued { return Err(GovernanceError::ProposalNotPassed); }
        // A signaling proposal carries no actions, so there is nothing to run.
        if proposal.kind == ProposalKind::Signaling { return Err(GovernanceError::NotExecutable); }
        if env.ledger().sequence() < proposal.queue_ledger { return Err(GovernanceError::TimelockNotExpired); }

        // Check if execution grace period has expired
        let execution_deadline = proposal.queue_ledger + config.execution_grace_period;
        if config.execution_grace_period > 0 && env.ledger().sequence() > execution_deadline {
            return Err(GovernanceError::ExecutionExpired);
        }

        // Re-check the allowlist now, since it may have changed since the actions
        // were attached. Checked before Executed is committed, so a rejected call
        // leaves the proposal Queued.
        let actions: soroban_sdk::Vec<ProposalAction> = env.storage().persistent()
            .get(&DataKey::ProposalAction(proposal_id))
            .unwrap_or_else(|| soroban_sdk::Vec::new(&env));
        for action in actions.iter() {
            if !Self::target_allowed(&env, &action.target) {
                return Err(GovernanceError::TargetNotAllowed);
            }
        }

        // Commit the terminal state before dispatching any proposal actions.
        // A callee may synchronously call execute again; it must observe
        // Executed and fail rather than dispatch twice.
        proposal.status = ProposalStatus::Executed;
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
        Self::touch_proposal(&env, proposal_id);

        // A failing action returns an error instead of trapping. Returning Err
        // rolls back this whole invocation, so the proposal stays Queued and
        // no earlier action's effects are kept.
        for action in actions.iter() {
            let result = env.try_invoke_contract::<Val, soroban_sdk::Error>(&action.target, &action.function, action.args.clone());
            if !matches!(result, Ok(Ok(_))) {
                return Err(GovernanceError::ActionFailed);
            }
        }

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

    /// Returns the IDs of proposals currently in the Active voting state.
    /// The list is maintained on create, finalize, and cancel, so callers do
    /// not need to fetch and filter the full proposal history.
    pub fn get_active_proposals(env: Env) -> soroban_sdk::Vec<u64> {
        let key = DataKey::ActiveProposals;
        let active = env.storage().persistent().get(&key).unwrap_or_else(|| soroban_sdk::Vec::new(&env));
        if env.storage().persistent().has(&key) {
            Self::touch_persistent(&env, &key);
        }
        active
    }

    /// Returns a paginated list of proposals.
    /// `start` is the first proposal ID to return (1-indexed).
    /// `limit` is bounded to prevent resource exhaustion.
    /// Returns an empty vector if start is beyond the last proposal.
    pub fn get_proposals(env: Env, start: u64, limit: u32) -> Result<soroban_sdk::Vec<Proposal>, GovernanceError> {
        const MAX_PAGE_SIZE: u32 = 100;
        let bounded_limit = if limit > MAX_PAGE_SIZE { MAX_PAGE_SIZE } else { limit };

        let count = Self::get_proposal_count(env.clone());
        let mut proposals = soroban_sdk::Vec::new(&env);

        if start < 1 || start > count {
            return Ok(proposals); // Empty page for out-of-range start
        }

        let end = start.saturating_add(u64::from(bounded_limit)).min(count + 1);

        for id in start..end {
            if let Ok(proposal) = Self::get_proposal(env.clone(), id) {
                proposals.push_back(proposal);
            }
        }

        Ok(proposals)
    }

    /// Returns all proposals opened by a specific address.
    /// Returns an empty vector if the address has never proposed.
    pub fn get_proposals_by_proposer(env: Env, proposer: Address) -> soroban_sdk::Vec<Proposal> {
        let mut proposals = soroban_sdk::Vec::new(&env);
        let count: u64 = env.storage().persistent()
            .get(&DataKey::ProposerCount(proposer.clone()))
            .unwrap_or(0);

        for i in 1..=count {
            if let Some(proposal_id) = env.storage().persistent()
                .get::<DataKey, u64>(&DataKey::ProposerIndex(proposer.clone(), i)) {
                if let Ok(proposal) = Self::get_proposal(env.clone(), proposal_id) {
                    proposals.push_back(proposal);
                }
            }
        }

        proposals
    }

    pub fn has_voted(env: Env, proposal_id: u64, voter: Address) -> bool {
        env.storage().persistent().has(&DataKey::HasVoted(proposal_id, voter))
    }

    /// Returns whether a proposal has reached quorum.
    /// Uses the same comparison logic as finalize().
    pub fn has_reached_quorum(env: Env, proposal_id: u64) -> Result<bool, GovernanceError> {
        let proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(GovernanceError::ProposalNotFound)?;

        // Same quorum check as finalize()
        let total = proposal
            .for_votes
            .checked_add(proposal.against_votes)
            .and_then(|sum| sum.checked_add(proposal.abstain_votes))
            .ok_or(GovernanceError::Overflow)?;

        Ok(total >= proposal.quorum_required)
    }

    /// Share of the quorum requirement that has voted so far, in basis points:
    /// 5000 means half of quorum. Capped at 10000, so a proposal that has met or
    /// exceeded quorum reports 10000. Uses the same tally as `finalize()`.
    pub fn get_quorum_progress(env: Env, id: u64) -> Result<u32, GovernanceError> {
        let proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(id)).ok_or(GovernanceError::ProposalNotFound)?;
        // A zero requirement (zero supply) is met by any tally, including none.
        if proposal.quorum_required <= 0 {
            return Ok(MAX_QUORUM_PROGRESS_BPS);
        }
        let total = Self::total_votes(&proposal)?;
        let progress = total
            .checked_mul(BPS_DENOMINATOR)
            .ok_or(GovernanceError::Overflow)?
            / proposal.quorum_required;
        u32::try_from(progress.min(i128::from(MAX_QUORUM_PROGRESS_BPS)))
            .map_err(|_| GovernanceError::Overflow)
    }

    /// The lifecycle phase of a proposal at the current ledger. Read-only: it
    /// computes the phase from the stored status and ledger window, so a
    /// proposal whose grace period has lapsed reports `Expired` before anyone
    /// calls `mark_expired()`.
    pub fn get_proposal_phase(env: Env, id: u64) -> Result<ProposalPhase, GovernanceError> {
        let proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(id)).ok_or(GovernanceError::ProposalNotFound)?;
        let config: Config = Self::require_config(&env)?;
        Ok(Self::phase_of(&proposal, env.ledger().sequence(), config.execution_grace_period))
    }

    /// Governance-wide counters, read in O(1). They are maintained by the calls
    /// that create, vote on, finalize, execute, cancel or expire a proposal, and
    /// start at zero on deployment. Proposals made by a deployment that predates
    /// these counters are not included.
    pub fn get_governance_stats(env: Env) -> GovernanceStats {
        env.storage().instance().get(&DataKey::Stats).unwrap_or_default()
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

    /// Sets the amount a proposer must lock when opening a proposal. Zero turns
    /// the deposit off. Admin only. Each proposal keeps the amount it opened with.
    pub fn set_proposal_deposit(env: Env, amount: i128) -> Result<(), GovernanceError> {
        let mut config: Config = Self::require_config(&env)?;
        config.admin.require_auth();
        if amount < 0 {
            return Err(GovernanceError::InvalidAmount);
        }
        config.proposal_deposit = amount;
        env.storage().instance().set(&DataKey::Config, &config);
        Self::touch_instance(&env);

        env.events().publish(
            (Symbol::new(&env, "proposal_deposit_updated"),),
            ProposalDepositUpdated { amount },
        );
        Ok(())
    }

    /// Sets how many ledgers a proposer must wait after opening a proposal before
    /// they may open another. Zero turns the cooldown off. Admin only. The change
    /// applies to proposals opened after it.
    pub fn set_proposer_cooldown(env: Env, ledgers: u32) -> Result<(), GovernanceError> {
        let mut config: Config = Self::require_config(&env)?;
        config.admin.require_auth();
        config.proposer_cooldown = ledgers;
        env.storage().instance().set(&DataKey::Config, &config);
        Self::touch_instance(&env);

        env.events().publish(
            (Symbol::new(&env, "proposer_cooldown_updated"),),
            ProposerCooldownUpdated { ledgers },
        );
        Ok(())
    }

    /// Sets the maximum number of concurrently Active proposals. Admin only;
    /// the limit cannot be lowered below the current active set.
    pub fn set_max_active_proposals(env: Env, max: u32) -> Result<(), GovernanceError> {
        let mut config: Config = Self::require_config(&env)?;
        config.admin.require_auth();
        let active = env.storage().persistent().get::<DataKey, soroban_sdk::Vec<u64>>(&DataKey::ActiveProposals).unwrap_or_else(|| soroban_sdk::Vec::new(&env));
        if max == 0 || max < active.len() {
            return Err(GovernanceError::InvalidMaxActiveProposals);
        }
        config.max_active_proposals = max;
        env.storage().instance().set(&DataKey::Config, &config);
        Self::touch_instance(&env);
        Ok(())
    }

    /// Replaces the guardian that may veto queued proposals. Admin only. Takes
    /// effect at once, so a compromised guardian can be rotated out mid-timelock.
    pub fn set_guardian(env: Env, new_guardian: Address) -> Result<(), GovernanceError> {
        let mut config: Config = Self::require_config(&env)?;
        config.admin.require_auth();
        let previous_guardian = config.guardian.clone();
        config.guardian = new_guardian.clone();
        env.storage().instance().set(&DataKey::Config, &config);
        Self::touch_instance(&env);

        env.events().publish(
            (Symbol::new(&env, "guardian_changed"),),
            GuardianChanged { previous_guardian, new_guardian },
        );
        Ok(())
    }

    /// Adds `target` to the allowlist of contracts that proposal actions may
    /// call. Admin only.
    pub fn allow_target(env: Env, target: Address) -> Result<(), GovernanceError> {
        Self::set_target_allowed(&env, target, true)
    }

    /// Removes `target` from the allowlist. Admin only. An action already
    /// attached to a proposal fails at execution while its target is off the list.
    pub fn disallow_target(env: Env, target: Address) -> Result<(), GovernanceError> {
        Self::set_target_allowed(&env, target, false)
    }

    pub fn is_target_allowed(env: Env, target: Address) -> bool {
        Self::target_allowed(&env, &target)
    }

    /// The actions `proposal_id` dispatches on execution, in order. Empty if none were attached.
    pub fn get_proposal_actions(env: Env, proposal_id: u64) -> soroban_sdk::Vec<ProposalAction> {
        env.storage()
            .persistent()
            .get(&DataKey::ProposalAction(proposal_id))
            .unwrap_or_else(|| soroban_sdk::Vec::new(&env))
    }

    /// Appends a call the proposal makes when it executes. Calling it again adds
    /// another action, up to `MAX_PROPOSAL_ACTIONS`; `execute()` runs them in the
    /// order they were added. Only the proposer may add actions, and only while
    /// voting is open. The target must be allowlisted now, and `execute()` checks
    /// it again.
    pub fn set_proposal_action(env: Env, proposer: Address, proposal_id: u64, target: Address, function: Symbol, args: soroban_sdk::Vec<Val>) -> Result<(), GovernanceError> {
        proposer.require_auth();
        let proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id)).ok_or(GovernanceError::ProposalNotFound)?;
        if proposer != proposal.proposer {
            return Err(GovernanceError::Unauthorized);
        }
        if env.ledger().sequence() > proposal.end_ledger { return Err(GovernanceError::VotingPeriodEnded); }
        if proposal.status != ProposalStatus::Active { return Err(GovernanceError::VotingNotActive); }
        if !Self::target_allowed(&env, &target) {
            return Err(GovernanceError::TargetNotAllowed);
        }

        let key = DataKey::ProposalAction(proposal_id);
        let mut actions: soroban_sdk::Vec<ProposalAction> = env.storage().persistent()
            .get(&key)
            .unwrap_or_else(|| soroban_sdk::Vec::new(&env));
        if actions.len() >= MAX_PROPOSAL_ACTIONS {
            return Err(GovernanceError::TooManyActions);
        }
        actions.push_back(ProposalAction { target: target.clone(), function: function.clone(), args });
        env.storage().persistent().set(&key, &actions);
        Self::touch_persistent(&env, &key);

        env.events().publish(
            (Symbol::new(&env, "proposal_action_set"), proposal_id),
            ProposalActionSet { id: proposal_id, target, function },
        );
        Ok(())
    }

    /// The co-sponsors named when `proposal_id` was opened. Empty if it had none.
    pub fn get_cosponsors(env: Env, proposal_id: u64) -> soroban_sdk::Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::CoSponsors(proposal_id))
            .unwrap_or_else(|| soroban_sdk::Vec::new(&env))
    }

    /// The conviction tally of a conviction proposal, decayed to the current
    /// ledger. `None` for a standard proposal.
    pub fn get_conviction(env: Env, proposal_id: u64) -> Option<ConvictionTally> {
        let stored: ConvictionTally = env.storage().persistent().get(&DataKey::Conviction(proposal_id))?;
        Some(Self::decay_to(&stored, env.ledger().sequence()))
    }

    /// Cancels a proposal while its voting window is still open. Only the
    /// proposer or the admin may cancel, and only an `Active` proposal that has
    /// not passed its `end_ledger`. Anything else, including a proposal that is
    /// already executed, queued, failed or cancelled, fails with
    /// `ProposalNotCancellable`.
    pub fn cancel(env: Env, caller: Address, proposal_id: u64) -> Result<(), GovernanceError> {
        let config: Config = Self::require_config(&env)?;
        caller.require_auth();
        let mut proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id)).ok_or(GovernanceError::ProposalNotFound)?;
        if caller != proposal.proposer && caller != config.admin {
            return Err(GovernanceError::Unauthorized);
        }
        if proposal.status != ProposalStatus::Active || env.ledger().sequence() > proposal.end_ledger {
            return Err(GovernanceError::ProposalNotCancellable);
        }
        proposal.status = ProposalStatus::Cancelled;
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
        Self::remove_active_proposal(&env, proposal_id);
        Self::touch_proposal(&env, proposal_id);
        // A cancelled proposal forfeits any deposit it still holds. One that
        // already passed had its deposit refunded at queueing, so nothing is left.
        Self::forfeit_deposit(&env, &config.token, proposal_id);

        env.events().publish(
            (Symbol::new(&env, "proposal_cancelled"), proposal_id),
            ProposalCancelled { id: proposal_id, caller },
        );
        Ok(())
    }

    /// Guardian veto during the timelock window. Only the guardian may call
    /// this, only on a Queued proposal, and only before `queue_ledger`.
    /// `reason` is required and is emitted with the event so the veto is
    /// auditable on-chain.
    pub fn veto(env: Env, caller: Address, proposal_id: u64, reason: String) -> Result<(), GovernanceError> {
        let config: Config = Self::require_config(&env)?;
        caller.require_auth();
        if caller != config.guardian {
            return Err(GovernanceError::Unauthorized);
        }
        if reason.is_empty() {
            return Err(GovernanceError::EmptyVetoReason);
        }
        if reason.len() > MAX_VETO_REASON_LENGTH {
            return Err(GovernanceError::VetoReasonTooLong);
        }
        let mut proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id)).ok_or(GovernanceError::ProposalNotFound)?;
        if proposal.status != ProposalStatus::Queued { return Err(GovernanceError::ProposalNotPassed); }
        if env.ledger().sequence() >= proposal.queue_ledger { return Err(GovernanceError::VetoWindowClosed); }

        proposal.status = ProposalStatus::Vetoed;
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
        Self::touch_proposal(&env, proposal_id);

        env.events().publish(
            (Symbol::new(&env, "proposal_vetoed"), proposal_id),
            ProposalVetoed { id: proposal_id, guardian: caller, reason },
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

    /// Replace the governance contract's WASM bytecode.
    ///
    /// Only the admin may call this. In production the admin should be the
    /// governance contract itself, so an upgrade only happens after a passed
    /// and executed governance proposal unlocks it. `new_wasm_hash` must be
    /// the hash of a WASM binary already uploaded to the network.
    pub fn upgrade(env: Env, caller: Address, new_wasm_hash: BytesN<32>) -> Result<(), GovernanceError> {
        let config = Self::require_config(&env)?;
        caller.require_auth();
        if caller != config.admin {
            return Err(GovernanceError::Unauthorized);
        }
        env.deployer().update_current_contract_wasm(new_wasm_hash.clone());
        env.events().publish(
            (Symbol::new(&env, "upgraded"),),
            Upgraded { new_wasm_hash },
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
    /// Returns effective delegated weight at the proposal's snapshot ledger.
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
            Self::record_status_change(&env, &ProposalStatus::Queued, &ProposalStatus::Expired);
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

    /// Shared body of the proposal constructors.
    ///
    /// Checks the co-sponsors, sums their live balances with the proposer's
    /// against `proposal_threshold`, takes the proposer's deposit if one is set,
    /// and records the optional co-sponsors, deposit and conviction flag.
    fn open_proposal(env: &Env, proposer: Address, cosponsors: &soroban_sdk::Vec<Address>, title: String, description: String, metadata_uri: String, conviction: bool) -> Result<u64, GovernanceError> {
        let config: Config = Self::require_config(env)?;
        proposer.require_auth();
        Self::validate_cosponsors(cosponsors, &proposer)?;
        for i in 0..cosponsors.len() {
            cosponsors.get(i).ok_or(GovernanceError::InvalidCosponsors)?.require_auth();
        }

        // Check if contract is paused
        if config.paused {
            return Err(GovernanceError::ContractPaused);
        }

        // Validate title: reject empty titles
        if title.is_empty() {
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

        // A proposer who opened a proposal recently waits `proposer_cooldown`
        // ledgers before opening another. Zero leaves the check a no-op, since
        // the ledger sequence never moves backwards.
        if let Some(last) = env.storage().persistent().get::<DataKey, u32>(&DataKey::LastProposal(proposer.clone())) {
            if env.ledger().sequence() < last.saturating_add(config.proposer_cooldown) {
                return Err(GovernanceError::ProposerOnCooldown);
            }
        }

        let count: u64 = env.storage().instance().get(&DataKey::ProposalCount).unwrap_or(0);
        let id = count + 1;
        let current = env.ledger().sequence();
        let token = TokenClient::new(env, &config.token);

        // Gate proposal creation on a real stake, so spamming the proposal
        // queue costs tokens. Checked against the live balances: the threshold
        // is about who may open a proposal now, unlike voting power, which is
        // fixed at the snapshot. With no co-sponsors this is the proposer alone.
        let proposer_balance = token.balance(&proposer);
        let mut combined = proposer_balance;
        for i in 0..cosponsors.len() {
            let sponsor = cosponsors.get(i).ok_or(GovernanceError::InvalidCosponsors)?;
            combined = Self::add_weight(combined, token.balance(&sponsor))?;
        }
        if combined < config.proposal_threshold {
            return Err(GovernanceError::BelowProposalThreshold);
        }
        // The deposit is separate from the threshold: it is paid out of the
        // proposer's balance and is not part of the combined stake above.
        if proposer_balance < config.proposal_deposit {
            return Err(GovernanceError::InsufficientDeposit);
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
            id, proposer: proposer.clone(), title, description,
            for_votes: 0, against_votes: 0, abstain_votes: 0,
            snapshot_ledger: current,
            start_ledger,
            end_ledger,
            queue_ledger: 0,
            quorum_required,
            timelock_period: config.timelock_period,
            status: ProposalStatus::Active,
            metadata_uri: metadata_uri.clone(),
            kind: ProposalKind::Executable,
        };
        env.storage().persistent().set(&DataKey::Proposal(id), &proposal);
        env.storage().instance().set(&DataKey::ProposalCount, &id);
        Self::add_active_proposal(env, id);

        if config.proposal_deposit > 0 {
            token.transfer(&proposer, &env.current_contract_address(), &config.proposal_deposit);
            let deposit_key = DataKey::Deposit(id);
            env.storage().persistent().set(&deposit_key, &config.proposal_deposit);
            Self::touch_persistent(env, &deposit_key);
        }
        if conviction {
            let conviction_key = DataKey::Conviction(id);
            env.storage().persistent().set(
                &conviction_key,
                &ConvictionTally { updated_ledger: current, ..Default::default() },
            );
            Self::touch_persistent(env, &conviction_key);
        }
        if !cosponsors.is_empty() {
            let cosponsors_key = DataKey::CoSponsors(id);
            env.storage().persistent().set(&cosponsors_key, cosponsors);
            Self::touch_persistent(env, &cosponsors_key);
        }

        // Index proposal by proposer
        let proposer_count: u64 = env.storage().persistent()
            .get(&DataKey::ProposerCount(proposer.clone()))
            .unwrap_or(0);
        let new_count = proposer_count + 1;
        env.storage().persistent().set(&DataKey::ProposerIndex(proposer.clone(), new_count), &id);
        env.storage().persistent().set(&DataKey::ProposerCount(proposer.clone()), &new_count);

        let last_key = DataKey::LastProposal(proposer.clone());
        env.storage().persistent().set(&last_key, &current);
        Self::touch_persistent(env, &last_key);

        Self::touch_proposal(env, id);
        Self::touch_instance(env);

        env.events().publish(
            (Symbol::new(env, "proposal_created"), id),
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

    /// Co-sponsors must be distinct from one another and from the proposer, and
    /// there may be at most `MAX_COSPONSORS` of them.
    fn validate_cosponsors(cosponsors: &soroban_sdk::Vec<Address>, proposer: &Address) -> Result<(), GovernanceError> {
        if cosponsors.len() > MAX_COSPONSORS {
            return Err(GovernanceError::InvalidCosponsors);
        }
        for i in 0..cosponsors.len() {
            let sponsor = cosponsors.get(i).ok_or(GovernanceError::InvalidCosponsors)?;
            if sponsor == *proposer {
                return Err(GovernanceError::InvalidCosponsors);
            }
            for j in 0..i {
                if cosponsors.get(j).ok_or(GovernanceError::InvalidCosponsors)? == sponsor {
                    return Err(GovernanceError::InvalidCosponsors);
                }
            }
        }
        Ok(())
    }

    fn set_target_allowed(env: &Env, target: Address, allowed: bool) -> Result<(), GovernanceError> {
        let config: Config = Self::require_config(env)?;
        config.admin.require_auth();
        let key = DataKey::AllowedTarget(target.clone());
        if allowed {
            env.storage().persistent().set(&key, &true);
            Self::touch_persistent(env, &key);
        } else {
            env.storage().persistent().remove(&key);
        }
        Self::touch_instance(env);

        env.events().publish(
            (Symbol::new(env, "target_allowlist_updated"), target.clone()),
            TargetAllowlistUpdated { admin: config.admin, target, allowed },
        );
        Ok(())
    }

    fn target_allowed(env: &Env, target: &Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::AllowedTarget(target.clone()))
            .unwrap_or(false)
    }

    /// Returns the deposit held for `proposal` to its proposer, if one is held.
    fn refund_deposit(env: &Env, token: &Address, proposal: &Proposal) {
        if let Some(amount) = Self::take_deposit(env, proposal.id) {
            TokenClient::new(env, token).transfer(&env.current_contract_address(), &proposal.proposer, &amount);
            env.events().publish(
                (Symbol::new(env, "deposit_refunded"), proposal.id),
                DepositRefunded { id: proposal.id, proposer: proposal.proposer.clone(), amount },
            );
        }
    }

    /// Burns the deposit held for `proposal_id`, if one is held.
    fn forfeit_deposit(env: &Env, token: &Address, proposal_id: u64) {
        if let Some(amount) = Self::take_deposit(env, proposal_id) {
            TokenClient::new(env, token).burn(&env.current_contract_address(), &amount);
            env.events().publish(
                (Symbol::new(env, "deposit_forfeited"), proposal_id),
                DepositForfeited { id: proposal_id, amount },
            );
        }
    }

    /// Clears and returns the deposit recorded for `proposal_id`. The record is
    /// removed before any transfer, so a deposit can only move once.
    fn take_deposit(env: &Env, proposal_id: u64) -> Option<i128> {
        let key = DataKey::Deposit(proposal_id);
        let amount: Option<i128> = env.storage().persistent().get(&key);
        if amount.is_some() {
            env.storage().persistent().remove(&key);
        }
        amount
    }

    /// Brings a conviction tally forward to ledger `now`. Each side is halved
    /// once for every whole `CONVICTION_HALF_LIFE` since it was last written, so
    /// support decays in steps. A shift of 128 or more leaves nothing.
    fn decay_to(tally: &ConvictionTally, now: u32) -> ConvictionTally {
        let halvings = now.saturating_sub(tally.updated_ledger) / CONVICTION_HALF_LIFE;
        ConvictionTally {
            for_conviction: tally.for_conviction.checked_shr(halvings).unwrap_or(0),
            against_conviction: tally.against_conviction.checked_shr(halvings).unwrap_or(0),
            updated_ledger: now,
        }
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

    /// Extends the TTL of a persistent entry that the helpers above do not cover.
    fn touch_persistent(env: &Env, key: &DataKey) {
        env.storage().persistent().extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }

    fn add_active_proposal(env: &Env, id: u64) {
        let key = DataKey::ActiveProposals;
        let mut active = env.storage().persistent().get(&key).unwrap_or_else(|| soroban_sdk::Vec::new(env));
        active.push_back(id);
        env.storage().persistent().set(&key, &active);
        Self::touch_persistent(env, &key);
    }

    fn remove_active_proposal(env: &Env, id: u64) {
        let key = DataKey::ActiveProposals;
        let Some(mut active) = env.storage().persistent().get::<DataKey, soroban_sdk::Vec<u64>>(&key) else { return; };
        if let Some(index) = active.first_index_of(id) {
            active.remove(index);
            env.storage().persistent().set(&key, &active);
            Self::touch_persistent(env, &key);
        }
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

    /// Takes `weight` back out of a running vote tally. A tally that would go
    /// negative means the recorded weight and the tally disagree, so it is
    /// refused rather than wrapped.
    fn remove_weight(tally: i128, weight: i128) -> Result<i128, GovernanceError> {
        tally
            .checked_sub(weight)
            .filter(|remaining| *remaining >= 0)
            .ok_or(GovernanceError::Overflow)
    }

    /// The tally that a `support` value adds to: 0 Against, 1 For, 2 Abstain.
    fn tally_mut(proposal: &mut Proposal, support: u32) -> &mut i128 {
        match support {
            0 => &mut proposal.against_votes,
            1 => &mut proposal.for_votes,
            _ => &mut proposal.abstain_votes,
        }
    }

    fn quorum_for_supply(total_supply: i128, quorum_bps: u32) -> Result<i128, GovernanceError> {
        total_supply
            .checked_mul(i128::from(quorum_bps))
            .map(|scaled| scaled / BPS_DENOMINATOR)
            .ok_or(GovernanceError::Overflow)
    }

    /// Sum of the For, Against and Abstain tallies: the figure quorum is measured
    /// against. Checked, so an overflowing sum is an error rather than a trap.
    fn total_votes(proposal: &Proposal) -> Result<i128, GovernanceError> {
        proposal
            .for_votes
            .checked_add(proposal.against_votes)
            .and_then(|sum| sum.checked_add(proposal.abstain_votes))
            .ok_or(GovernanceError::Overflow)
    }

    /// The phase of `proposal` at ledger `now`, from its stored status and ledger
    /// window. Mirrors the checks in `vote()`, `execute()` and `mark_expired()`.
    fn phase_of(proposal: &Proposal, now: u32, execution_grace_period: u32) -> ProposalPhase {
        match &proposal.status {
            ProposalStatus::Active if now < proposal.start_ledger => ProposalPhase::Pending,
            ProposalStatus::Active if now <= proposal.end_ledger => ProposalPhase::Active,
            ProposalStatus::Active => ProposalPhase::Ended,
            ProposalStatus::Queued if now < proposal.queue_ledger => ProposalPhase::Queued,
            ProposalStatus::Queued
                if execution_grace_period > 0
                    && now > proposal.queue_ledger.saturating_add(execution_grace_period) =>
            {
                ProposalPhase::Expired
            }
            ProposalStatus::Queued if proposal.kind == ProposalKind::Signaling => ProposalPhase::Passed,
            ProposalStatus::Queued => ProposalPhase::ReadyToExecute,
            ProposalStatus::Executed => ProposalPhase::Executed,
            ProposalStatus::Failed => ProposalPhase::Failed,
            ProposalStatus::Cancelled => ProposalPhase::Cancelled,
            ProposalStatus::Expired => ProposalPhase::Expired,
            ProposalStatus::Vetoed => ProposalPhase::Vetoed,
        }
    }

    /// Applies `apply` to the stored counters and writes them back.
    fn update_stats(env: &Env, apply: impl FnOnce(&mut GovernanceStats)) {
        let mut stats: GovernanceStats = env
            .storage()
            .instance()
            .get(&DataKey::Stats)
            .unwrap_or_default();
        apply(&mut stats);
        env.storage().instance().set(&DataKey::Stats, &stats);
    }

    /// Moves one proposal from the `from` counter to the `to` counter.
    fn record_status_change(env: &Env, from: &ProposalStatus, to: &ProposalStatus) {
        Self::update_stats(env, |stats| {
            if let Some(counter) = Self::status_counter(stats, from) {
                *counter = counter.saturating_sub(1);
            }
            if let Some(counter) = Self::status_counter(stats, to) {
                *counter = counter.saturating_add(1);
            }
        });
    }

    /// The counter that tracks proposals in `status`. `Vetoed` has none, and
    /// `Passed` is a phase that `get_proposal_phase` derives rather than a status.
    fn status_counter<'a>(stats: &'a mut GovernanceStats, status: &ProposalStatus) -> Option<&'a mut u64> {
        match status {
            ProposalStatus::Active => Some(&mut stats.active),
            ProposalStatus::Queued => Some(&mut stats.queued),
            ProposalStatus::Executed => Some(&mut stats.executed),
            ProposalStatus::Failed => Some(&mut stats.failed),
            ProposalStatus::Cancelled => Some(&mut stats.cancelled),
            ProposalStatus::Expired => Some(&mut stats.expired),
            ProposalStatus::Vetoed => None,
        }
    }
}

#[cfg(test)]
mod test;
