//! End-to-end governance cycle driven from the token side.
//!
//! The unit suites cover each contract alone, and the governance suite
//! registers a real token only as a source of voting power. This test starts
//! from the token instead: supply is minted and distributed through every
//! balance-moving path, a proposal snapshots it, balances keep moving, and the
//! vote is finalized and executed. At each step it checks that governance
//! counted exactly what the token's checkpoints recorded.

use quorum_governance::{GovernanceContract, GovernanceContractClient, GovernanceError, ProposalStatus};
use quorum_token::{QuorumToken, QuorumTokenClient};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{Address, Env, String};

const INITIAL_SUPPLY: i128 = 1_000_000;
const QUORUM_BPS: u32 = 500; // 5%
const VOTING_PERIOD: u32 = 100;
const TIMELOCK_PERIOD: u32 = 50;
const PROPOSAL_THRESHOLD: i128 = 100_000;

const AGAINST: u32 = 0;
const FOR: u32 = 1;
const ABSTAIN: u32 = 2;

struct Dao<'a> {
    env: Env,
    admin: Address,
    token: QuorumTokenClient<'a>,
    governance: GovernanceContractClient<'a>,
}

fn setup<'a>() -> Dao<'a> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);
    let admin = Address::generate(&env);
    let guardian = Address::generate(&env);

    let token_id = env.register(QuorumToken, ());
    let token = QuorumTokenClient::new(&env, &token_id);
    token.initialize(
        &admin,
        &String::from_str(&env, "Quorum"),
        &String::from_str(&env, "QUORUM"),
        &7,
        &INITIAL_SUPPLY,
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
        &(17_280 * 7),
        &PROPOSAL_THRESHOLD,
    );

    Dao { env, admin, token, governance }
}

fn advance_to(env: &Env, ledger: u32) {
    env.ledger().set_sequence_number(ledger);
}

fn text(env: &Env, s: &str) -> String {
    String::from_str(env, s)
}

/// The sum of `holders`' balances must equal total supply — the token is the
/// only ledger of record, so governance activity must never create or destroy
/// tokens.
fn assert_supply_conserved(token: &QuorumTokenClient, holders: &[&Address]) {
    let sum: i128 = holders.iter().map(|h| token.balance(h)).sum();
    assert_eq!(sum, token.total_supply());
}

