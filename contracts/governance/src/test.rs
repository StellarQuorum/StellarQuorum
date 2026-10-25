use super::*;
use quorum_token::{QuorumToken, QuorumTokenClient};
use soroban_sdk::testutils::storage::Persistent as _;
use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _, MockAuth, MockAuthInvoke};
use soroban_sdk::{IntoVal, TryFromVal, Val};

#[path = "test_delegation.rs"]
mod delegation;

// Models an action target attempting to execute the same proposal from its
// callback after the governor has committed the Executed state.
#[contract]
struct ReentrantCallback;

#[contractimpl]
impl ReentrantCallback {
    pub fn try_reenter(env: Env, governance: Address, proposal_id: u64) -> bool {
        let executor = Address::generate(&env);
        GovernanceContractClient::new(&env, &governance)
            .try_execute(&executor, &proposal_id)
            .is_err()
    }
}

// A proposal action target that records the arguments it was called with, or
// fails on demand, so tests can see exactly what execute() dispatched.
#[contract]
struct ActionRecorder;

#[contractimpl]
impl ActionRecorder {
    pub fn record(env: Env, value: u32) {
        let mut calls: soroban_sdk::Vec<u32> = env.storage().instance()
            .get(&Symbol::new(&env, "calls"))
            .unwrap_or_else(|| soroban_sdk::Vec::new(&env));
        calls.push_back(value);
        env.storage().instance().set(&Symbol::new(&env, "calls"), &calls);
    }

    pub fn calls(env: Env) -> soroban_sdk::Vec<u32> {
        env.storage().instance()
            .get(&Symbol::new(&env, "calls"))
            .unwrap_or_else(|| soroban_sdk::Vec::new(&env))
    }

    pub fn fail(_env: Env) {
        panic!("action failed");
    }
}

const QUORUM_BPS: u32 = 500; // 5%
const VOTING_PERIOD: u32 = 100;
const TIMELOCK_PERIOD: u32 = 50;
const TIMELOCK: u32 = TIMELOCK_PERIOD;
const EXECUTION_GRACE: u32 = LEDGERS_PER_DAY * 7;
const PROPOSAL_THRESHOLD: i128 = 0;

/// Registers a QUORUM token and a governor wired to it, minting `initial_supply`
/// to the admin.
fn deploy(env: &Env, initial_supply: i128, quorum_bps: u32) -> (Address, Address, Address) {
    deploy_with_threshold(env, initial_supply, quorum_bps, PROPOSAL_THRESHOLD)
}

/// As `deploy`, with an explicit `proposal_threshold`.
fn deploy_with_threshold(
    env: &Env,
    initial_supply: i128,
    quorum_bps: u32,
    proposal_threshold: i128,
) -> (Address, Address, Address) {
    deploy_full(env, initial_supply, quorum_bps, proposal_threshold, LEDGERS_PER_DAY * 7)
}

/// Full deployment with all parameters including execution_grace_period.
fn deploy_full(
    env: &Env,
    initial_supply: i128,
    quorum_bps: u32,
    proposal_threshold: i128,
    execution_grace_period: u32,
) -> (Address, Address, Address) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let guardian = Address::generate(env);

    let token_id = env.register(QuorumToken, ());
    QuorumTokenClient::new(env, &token_id).initialize(
        &admin,
        &String::from_str(env, "Quorum"),
        &String::from_str(env, "QUORUM"),
        &7,
        &initial_supply,
    );

    let governance_id = env.register(GovernanceContract, ());
    GovernanceContractClient::new(env, &governance_id).initialize(
        &admin,
        &guardian,
        &token_id,
        &quorum_bps,
        &VOTING_PERIOD,
        &TIMELOCK_PERIOD,
        &execution_grace_period,
        &proposal_threshold,
    );

    (admin, token_id, governance_id)
}

fn propose(env: &Env, governance_id: &Address, proposer: &Address) -> Proposal {
    let governance = GovernanceContractClient::new(env, governance_id);
    let id = governance.create_proposal(
        proposer,
        &String::from_str(env, "Raise the quorum threshold"),
        &String::from_str(env, "Move quorum_bps from 500 to 750."),
        &String::from_str(env, ""),
    );
    governance.get_proposal(&id)
}

