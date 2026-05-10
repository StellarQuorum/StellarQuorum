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