#[test]
fn full_cycle_mint_distribute_snapshot_vote_finalize_execute() {
    let Dao { env, admin, token, governance } = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);
    let dave = Address::generate(&env);
    let distributor = Address::generate(&env);
    let erin = Address::generate(&env);
    let frank = Address::generate(&env);
    let everyone = [&admin, &alice, &bob, &carol, &dave, &distributor, &erin, &frank];

    // ── Mint and distribute ─────────────────────────────────────────────────
    // Every balance-moving path is used, so each one has to write the
    // checkpoints the snapshot is later read from.
    advance_to(&env, 101);
    token.mint(&alice, &300_000);
    token.mint(&bob, &200_000);
    token.transfer(&admin, &carol, &100_000);
    token.approve(&admin, &distributor, &50_000, &1_000);
    token.transfer_from(&distributor, &admin, &dave, &50_000);
    assert_eq!(token.allowance(&admin, &distributor), 0);

    advance_to(&env, 110);
    token.transfer(&carol, &alice, &40_000);

    assert_eq!(token.total_supply(), 1_500_000);
    assert_eq!(token.balance(&admin), 850_000);
    assert_eq!(token.balance(&alice), 340_000);
    assert_eq!(token.balance(&bob), 200_000);
    assert_eq!(token.balance(&carol), 60_000);
    assert_eq!(token.balance(&dave), 50_000);
    assert_supply_conserved(&token, &everyone);

    // ── Snapshot ────────────────────────────────────────────────────────────
    // Dave holds less than the proposal threshold; Alice holds more.
    advance_to(&env, 120);
    assert_eq!(
        governance.try_create_proposal(&dave, &text(&env, "t"), &text(&env, "d"), &text(&env, "")),
        Err(Ok(GovernanceError::BelowProposalThreshold))
    );
    let id = governance.create_proposal(
        &alice,
        &text(&env, "Fund the grants round"),
        &text(&env, "Release 50,000 QUORUM to the grants multisig."),
        &text(&env, "ipfs://grants-round"),
    );
    let proposal = governance.get_proposal(&id);
    let snapshot = proposal.snapshot_ledger;
    assert_eq!(snapshot, 120);
    assert_eq!(proposal.status, ProposalStatus::Active);
    // 5% of the supply at creation.
    assert_eq!(proposal.quorum_required, 75_000);

    // ── Balances keep moving after the snapshot ─────────────────────────────
    advance_to(&env, 121);
    token.transfer(&alice, &erin, &100_000); // Erin buys in after the snapshot.
    token.mint(&frank, &500_000); // Dilution after the snapshot.
    token.burn(&bob, &50_000);
    assert_eq!(token.total_supply(), 1_950_000);
    assert_supply_conserved(&token, &everyone);

    // The token still reports the snapshot-era balances, whatever happened
    // since.
    assert_eq!(token.get_past_balance(&alice, &snapshot), 340_000);
    assert_eq!(token.get_past_balance(&bob, &snapshot), 200_000);
    assert_eq!(token.get_past_balance(&carol, &snapshot), 60_000);
    assert_eq!(token.get_past_balance(&dave, &snapshot), 50_000);
    assert_eq!(token.get_past_balance(&erin, &snapshot), 0);
    assert_eq!(token.get_past_balance(&frank, &snapshot), 0);

    // Minting after creation must not move the bar the proposal has to clear.
    assert_eq!(governance.get_proposal(&id).quorum_required, 75_000);

    // ── Vote ────────────────────────────────────────────────────────────────
    advance_to(&env, 130);
    governance.vote(&alice, &id, &FOR);
    governance.vote(&bob, &id, &AGAINST);
    governance.vote(&carol, &id, &ABSTAIN);
    governance.vote(&dave, &id, &FOR);

    // Tokens acquired after the snapshot carry no weight.
    assert_eq!(governance.try_vote(&erin, &id, &FOR), Err(Ok(GovernanceError::NoVotingPower)));
    assert_eq!(governance.try_vote(&frank, &id, &FOR), Err(Ok(GovernanceError::NoVotingPower)));
    // Still inside the window, so a repeat vote replaces the earlier choice.
    // Repeating the same choice leaves the tallies below unchanged.
    assert!(governance.try_vote(&alice, &id, &FOR).is_ok());

    // Each tally is exactly the voters' snapshot balances, not their live
    // ones: Alice now holds 240,000 and Bob 150,000.
    let proposal = governance.get_proposal(&id);
    assert_eq!(proposal.for_votes, 340_000 + 50_000);
    assert_eq!(proposal.against_votes, 200_000);
    assert_eq!(proposal.abstain_votes, 60_000);
    assert_eq!(governance.get_vote(&id, &carol), Some(ABSTAIN));
    assert_eq!(governance.get_vote(&id, &erin), None);

    // Voting reads balances; it never moves them.
    assert_eq!(token.balance(&alice), 240_000);
    assert_eq!(token.balance(&bob), 150_000);
    assert_eq!(token.total_supply(), 1_950_000);
    assert_supply_conserved(&token, &everyone);

    // ── Finalize ────────────────────────────────────────────────────────────
    assert_eq!(governance.try_finalize(&id), Err(Ok(GovernanceError::VotingNotActive)));
    advance_to(&env, proposal.end_ledger + 1);
    assert_eq!(governance.try_vote(&admin, &id, &AGAINST), Err(Ok(GovernanceError::VotingPeriodEnded)));

    assert_eq!(governance.finalize(&id), ProposalStatus::Queued);
    let proposal = governance.get_proposal(&id);
    assert_eq!(proposal.queue_ledger, proposal.end_ledger + 1 + TIMELOCK_PERIOD);

    // ── Execute ─────────────────────────────────────────────────────────────
    let executor = Address::generate(&env);
    advance_to(&env, proposal.queue_ledger - 1);
    assert_eq!(governance.try_execute(&executor, &id), Err(Ok(GovernanceError::TimelockNotExpired)));
    advance_to(&env, proposal.queue_ledger);
    governance.execute(&executor, &id);
    assert_eq!(governance.get_proposal(&id).status, ProposalStatus::Executed);

    // The whole cycle left the token's books intact.
    assert_eq!(token.total_supply(), 1_950_000);
    assert_supply_conserved(&token, &everyone);
}

#[test]
fn snapshot_holders_can_defeat_a_proposal_that_live_balances_would_pass() {
    let Dao { env, admin, token, governance } = setup();
    let proposer = Address::generate(&env);
    let whale = Address::generate(&env);

    advance_to(&env, 101);
    token.transfer(&admin, &proposer, &150_000);
    token.transfer(&admin, &whale, &300_000);

    advance_to(&env, 110);
    let id = governance.create_proposal(
        &proposer,
        &text(&env, "Lower the quorum"),
        &text(&env, "Move quorum_bps from 500 to 100."),
        &text(&env, ""),
    );

    // After the snapshot the whale sells everything to the proposer. Live,
    // the proposer would now outvote the whale 450,000 to 0.
    advance_to(&env, 111);
    token.transfer(&whale, &proposer, &300_000);
    assert_eq!(token.balance(&proposer), 450_000);
    assert_eq!(token.balance(&whale), 0);

    // At the snapshot, though, the whale's 300,000 outweighs the proposer's
    // 150,000.
    governance.vote(&proposer, &id, &FOR);
    governance.vote(&whale, &id, &AGAINST);
    let proposal = governance.get_proposal(&id);
    assert_eq!(proposal.for_votes, 150_000);
    assert_eq!(proposal.against_votes, 300_000);

    advance_to(&env, proposal.end_ledger + 1);
    assert_eq!(governance.finalize(&id), ProposalStatus::Failed);
    assert_eq!(
        governance.try_execute(&proposer, &id),
        Err(Ok(GovernanceError::ProposalNotPassed))
    );
    assert_eq!(token.total_supply(), INITIAL_SUPPLY);
}