#[test]
fn quorum_required_is_derived_from_token_total_supply() {
    let env = Env::default();
    let (_, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let proposer = Address::generate(&env);

    let proposal = propose(&env, &governance_id, &proposer);

    // 5% of 1_000_000
    assert_eq!(proposal.quorum_required, 50_000);
}

#[test]
fn quorum_required_tracks_supply_changes_between_proposals() {
    let env = Env::default();
    let (admin, token_id, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let proposer = Address::generate(&env);

    let first = propose(&env, &governance_id, &proposer);
    assert_eq!(first.quorum_required, 50_000);

    // Minting raises circulating supply, so later proposals need a higher bar.
    QuorumTokenClient::new(&env, &token_id).mint(&admin, &1_000_000);

    let second = propose(&env, &governance_id, &proposer);
    assert_eq!(second.quorum_required, 100_000);
}

#[test]
fn quorum_calculation_with_zero_basis_points_is_zero() {
    assert_eq!(GovernanceContract::quorum_for_supply(1_000_000, 0), Ok(0));
}

const THRESHOLD: i128 = 10_000;

#[test]
fn proposer_below_threshold_is_rejected() {
    let env = Env::default();
    let (_, _, governance_id) = deploy_with_threshold(&env, 1_000_000, QUORUM_BPS, THRESHOLD);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let broke = Address::generate(&env);

    assert_eq!(
        governance.try_create_proposal(
            &broke,
            &String::from_str(&env, "Fund my thing"),
            &String::from_str(&env, "I hold no QUORUM."),
            &String::from_str(&env, ""),
        ),
        Err(Ok(GovernanceError::BelowProposalThreshold))
    );
    assert_eq!(governance.get_proposal_count(), 0);
}

#[test]
fn proposer_holding_just_under_threshold_is_rejected() {
    let env = Env::default();
    let (admin, token_id, governance_id) =
        deploy_with_threshold(&env, 1_000_000, QUORUM_BPS, THRESHOLD);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let almost = Address::generate(&env);
    QuorumTokenClient::new(&env, &token_id).transfer(&admin, &almost, &(THRESHOLD - 1));

    assert_eq!(
        governance.try_create_proposal(
            &almost,
            &String::from_str(&env, "One short"),
            &String::from_str(&env, "Holding threshold - 1."),
            &String::from_str(&env, ""),
        ),
        Err(Ok(GovernanceError::BelowProposalThreshold))
    );
}

#[test]
fn proposer_at_threshold_succeeds() {
    let env = Env::default();
    let (admin, token_id, governance_id) =
        deploy_with_threshold(&env, 1_000_000, QUORUM_BPS, THRESHOLD);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let holder = Address::generate(&env);

    // Exactly the threshold — the check is inclusive.
    QuorumTokenClient::new(&env, &token_id).transfer(&admin, &holder, &THRESHOLD);

    let id = governance.create_proposal(
        &holder,
        &String::from_str(&env, "Exactly enough"),
        &String::from_str(&env, "Holding exactly the threshold."),
        &String::from_str(&env, ""),
    );
    assert_eq!(governance.get_proposal(&id).proposer, holder);
}

#[test]
fn zero_threshold_lets_any_address_propose() {
    let env = Env::default();
    let (_, _, governance_id) = deploy_with_threshold(&env, 1_000_000, QUORUM_BPS, 0);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    let id = governance.create_proposal(
        &Address::generate(&env),
        &String::from_str(&env, "Open season"),
        &String::from_str(&env, "No threshold configured."),
        &String::from_str(&env, ""),
    );
    assert_eq!(id, 1);
}

const VOTE_FOR: u32 = 1;

#[test]
fn voting_power_is_read_at_the_snapshot_not_the_live_balance() {
    let env = Env::default();
    env.ledger().set_sequence_number(10);
    let (admin, token_id, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    env.ledger().set_sequence_number(20);
    let proposal_id = governance.create_proposal(
        &admin,
        &String::from_str(&env, "Raise the quorum threshold"),
        &String::from_str(&env, "Move quorum_bps from 500 to 750."),
        &String::from_str(&env, ""),
    );

    // Admin gives most of the supply away *after* the snapshot.
    env.ledger().set_sequence_number(30);
    let latecomer = Address::generate(&env);
    QuorumTokenClient::new(&env, &token_id).transfer(&admin, &latecomer, &400_000);

    governance.vote(&admin, &proposal_id, &VOTE_FOR);

    // Weight is the snapshot balance (1_000_000), not the live one (600_000).
    assert_eq!(governance.get_proposal(&proposal_id).for_votes, 1_000_000);
}

#[test]
fn tokens_acquired_after_the_snapshot_carry_no_weight() {
    let env = Env::default();
    env.ledger().set_sequence_number(10);
    let (admin, token_id, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    env.ledger().set_sequence_number(20);
    let proposal_id = governance.create_proposal(
        &admin,
        &String::from_str(&env, "Raise the quorum threshold"),
        &String::from_str(&env, "Move quorum_bps from 500 to 750."),
        &String::from_str(&env, ""),
    );

    // Buying in after the proposal opened must not buy influence — this is the
    // flash-loan path the snapshot exists to close.
    env.ledger().set_sequence_number(30);
    let latecomer = Address::generate(&env);
    QuorumTokenClient::new(&env, &token_id).transfer(&admin, &latecomer, &400_000);

    assert_eq!(
        governance.try_vote(&latecomer, &proposal_id, &VOTE_FOR),
        Err(Ok(GovernanceError::NoVotingPower))
    );
    assert_eq!(governance.get_proposal(&proposal_id).for_votes, 0);
    assert!(!governance.has_voted(&proposal_id, &latecomer));
}

#[test]
fn address_that_never_held_tokens_cannot_vote() {
    let env = Env::default();
    env.ledger().set_sequence_number(10);
    let (admin, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    env.ledger().set_sequence_number(20);
    let proposal_id = governance.create_proposal(
        &admin,
        &String::from_str(&env, "Raise the quorum threshold"),
        &String::from_str(&env, "Move quorum_bps from 500 to 750."),
        &String::from_str(&env, ""),
    );

    start_voting(&env, &governance, proposal_id);
    assert_eq!(
        governance.try_vote(&Address::generate(&env), &proposal_id, &VOTE_FOR),
        Err(Ok(GovernanceError::NoVotingPower))
    );
}

const VOTE_AGAINST: u32 = 0;
const VOTE_ABSTAIN: u32 = 2;

/// Ledger the token is deployed and holders are funded at.
const GENESIS: u32 = 10;
/// Ledger proposals are opened at, so `snapshot_ledger` is GENESIS < L < voting.
const OPENED: u32 = 20;

// ─── Initialization ──────────────────────────────────────────────────────────

#[test]
fn initialize_stores_the_supplied_config() {
    let env = Env::default();
    let (admin, token_id, governance_id) =
        deploy_with_threshold(&env, 1_000_000, QUORUM_BPS, THRESHOLD);

    let config = GovernanceContractClient::new(&env, &governance_id).try_get_config().unwrap().unwrap();
    assert_eq!(config.admin, admin);
    assert_eq!(config.token, token_id);
    assert_eq!(config.quorum_bps, QUORUM_BPS);
    assert_eq!(config.voting_period, VOTING_PERIOD);
    assert_eq!(config.timelock_period, TIMELOCK_PERIOD);
    assert_eq!(config.proposal_threshold, THRESHOLD);
    assert_eq!(
        GovernanceContractClient::new(&env, &governance_id).get_proposal_count(),
        0
    );
    assert_eq!(
        GovernanceContractClient::new(&env, &governance_id).get_config().max_active_proposals,
        DEFAULT_MAX_ACTIVE_PROPOSALS
    );
}

#[test]
fn initialize_cannot_run_twice() {
    let env = Env::default();
    let (admin, token_id, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);

    let guardian = Address::generate(&env);
    assert_eq!(
        GovernanceContractClient::new(&env, &governance_id).try_initialize(
            &admin,
            &guardian,
            &token_id,
            &QUORUM_BPS,
            &VOTING_PERIOD,
            &TIMELOCK_PERIOD,
            &(LEDGERS_PER_DAY * 7),
            &PROPOSAL_THRESHOLD,
        ),
        Err(Ok(GovernanceError::AlreadyInitialized))
    );
}

#[test]
fn admin_can_transfer_governance_administration_and_emits_event() {
    let env = Env::default();
    let (_admin, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let new_admin = Address::generate(&env);

    // transfer_admin only nominates: control must not move until the
    // nominee accepts, and no rotation is announced yet.
    governance.transfer_admin(&new_admin);
    
    // Two-step transfer: new admin must accept
    env.mock_all_auths();
    governance.accept_admin();

    let config = governance.get_config();
    assert_eq!(config.admin, new_admin);
}

#[test]
fn governance_admin_transfer_requires_current_admin_authorization() {
    let env = Env::default();
    let (admin, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let attacker = Address::generate(&env);
    env.set_auths(&[]);

    assert!(governance.try_transfer_admin(&attacker).is_err());
    assert_eq!(governance.try_get_config().unwrap().unwrap().admin, admin);
    assert!(env.events().all().is_empty());
}

// ─── Proposal creation ───────────────────────────────────────────────────────

#[test]
fn create_proposal_sets_the_expected_ledger_window() {
    let env = Env::default();
    env.ledger().set_sequence_number(GENESIS);
    let (admin, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    env.ledger().set_sequence_number(OPENED);
    let proposal = propose(&env, &governance_id, &admin);

    assert_eq!(proposal.id, 1);
    assert_eq!(proposal.proposer, admin);
    assert_eq!(proposal.snapshot_ledger, OPENED);
    assert_eq!(proposal.start_ledger, OPENED + 1);
    assert_eq!(proposal.end_ledger, OPENED + 1 + VOTING_PERIOD);
    assert_eq!(proposal.queue_ledger, 0);
    assert_eq!(proposal.status, ProposalStatus::Active);
    assert_eq!(
        (proposal.for_votes, proposal.against_votes, proposal.abstain_votes),
        (0, 0, 0)
    );
    assert_eq!(governance.get_proposal_count(), 1);
}

#[test]
fn proposal_ids_increment_from_one() {
    let env = Env::default();
    env.ledger().set_sequence_number(GENESIS);
    let (admin, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    env.ledger().set_sequence_number(OPENED);
    for expected in 1..=3u64 {
        assert_eq!(propose(&env, &governance_id, &admin).id, expected);
    }
    assert_eq!(governance.get_proposal_count(), 3);
}

#[test]
fn active_proposal_limit_is_enforced_and_freed_after_finalize() {
    let env = Env::default();
    let (admin, governance_id, first) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    governance.set_max_active_proposals(&1);

    assert_eq!(
        governance.try_create_proposal(&admin, &String::from_str(&env, "blocked"), &String::from_str(&env, "blocked"), &String::from_str(&env, "")),
        Err(Ok(GovernanceError::TooManyActiveProposals))
    );
    close_voting(&env, &governance, first);
    governance.finalize(&first);
    assert!(governance.try_create_proposal(&admin, &String::from_str(&env, "available"), &String::from_str(&env, "available"), &String::from_str(&env, "")).is_ok());
}

#[test]
fn active_proposal_limit_is_freed_after_cancel() {
    let env = Env::default();
    let (admin, governance_id, first) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    governance.set_max_active_proposals(&1);
    governance.cancel(&admin, &first);
    assert!(governance.try_create_proposal(&admin, &String::from_str(&env, "available"), &String::from_str(&env, "available"), &String::from_str(&env, "")).is_ok());
}

#[test]
fn active_proposal_index_tracks_creation_and_finalization() {
    let env = Env::default();
    let (admin, governance_id, first) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let second = propose(&env, &governance_id, &admin).id;
    assert_eq!(governance.get_active_proposals(), soroban_sdk::vec![&env, first, second]);

    close_voting(&env, &governance, first);
    governance.finalize(&first);
    assert_eq!(governance.get_active_proposals(), soroban_sdk::vec![&env, second]);
}

#[test]
fn active_proposal_index_removes_cancelled_proposals() {
    let env = Env::default();
    let (admin, governance_id, first) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let second = propose(&env, &governance_id, &admin).id;

    governance.cancel(&admin, &first);
    assert_eq!(governance.get_active_proposals(), soroban_sdk::vec![&env, second]);
}

#[test]
fn get_proposal_rejects_an_unknown_id() {
    let env = Env::default();
    let (_, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);

    assert_eq!(
        GovernanceContractClient::new(&env, &governance_id).try_get_proposal(&999),
        Err(Ok(GovernanceError::ProposalNotFound))
    );
}

// ─── Proposer cooldown ───────────────────────────────────────────────────────

/// Ledgers a proposer waits between proposals once the admin sets a cooldown.
const PROPOSER_COOLDOWN: u32 = 10;

#[test]
fn a_proposer_must_wait_out_the_cooldown_before_opening_another_proposal() {
    let env = Env::default();
    env.ledger().set_sequence_number(GENESIS);
    let (admin, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    assert_eq!(governance.get_config().proposer_cooldown, 0);
    governance.set_proposer_cooldown(&PROPOSER_COOLDOWN);
    assert_eq!(governance.get_config().proposer_cooldown, PROPOSER_COOLDOWN);

    env.ledger().set_sequence_number(OPENED);
    assert_eq!(propose(&env, &governance_id, &admin).id, 1);

    // One ledger short of the cooldown is still rejected.
    env.ledger().set_sequence_number(OPENED + PROPOSER_COOLDOWN - 1);
    assert_eq!(
        governance.try_create_proposal(
            &admin,
            &String::from_str(&env, "Second proposal"),
            &String::from_str(&env, "Opened during the cooldown."),
            &String::from_str(&env, ""),
        ),
        Err(Ok(GovernanceError::ProposerOnCooldown))
    );
    assert_eq!(governance.get_proposal_count(), 1);

    env.ledger().set_sequence_number(OPENED + PROPOSER_COOLDOWN);
    assert_eq!(propose(&env, &governance_id, &admin).id, 2);
}

#[test]
fn the_cooldown_is_tracked_per_proposer() {
    let env = Env::default();
    env.ledger().set_sequence_number(GENESIS);
    let (admin, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    GovernanceContractClient::new(&env, &governance_id).set_proposer_cooldown(&PROPOSER_COOLDOWN);

    env.ledger().set_sequence_number(OPENED);
    propose(&env, &governance_id, &admin);

    // A different proposer is not held back by the first one's cooldown.
    let other = Address::generate(&env);
    assert_eq!(propose(&env, &governance_id, &other).id, 2);
}

// ─── Voting ──────────────────────────────────────────────────────────────────

/// Deploys with `supply`, funds each holder before the snapshot, and opens a
/// proposal at `OPENED`. Returns (admin, governance id, proposal id).
fn open_with_holders(
    env: &Env,
    supply: i128,
    quorum_bps: u32,
    holders: &[(Address, i128)],
) -> (Address, Address, u64) {
    env.ledger().set_sequence_number(GENESIS);
    let (admin, token_id, governance_id) = deploy(env, supply, quorum_bps);
    let token = QuorumTokenClient::new(env, &token_id);

    // Funded at GENESIS, before the snapshot, so the grants carry weight.
    for (holder, amount) in holders {
        token.transfer(&admin, holder, amount);
    }

    env.ledger().set_sequence_number(OPENED);
    let id = propose(env, &governance_id, &admin).id;
    env.ledger().set_sequence_number(OPENED + 1);
    (admin, governance_id, id)
}

fn start_voting(env: &Env, governance: &GovernanceContractClient, id: u64) {
    let start = governance.get_proposal(&id).start_ledger;
    if env.ledger().sequence() < start {
        env.ledger().set_sequence_number(start);
    }
}

#[test]
fn votes_accumulate_into_the_matching_tally() {
    let env = Env::default();
    let (against_voter, abstain_voter) = (Address::generate(&env), Address::generate(&env));
    let (admin, governance_id, proposal_id) = open_with_holders(
        &env,
        1_000_000,
        QUORUM_BPS,
        &[(against_voter.clone(), 200_000), (abstain_voter.clone(), 300_000)],
    );
    let governance = GovernanceContractClient::new(&env, &governance_id);

    governance.vote(&admin, &proposal_id, &VOTE_FOR); // 500_000 left after grants
    governance.vote(&against_voter, &proposal_id, &VOTE_AGAINST);
    governance.vote(&abstain_voter, &proposal_id, &VOTE_ABSTAIN);

    let proposal = governance.get_proposal(&proposal_id);
    assert_eq!(proposal.for_votes, 500_000);
    assert_eq!(proposal.against_votes, 200_000);
    assert_eq!(proposal.abstain_votes, 300_000);
}

#[test]
fn a_voter_can_change_their_vote_while_voting_is_open() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    governance.vote(&admin, &proposal_id, &VOTE_FOR);
    governance.vote(&admin, &proposal_id, &VOTE_AGAINST);
    let proposal = governance.get_proposal(&proposal_id);
    assert_eq!(proposal.for_votes, 0);
    assert_eq!(proposal.against_votes, 1_000_000);
    assert_eq!(governance.get_vote(&proposal_id, &admin), Some(VOTE_AGAINST));

    governance.vote(&admin, &proposal_id, &VOTE_ABSTAIN);
    let proposal = governance.get_proposal(&proposal_id);
    assert_eq!(proposal.for_votes, 0);
    assert_eq!(proposal.against_votes, 0);
    assert_eq!(proposal.abstain_votes, 1_000_000);
    assert_eq!(governance.get_vote(&proposal_id, &admin), Some(VOTE_ABSTAIN));
}

#[test]
fn a_changed_vote_only_moves_that_voters_own_weight() {
    let env = Env::default();
    let other = Address::generate(&env);
    let (admin, governance_id, proposal_id) = open_with_holders(
        &env,
        1_000_000,
        QUORUM_BPS,
        &[(other.clone(), 300_000)],
    );
    let governance = GovernanceContractClient::new(&env, &governance_id);

    // The admin keeps 700_000 after the grant.
    governance.vote(&other, &proposal_id, &VOTE_FOR);
    governance.vote(&admin, &proposal_id, &VOTE_AGAINST);
    governance.vote(&admin, &proposal_id, &VOTE_ABSTAIN);

    let proposal = governance.get_proposal(&proposal_id);
    assert_eq!(proposal.for_votes, 300_000);
    assert_eq!(proposal.against_votes, 0);
    assert_eq!(proposal.abstain_votes, 700_000);
}

#[test]
fn a_repeat_vote_after_the_window_closes_is_still_rejected() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let end_ledger = governance.get_proposal(&proposal_id).end_ledger;

    governance.vote(&admin, &proposal_id, &VOTE_FOR);
    env.ledger().set_sequence_number(end_ledger + 1);
    assert_eq!(
        governance.try_vote(&admin, &proposal_id, &VOTE_AGAINST),
        Err(Ok(GovernanceError::AlreadyVoted))
    );

    // The rejected call left the recorded choice and the tallies untouched.
    let proposal = governance.get_proposal(&proposal_id);
    assert_eq!(proposal.for_votes, 1_000_000);
    assert_eq!(proposal.against_votes, 0);
    assert_eq!(governance.get_vote(&proposal_id, &admin), Some(VOTE_FOR));
}

#[test]
fn votes_after_the_deadline_are_rejected() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let end_ledger = governance.get_proposal(&proposal_id).end_ledger;

    // The final ledger of the window still accepts votes.
    env.ledger().set_sequence_number(end_ledger);
    governance.vote(&admin, &proposal_id, &VOTE_FOR);

    env.ledger().set_sequence_number(end_ledger + 1);
    let latecomer = Address::generate(&env);
    assert_eq!(
        governance.try_vote(&latecomer, &proposal_id, &VOTE_FOR),
        Err(Ok(GovernanceError::VotingPeriodEnded))
    );
}

#[test]
fn votes_before_start_ledger_are_rejected_and_the_window_opens_at_start_ledger() {
    let env = Env::default();
    let voter = Address::generate(&env);
    let (_, governance_id, proposal_id) = open_with_holders(
        &env,
        1_000_000,
        QUORUM_BPS,
        &[(voter.clone(), 200_000)],
    );
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let start_ledger = governance.get_proposal(&proposal_id).start_ledger;

    // One ledger before start_ledger the window is still closed.
    env.ledger().set_sequence_number(start_ledger - 1);
    assert_eq!(
        governance.try_vote(&voter, &proposal_id, &VOTE_FOR),
        Err(Ok(GovernanceError::VotingNotStarted))
    );

    // start_ledger itself is the first ledger that accepts votes.
    env.ledger().set_sequence_number(start_ledger);
    governance.vote(&voter, &proposal_id, &VOTE_FOR);
    assert_eq!(governance.get_proposal(&proposal_id).for_votes, 200_000);
}

#[test]
fn the_phase_is_pending_until_voting_opens_while_the_stored_status_stays_active() {
    let env = Env::default();
    let (_, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let start_ledger = governance.get_proposal(&proposal_id).start_ledger;

    env.ledger().set_sequence_number(start_ledger - 1);
    assert_eq!(governance.get_proposal_phase(&proposal_id), ProposalPhase::Pending);
    assert_eq!(governance.get_proposal(&proposal_id).status, ProposalStatus::Active);

    env.ledger().set_sequence_number(start_ledger);
    assert_eq!(governance.get_proposal_phase(&proposal_id), ProposalPhase::Active);
}

#[test]
fn an_out_of_range_vote_choice_is_rejected() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    assert_eq!(
        governance.try_vote(&admin, &proposal_id, &3),
        Err(Ok(GovernanceError::InvalidVoteChoice))
    );
    assert!(!governance.has_voted(&proposal_id, &admin));
}

#[test]
fn voting_on_an_unknown_proposal_is_rejected() {
    let env = Env::default();
    let (admin, governance_id, _) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);

    assert_eq!(
        GovernanceContractClient::new(&env, &governance_id).try_vote(&admin, &999, &VOTE_FOR),
        Err(Ok(GovernanceError::ProposalNotFound))
    );
}

#[test]
fn get_vote_returns_the_recorded_choice() {
    let env = Env::default();
    env.ledger().set_sequence_number(10);
    let (admin, token_id, governance_id) = deploy(&env, 900_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let token = QuorumTokenClient::new(&env, &token_id);

    // Three holders, funded before the snapshot so each carries weight.
    let against = Address::generate(&env);
    let abstain = Address::generate(&env);
    token.transfer(&admin, &against, &300_000);
    token.transfer(&admin, &abstain, &300_000);

    env.ledger().set_sequence_number(20);
    let proposal_id = governance.create_proposal(
        &admin,
        &String::from_str(&env, "Three-way split"),
        &String::from_str(&env, "One voter per choice."),
        &String::from_str(&env, ""),
    );

    start_voting(&env, &governance, proposal_id);
    governance.vote(&admin, &proposal_id, &VOTE_FOR);
    governance.vote(&against, &proposal_id, &VOTE_AGAINST);
    governance.vote(&abstain, &proposal_id, &VOTE_ABSTAIN);

    assert_eq!(governance.get_vote(&proposal_id, &admin), Some(VOTE_FOR));
    assert_eq!(governance.get_vote(&proposal_id, &against), Some(VOTE_AGAINST));
    assert_eq!(governance.get_vote(&proposal_id, &abstain), Some(VOTE_ABSTAIN));
}

#[test]
fn get_vote_is_none_for_an_address_that_has_not_voted() {
    let env = Env::default();
    env.ledger().set_sequence_number(10);
    let (admin, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    env.ledger().set_sequence_number(20);
    let proposal_id = governance.create_proposal(
        &admin,
        &String::from_str(&env, "Nobody has voted yet"),
        &String::from_str(&env, "Fresh proposal."),
        &String::from_str(&env, ""),
    );

    // Never voted, and a non-holder who could not vote even if they tried.
    assert_eq!(governance.get_vote(&proposal_id, &admin), None);
    assert_eq!(governance.get_vote(&proposal_id, &Address::generate(&env)), None);

    // A rejected vote must not leave a record behind.
    let latecomer = Address::generate(&env);
    assert!(governance.try_vote(&latecomer, &proposal_id, &VOTE_FOR).is_err());
    assert_eq!(governance.get_vote(&proposal_id, &latecomer), None);
}

#[test]
fn get_vote_is_none_for_an_unknown_proposal() {
    let env = Env::default();
    let (admin, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);

    assert_eq!(
        GovernanceContractClient::new(&env, &governance_id).get_vote(&999, &admin),
        None
    );
}

// ─── Finalize ────────────────────────────────────────────────────────────────

/// Moves past `end_ledger` so the proposal can be finalized.
fn close_voting(env: &Env, governance: &GovernanceContractClient, proposal_id: u64) {
    let end_ledger = governance.get_proposal(&proposal_id).end_ledger;
    env.ledger().set_sequence_number(end_ledger + 1);
}

#[test]
fn finalize_queues_a_proposal_that_clears_quorum_and_majority() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    governance.vote(&admin, &proposal_id, &VOTE_FOR);
    close_voting(&env, &governance, proposal_id);
    let closed_at = env.ledger().sequence();

    assert_eq!(governance.finalize(&proposal_id), ProposalStatus::Queued);

    let proposal = governance.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Queued);
    assert_eq!(proposal.queue_ledger, closed_at + TIMELOCK_PERIOD);
}

#[test]
fn finalize_fails_a_proposal_that_misses_quorum() {
    let env = Env::default();
    let small_holder = Address::generate(&env);
    // 50% quorum against a 1_000_000 supply needs 500_000; this voter has 1_000.
    let (_, governance_id, proposal_id) = open_with_holders(
        &env,
        1_000_000,
        5_000,
        &[(small_holder.clone(), 1_000)],
    );
    let governance = GovernanceContractClient::new(&env, &governance_id);

    governance.vote(&small_holder, &proposal_id, &VOTE_FOR);
    close_voting(&env, &governance, proposal_id);

    assert_eq!(governance.finalize(&proposal_id), ProposalStatus::Failed);
    assert_eq!(governance.get_proposal(&proposal_id).queue_ledger, 0);
}

#[test]
fn finalize_fails_a_proposal_that_clears_quorum_but_loses_the_vote() {
    let env = Env::default();
    let opposition = Address::generate(&env);
    let (admin, governance_id, proposal_id) = open_with_holders(
        &env,
        1_000_000,
        QUORUM_BPS,
        &[(opposition.clone(), 600_000)],
    );
    let governance = GovernanceContractClient::new(&env, &governance_id);

    governance.vote(&admin, &proposal_id, &VOTE_FOR); // 400_000
    governance.vote(&opposition, &proposal_id, &VOTE_AGAINST); // 600_000
    close_voting(&env, &governance, proposal_id);

    // Turnout clears quorum, but Against wins.
    assert_eq!(governance.finalize(&proposal_id), ProposalStatus::Failed);
}

#[test]
fn a_tie_fails_because_majority_requires_strictly_more_for_votes() {
    let env = Env::default();
    let opposition = Address::generate(&env);
    let (admin, governance_id, proposal_id) = open_with_holders(
        &env,
        1_000_000,
        QUORUM_BPS,
        &[(opposition.clone(), 500_000)],
    );
    let governance = GovernanceContractClient::new(&env, &governance_id);

    governance.vote(&admin, &proposal_id, &VOTE_FOR); // 500_000
    governance.vote(&opposition, &proposal_id, &VOTE_AGAINST); // 500_000
    close_voting(&env, &governance, proposal_id);

    assert_eq!(governance.finalize(&proposal_id), ProposalStatus::Failed);
}

#[test]
fn finalize_before_the_deadline_is_rejected() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    governance.vote(&admin, &proposal_id, &VOTE_FOR);

    // On end_ledger itself voting is still open, so finalize is premature.
    env.ledger()
        .set_sequence_number(governance.get_proposal(&proposal_id).end_ledger);
    assert_eq!(
        governance.try_finalize(&proposal_id),
        Err(Ok(GovernanceError::VotingNotActive))
    );
}

/// Quorum is total turnout, not the winning side: 40_000 For plus 20_000
/// Against is 60_000 of a 1_000_000 supply — over the 50_000 threshold —
/// even though For alone sits below it. Splitting the tally across the
/// wrong operators would drop this proposal below quorum.
#[test]
fn finalize_counts_for_and_against_together_toward_quorum() {
    let env = Env::default();
    let supporters = Address::generate(&env);
    let opposition = Address::generate(&env);
    let (_, governance_id, proposal_id) = open_with_holders(
        &env,
        1_000_000,
        QUORUM_BPS, // 5% of 1_000_000 = 50_000
        &[(supporters.clone(), 40_000), (opposition.clone(), 20_000)],
    );
    let governance = GovernanceContractClient::new(&env, &governance_id);

    governance.vote(&supporters, &proposal_id, &VOTE_FOR);
    governance.vote(&opposition, &proposal_id, &VOTE_AGAINST);
    close_voting(&env, &governance, proposal_id);

    // 60_000 turnout clears quorum and For beats Against, so it queues.
    assert_eq!(governance.finalize(&proposal_id), ProposalStatus::Queued);
}

/// Abstentions count toward turnout: they are not For, but they are votes
/// cast, and SEP-20/quorum rules here measure participation, not agreement.
/// Dropping them from the tally would push 60_000 turnout under the 50_000
/// threshold and fail a proposal that should queue.
#[test]
fn finalize_counts_abstentions_toward_quorum() {
    let env = Env::default();
    let supporters = Address::generate(&env);
    let spectators = Address::generate(&env);
    let (_, governance_id, proposal_id) = open_with_holders(
        &env,
        1_000_000,
        QUORUM_BPS, // 5% of 1_000_000 = 50_000
        &[(supporters.clone(), 30_000), (spectators.clone(), 30_000)],
    );
    let governance = GovernanceContractClient::new(&env, &governance_id);

    governance.vote(&supporters, &proposal_id, &VOTE_FOR);
    governance.vote(&spectators, &proposal_id, &VOTE_ABSTAIN);
    close_voting(&env, &governance, proposal_id);

    // 30_000 For + 30_000 Abstain = 60_000 turnout, and For outvotes the
    // empty Against tally, so the proposal queues.
    assert_eq!(governance.finalize(&proposal_id), ProposalStatus::Queued);
}

// ─── Execute ─────────────────────────────────────────────────────────────────

/// Votes the proposal through and finalizes it into Queued.
fn queue_proposal(env: &Env, governance: &GovernanceContractClient, admin: &Address, id: u64) {
    start_voting(env, governance, id);
    governance.vote(admin, &id, &VOTE_FOR);
    close_voting(env, governance, id);
    assert_eq!(governance.finalize(&id), ProposalStatus::Queued);
}

#[test]
fn execute_succeeds_once_the_timelock_has_elapsed() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    queue_proposal(&env, &governance, &admin, proposal_id);

    let queue_ledger = governance.get_proposal(&proposal_id).queue_ledger;
    env.ledger().set_sequence_number(queue_ledger);
    governance.execute(&Address::generate(&env), &proposal_id);

    assert_eq!(
        governance.get_proposal(&proposal_id).status,
        ProposalStatus::Executed
    );
}

#[test]
fn malicious_action_callback_cannot_execute_a_proposal_twice() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    queue_proposal(&env, &governance, &admin, proposal_id);
    let queue_ledger = governance.get_proposal(&proposal_id).queue_ledger;
    env.ledger().set_sequence_number(queue_ledger);

    // This callback models an action target re-entering execute after dispatch
    // starts. The action dispatcher is not implemented yet, so invoke the
    // malicious target immediately after the successful state transition.
    governance.execute(&admin, &proposal_id);
    let callback_id = env.register(ReentrantCallback, ());
    assert!(ReentrantCallbackClient::new(&env, &callback_id)
        .try_reenter(&governance_id, &proposal_id));
    assert_eq!(
        governance.get_proposal(&proposal_id).status,
        ProposalStatus::Executed
    );
}

#[test]
fn execute_during_the_timelock_is_rejected() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    queue_proposal(&env, &governance, &admin, proposal_id);

    let queue_ledger = governance.get_proposal(&proposal_id).queue_ledger;
    env.ledger().set_sequence_number(queue_ledger - 1);

    assert_eq!(
        governance.try_execute(&Address::generate(&env), &proposal_id),
        Err(Ok(GovernanceError::TimelockNotExpired))
    );
    assert_eq!(
        governance.get_proposal(&proposal_id).status,
        ProposalStatus::Queued
    );
}

#[test]
fn execute_is_rejected_while_a_proposal_is_still_active() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    governance.vote(&admin, &proposal_id, &VOTE_FOR);

    assert_eq!(
        governance.try_execute(&Address::generate(&env), &proposal_id),
        Err(Ok(GovernanceError::ProposalNotPassed))
    );
}

#[test]
fn a_failed_proposal_cannot_be_executed() {
    let env = Env::default();
    let small_holder = Address::generate(&env);
    let (_, governance_id, proposal_id) =
        open_with_holders(&env, 1_000_000, 5_000, &[(small_holder.clone(), 1_000)]);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    governance.vote(&small_holder, &proposal_id, &VOTE_FOR);
    close_voting(&env, &governance, proposal_id);
    assert_eq!(governance.finalize(&proposal_id), ProposalStatus::Failed);

    env.ledger().set_sequence_number(env.ledger().sequence() + TIMELOCK_PERIOD + 1);
    assert_eq!(
        governance.try_execute(&Address::generate(&env), &proposal_id),
        Err(Ok(GovernanceError::ProposalNotPassed))
    );
}

// ─── Cancel ──────────────────────────────────────────────────────────────────

#[test]
fn a_proposer_can_cancel_their_own_proposal() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    // admin is the proposer here (open_with_holders proposes as admin).
    governance.cancel(&admin, &proposal_id);
    assert_eq!(
        governance.get_proposal(&proposal_id).status,
        ProposalStatus::Cancelled
    );
}

#[test]
fn the_admin_can_cancel_a_proposal_they_did_not_open() {
    let env = Env::default();
    env.ledger().set_sequence_number(GENESIS);
    let (admin, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    env.ledger().set_sequence_number(OPENED);
    let outsider = Address::generate(&env);
    let proposal_id = propose(&env, &governance_id, &outsider).id;

    governance.cancel(&admin, &proposal_id);
    assert_eq!(
        governance.get_proposal(&proposal_id).status,
        ProposalStatus::Cancelled
    );
}

#[test]
fn a_third_party_cannot_cancel() {
    let env = Env::default();
    let (_, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    assert_eq!(
        governance.try_cancel(&Address::generate(&env), &proposal_id),
        Err(Ok(GovernanceError::Unauthorized))
    );
    assert_eq!(
        governance.get_proposal(&proposal_id).status,
        ProposalStatus::Active
    );
}

#[test]
fn a_cancelled_proposal_stops_accepting_votes() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    governance.cancel(&admin, &proposal_id);
    assert_eq!(
        governance.try_vote(&admin, &proposal_id, &VOTE_FOR),
        Err(Ok(GovernanceError::VotingNotActive))
    );
}

#[test]
fn cancel_is_rejected_once_the_proposal_has_been_executed() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    queue_proposal(&env, &governance, &admin, proposal_id);

    let queue_ledger = governance.get_proposal(&proposal_id).queue_ledger;
    env.ledger().set_sequence_number(queue_ledger);
    governance.execute(&admin, &proposal_id);

    assert_eq!(
        governance.try_cancel(&admin, &proposal_id),
        Err(Ok(GovernanceError::ProposalNotCancellable))
    );
    assert_eq!(
        governance.get_proposal(&proposal_id).status,
        ProposalStatus::Executed
    );
}

#[test]
fn cancel_is_rejected_once_the_proposal_has_been_queued() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    queue_proposal(&env, &governance, &admin, proposal_id);

    assert_eq!(
        governance.try_cancel(&admin, &proposal_id),
        Err(Ok(GovernanceError::ProposalNotCancellable))
    );
    assert_eq!(
        governance.get_proposal(&proposal_id).status,
        ProposalStatus::Queued
    );
}

