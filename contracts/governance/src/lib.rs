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
