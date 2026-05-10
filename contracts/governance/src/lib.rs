#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, contracterror, Address, Env, String};

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
}

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum ProposalStatus {
    Pending, Active, Passed, Failed, Queued, Executed, Cancelled,
}

#[contracttype]
#[derive(Clone)]
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
}

#[contracttype]
pub struct Config {
    pub token: Address,
    pub quorum_bps: u32,
    pub voting_period: u32,
    pub timelock_period: u32,
    pub proposal_threshold: i128,
    pub admin: Address,
}

#[contracttype]
pub enum DataKey {
    Config,
    ProposalCount,
    Proposal(u64),
    HasVoted(u64, Address),
    Delegate(Address),
}

#[contract]
pub struct GovernanceContract;

#[contractimpl]
impl GovernanceContract {
    pub fn initialize(env: Env, admin: Address, token: Address, quorum_bps: u32, voting_period: u32, timelock_period: u32, proposal_threshold: i128) -> Result<(), GovernanceError> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(GovernanceError::AlreadyInitialized);
        }
        admin.require_auth();
        let config = Config { token, quorum_bps, voting_period, timelock_period, proposal_threshold, admin };
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().set(&DataKey::ProposalCount, &0u64);
        Ok(())
    }

    pub fn create_proposal(env: Env, proposer: Address, title: String, description: String) -> Result<u64, GovernanceError> {
        proposer.require_auth();
        let count: u64 = env.storage().instance().get(&DataKey::ProposalCount).unwrap_or(0);
        let id = count + 1;
        let current = env.ledger().sequence();
        let config: Config = env.storage().instance().get(&DataKey::Config).unwrap();
        let proposal = Proposal {
            id, proposer, title, description,
            for_votes: 0, against_votes: 0, abstain_votes: 0,
            snapshot_ledger: current,
            start_ledger: current + 1,
            end_ledger: current + 1 + config.voting_period,
            queue_ledger: 0,
            quorum_required: 0, // TODO: calc from total_supply * quorum_bps / 10000
            status: ProposalStatus::Active,
        };
        env.storage().persistent().set(&DataKey::Proposal(id), &proposal);
        env.storage().instance().set(&DataKey::ProposalCount, &id);
        Ok(id)
    }

    pub fn vote(env: Env, voter: Address, proposal_id: u64, support: u32) -> Result<(), GovernanceError> {
        voter.require_auth();
        if support > 2 { return Err(GovernanceError::InvalidVoteChoice); }
        if env.storage().persistent().has(&DataKey::HasVoted(proposal_id, voter.clone())) {
            return Err(GovernanceError::AlreadyVoted);
        }
        let mut proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id)).ok_or(GovernanceError::ProposalNotFound)?;
        if env.ledger().sequence() > proposal.end_ledger { return Err(GovernanceError::VotingPeriodEnded); }
        if proposal.status != ProposalStatus::Active { return Err(GovernanceError::VotingNotActive); }
        let voting_power: i128 = 0; // TODO: get from token contract at snapshot_ledger
        match support {
            0 => proposal.against_votes += voting_power,
            1 => proposal.for_votes += voting_power,
            _ => proposal.abstain_votes += voting_power,
        }
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
        env.storage().persistent().set(&DataKey::HasVoted(proposal_id, voter), &support);
        Ok(())
    }