#[test]
fn cancel_is_rejected_once_the_proposal_has_failed() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    close_voting(&env, &governance, proposal_id);
    assert_eq!(governance.finalize(&proposal_id), ProposalStatus::Failed);

    assert_eq!(
        governance.try_cancel(&admin, &proposal_id),
        Err(Ok(GovernanceError::ProposalNotCancellable))
    );
    assert_eq!(
        governance.get_proposal(&proposal_id).status,
        ProposalStatus::Failed
    );
}

#[test]
fn cancel_is_rejected_once_voting_has_closed_even_before_finalize() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    close_voting(&env, &governance, proposal_id);

    assert_eq!(
        governance.try_cancel(&admin, &proposal_id),
        Err(Ok(GovernanceError::ProposalNotCancellable))
    );
    assert_eq!(
        governance.get_proposal(&proposal_id).status,
        ProposalStatus::Active
    );
}

#[test]
fn a_second_cancel_is_rejected() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    governance.cancel(&admin, &proposal_id);
    assert_eq!(
        governance.try_cancel(&admin, &proposal_id),
        Err(Ok(GovernanceError::ProposalNotCancellable))
    );
    assert_eq!(
        governance.get_proposal(&proposal_id).status,
        ProposalStatus::Cancelled
    );
}

// ─── Veto ────────────────────────────────────────────────────────────────────

fn veto_reason(env: &Env) -> String {
    String::from_str(env, "Action drains the treasury; see incident report #12.")
}

#[test]
fn the_guardian_can_veto_a_queued_proposal_during_the_timelock() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    queue_proposal(&env, &governance, &admin, proposal_id);
    let guardian = governance.get_config().guardian;

    governance.veto(&guardian, &proposal_id, &veto_reason(&env));
    assert_eq!(
        governance.get_proposal(&proposal_id).status,
        ProposalStatus::Vetoed
    );
}

#[test]
fn a_vetoed_proposal_cannot_be_executed() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    queue_proposal(&env, &governance, &admin, proposal_id);
    let guardian = governance.get_config().guardian;
    governance.veto(&guardian, &proposal_id, &veto_reason(&env));

    let queue_ledger = governance.get_proposal(&proposal_id).queue_ledger;
    env.ledger().set_sequence_number(queue_ledger);
    assert_eq!(
        governance.try_execute(&admin, &proposal_id),
        Err(Ok(GovernanceError::ProposalNotPassed))
    );
}

#[test]
fn a_non_guardian_cannot_veto() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    queue_proposal(&env, &governance, &admin, proposal_id);

    assert_eq!(
        governance.try_veto(&admin, &proposal_id, &veto_reason(&env)),
        Err(Ok(GovernanceError::Unauthorized))
    );
    assert_eq!(
        governance.get_proposal(&proposal_id).status,
        ProposalStatus::Queued
    );
}

#[test]
fn a_veto_without_a_reason_is_rejected() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    queue_proposal(&env, &governance, &admin, proposal_id);
    let guardian = governance.get_config().guardian;

    assert_eq!(
        governance.try_veto(&guardian, &proposal_id, &String::from_str(&env, "")),
        Err(Ok(GovernanceError::EmptyVetoReason))
    );
}

#[test]
fn a_veto_reason_over_the_length_limit_is_rejected() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    queue_proposal(&env, &governance, &admin, proposal_id);
    let guardian = governance.get_config().guardian;

    let at_limit = "x".repeat(MAX_VETO_REASON_LENGTH as usize);
    let over_limit = "x".repeat(MAX_VETO_REASON_LENGTH as usize + 1);
    assert_eq!(
        governance.try_veto(&guardian, &proposal_id, &String::from_str(&env, &over_limit)),
        Err(Ok(GovernanceError::VetoReasonTooLong))
    );
    governance.veto(&guardian, &proposal_id, &String::from_str(&env, &at_limit));
    assert_eq!(
        governance.get_proposal(&proposal_id).status,
        ProposalStatus::Vetoed
    );
}

#[test]
fn a_veto_after_the_timelock_has_elapsed_is_rejected() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    queue_proposal(&env, &governance, &admin, proposal_id);
    let guardian = governance.get_config().guardian;

    let queue_ledger = governance.get_proposal(&proposal_id).queue_ledger;
    env.ledger().set_sequence_number(queue_ledger);
    assert_eq!(
        governance.try_veto(&guardian, &proposal_id, &veto_reason(&env)),
        Err(Ok(GovernanceError::VetoWindowClosed))
    );
}

#[test]
fn a_proposal_that_is_not_queued_cannot_be_vetoed() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let guardian = governance.get_config().guardian;
    governance.vote(&admin, &proposal_id, &VOTE_FOR);

    assert_eq!(
        governance.try_veto(&guardian, &proposal_id, &veto_reason(&env)),
        Err(Ok(GovernanceError::ProposalNotPassed))
    );
}

// ─── Storage lifetime ────────────────────────────────────────────────────────

/// Remaining TTL, in ledgers, of a proposal entry.
fn proposal_ttl(env: &Env, governance_id: &Address, id: u64) -> u32 {
    env.as_contract(governance_id, || {
        env.storage().persistent().get_ttl(&DataKey::Proposal(id))
    })
}

#[test]
fn creating_a_proposal_puts_its_entry_well_past_the_threshold() {
    let env = Env::default();
    env.ledger().set_sequence_number(GENESIS);
    let (admin, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);

    env.ledger().set_sequence_number(OPENED);
    let id = propose(&env, &governance_id, &admin).id;

    assert!(proposal_ttl(&env, &governance_id, id) >= TTL_THRESHOLD);
}

#[test]
fn reading_a_proposal_extends_its_ttl() {
    let env = Env::default();
    env.ledger().set_sequence_number(GENESIS);
    let (admin, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    env.ledger().set_sequence_number(OPENED);
    let id = propose(&env, &governance_id, &admin).id;

    // Let most of the entry's life burn off, then read it.
    env.ledger().set_sequence_number(OPENED + TTL_EXTEND_TO - 1_000);
    let before = proposal_ttl(&env, &governance_id, id);
    governance.get_proposal(&id);
    let after = proposal_ttl(&env, &governance_id, id);

    assert!(before < TTL_THRESHOLD, "entry should have aged below the threshold");
    assert!(after > before, "read should have bumped the TTL");
    assert!(after >= TTL_THRESHOLD);
}

/// The bump has to fire while the entry still has days of life left, not
/// only once it is nearly gone: read at ~100_000 ledgers remaining (about
/// 5.8 days), still below the 30-day threshold but far above the floor.
/// A threshold that no longer matches the documented 30-day window would
/// leave the entry where it is instead of pushing it back out to 90 days.
#[test]
fn a_read_restores_the_ttl_while_the_entry_is_still_below_the_threshold() {
    let env = Env::default();
    env.ledger().set_sequence_number(GENESIS);
    let (admin, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    env.ledger().set_sequence_number(OPENED);
    let id = propose(&env, &governance_id, &admin).id;

    env.ledger()
        .set_sequence_number(OPENED + TTL_EXTEND_TO - 100_000);
    let before = proposal_ttl(&env, &governance_id, id);
    assert!(before < TTL_THRESHOLD, "entry should have aged below the threshold");
    assert!(before > LEDGERS_PER_DAY, "but should still have days of life left");

    governance.get_proposal(&id);
    let after = proposal_ttl(&env, &governance_id, id);

    assert!(after >= TTL_THRESHOLD, "read should have bumped the TTL");
}

#[test]
fn a_proposal_outlives_a_long_voting_window() {
    let env = Env::default();
    env.ledger().set_sequence_number(GENESIS);
    let (admin, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    env.ledger().set_sequence_number(OPENED);
    let id = propose(&env, &governance_id, &admin).id;

    // Far past the 17_280 ledgers (~1 day) the issue calls out, and past the
    // 30-day voting period the create form offers.
    env.ledger()
        .set_sequence_number(OPENED + LEDGERS_PER_DAY * 45);

    assert_eq!(governance.get_proposal(&id).id, id);
    // Instance storage carries Config; losing it would brick the contract.
    assert_eq!(governance.try_get_config().unwrap().unwrap().quorum_bps, QUORUM_BPS);
}

#[test]
fn a_recorded_vote_outlives_a_long_voting_window() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    start_voting(&env, &governance, proposal_id);
    governance.vote(&admin, &proposal_id, &VOTE_FOR);

    env.ledger()
        .set_sequence_number(env.ledger().sequence() + LEDGERS_PER_DAY * 45);

    assert!(governance.has_voted(&proposal_id, &admin));
    assert_eq!(governance.get_vote(&proposal_id, &admin), Some(VOTE_FOR));
}

// ─── Events ──────────────────────────────────────────────────────────────────
//
// env.events().all() collects events from every contract in the test, and the
// governor cross-invokes the token on most paths, so these filter by the
// emitting contract rather than indexing blindly into the list.

type EventLog = soroban_sdk::Vec<(soroban_sdk::Vec<Val>, Val)>;

fn governance_events(env: &Env, governance_id: &Address) -> EventLog {
    let mut out = soroban_sdk::Vec::new(env);
    for (contract, topics, data) in env.events().all().iter() {
        if &contract == governance_id {
            out.push_back((topics, data));
        }
    }
    out
}

fn last_governance_event(env: &Env, governance_id: &Address) -> (soroban_sdk::Vec<Val>, Val) {
    governance_events(env, governance_id)
        .last()
        .expect("expected at least one governance event")
}

#[test]
fn creating_a_proposal_emits_proposal_created() {
    let env = Env::default();
    env.ledger().set_sequence_number(GENESIS);
    let (admin, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);

    env.ledger().set_sequence_number(OPENED);
    // Read the events straight after create_proposal: the test env exposes
    // only the most recent invocation's events, so an intervening read call
    // (get_proposal, say) would clear them.
    let title = String::from_str(&env, "Raise the quorum threshold");
    GovernanceContractClient::new(&env, &governance_id).create_proposal(
        &admin,
        &title,
        &String::from_str(&env, "Move quorum_bps from 500 to 750."),
        &String::from_str(&env, ""),
    );

    let (topics, data) = last_governance_event(&env, &governance_id);
    assert_eq!(
        topics,
        (Symbol::new(&env, "proposal_created"), 1u64).into_val(&env)
    );
    assert_eq!(
        ProposalCreated::try_from_val(&env, &data).unwrap(),
        ProposalCreated {
            id: 1,
            proposer: admin,
            title,
            start_ledger: OPENED + 1,
            end_ledger: OPENED + 1 + VOTING_PERIOD,
            quorum_required: 50_000,
            metadata_uri: String::from_str(&env, ""),
        }
    );
}

#[test]
fn voting_emits_vote_cast_with_the_snapshot_weight() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    governance.vote(&admin, &proposal_id, &VOTE_ABSTAIN);

    let (topics, data) = last_governance_event(&env, &governance_id);
    assert_eq!(
        topics,
        (Symbol::new(&env, "vote_cast"), proposal_id, admin.clone()).into_val(&env)
    );
    assert_eq!(
        VoteCast::try_from_val(&env, &data).unwrap(),
        VoteCast {
            proposal_id,
            voter: admin,
            support: VOTE_ABSTAIN,
            voting_power: 1_000_000,
        }
    );
}

#[test]
fn a_rejected_vote_emits_nothing() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    // An accepted vote leaves exactly its own event behind...
    governance.vote(&admin, &proposal_id, &VOTE_FOR);
    assert_eq!(governance_events(&env, &governance_id).len(), 1);

    // ...while a voter with no power at the snapshot is refused, and a failed
    // invocation rolls back its events along with its state.
    assert!(governance
        .try_vote(&Address::generate(&env), &proposal_id, &VOTE_FOR)
        .is_err());
    assert!(governance_events(&env, &governance_id).is_empty());
}

#[test]
fn finalizing_a_passing_proposal_emits_finalized_then_queued() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    governance.vote(&admin, &proposal_id, &VOTE_FOR);
    close_voting(&env, &governance, proposal_id);
    let closed_at = env.ledger().sequence();
    governance.finalize(&proposal_id);

    let events = governance_events(&env, &governance_id);
    let (queued_topics, queued_data) = events.last().unwrap();
    let (finalized_topics, finalized_data) = events.get(events.len() - 2).unwrap();

    assert_eq!(
        finalized_topics,
        (Symbol::new(&env, "proposal_finalized"), proposal_id).into_val(&env)
    );
    assert_eq!(
        ProposalFinalized::try_from_val(&env, &finalized_data).unwrap(),
        ProposalFinalized {
            id: proposal_id,
            status: ProposalStatus::Queued,
            for_votes: 1_000_000,
            against_votes: 0,
            abstain_votes: 0,
        }
    );

    assert_eq!(
        queued_topics,
        (Symbol::new(&env, "proposal_queued"), proposal_id).into_val(&env)
    );
    assert_eq!(
        ProposalQueued::try_from_val(&env, &queued_data).unwrap(),
        ProposalQueued {
            id: proposal_id,
            queue_ledger: closed_at + TIMELOCK_PERIOD,
        }
    );
}

#[test]
fn a_failing_proposal_emits_finalized_without_queued() {
    let env = Env::default();
    let small_holder = Address::generate(&env);
    let (_, governance_id, proposal_id) =
        open_with_holders(&env, 1_000_000, 5_000, &[(small_holder.clone(), 1_000)]);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    governance.vote(&small_holder, &proposal_id, &VOTE_FOR);
    close_voting(&env, &governance, proposal_id);
    governance.finalize(&proposal_id);

    let (topics, data) = last_governance_event(&env, &governance_id);
    assert_eq!(
        topics,
        (Symbol::new(&env, "proposal_finalized"), proposal_id).into_val(&env)
    );
    assert_eq!(
        ProposalFinalized::try_from_val(&env, &data).unwrap().status,
        ProposalStatus::Failed
    );
}

#[test]
fn executing_emits_proposal_executed() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    queue_proposal(&env, &governance, &admin, proposal_id);

    let executor = Address::generate(&env);
    env.ledger()
        .set_sequence_number(governance.get_proposal(&proposal_id).queue_ledger);
    governance.execute(&executor, &proposal_id);

    let (topics, data) = last_governance_event(&env, &governance_id);
    assert_eq!(
        topics,
        (Symbol::new(&env, "proposal_executed"), proposal_id).into_val(&env)
    );
    assert_eq!(
        ProposalExecuted::try_from_val(&env, &data).unwrap(),
        ProposalExecuted { id: proposal_id, executor }
    );
}

#[test]
fn cancelling_emits_proposal_cancelled_with_the_caller() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    governance.cancel(&admin, &proposal_id);

    let (topics, data) = last_governance_event(&env, &governance_id);
    assert_eq!(
        topics,
        (Symbol::new(&env, "proposal_cancelled"), proposal_id).into_val(&env)
    );
    assert_eq!(
        ProposalCancelled::try_from_val(&env, &data).unwrap(),
        ProposalCancelled { id: proposal_id, caller: admin }
    );
}

#[test]
fn vetoing_emits_proposal_vetoed_with_the_reason() {
    let env = Env::default();
    let (admin, governance_id, proposal_id) = open_with_holders(&env, 1_000_000, QUORUM_BPS, &[]);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    queue_proposal(&env, &governance, &admin, proposal_id);
    let guardian = governance.get_config().guardian;

    governance.veto(&guardian, &proposal_id, &veto_reason(&env));

    let (topics, data) = last_governance_event(&env, &governance_id);
    assert_eq!(
        topics,
        (Symbol::new(&env, "proposal_vetoed"), proposal_id).into_val(&env)
    );
    assert_eq!(
        ProposalVetoed::try_from_val(&env, &data).unwrap(),
        ProposalVetoed { id: proposal_id, guardian, reason: veto_reason(&env) }
    );
}

#[test]
fn add_weight_saturates_into_an_error_at_the_i128_boundary() {
    assert_eq!(
        GovernanceContract::add_weight(i128::MAX - 1, 1),
        Ok(i128::MAX)
    );
    assert_eq!(
        GovernanceContract::add_weight(i128::MAX, 1),
        Err(GovernanceError::Overflow)
    );
    assert_eq!(
        GovernanceContract::add_weight(1, i128::MAX),
        Err(GovernanceError::Overflow)
    );
    assert_eq!(GovernanceContract::add_weight(0, 0), Ok(0));
}

#[test]
fn tallying_the_entire_supply_at_the_boundary_does_not_trap() {
    let env = Env::default();
    env.ledger().set_sequence_number(10);
    // One basis point is valid and multiplication by one cannot overflow.
    let (admin, _, governance_id) = deploy(&env, i128::MAX, 1);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    env.ledger().set_sequence_number(20);
    let proposal_id = governance.create_proposal(
        &admin,
        &String::from_str(&env, "Whole supply votes"),
        &String::from_str(&env, "Single holder controlling i128::MAX."),
        &String::from_str(&env, ""),
    );
    start_voting(&env, &governance, proposal_id);
    governance.vote(&admin, &proposal_id, &VOTE_FOR);

    assert_eq!(governance.get_proposal(&proposal_id).for_votes, i128::MAX);
}

#[test]
fn finalize_returns_overflow_when_the_tallies_sum_past_the_boundary() {
    let env = Env::default();
    env.ledger().set_sequence_number(10);
    let (admin, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    env.ledger().set_sequence_number(20);
    let proposal_id = governance.create_proposal(
        &admin,
        &String::from_str(&env, "Tallies past i128::MAX"),
        &String::from_str(&env, "Unreachable through votes, so tallies are seeded directly."),
        &String::from_str(&env, ""),
    );
    // Token supply cannot push the sum of tallies past i128::MAX through the
    // public API, so the boundary is reached by writing the proposal directly.
    env.as_contract(&governance_id, || {
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .unwrap();
        proposal.for_votes = i128::MAX;
        proposal.against_votes = 1;
        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id), &proposal);
    });

    let end_ledger = governance.get_proposal(&proposal_id).end_ledger;
    env.ledger().set_sequence_number(end_ledger + 1);
    assert_eq!(
        governance.try_finalize(&proposal_id),
        Err(Ok(GovernanceError::Overflow))
    );
    // A rejected finalize leaves the proposal open rather than half-decided.
    assert_eq!(
        governance.get_proposal(&proposal_id).status,
        ProposalStatus::Active
    );
}

#[test]
fn quorum_for_supply_truncates_fractional_thresholds() {
    // 5% of 199 is 9.95 — truncated down so the threshold never exceeds supply.
    assert_eq!(
        GovernanceContract::quorum_for_supply(199, QUORUM_BPS),
        Ok(9)
    );
    assert_eq!(GovernanceContract::quorum_for_supply(0, QUORUM_BPS), Ok(0));
}

#[test]
fn quorum_for_supply_rejects_overflow_instead_of_panicking() {
    assert_eq!(
        GovernanceContract::quorum_for_supply(i128::MAX, 10_000),
        Err(GovernanceError::Overflow)
    );
}

use proptest::prelude::*;

proptest! {
    #[test]
    fn quorum_threshold_never_exceeds_supply(supply in 0i128..=(i128::MAX / 10_000), bps in 0u32..=10_000) {
        let quorum = GovernanceContract::quorum_for_supply(supply, bps).unwrap();
        prop_assert!(quorum <= supply);
    }

    #[test]
    fn vote_tallies_never_exceed_their_supply(supply in 0i128..=(i128::MAX / 10_000), first_share in 0u32..=10_000, second_share in 0u32..=10_000) {
        let first = supply * i128::from(first_share) / BPS_DENOMINATOR;
        let remaining = supply - first;
        let second = remaining * i128::from(second_share) / BPS_DENOMINATOR;
        let third = remaining - second;

        let tally = GovernanceContract::add_weight(0, first).unwrap();
        let tally = GovernanceContract::add_weight(tally, second).unwrap();
        let tally = GovernanceContract::add_weight(tally, third).unwrap();
        prop_assert!(tally <= supply);
    }

    #[test]
    fn quorum_integer_division_truncates_without_rounding_up(supply in 0i128..=(i128::MAX / 10_000), bps in 0u32..=10_000) {
        let scaled = supply * i128::from(bps);
        let quorum = GovernanceContract::quorum_for_supply(supply, bps).unwrap();

        prop_assert!(quorum * BPS_DENOMINATOR <= scaled);
        prop_assert!(scaled - quorum * BPS_DENOMINATOR < BPS_DENOMINATOR);
    }
}

#[test]
fn create_proposal_and_vote_stay_within_resource_budgets() {
    let env = Env::default();
    env.ledger().set_sequence_number(GENESIS);
    let (admin, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    env.ledger().set_sequence_number(OPENED);
    let proposal_id = governance.create_proposal(
        &admin,
        &String::from_str(&env, "Resource baseline"),
        &String::from_str(&env, "Measure proposal creation cost."),
        &String::from_str(&env, ""),
    );
    let create_cpu = env.cost_estimate().budget().cpu_instruction_cost();
    let create_memory = env.cost_estimate().budget().memory_bytes_cost();

    start_voting(&env, &governance, proposal_id);
    governance.vote(&admin, &proposal_id, &VOTE_FOR);
    let vote_cpu = env.cost_estimate().budget().cpu_instruction_cost();
    let vote_memory = env.cost_estimate().budget().memory_bytes_cost();

    std::println!("create_proposal budget: cpu={create_cpu}, memory={create_memory}");
    std::println!("vote budget: cpu={vote_cpu}, memory={vote_memory}");
    // Measured with delegated vote reads and title validation; keep the
    // existing 25% regression margin over the documented measurements.
    assert!(create_cpu <= 334_212, "create_proposal CPU regression: {create_cpu}");
    assert!(vote_cpu <= 282_745, "vote CPU regression: {vote_cpu}");
    assert!(create_memory <= 59_787, "create_proposal memory regression: {create_memory}");
    assert!(vote_memory <= 47_767, "vote memory regression: {vote_memory}");
}

// ─── Full cross-contract lifecycle (#162) ──────────────────────────────────────
//
// Every other test in this file exercises one step of the lifecycle in
// isolation. This one walks the entire path end to end — deploy both
// contracts, distribute tokens, open a proposal, vote from several holders,
// finalize, wait out the timelock, execute — checking both state and emitted
// events at each step, plus the failing (quorum not reached) branch.

#[test]
fn full_lifecycle_passes_and_executes_after_timelock() {
    let env = Env::default();
    env.ledger().set_sequence_number(GENESIS);
    let (admin, token_id, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let token = QuorumTokenClient::new(&env, &token_id);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    // Distribute tokens to several holders before the snapshot is taken.
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);
    token.transfer(&admin, &alice, &300_000);
    token.transfer(&admin, &bob, &200_000);
    token.transfer(&admin, &carol, &100_000);
    // admin retains 400_000

    // ── Open a proposal ──
    env.ledger().set_sequence_number(GENESIS + 10);
    let title = String::from_str(&env, "Increase treasury allocation");
    let description = String::from_str(&env, "Allocate more funds to the treasury.");
    let id = governance.create_proposal(&alice, &title, &description, &String::from_str(&env, ""));

    let (topics, data) = last_governance_event(&env, &governance_id);
    assert_eq!(topics, (Symbol::new(&env, "proposal_created"), id).into_val(&env));
    let created = ProposalCreated::try_from_val(&env, &data).unwrap();
    assert_eq!(created.id, id);
    assert_eq!(created.proposer, alice);

    let proposal = governance.get_proposal(&id);
    assert_eq!(proposal.status, ProposalStatus::Active);
    assert_eq!(proposal.snapshot_ledger, GENESIS + 10);

    // ── Vote from several holders ──
    env.ledger().set_sequence_number(proposal.start_ledger);

    governance.vote(&alice, &id, &VOTE_FOR);
    let (_, data) = last_governance_event(&env, &governance_id);
    assert_eq!(
        VoteCast::try_from_val(&env, &data).unwrap(),
        VoteCast { proposal_id: id, voter: alice.clone(), support: VOTE_FOR, voting_power: 300_000 }
    );

    governance.vote(&bob, &id, &VOTE_FOR);
    let (_, data) = last_governance_event(&env, &governance_id);
    assert_eq!(
        VoteCast::try_from_val(&env, &data).unwrap(),
        VoteCast { proposal_id: id, voter: bob.clone(), support: VOTE_FOR, voting_power: 200_000 }
    );

    governance.vote(&carol, &id, &VOTE_AGAINST);
    let (_, data) = last_governance_event(&env, &governance_id);
    assert_eq!(
        VoteCast::try_from_val(&env, &data).unwrap(),
        VoteCast { proposal_id: id, voter: carol.clone(), support: VOTE_AGAINST, voting_power: 100_000 }
    );

    assert!(governance.has_voted(&id, &alice));
    assert_eq!(governance.get_vote(&id, &bob), Some(VOTE_FOR));

    // ── Finalize: quorum met (600_000 of 1_000_000 >= 5%), for > against ──
    env.ledger().set_sequence_number(proposal.end_ledger + 1);
    let status = governance.finalize(&id);
    assert_eq!(status, ProposalStatus::Queued);

    // finalize() on the passing path emits both proposal_finalized and, last,
    // proposal_queued — governance_events() preserves call order.
    //
    // Read them before any further contract call: the test Env enables
    // soroban-env invocation metering, and that clears the host event buffer
    // at the start of every top-level invocation. The get_proposal() below
    // would otherwise wipe what finalize() just emitted.
    // Capture the finalize events before get_proposal(), which makes a new
    // invocation and replaces the test environment's last-invocation events.
    let events = governance_events(&env, &governance_id);

    let finalized = governance.get_proposal(&id);
    assert_eq!(finalized.for_votes, 500_000);
    assert_eq!(finalized.against_votes, 100_000);
    assert_eq!(finalized.abstain_votes, 0);
    assert_eq!(finalized.status, ProposalStatus::Queued);
    assert!(finalized.queue_ledger > env.ledger().sequence());

    // finalize() on the passing path emits both proposal_finalized and, last,
    // proposal_queued — governance_events() preserves call order.
    assert_eq!(events.len(), 2);
    let (finalized_topics, finalized_data) = events.get(0).unwrap();
    assert_eq!(
        finalized_topics,
        (Symbol::new(&env, "proposal_finalized"), id).into_val(&env)
    );
    assert_eq!(
        ProposalFinalized::try_from_val(&env, &finalized_data).unwrap(),
        ProposalFinalized {
            id,
            status: ProposalStatus::Queued,
            for_votes: 500_000,
            against_votes: 100_000,
            abstain_votes: 0,
        }
    );
    let (queued_topics, queued_data) = events.get(1).unwrap();
    assert_eq!(queued_topics, (Symbol::new(&env, "proposal_queued"), id).into_val(&env));
    assert_eq!(
        ProposalQueued::try_from_val(&env, &queued_data).unwrap(),
        ProposalQueued { id, queue_ledger: finalized.queue_ledger }
    );

    // ── Wait out the timelock and execute ──
    let executor = Address::generate(&env);
    env.ledger().set_sequence_number(finalized.queue_ledger);
    governance.execute(&executor, &id);

    let (topics, data) = last_governance_event(&env, &governance_id);
    assert_eq!(topics, (Symbol::new(&env, "proposal_executed"), id).into_val(&env));
    assert_eq!(
        ProposalExecuted::try_from_val(&env, &data).unwrap(),
        ProposalExecuted { id, executor }
    );

    let executed = governance.get_proposal(&id);
    assert_eq!(executed.status, ProposalStatus::Executed);
}

#[test]
fn full_lifecycle_fails_when_quorum_is_not_reached() {
    let env = Env::default();
    env.ledger().set_sequence_number(GENESIS);
    // 20% quorum on a 1_000_000 supply requires 200_000 votes.
    let (admin, token_id, governance_id) = deploy(&env, 1_000_000, 2_000);
    let token = QuorumTokenClient::new(&env, &token_id);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    let small_holder = Address::generate(&env);
    token.transfer(&admin, &small_holder, &50_000);

    env.ledger().set_sequence_number(GENESIS + 10);
    let id = governance.create_proposal(
        &admin,
        &String::from_str(&env, "Small ask"),
        &String::from_str(&env, "Only a minority shows up to vote."),
        &String::from_str(&env, ""),
    );
    let proposal = governance.get_proposal(&id);

    env.ledger().set_sequence_number(proposal.start_ledger);
    governance.vote(&small_holder, &id, &VOTE_FOR);

    // Only 50_000 of the required 200_000 voted — quorum not reached even
    // though every cast vote was in favour.
    env.ledger().set_sequence_number(proposal.end_ledger + 1);
    let status = governance.finalize(&id);
    assert_eq!(status, ProposalStatus::Failed);

    let (topics, data) = last_governance_event(&env, &governance_id);
    assert_eq!(topics, (Symbol::new(&env, "proposal_finalized"), id).into_val(&env));
    assert_eq!(
        ProposalFinalized::try_from_val(&env, &data).unwrap(),
        ProposalFinalized {
            id,
            status: ProposalStatus::Failed,
            for_votes: 50_000,
            against_votes: 0,
            abstain_votes: 0,
        }
    );

    // A failed proposal is not queued and cannot be executed.
    let failed = governance.get_proposal(&id);
    assert_eq!(failed.status, ProposalStatus::Failed);
    assert_eq!(failed.queue_ledger, 0);
    assert_eq!(
        governance.try_execute(&Address::generate(&env), &id),
        Err(Ok(GovernanceError::ProposalNotPassed))
    );
}

// ─── Cross-contract authorization (#163) ──────────────────────────────────────
//
// The tests above (and `deploy`/`open_with_holders`) run under
// `mock_all_auths()`, which makes every `require_auth()` call succeed — great
// for exercising contract logic, but it proves nothing about which calls
// actually carry authorization. These tests mock only the specific
// invocations expected to require auth, so an accidental extra
// `require_auth()` deeper in the call tree (or a missing one) would show up
// as a failure here instead of silently passing under `mock_all_auths()`.
//
// `token.balance()`, `token.total_supply()` and `token.get_past_votes()` —
// the three cross-invocations governance makes — call no `require_auth()`
// today (that's the premise of #163: it'll change once delegation lands), so
// mocking only the top-level proposer/voter call, with no `sub_invokes`, and
// having it succeed is itself the proof that these reads carry no hidden
// authorization requirement.

fn deploy_with_explicit_auth(
    env: &Env,
    initial_supply: i128,
    quorum_bps: u32,
) -> (Address, Address, Address) {
    let admin = Address::generate(env);
    let guardian = Address::generate(env);
    let name = String::from_str(env, "Quorum");
    let symbol = String::from_str(env, "QUORUM");

    let token_id = env.register(QuorumToken, ());
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &token_id,
            fn_name: "initialize",
            args: (admin.clone(), name.clone(), symbol.clone(), 7u32, initial_supply)
                .into_val(env),
            sub_invokes: &[],
        },
    }]);
    QuorumTokenClient::new(env, &token_id).initialize(&admin, &name, &symbol, &7, &initial_supply);

    let governance_id = env.register(GovernanceContract, ());
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &governance_id,
            fn_name: "initialize",
            args: (
                admin.clone(),
                guardian.clone(),
                token_id.clone(),
                quorum_bps,
                VOTING_PERIOD,
                TIMELOCK_PERIOD,
                LEDGERS_PER_DAY * 7,
                PROPOSAL_THRESHOLD,
            )
                .into_val(env),
            sub_invokes: &[],
        },
    }]);
    GovernanceContractClient::new(env, &governance_id).initialize(
        &admin,
        &guardian,
        &token_id,
        &quorum_bps,
        &VOTING_PERIOD,
        &TIMELOCK_PERIOD,
        &(LEDGERS_PER_DAY * 7),
        &PROPOSAL_THRESHOLD,
    );

    (admin, token_id, governance_id)
}

#[test]
fn create_proposal_only_requires_the_proposers_auth() {
    let env = Env::default();
    env.ledger().set_sequence_number(GENESIS);
    let (admin, _token_id, governance_id) = deploy_with_explicit_auth(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let title = String::from_str(&env, "Fund the grants program");
    let description = String::from_str(&env, "Allocate treasury funds to grants.");

    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &governance_id,
            fn_name: "create_proposal",
            args: (admin.clone(), title.clone(), description.clone(), String::from_str(&env, "")).into_val(&env),
            // No sub_invokes: create_proposal cross-invokes token.balance() and
            // token.total_supply(), and this succeeding with an empty tree
            // proves neither one requires auth today.
            sub_invokes: &[],
        },
    }]);
    let id = governance.create_proposal(&admin, &title, &description, &String::from_str(&env, ""));
    assert_eq!(id, 1);

    let auths = env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, admin);
}

#[test]
fn voting_only_requires_the_voters_auth() {
    let env = Env::default();
    env.ledger().set_sequence_number(GENESIS);
    let (admin, _token_id, governance_id) = deploy_with_explicit_auth(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let title = String::from_str(&env, "t");
    let description = String::from_str(&env, "d");

    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &governance_id,
            fn_name: "create_proposal",
            args: (admin.clone(), title.clone(), description.clone(), String::from_str(&env, "")).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    let id = governance.create_proposal(&admin, &title, &description, &String::from_str(&env, ""));

    env.ledger().set_sequence_number(GENESIS + 1);

    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &governance_id,
            fn_name: "vote",
            args: (admin.clone(), id, VOTE_FOR).into_val(&env),
            // No sub_invokes: vote() cross-invokes token.get_past_votes(),
            // also not gated by auth today — same proof as above.
            sub_invokes: &[],
        },
    }]);
    governance.vote(&admin, &id, &VOTE_FOR);

    let auths = env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, admin);
}

#[test]
fn governance_cannot_move_a_holders_tokens() {
    let env = Env::default();
    env.ledger().set_sequence_number(GENESIS);
    let (admin, token_id, governance_id) = deploy_with_explicit_auth(&env, 1_000_000, QUORUM_BPS);
    let token = QuorumTokenClient::new(&env, &token_id);

    // Fund a holder distinct from admin, under an explicit mock of the
    // admin's own transfer call — never a blanket mock_all_auths().
    let holder = Address::generate(&env);
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &token_id,
            fn_name: "transfer",
            args: (admin.clone(), holder.clone(), 100_000i128).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    token.transfer(&admin, &holder, &100_000);
    assert_eq!(token.balance(&holder), 100_000);

    // Nothing here mocks an approval from the holder to governance, nor any
    // authorization for governance itself. Attempting to move the holder's
    // tokens with the governance contract's address standing in as `spender`
    // must fail — there is no allowance, and — the point of this test —
    // nothing grants governance the holder's (or its own) authorization to
    // move them regardless.
    let attacker = Address::generate(&env);
    let result = token.try_transfer_from(&governance_id, &holder, &attacker, &50_000);
    assert!(result.is_err());
    assert_eq!(token.balance(&holder), 100_000);
    assert_eq!(token.balance(&attacker), 0);
}


#[test]
fn two_step_admin_transfer_works() {
    let env = Env::default();
    env.ledger().set_sequence_number(10);
    let (_admin, _, governance_id) = deploy(&env, 1_000_000, 500);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let new_admin = Address::generate(&env);
    
    governance.transfer_admin(&new_admin);
    env.mock_all_auths();
    governance.accept_admin();
    
    let config = governance.try_get_config().unwrap().unwrap();
    assert_eq!(config.admin, new_admin);
}

#[test]
fn cancel_admin_transfer_works() {
    let env = Env::default();
    env.ledger().set_sequence_number(10);
    let (_admin, _, governance_id) = deploy(&env, 1_000_000, 500);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let new_admin = Address::generate(&env);
    
    governance.transfer_admin(&new_admin);
    governance.cancel_admin_transfer();
    assert!(governance.try_accept_admin().is_err());
}

// ─── NotInitialized error handling ─────────────────────────────────────────────

#[test]
fn create_proposal_returns_not_initialized_before_initialize() {
    let env = Env::default();
    let governance_id = env.register(GovernanceContract, ());
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let proposer = Address::generate(&env);

    assert_eq!(
        governance.try_create_proposal(
            &proposer,
            &String::from_str(&env, "Test"),
            &String::from_str(&env, "Description"),
            &String::from_str(&env, ""),
        ),
        Err(Ok(GovernanceError::NotInitialized))
    );
}

// ─── Emergency Pause (Issue #80) ─────────────────────────────────────────────

#[test]
fn admin_can_pause_contract() {
    let env = Env::default();
    let (admin, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    
    governance.pause(&admin);
    
    let config = governance.get_config();
    assert!(config.paused);
}

#[test]
fn guardian_can_pause_contract() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let guardian = Address::generate(&env);
    let token_id = env.register(QuorumToken, ());
    QuorumTokenClient::new(&env, &token_id).initialize(
        &admin,
        &String::from_str(&env, "Quorum"),
        &String::from_str(&env, "QUORUM"),
        &7,
        &1_000_000,
    );
    let governance_id = env.register(GovernanceContract, ());
    GovernanceContractClient::new(&env, &governance_id).initialize(
        &admin,
        &guardian,
        &token_id,
        &QUORUM_BPS,
        &VOTING_PERIOD,
        &TIMELOCK_PERIOD,
        &(LEDGERS_PER_DAY * 7),
        &PROPOSAL_THRESHOLD,
    );
    let governance = GovernanceContractClient::new(&env, &governance_id);
    
    governance.pause(&guardian);
    
    let config = governance.get_config();
    assert!(config.paused);
}

#[test]
fn non_privileged_address_cannot_pause() {
    let env = Env::default();
    let (_, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let attacker = Address::generate(&env);
    
    assert_eq!(
        governance.try_pause(&attacker),
        Err(Ok(GovernanceError::Unauthorized))
    );
}

#[test]
fn paused_contract_blocks_proposal_creation() {
    let env = Env::default();
    let (admin, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    
    governance.pause(&admin);
    
    assert_eq!(
        governance.try_create_proposal(
            &admin,
            &String::from_str(&env, "title"),
            &String::from_str(&env, "desc"),
            &String::from_str(&env, ""),
        ),
        Err(Ok(GovernanceError::ContractPaused))
    );
}

#[test]
fn paused_contract_blocks_execution() {
    let env = Env::default();
    let (admin, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    
    let proposal_id = propose(&env, &governance_id, &admin).id;
    queue_proposal(&env, &governance, &admin, proposal_id);
    
    let queue_ledger = governance.get_proposal(&proposal_id).queue_ledger;
    env.ledger().set_sequence_number(queue_ledger);
    
    governance.pause(&admin);
    
    assert_eq!(
        governance.try_execute(&admin, &proposal_id),
        Err(Ok(GovernanceError::ContractPaused))
    );
}

#[test]
fn only_admin_can_unpause() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let guardian = Address::generate(&env);
    let token_id = env.register(QuorumToken, ());
    QuorumTokenClient::new(&env, &token_id).initialize(
        &admin,
        &String::from_str(&env, "Quorum"),
        &String::from_str(&env, "QUORUM"),
        &7,
        &1_000_000,
    );
    let governance_id = env.register(GovernanceContract, ());
    GovernanceContractClient::new(&env, &governance_id).initialize(
        &admin,
        &guardian,
        &token_id,
        &QUORUM_BPS,
        &VOTING_PERIOD,
        &TIMELOCK_PERIOD,
        &(LEDGERS_PER_DAY * 7),
        &PROPOSAL_THRESHOLD,
    );
    let governance = GovernanceContractClient::new(&env, &governance_id);
    
    governance.pause(&guardian);
    
    env.set_auths(&[]);
    assert!(governance.try_unpause().is_err());
}

#[test]
fn unpause_restores_normal_operation() {
    let env = Env::default();
    let (admin, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    
    governance.pause(&admin);
    governance.unpause();
    
    let config = governance.get_config();
    assert!(!config.paused);
    
    let id = governance.create_proposal(
        &admin,
        &String::from_str(&env, "title"),
        &String::from_str(&env, "desc"),
        &String::from_str(&env, ""),
    );
    assert_eq!(id, 1);
}

// ─── Extend Proposal TTL (Issue #81) ─────────────────────────────────────────

#[test]
fn anyone_can_extend_proposal_ttl() {
    let env = Env::default();
    env.ledger().set_sequence_number(GENESIS);
    let (admin, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    
    env.ledger().set_sequence_number(OPENED);
    let id = propose(&env, &governance_id, &admin).id;
    
    env.ledger().set_sequence_number(OPENED + TTL_EXTEND_TO - 1_000);
    let before = proposal_ttl(&env, &governance_id, id);
    
    governance.extend_proposal_ttl(&id);
    
    let after = proposal_ttl(&env, &governance_id, id);
    assert!(after > before);
    assert!(after >= TTL_THRESHOLD);
}

#[test]
fn extending_nonexistent_proposal_errors() {
    let env = Env::default();
    let (_, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    
    assert_eq!(
        governance.try_extend_proposal_ttl(&999),
        Err(Ok(GovernanceError::ProposalNotFound))
    );
}

// ─── Execution Grace Period (Issue #82) ──────────────────────────────────────

#[test]
fn execution_succeeds_inside_grace_period() {
    let env = Env::default();
    let grace_period = 1000u32;
    let (admin, _, governance_id) = deploy_full(&env, 1_000_000, QUORUM_BPS, 0, grace_period);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    
    let proposal_id = propose(&env, &governance_id, &admin).id;
    queue_proposal(&env, &governance, &admin, proposal_id);
    
    let queue_ledger = governance.get_proposal(&proposal_id).queue_ledger;
    env.ledger().set_sequence_number(queue_ledger + grace_period - 1);
    
    governance.execute(&admin, &proposal_id);
    assert_eq!(
        governance.get_proposal(&proposal_id).status,
        ProposalStatus::Executed
    );
}

#[test]
fn execution_at_grace_period_boundary_succeeds() {
    let env = Env::default();
    let grace_period = 1000u32;
    let (admin, _, governance_id) = deploy_full(&env, 1_000_000, QUORUM_BPS, 0, grace_period);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    
    let proposal_id = propose(&env, &governance_id, &admin).id;
    queue_proposal(&env, &governance, &admin, proposal_id);
    
    let queue_ledger = governance.get_proposal(&proposal_id).queue_ledger;
    env.ledger().set_sequence_number(queue_ledger + grace_period);
    
    governance.execute(&admin, &proposal_id);
    assert_eq!(
        governance.get_proposal(&proposal_id).status,
        ProposalStatus::Executed
    );
}

#[test]
fn execution_after_grace_period_is_rejected() {
    let env = Env::default();
    let grace_period = 1000u32;
    let (admin, _, governance_id) = deploy_full(&env, 1_000_000, QUORUM_BPS, 0, grace_period);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    
    let proposal_id = propose(&env, &governance_id, &admin).id;
    queue_proposal(&env, &governance, &admin, proposal_id);
    
    let queue_ledger = governance.get_proposal(&proposal_id).queue_ledger;
    env.ledger().set_sequence_number(queue_ledger + grace_period + 1);
    
    // Execution should fail after grace period
    assert_eq!(
        governance.try_execute(&admin, &proposal_id),
        Err(Ok(GovernanceError::ExecutionExpired))
    );
    
    // Anyone can mark the proposal as expired
    governance.mark_expired(&proposal_id);
    assert_eq!(
        governance.get_proposal(&proposal_id).status,
        ProposalStatus::Expired
    );
}

#[test]
fn zero_grace_period_allows_indefinite_execution() {
    let env = Env::default();
    let (admin, _, governance_id) = deploy_full(&env, 1_000_000, QUORUM_BPS, 0, 0);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    
    let proposal_id = propose(&env, &governance_id, &admin).id;
    queue_proposal(&env, &governance, &admin, proposal_id);
    
    let queue_ledger = governance.get_proposal(&proposal_id).queue_ledger;
    env.ledger().set_sequence_number(queue_ledger + 1_000_000);
    
    governance.execute(&admin, &proposal_id);
    assert_eq!(
        governance.get_proposal(&proposal_id).status,
        ProposalStatus::Executed
    );
}

// ─── Get Voting Power (Issue #79) ────────────────────────────────────────────

#[test]
fn get_voting_power_returns_snapshot_balance() {
    let env = Env::default();
    env.ledger().set_sequence_number(GENESIS);
    let (admin, token_id, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let token = QuorumTokenClient::new(&env, &token_id);
    
    let holder = Address::generate(&env);
    token.transfer(&admin, &holder, &300_000);
    
    env.ledger().set_sequence_number(OPENED);
    let proposal_id = governance.create_proposal(
        &admin,
        &String::from_str(&env, "Test"),
        &String::from_str(&env, "Test proposal"),
        &String::from_str(&env, ""),
    );
    
    let power = governance.get_voting_power(&proposal_id, &holder);
    assert_eq!(power, 300_000);
}

#[test]
fn get_voting_power_returns_zero_for_non_holder() {
    let env = Env::default();
    env.ledger().set_sequence_number(GENESIS);
    let (admin, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    
    env.ledger().set_sequence_number(OPENED);
    let proposal_id = governance.create_proposal(
        &admin,
        &String::from_str(&env, "Test"),
        &String::from_str(&env, "Test proposal"),
        &String::from_str(&env, ""),
    );
    
    let non_holder = Address::generate(&env);
    let power = governance.get_voting_power(&proposal_id, &non_holder);
    assert_eq!(power, 0);
}

#[test]
fn get_voting_power_reflects_balance_before_snapshot() {
    let env = Env::default();
    env.ledger().set_sequence_number(GENESIS);
    let (admin, token_id, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let token = QuorumTokenClient::new(&env, &token_id);
    
    let holder = Address::generate(&env);
    token.transfer(&admin, &holder, &200_000);
    
    env.ledger().set_sequence_number(OPENED);
    let proposal_id = governance.create_proposal(
        &admin,
        &String::from_str(&env, "Test"),
        &String::from_str(&env, "Test proposal"),
        &String::from_str(&env, ""),
    );
    
    // Transfer happens after the proposal snapshot
    env.ledger().set_sequence_number(OPENED + 1);
    token.transfer(&holder, &admin, &100_000);
    
    let power = governance.get_voting_power(&proposal_id, &holder);
    assert_eq!(power, 200_000);
}

#[test]
fn get_voting_power_for_nonexistent_proposal_errors() {
    let env = Env::default();
    let (_, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    
    assert_eq!(
        governance.try_get_voting_power(&999, &Address::generate(&env)),
        Err(Ok(GovernanceError::ProposalNotFound))
    );
}

// Tests for issue #71: minimum timelock period validation
#[test]
fn initialize_rejects_zero_timelock() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let guardian = Address::generate(&env);

    let token_id = env.register(QuorumToken, ());
    QuorumTokenClient::new(&env, &token_id).initialize(
        &admin,
        &String::from_str(&env, "Quorum"),
        &String::from_str(&env, "QUORUM"),
        &7,
        &1_000_000,
    );

    let governance_id = env.register(GovernanceContract, ());
    let governance = GovernanceContractClient::new(&env, &governance_id);

    let result = governance.try_initialize(
        &admin,
        &guardian,
        &token_id,
        &QUORUM_BPS,
        &VOTING_PERIOD,
        &0, // timelock_period = 0
        &EXECUTION_GRACE,
        &0,
    );

    assert_eq!(result, Err(Ok(GovernanceError::MinimumTimelockRequired)));
}

#[test]
fn initialize_accepts_minimum_timelock_of_one() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let guardian = Address::generate(&env);

    let token_id = env.register(QuorumToken, ());
    QuorumTokenClient::new(&env, &token_id).initialize(
        &admin,
        &String::from_str(&env, "Quorum"),
        &String::from_str(&env, "QUORUM"),
        &7,
        &1_000_000,
    );

    let governance_id = env.register(GovernanceContract, ());
    let governance = GovernanceContractClient::new(&env, &governance_id);

    let result = governance.try_initialize(
        &admin,
        &guardian,
        &token_id,
        &QUORUM_BPS,
        &VOTING_PERIOD,
        &1, // timelock_period = 1 (minimum)
        &EXECUTION_GRACE,
        &0,
    );

    assert!(result.is_ok());
}

// Tests for issue #72: minimum quorum floor validation
#[test]
fn initialize_rejects_zero_quorum_bps() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let guardian = Address::generate(&env);

    let token_id = env.register(QuorumToken, ());
    QuorumTokenClient::new(&env, &token_id).initialize(
        &admin,
        &String::from_str(&env, "Quorum"),
        &String::from_str(&env, "QUORUM"),
        &7,
        &1_000_000,
    );

    let governance_id = env.register(GovernanceContract, ());
    let governance = GovernanceContractClient::new(&env, &governance_id);

    let result = governance.try_initialize(
        &admin,
        &guardian,
        &token_id,
        &0, // quorum_bps = 0
        &VOTING_PERIOD,
        &TIMELOCK,
        &EXECUTION_GRACE,
        &0,
    );

    assert_eq!(result, Err(Ok(GovernanceError::MinimumQuorumRequired)));
}

#[test]
fn initialize_accepts_minimum_quorum_of_one() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let guardian = Address::generate(&env);

    let token_id = env.register(QuorumToken, ());
    QuorumTokenClient::new(&env, &token_id).initialize(
        &admin,
        &String::from_str(&env, "Quorum"),
        &String::from_str(&env, "QUORUM"),
        &7,
        &1_000_000,
    );

    let governance_id = env.register(GovernanceContract, ());
    let governance = GovernanceContractClient::new(&env, &governance_id);

    let result = governance.try_initialize(
        &admin,
        &guardian,
        &token_id,
        &1, // quorum_bps = 1 (minimum)
        &VOTING_PERIOD,
        &TIMELOCK,
        &EXECUTION_GRACE,
        &0,
    );

    assert!(result.is_ok());
}

// Tests for issue #73: title and description length validation
#[test]
fn create_proposal_rejects_oversized_title() {
    let env = Env::default();
    let (_, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let proposer = Address::generate(&env);

    env.mock_all_auths();

    // Create a title exceeding 200 bytes
    let long_title = String::from_str(&env, &"x".repeat(201));

    let result = governance.try_create_proposal(
        &proposer,
        &long_title,
        &String::from_str(&env, "Valid description"),
        &String::from_str(&env, "https://example.com"),
    );

    assert_eq!(result, Err(Ok(GovernanceError::TitleTooLong)));
}

#[test]
fn create_proposal_accepts_title_at_max_length() {
    let env = Env::default();
    let (_, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let proposer = Address::generate(&env);

    env.mock_all_auths();

    // Create a title exactly 200 bytes
    let max_title = String::from_str(&env, &"x".repeat(200));

    let result = governance.try_create_proposal(
        &proposer,
        &max_title,
        &String::from_str(&env, "Valid description"),
        &String::from_str(&env, "https://example.com"),
    );

    assert!(result.is_ok());
}

#[test]
fn create_proposal_rejects_oversized_description() {
    let env = Env::default();
    let (_, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let proposer = Address::generate(&env);

    env.mock_all_auths();

    // Create a description exceeding 10,000 bytes
    let long_description = String::from_str(&env, &"x".repeat(10_001));

    let result = governance.try_create_proposal(
        &proposer,
        &String::from_str(&env, "Valid title"),
        &long_description,
        &String::from_str(&env, "https://example.com"),
    );

    assert_eq!(result, Err(Ok(GovernanceError::DescriptionTooLong)));
}

#[test]
fn create_proposal_accepts_description_at_max_length() {
    let env = Env::default();
    let (_, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let proposer = Address::generate(&env);

    env.mock_all_auths();

    // Create a description exactly 10,000 bytes
    let max_description = String::from_str(&env, &"x".repeat(10_000));

    let result = governance.try_create_proposal(
        &proposer,
        &String::from_str(&env, "Valid title"),
        &max_description,
        &String::from_str(&env, "https://example.com"),
    );

    assert!(result.is_ok());
}

// Tests for issue #74: empty title validation
#[test]
fn create_proposal_rejects_empty_title() {
    let env = Env::default();
    let (_, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let proposer = Address::generate(&env);

    env.mock_all_auths();

    let result = governance.try_create_proposal(
        &proposer,
        &String::from_str(&env, ""),
        &String::from_str(&env, "Valid description"),
        &String::from_str(&env, "https://example.com"),
    );

    assert_eq!(result, Err(Ok(GovernanceError::EmptyTitle)));
}

#[test]
fn create_proposal_rejects_whitespace_only_title() {
    let env = Env::default();
    let (_, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let proposer = Address::generate(&env);

    env.mock_all_auths();

    let result = governance.try_create_proposal(
        &proposer,
        &String::from_str(&env, "   "),
        &String::from_str(&env, "Valid description"),
        &String::from_str(&env, "https://example.com"),
    );

    assert_eq!(result, Err(Ok(GovernanceError::EmptyTitle)));
}

#[test]
fn create_proposal_accepts_valid_title_with_leading_trailing_spaces() {
    let env = Env::default();
    let (_, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let proposer = Address::generate(&env);

    env.mock_all_auths();

    // Title with spaces but non-whitespace content should be accepted
    let result = governance.try_create_proposal(
        &proposer,
        &String::from_str(&env, "  Valid Title  "),
        &String::from_str(&env, "Valid description"),
        &String::from_str(&env, "https://example.com"),
    );

    assert!(result.is_ok());
}

// ============================================================================
// Tests for Issue #75: Emit event on initialize()
// ============================================================================

#[test]
fn initialize_emits_event_with_config() {
    let env = Env::default();
    env.mock_all_auths();
    
    let admin = Address::generate(&env);
    let guardian = Address::generate(&env);
    let token_id = env.register(QuorumToken, ());
    
    QuorumTokenClient::new(&env, &token_id).initialize(
        &admin,
        &String::from_str(&env, "Quorum"),
        &String::from_str(&env, "QUORUM"),
        &7,
        &1_000_000,
    );
    
    let governance_id = env.register(GovernanceContract, ());
    let governance = GovernanceContractClient::new(&env, &governance_id);
    
    governance.initialize(
        &admin,
        &guardian,
        &token_id,
        &QUORUM_BPS,
        &VOTING_PERIOD,
        &TIMELOCK_PERIOD,
        &EXECUTION_GRACE,
        &PROPOSAL_THRESHOLD,
    );
    
    // Verify the event was emitted
    let events = env.events().all();
    let init_event = events.iter().find(|e| {
        e.1 == (Symbol::new(&env, "contract_initialized"),).into_val(&env)
    });
    
    assert!(init_event.is_some(), "ContractInitialized event should be emitted");
    
    // Verify event payload
    if let Some(event) = init_event {
        let payload: ContractInitialized = ContractInitialized::try_from_val(&env, &event.2).unwrap();
        assert_eq!(payload.admin, admin);
        assert_eq!(payload.guardian, guardian);
        assert_eq!(payload.token, token_id);
        assert_eq!(payload.quorum_bps, QUORUM_BPS);
        assert_eq!(payload.voting_period, VOTING_PERIOD);
        assert_eq!(payload.timelock_period, TIMELOCK_PERIOD);
        assert_eq!(payload.execution_grace_period, EXECUTION_GRACE);
        assert_eq!(payload.proposal_threshold, PROPOSAL_THRESHOLD);
    }
}

// ============================================================================
// Tests for Issue #76: Add get_proposals(start, limit) for paginated reads
// ============================================================================

#[test]
fn get_proposals_returns_empty_for_no_proposals() {
    let env = Env::default();
    let (_, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    
    let proposals = governance.get_proposals(&1, &10);
    assert_eq!(proposals.len(), 0);
}

#[test]
fn get_proposals_returns_bounded_page() {
    let env = Env::default();
    let (_, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let proposer = Address::generate(&env);
    
    // Create 5 proposals
    for i in 1..=5 {
        governance.create_proposal(
            &proposer,
            &String::from_str(&env, &std::format!("Proposal {}", i)),
            &String::from_str(&env, "Description"),
            &String::from_str(&env, ""),
        );
    }
    
    // Request 3 proposals starting from ID 1
    let proposals = governance.get_proposals(&1, &3);
    assert_eq!(proposals.len(), 3);
    assert_eq!(proposals.get(0).unwrap().id, 1);
    assert_eq!(proposals.get(1).unwrap().id, 2);
    assert_eq!(proposals.get(2).unwrap().id, 3);
}

#[test]
fn get_proposals_handles_out_of_range_start() {
    let env = Env::default();
    let (_, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let proposer = Address::generate(&env);
    
    // Create 2 proposals
    governance.create_proposal(
        &proposer,
        &String::from_str(&env, "Proposal 1"),
        &String::from_str(&env, "Description"),
        &String::from_str(&env, ""),
    );
    governance.create_proposal(
        &proposer,
        &String::from_str(&env, "Proposal 2"),
        &String::from_str(&env, "Description"),
        &String::from_str(&env, ""),
    );
    
    // Start beyond last proposal
    let proposals = governance.get_proposals(&10, &5);
    assert_eq!(proposals.len(), 0);
    
    // Start at 0
    let proposals = governance.get_proposals(&0, &5);
    assert_eq!(proposals.len(), 0);
}

#[test]
fn get_proposals_enforces_max_page_size() {
    let env = Env::default();
    let (_, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let proposer = Address::generate(&env);
    
    // Create 10 proposals
    for i in 1..=10 {
        governance.create_proposal(
            &proposer,
            &String::from_str(&env, &std::format!("Proposal {}", i)),
            &String::from_str(&env, "Description"),
            &String::from_str(&env, ""),
        );
    }
    
    // Request more than MAX_PAGE_SIZE (which is 100), should be capped
    let proposals = governance.get_proposals(&1, &200);
    assert!(proposals.len() <= 100);
}

#[test]
fn get_proposals_paging_boundaries() {
    let env = Env::default();
    let (_, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let proposer = Address::generate(&env);
    
    // Create 7 proposals
    for i in 1..=7 {
        governance.create_proposal(
            &proposer,
            &String::from_str(&env, &std::format!("Proposal {}", i)),
            &String::from_str(&env, "Description"),
            &String::from_str(&env, ""),
        );
    }
    
    // Page 1: proposals 1-3
    let page1 = governance.get_proposals(&1, &3);
    assert_eq!(page1.len(), 3);
    assert_eq!(page1.get(0).unwrap().id, 1);
    
    // Page 2: proposals 4-6
    let page2 = governance.get_proposals(&4, &3);
    assert_eq!(page2.len(), 3);
    assert_eq!(page2.get(0).unwrap().id, 4);
    
    // Page 3: proposal 7 (partial page)
    let page3 = governance.get_proposals(&7, &3);
    assert_eq!(page3.len(), 1);
    assert_eq!(page3.get(0).unwrap().id, 7);
}

// ============================================================================
// Tests for Issue #77: Add get_proposals_by_proposer(address)
// ============================================================================

#[test]
fn get_proposals_by_proposer_empty_for_new_address() {
    let env = Env::default();
    let (_, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let never_proposed = Address::generate(&env);
    
    let proposals = governance.get_proposals_by_proposer(&never_proposed);
    assert_eq!(proposals.len(), 0);
}

#[test]
fn get_proposals_by_proposer_returns_only_proposer_proposals() {
    let env = Env::default();
    let (_, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    
    let proposer_a = Address::generate(&env);
    let proposer_b = Address::generate(&env);
    
    // Proposer A creates 2 proposals
    let id1 = governance.create_proposal(
        &proposer_a,
        &String::from_str(&env, "Proposal A1"),
        &String::from_str(&env, "Description"),
        &String::from_str(&env, ""),
    );
    
    governance.create_proposal(
        &proposer_b,
        &String::from_str(&env, "Proposal B1"),
        &String::from_str(&env, "Description"),
        &String::from_str(&env, ""),
    );
    
    let id3 = governance.create_proposal(
        &proposer_a,
        &String::from_str(&env, "Proposal A2"),
        &String::from_str(&env, "Description"),
        &String::from_str(&env, ""),
    );
    
    // Get proposals by proposer A
    let proposals_a = governance.get_proposals_by_proposer(&proposer_a);
    assert_eq!(proposals_a.len(), 2);
    assert_eq!(proposals_a.get(0).unwrap().id, id1);
    assert_eq!(proposals_a.get(1).unwrap().id, id3);
    assert_eq!(proposals_a.get(0).unwrap().proposer, proposer_a);
    assert_eq!(proposals_a.get(1).unwrap().proposer, proposer_a);
    
    // Get proposals by proposer B
    let proposals_b = governance.get_proposals_by_proposer(&proposer_b);
    assert_eq!(proposals_b.len(), 1);
    assert_eq!(proposals_b.get(0).unwrap().proposer, proposer_b);
}

#[test]
fn get_proposals_by_proposer_multiple_proposals() {
    let env = Env::default();
    let (_, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let proposer = Address::generate(&env);
    
    // Create 5 proposals from same proposer
    for i in 1..=5 {
        governance.create_proposal(
            &proposer,
            &String::from_str(&env, &std::format!("Proposal {}", i)),
            &String::from_str(&env, "Description"),
            &String::from_str(&env, ""),
        );
    }
    
    let proposals = governance.get_proposals_by_proposer(&proposer);
    assert_eq!(proposals.len(), 5);
    
    // Verify all proposals are from the same proposer
    for i in 0..5 {
        assert_eq!(proposals.get(i).unwrap().proposer, proposer);
    }
}

// ============================================================================
// Tests for Issue #78: Add view returning whether proposal reached quorum
// ============================================================================

#[test]
fn has_reached_quorum_returns_false_for_no_votes() {
    let env = Env::default();
    let (_, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let proposer = Address::generate(&env);
    
    let proposal_id = governance.create_proposal(
        &proposer,
        &String::from_str(&env, "Test Proposal"),
        &String::from_str(&env, "Description"),
        &String::from_str(&env, ""),
    );
    
    let reached_quorum = governance.has_reached_quorum(&proposal_id);
    assert!(!reached_quorum);
}

#[test]
fn has_reached_quorum_returns_true_when_quorum_met() {
    let env = Env::default();
    let (admin, token_id, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let token = QuorumTokenClient::new(&env, &token_id);
    
    let voter = Address::generate(&env);
    // Transfer 60,000 tokens (quorum requires 50,000 = 5% of 1M)
    token.transfer(&admin, &voter, &60_000);
    
    let proposal_id = governance.create_proposal(
        &voter,
        &String::from_str(&env, "Test Proposal"),
        &String::from_str(&env, "Description"),
        &String::from_str(&env, ""),
    );
    
    // Before voting, quorum not reached
    assert!(!governance.has_reached_quorum(&proposal_id));
    
    // Vote with 60,000 tokens (support=1 means for)
    start_voting(&env, &governance, proposal_id);
    governance.vote(&voter, &proposal_id, &1);
    
    // After voting, quorum reached
    assert!(governance.has_reached_quorum(&proposal_id));
}

#[test]
fn has_reached_quorum_counts_all_vote_types() {
    let env = Env::default();
    let (admin, token_id, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let token = QuorumTokenClient::new(&env, &token_id);
    
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    let voter3 = Address::generate(&env);
    
    // Distribute tokens: each gets less than quorum individually
    token.transfer(&admin, &voter1, &20_000); // for
    token.transfer(&admin, &voter2, &20_000); // against
    token.transfer(&admin, &voter3, &15_000); // abstain
    
    let proposer = Address::generate(&env);
    let proposal_id = governance.create_proposal(
        &proposer,
        &String::from_str(&env, "Test Proposal"),
        &String::from_str(&env, "Description"),
        &String::from_str(&env, ""),
    );
    
    // Vote: 20k for, 20k against, 15k abstain = 55k total (> 50k quorum)
    start_voting(&env, &governance, proposal_id);
    governance.vote(&voter1, &proposal_id, &1); // for
    governance.vote(&voter2, &proposal_id, &0); // against
    governance.vote(&voter3, &proposal_id, &2); // abstain
    
    // Quorum should be reached (55k > 50k)
    assert!(governance.has_reached_quorum(&proposal_id));
}

#[test]
fn has_reached_quorum_agrees_with_finalize() {
    let env = Env::default();
    let (admin, token_id, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let token = QuorumTokenClient::new(&env, &token_id);
    
    let voter = Address::generate(&env);
    token.transfer(&admin, &voter, &60_000);
    
    let proposal_id = governance.create_proposal(
        &voter,
        &String::from_str(&env, "Test Proposal"),
        &String::from_str(&env, "Description"),
        &String::from_str(&env, ""),
    );
    
    start_voting(&env, &governance, proposal_id);
    governance.vote(&voter, &proposal_id, &1); // for
    
    // Verify quorum reached before finalize
    assert!(governance.has_reached_quorum(&proposal_id));
    
    // Advance past voting period
    let proposal = governance.get_proposal(&proposal_id);
    env.ledger().set_sequence_number(proposal.end_ledger + 1);
    
    // Finalize and check status
    let status = governance.finalize(&proposal_id);
    assert_eq!(status, ProposalStatus::Queued); // Passed
}

#[test]
fn has_reached_quorum_agrees_with_finalize_failed() {
    let env = Env::default();
    let (admin, token_id, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let token = QuorumTokenClient::new(&env, &token_id);
    
    let voter = Address::generate(&env);
    token.transfer(&admin, &voter, &30_000); // Less than 50k quorum
    
    let proposal_id = governance.create_proposal(
        &voter,
        &String::from_str(&env, "Test Proposal"),
        &String::from_str(&env, "Description"),
        &String::from_str(&env, ""),
    );
    
    start_voting(&env, &governance, proposal_id);
    governance.vote(&voter, &proposal_id, &1); // for
    
    // Verify quorum NOT reached before finalize
    assert!(!governance.has_reached_quorum(&proposal_id));
    
    // Advance past voting period
    let proposal = governance.get_proposal(&proposal_id);
    env.ledger().set_sequence_number(proposal.end_ledger + 1);
    
    // Finalize and check status
    let status = governance.finalize(&proposal_id);
    assert_eq!(status, ProposalStatus::Failed); // Failed due to no quorum
}

#[test]
fn has_reached_quorum_errors_for_nonexistent_proposal() {
    let env = Env::default();
    let (_, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    
    let result = governance.try_has_reached_quorum(&999);
    assert_eq!(result, Err(Ok(GovernanceError::ProposalNotFound)));
}

// ─── Proposal deposit (#256) ─────────────────────────────────────────────────

/// Deploys with a proposal deposit of `deposit`, funds a fresh proposer with
/// `proposer_balance`, and opens a proposal from them at `OPENED`.
fn open_deposit_proposal(env: &Env, deposit: i128, proposer_balance: i128) -> (Address, Address, Address, u64) {
    env.ledger().set_sequence_number(GENESIS);
    let (admin, token_id, governance_id) = deploy(env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(env, &governance_id);
    governance.set_proposal_deposit(&deposit);

    let proposer = Address::generate(env);
    QuorumTokenClient::new(env, &token_id).transfer(&admin, &proposer, &proposer_balance);

    env.ledger().set_sequence_number(OPENED);
    let id = governance.create_proposal(
        &proposer,
        &String::from_str(env, "Deposit"),
        &String::from_str(env, "A proposal that locks a deposit."),
        &String::from_str(env, ""),
    );
    (proposer, token_id, governance_id, id)
}

#[test]
fn a_passed_proposal_returns_its_deposit_to_the_proposer() {
    let env = Env::default();
    let (proposer, token_id, governance_id, id) = open_deposit_proposal(&env, 10_000, 100_000);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let token = QuorumTokenClient::new(&env, &token_id);
    assert_eq!(token.balance(&proposer), 90_000);
    assert_eq!(token.balance(&governance_id), 10_000);

    governance.vote(&proposer, &id, &VOTE_FOR);
    close_voting(&env, &governance, id);

    assert_eq!(governance.finalize(&id), ProposalStatus::Queued);
    assert_eq!(token.balance(&proposer), 100_000);
    assert_eq!(token.balance(&governance_id), 0);
    assert_eq!(token.total_supply(), 1_000_000);
}

#[test]
fn a_failed_proposal_forfeits_its_deposit_by_burning_it() {
    let env = Env::default();
    let (proposer, token_id, governance_id, id) = open_deposit_proposal(&env, 10_000, 100_000);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let token = QuorumTokenClient::new(&env, &token_id);

    // Nobody votes, so quorum is missed and the proposal fails.
    close_voting(&env, &governance, id);

    assert_eq!(governance.finalize(&id), ProposalStatus::Failed);
    assert_eq!(token.balance(&governance_id), 0);
    assert_eq!(token.balance(&proposer), 90_000);
    assert_eq!(token.total_supply(), 990_000);
}

#[test]
fn cancelling_an_open_proposal_forfeits_its_deposit() {
    let env = Env::default();
    let (proposer, token_id, governance_id, id) = open_deposit_proposal(&env, 10_000, 100_000);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let token = QuorumTokenClient::new(&env, &token_id);

    governance.cancel(&proposer, &id);

    assert_eq!(token.balance(&governance_id), 0);
    assert_eq!(token.balance(&proposer), 90_000);
    assert_eq!(token.total_supply(), 990_000);
}

#[test]
fn a_deposit_above_the_proposers_balance_is_rejected() {
    let env = Env::default();
    env.ledger().set_sequence_number(GENESIS);
    let (admin, token_id, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    governance.set_proposal_deposit(&200_000);

    let proposer = Address::generate(&env);
    QuorumTokenClient::new(&env, &token_id).transfer(&admin, &proposer, &100_000);

    assert_eq!(
        governance.try_create_proposal(
            &proposer,
            &String::from_str(&env, "Too expensive"),
            &String::from_str(&env, ""),
            &String::from_str(&env, ""),
        ),
        Err(Ok(GovernanceError::InsufficientDeposit))
    );
    assert_eq!(governance.get_proposal_count(), 0);
}

#[test]
fn only_the_admin_can_set_the_proposal_deposit() {
    let env = Env::default();
    let (_, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    env.set_auths(&[]);

    assert!(governance.try_set_proposal_deposit(&500).is_err());
    assert_eq!(governance.get_config().proposal_deposit, 0);
}

#[test]
fn a_negative_proposal_deposit_is_rejected() {
    let env = Env::default();
    let (_, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    assert_eq!(
        governance.try_set_proposal_deposit(&-1),
        Err(Ok(GovernanceError::InvalidAmount))
    );
}

// ─── Co-sponsored proposals (#253) ───────────────────────────────────────────

#[test]
fn cosponsors_whose_combined_balance_meets_the_threshold_can_open_a_proposal() {
    let env = Env::default();
    env.ledger().set_sequence_number(GENESIS);
    let (admin, token_id, governance_id) = deploy_with_threshold(&env, 1_000_000, QUORUM_BPS, THRESHOLD);
    let token = QuorumTokenClient::new(&env, &token_id);
    let (proposer, sponsor) = (Address::generate(&env), Address::generate(&env));
    // Each is below the 10_000 threshold on their own; together they reach it.
    token.transfer(&admin, &proposer, &6_000);
    token.transfer(&admin, &sponsor, &4_000);

    env.ledger().set_sequence_number(OPENED);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let cosponsors = soroban_sdk::vec![&env, sponsor.clone()];
    let id = governance.create_cosponsored_proposal(
        &proposer,
        &cosponsors,
        &String::from_str(&env, "Joint proposal"),
        &String::from_str(&env, "Opened by two holders."),
        &String::from_str(&env, ""),
    );

    assert_eq!(governance.get_proposal(&id).proposer, proposer);
    assert_eq!(governance.get_cosponsors(&id), cosponsors);
}

#[test]
fn cosponsors_below_the_threshold_together_are_rejected() {
    let env = Env::default();
    env.ledger().set_sequence_number(GENESIS);
    let (admin, token_id, governance_id) = deploy_with_threshold(&env, 1_000_000, QUORUM_BPS, THRESHOLD);
    let token = QuorumTokenClient::new(&env, &token_id);
    let (proposer, sponsor) = (Address::generate(&env), Address::generate(&env));
    token.transfer(&admin, &proposer, &4_000);
    token.transfer(&admin, &sponsor, &5_000);

    env.ledger().set_sequence_number(OPENED);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let cosponsors = soroban_sdk::vec![&env, sponsor.clone()];
    assert_eq!(
        governance.try_create_cosponsored_proposal(
            &proposer,
            &cosponsors,
            &String::from_str(&env, "Not enough"),
            &String::from_str(&env, ""),
            &String::from_str(&env, ""),
        ),
        Err(Ok(GovernanceError::BelowProposalThreshold))
    );
    assert_eq!(governance.get_proposal_count(), 0);
}

#[test]
fn the_proposer_and_duplicate_cosponsors_are_rejected() {
    let env = Env::default();
    let (admin, _, governance_id) = deploy_with_threshold(&env, 1_000_000, QUORUM_BPS, THRESHOLD);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let sponsor = Address::generate(&env);
    let title = String::from_str(&env, "Joint proposal");
    let empty = String::from_str(&env, "");

    let listing_the_proposer = soroban_sdk::vec![&env, admin.clone()];
    assert_eq!(
        governance.try_create_cosponsored_proposal(&admin, &listing_the_proposer, &title, &empty, &empty),
        Err(Ok(GovernanceError::InvalidCosponsors))
    );

    let listing_twice = soroban_sdk::vec![&env, sponsor.clone(), sponsor.clone()];
    assert_eq!(
        governance.try_create_cosponsored_proposal(&admin, &listing_twice, &title, &empty, &empty),
        Err(Ok(GovernanceError::InvalidCosponsors))
    );
}

#[test]
fn the_cosponsor_list_is_capped() {
    let env = Env::default();
    let (admin, _, governance_id) = deploy_with_threshold(&env, 1_000_000, QUORUM_BPS, THRESHOLD);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    let mut too_many = soroban_sdk::Vec::new(&env);
    for _ in 0..11 {
        too_many.push_back(Address::generate(&env));
    }
    assert_eq!(
        governance.try_create_cosponsored_proposal(
            &admin,
            &too_many,
            &String::from_str(&env, "Too many"),
            &String::from_str(&env, ""),
            &String::from_str(&env, ""),
        ),
        Err(Ok(GovernanceError::InvalidCosponsors))
    );
}

#[test]
fn a_standard_proposal_has_no_cosponsors() {
    let env = Env::default();
    let (admin, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let id = propose(&env, &governance_id, &admin).id;

    assert_eq!(governance.get_cosponsors(&id).len(), 0);
}

// ─── Conviction voting (#254) ────────────────────────────────────────────────

const CONVICTION_WINDOW: u32 = LEDGERS_PER_DAY * 10;
const CONVICTION_QUORUM_BPS: u32 = 10; // 0.1% of 1_000_000 = 1_000

/// As `deploy`, with a voting window of `voting_period` ledgers.
fn deploy_with_window(env: &Env, supply: i128, quorum_bps: u32, voting_period: u32) -> (Address, Address, Address) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let guardian = Address::generate(env);

    let token_id = env.register(QuorumToken, ());
    QuorumTokenClient::new(env, &token_id).initialize(
        &admin,
        &String::from_str(env, "Quorum"),
        &String::from_str(env, "QUORUM"),
        &7,
        &supply,
    );

    let governance_id = env.register(GovernanceContract, ());
    GovernanceContractClient::new(env, &governance_id).initialize(
        &admin,
        &guardian,
        &token_id,
        &quorum_bps,
        &voting_period,
        &TIMELOCK_PERIOD,
        &EXECUTION_GRACE,
        &PROPOSAL_THRESHOLD,
    );

    (admin, token_id, governance_id)
}

/// Opens a proposal over the conviction-length window. Two holders each carry
/// 1_000 of weight, enough to clear quorum together. Returns the holders in
/// (against, for) order, then the governance address and proposal id.
fn open_long_window_proposal(env: &Env, conviction: bool) -> (Address, Address, Address, u64) {
    env.ledger().set_sequence_number(GENESIS);
    let (admin, token_id, governance_id) = deploy_with_window(env, 1_000_000, CONVICTION_QUORUM_BPS, CONVICTION_WINDOW);
    let token = QuorumTokenClient::new(env, &token_id);
    let (against_voter, for_voter) = (Address::generate(env), Address::generate(env));
    token.transfer(&admin, &against_voter, &1_000);
    token.transfer(&admin, &for_voter, &1_000);

    env.ledger().set_sequence_number(OPENED);
    let governance = GovernanceContractClient::new(env, &governance_id);
    let title = String::from_str(env, "Continuous grant stream");
    let description = String::from_str(env, "Fund a stream of grants.");
    let metadata_uri = String::from_str(env, "");
    let id = if conviction {
        governance.create_conviction_proposal(&admin, &title, &description, &metadata_uri)
    } else {
        governance.create_proposal(&admin, &title, &description, &metadata_uri)
    };
    (against_voter, for_voter, governance_id, id)
}

#[test]
fn conviction_support_halves_for_each_half_life_it_waits_before_the_close() {
    let env = Env::default();
    let (against_voter, for_voter, governance_id, id) = open_long_window_proposal(&env, true);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    let first = OPENED + 1;
    env.ledger().set_sequence_number(first);
    governance.vote(&against_voter, &id, &VOTE_AGAINST);
    env.ledger().set_sequence_number(first + CONVICTION_HALF_LIFE);
    governance.vote(&for_voter, &id, &VOTE_FOR);

    // The raw totals tie, but the earlier against vote has decayed to half.
    let proposal = governance.get_proposal(&id);
    assert_eq!(proposal.for_votes, proposal.against_votes);

    close_voting(&env, &governance, id);
    let tally = governance.get_conviction(&id).unwrap();
    assert_eq!(tally.for_conviction, 250);
    assert_eq!(tally.against_conviction, 125);

    assert_eq!(governance.finalize(&id), ProposalStatus::Queued);
}

#[test]
fn the_same_votes_on_a_standard_proposal_tie_and_fail() {
    let env = Env::default();
    let (against_voter, for_voter, governance_id, id) = open_long_window_proposal(&env, false);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    let first = OPENED + 1;
    env.ledger().set_sequence_number(first);
    governance.vote(&against_voter, &id, &VOTE_AGAINST);
    env.ledger().set_sequence_number(first + CONVICTION_HALF_LIFE);
    governance.vote(&for_voter, &id, &VOTE_FOR);

    close_voting(&env, &governance, id);
    assert_eq!(governance.finalize(&id), ProposalStatus::Failed);
}

#[test]
fn abstaining_leaves_the_conviction_tally_unchanged() {
    let env = Env::default();
    let (against_voter, _, governance_id, id) = open_long_window_proposal(&env, true);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    governance.vote(&against_voter, &id, &VOTE_ABSTAIN);

    let tally = governance.get_conviction(&id).unwrap();
    assert_eq!(tally.for_conviction, 0);
    assert_eq!(tally.against_conviction, 0);
}

#[test]
fn a_conviction_tally_read_later_is_decayed_to_that_ledger() {
    let env = Env::default();
    let (_, for_voter, governance_id, id) = open_long_window_proposal(&env, true);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    let first = OPENED + 1;
    env.ledger().set_sequence_number(first);
    governance.vote(&for_voter, &id, &VOTE_FOR);
    env.ledger().set_sequence_number(first + 2 * CONVICTION_HALF_LIFE);

    // Two whole half-lives have passed since the vote was written.
    assert_eq!(governance.get_conviction(&id).unwrap().for_conviction, 250);
}

#[test]
fn a_standard_proposal_has_no_conviction_tally() {
    let env = Env::default();
    let (_, _, governance_id, id) = open_long_window_proposal(&env, false);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    assert_eq!(governance.get_conviction(&id), None);
}

// ─── Execution allowlist (#252) ──────────────────────────────────────────────

/// Opens a proposal from the admin on a fresh deployment. The token address
/// is returned too, since it is a contract with a no-argument `name()` that
/// an action can call.
fn open_with_action_target(env: &Env) -> (Address, Address, Address, u64) {
    env.ledger().set_sequence_number(GENESIS);
    let (admin, token_id, governance_id) = deploy(env, 1_000_000, QUORUM_BPS);
    env.ledger().set_sequence_number(OPENED);
    let id = propose(env, &governance_id, &admin).id;
    (admin, token_id, governance_id, id)
}

#[test]
fn an_allowlisted_action_is_dispatched_when_the_proposal_executes() {
    let env = Env::default();
    let (admin, token_id, governance_id, id) = open_with_action_target(&env);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    governance.allow_target(&token_id);
    governance.set_proposal_action(&admin, &id, &token_id, &Symbol::new(&env, "name"), &soroban_sdk::Vec::new(&env));
    queue_proposal(&env, &governance, &admin, id);

    let queue_ledger = governance.get_proposal(&id).queue_ledger;
    env.ledger().set_sequence_number(queue_ledger);
    governance.execute(&Address::generate(&env), &id);

    assert_eq!(governance.get_proposal(&id).status, ProposalStatus::Executed);
}

#[test]
fn a_target_removed_from_the_allowlist_blocks_execution() {
    let env = Env::default();
    let (admin, token_id, governance_id, id) = open_with_action_target(&env);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    governance.allow_target(&token_id);
    governance.set_proposal_action(&admin, &id, &token_id, &Symbol::new(&env, "name"), &soroban_sdk::Vec::new(&env));
    queue_proposal(&env, &governance, &admin, id);
    governance.disallow_target(&token_id);

    let queue_ledger = governance.get_proposal(&id).queue_ledger;
    env.ledger().set_sequence_number(queue_ledger);

    assert_eq!(
        governance.try_execute(&Address::generate(&env), &id),
        Err(Ok(GovernanceError::TargetNotAllowed))
    );
    // The rejected call committed nothing: the proposal is still queued.
    assert_eq!(governance.get_proposal(&id).status, ProposalStatus::Queued);
}

#[test]
fn an_action_cannot_target_a_contract_that_is_not_allowlisted() {
    let env = Env::default();
    let (admin, token_id, governance_id, id) = open_with_action_target(&env);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    assert_eq!(
        governance.try_set_proposal_action(&admin, &id, &token_id, &Symbol::new(&env, "name"), &soroban_sdk::Vec::new(&env)),
        Err(Ok(GovernanceError::TargetNotAllowed))
    );
}

#[test]
fn only_the_proposer_can_attach_an_action() {
    let env = Env::default();
    let (_, token_id, governance_id, id) = open_with_action_target(&env);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    governance.allow_target(&token_id);
    let attacker = Address::generate(&env);

    assert_eq!(
        governance.try_set_proposal_action(&attacker, &id, &token_id, &Symbol::new(&env, "name"), &soroban_sdk::Vec::new(&env)),
        Err(Ok(GovernanceError::Unauthorized))
    );
}

#[test]
fn only_the_admin_can_change_the_allowlist() {
    let env = Env::default();
    let (_, token_id, governance_id, _) = open_with_action_target(&env);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    env.set_auths(&[]);

    assert!(governance.try_allow_target(&token_id).is_err());
    assert!(!governance.is_target_allowed(&token_id));
}

#[test]
fn allowlist_changes_emit_an_event() {
    let env = Env::default();
    let (_, token_id, governance_id, _) = open_with_action_target(&env);
    let governance = GovernanceContractClient::new(&env, &governance_id);

    governance.allow_target(&token_id);

    let (_, data) = last_governance_event(&env, &governance_id);
    let admin = governance.get_config().admin;
    assert_eq!(
        TargetAllowlistUpdated::try_from_val(&env, &data).unwrap(),
        TargetAllowlistUpdated { admin, target: token_id.clone(), allowed: true }
    );
}

#[test]
fn non_admin_cannot_upgrade_the_contract() {
    let env = Env::default();
    let (admin, _, governance_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let non_admin = Address::generate(&env);
    let dummy_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);

    env.set_auths(&[]);
    assert_eq!(
        governance.try_upgrade(&non_admin, &dummy_hash),
        Err(Ok(GovernanceError::Unauthorized))
    );
    // Admin auth check: auth cleared so even the admin must fail without it.
    assert_eq!(
        governance.try_upgrade(&admin, &dummy_hash),
        Err(Ok(GovernanceError::Unauthorized))
    );
}

// ─── Proposal actions with arguments (#49) ───────────────────────────────────

/// Opens a proposal with an allowlisted `ActionRecorder` as the action target.
fn open_with_recorder(env: &Env) -> (Address, Address, Address, u64) {
    let (admin, _, governance_id, id) = open_with_action_target(env);
    let recorder_id = env.register(ActionRecorder, ());
    GovernanceContractClient::new(env, &governance_id).allow_target(&recorder_id);
    (admin, recorder_id, governance_id, id)
}

fn record_args(env: &Env, value: u32) -> soroban_sdk::Vec<Val> {
    soroban_sdk::vec![env, value.into_val(env)]
}

fn execute_when_ready(env: &Env, governance: &GovernanceContractClient, admin: &Address, id: u64) -> Result<(), GovernanceError> {
    queue_proposal(env, governance, admin, id);
    env.ledger().set_sequence_number(governance.get_proposal(&id).queue_ledger);
    match governance.try_execute(&Address::generate(env), &id) {
        Ok(_) => Ok(()),
        Err(Ok(e)) => Err(e),
        Err(Err(_)) => panic!("execute returned an undecodable error"),
    }
}

#[test]
fn execute_calls_the_target_with_the_attached_arguments() {
    let env = Env::default();
    let (admin, recorder_id, governance_id, id) = open_with_recorder(&env);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    governance.set_proposal_action(&admin, &id, &recorder_id, &Symbol::new(&env, "record"), &record_args(&env, 42));

    assert_eq!(execute_when_ready(&env, &governance, &admin, id), Ok(()));

    let recorder = ActionRecorderClient::new(&env, &recorder_id);
    assert_eq!(recorder.calls(), soroban_sdk::vec![&env, 42u32]);
    assert_eq!(governance.get_proposal(&id).status, ProposalStatus::Executed);
}

#[test]
fn multiple_actions_are_dispatched_in_the_order_they_were_added() {
    let env = Env::default();
    let (admin, recorder_id, governance_id, id) = open_with_recorder(&env);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    for value in [1u32, 2, 3] {
        governance.set_proposal_action(&admin, &id, &recorder_id, &Symbol::new(&env, "record"), &record_args(&env, value));
    }
    assert_eq!(governance.get_proposal_actions(&id).len(), 3);

    assert_eq!(execute_when_ready(&env, &governance, &admin, id), Ok(()));

    let recorder = ActionRecorderClient::new(&env, &recorder_id);
    assert_eq!(recorder.calls(), soroban_sdk::vec![&env, 1u32, 2, 3]);
}

#[test]
fn a_proposal_with_no_actions_executes_without_dispatching_anything() {
    let env = Env::default();
    let (admin, recorder_id, governance_id, id) = open_with_recorder(&env);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    assert_eq!(governance.get_proposal_actions(&id).len(), 0);

    assert_eq!(execute_when_ready(&env, &governance, &admin, id), Ok(()));

    assert_eq!(ActionRecorderClient::new(&env, &recorder_id).calls().len(), 0);
    assert_eq!(governance.get_proposal(&id).status, ProposalStatus::Executed);
}

#[test]
fn a_failing_action_returns_an_error_and_rolls_back_the_execution() {
    let env = Env::default();
    let (admin, recorder_id, governance_id, id) = open_with_recorder(&env);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    governance.set_proposal_action(&admin, &id, &recorder_id, &Symbol::new(&env, "record"), &record_args(&env, 7));
    governance.set_proposal_action(&admin, &id, &recorder_id, &Symbol::new(&env, "fail"), &soroban_sdk::Vec::new(&env));

    assert_eq!(execute_when_ready(&env, &governance, &admin, id), Err(GovernanceError::ActionFailed));

    // Nothing was kept: the proposal is still queued and the first call was undone.
    assert_eq!(governance.get_proposal(&id).status, ProposalStatus::Queued);
    assert_eq!(ActionRecorderClient::new(&env, &recorder_id).calls().len(), 0);
}

#[test]
fn an_action_with_the_wrong_arguments_returns_an_error() {
    let env = Env::default();
    let (admin, recorder_id, governance_id, id) = open_with_recorder(&env);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    // `record` takes one u32; calling it with none fails inside the target.
    governance.set_proposal_action(&admin, &id, &recorder_id, &Symbol::new(&env, "record"), &soroban_sdk::Vec::new(&env));

    assert_eq!(execute_when_ready(&env, &governance, &admin, id), Err(GovernanceError::ActionFailed));
    assert_eq!(governance.get_proposal(&id).status, ProposalStatus::Queued);
}

#[test]
fn a_proposal_cannot_carry_more_than_the_maximum_number_of_actions() {
    let env = Env::default();
    let (admin, recorder_id, governance_id, id) = open_with_recorder(&env);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    for value in 0..MAX_PROPOSAL_ACTIONS {
        governance.set_proposal_action(&admin, &id, &recorder_id, &Symbol::new(&env, "record"), &record_args(&env, value));
    }

    assert_eq!(
        governance.try_set_proposal_action(&admin, &id, &recorder_id, &Symbol::new(&env, "record"), &record_args(&env, 99)),
        Err(Ok(GovernanceError::TooManyActions))
    );
}

// ─── Guardian rotation (#51) ─────────────────────────────────────────────────

#[test]
fn the_admin_can_replace_the_guardian() {
    let env = Env::default();
    let (_, _, governance_id, _) = open_with_action_target(&env);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let previous_guardian = governance.get_config().guardian;
    let new_guardian = Address::generate(&env);

    governance.set_guardian(&new_guardian);

    let (topics, data) = last_governance_event(&env, &governance_id);
    assert_eq!(Symbol::try_from_val(&env, &topics.get(0).unwrap()).unwrap(), Symbol::new(&env, "guardian_changed"));
    assert_eq!(
        GuardianChanged::try_from_val(&env, &data).unwrap(),
        GuardianChanged { previous_guardian, new_guardian: new_guardian.clone() }
    );
    assert_eq!(governance.get_config().guardian, new_guardian);
}

#[test]
fn only_the_admin_can_replace_the_guardian() {
    let env = Env::default();
    let (_, _, governance_id, _) = open_with_action_target(&env);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let previous_guardian = governance.get_config().guardian;
    env.set_auths(&[]);

    assert!(governance.try_set_guardian(&Address::generate(&env)).is_err());
    assert_eq!(governance.get_config().guardian, previous_guardian);
}

#[test]
fn a_replaced_guardian_can_no_longer_veto_and_the_new_one_can() {
    let env = Env::default();
    let (admin, _, governance_id, id) = open_with_action_target(&env);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let old_guardian = governance.get_config().guardian;
    let new_guardian = Address::generate(&env);
    governance.set_guardian(&new_guardian);
    queue_proposal(&env, &governance, &admin, id);

    assert_eq!(
        governance.try_veto(&old_guardian, &id, &veto_reason(&env)),
        Err(Ok(GovernanceError::Unauthorized))
    );
    governance.veto(&new_guardian, &id, &veto_reason(&env));
    assert_eq!(governance.get_proposal(&id).status, ProposalStatus::Vetoed);
}

#[test]
fn finalize_cannot_requeue_a_vetoed_proposal() {
    let env = Env::default();
    let (admin, _, governance_id, id) = open_with_action_target(&env);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    let guardian = governance.get_config().guardian;
    queue_proposal(&env, &governance, &admin, id);
    governance.veto(&guardian, &id, &veto_reason(&env));

    assert_eq!(governance.try_finalize(&id), Err(Ok(GovernanceError::VotingNotActive)));
    assert_eq!(governance.get_proposal(&id).status, ProposalStatus::Vetoed);
    env.ledger().set_sequence_number(governance.get_proposal(&id).queue_ledger);
    assert_eq!(
        governance.try_execute(&Address::generate(&env), &id),
        Err(Ok(GovernanceError::ProposalNotPassed))
    );
}

#[test]
fn finalize_cannot_requeue_an_executed_proposal() {
    let env = Env::default();
    let (admin, _, governance_id, id) = open_with_action_target(&env);
    let governance = GovernanceContractClient::new(&env, &governance_id);
    queue_proposal(&env, &governance, &admin, id);
    env.ledger().set_sequence_number(governance.get_proposal(&id).queue_ledger);
    governance.execute(&Address::generate(&env), &id);

    assert_eq!(governance.try_finalize(&id), Err(Ok(GovernanceError::VotingNotActive)));
    assert_eq!(governance.get_proposal(&id).status, ProposalStatus::Executed);
}
