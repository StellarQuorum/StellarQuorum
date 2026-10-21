//! Integration of #310's delegation plan with real governance snapshots.
use super::*;

#[test]
fn delegated_weight_is_counted_once_and_later_changes_cannot_rewrite_a_snapshot() {
    let env = Env::default();
    env.ledger().set_sequence_number(10);
    let (admin, token_id, governor_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let token = QuorumTokenClient::new(&env, &token_id);
    let governor = GovernanceContractClient::new(&env, &governor_id);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);
    token.transfer(&admin, &alice, &100);
    token.transfer(&admin, &bob, &40);
    token.transfer(&admin, &carol, &20);
    env.ledger().set_sequence_number(20);
    governor.delegate(&alice, &bob);
    let proposal = governor.create_proposal(
        &admin,
        &text(&env, "Delegation"),
        &text(&env, ""),
        &text(&env, ""),
    );
    // No vote may observe a snapshot while that ledger can still change.
    assert_eq!(
        governor.try_vote(&bob, &proposal, &1),
        Err(Ok(GovernanceError::VotingNotActive))
    );
    env.ledger().set_sequence_number(21);
    governor.delegate(&alice, &carol);
    token.transfer(&alice, &carol, &10);
    governor.vote(&bob, &proposal, &1);
    governor.vote(&carol, &proposal, &1);
    assert_eq!(governor.get_voting_power(&proposal, &bob), 140);
    assert_eq!(
        governor.try_vote(&alice, &proposal, &1),
        Err(Ok(GovernanceError::NoVotingPower))
    );
    // Still inside the window, so a repeat vote replaces the earlier choice
    // rather than adding to it: the weight stays counted once.
    assert!(governor.try_vote(&bob, &proposal, &1).is_ok());
    assert_eq!(governor.get_proposal(&proposal).for_votes, 160);
    assert_eq!(governor.get_past_votes(&bob, &19), 40);
    assert_eq!(governor.get_past_votes(&bob, &20), 140);
    assert_eq!(governor.get_past_votes(&bob, &21), 40);

    let next = governor.create_proposal(
        &admin,
        &text(&env, "Next"),
        &text(&env, ""),
        &text(&env, ""),
    );
    env.ledger().set_sequence_number(22);
    governor.undelegate(&alice);
    governor.vote(&carol, &next, &1);
    governor.vote(&bob, &next, &1);
    assert_eq!(governor.get_proposal(&next).for_votes, 160);
    assert_eq!(
        governor.try_vote(&alice, &next, &1),
        Err(Ok(GovernanceError::NoVotingPower))
    );
    assert_eq!(governor.get_delegate(&alice), alice);
    assert_eq!(token.balance(&alice), 90);
}

#[test]
fn delegation_after_a_proposal_preserves_the_original_holders_snapshot_votes() {
    let env = Env::default();
    env.ledger().set_sequence_number(10);
    let (admin, token_id, governor_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let token = QuorumTokenClient::new(&env, &token_id);
    let governor = GovernanceContractClient::new(&env, &governor_id);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    token.transfer(&admin, &alice, &100);
    token.transfer(&admin, &bob, &40);
    env.ledger().set_sequence_number(19);
    let proposal = governor.create_proposal(
        &admin,
        &text(&env, "Before delegation"),
        &text(&env, ""),
        &text(&env, ""),
    );
    env.ledger().set_sequence_number(20);
    governor.delegate(&alice, &bob);
    governor.vote(&alice, &proposal, &1);
    governor.vote(&bob, &proposal, &1);
    assert_eq!(governor.get_proposal(&proposal).for_votes, 140);
    assert_eq!(governor.get_past_votes(&alice, &19), 100);
    assert_eq!(governor.get_past_votes(&alice, &20), 0);
}

#[test]
fn governance_views_follow_direct_token_calls_and_revocation_clears_the_mapping() {
    let env = Env::default();
    let (admin, token_id, governor_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let token = QuorumTokenClient::new(&env, &token_id);
    let governor = GovernanceContractClient::new(&env, &governor_id);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);
    governor.delegate(&admin, &bob);
    env.as_contract(&governor_id, || {
        assert_eq!(
            env.storage()
                .persistent()
                .get::<_, Address>(&DataKey::Delegate(admin.clone())),
            Some(bob.clone())
        );
    });
    token.delegate(&admin, &carol);
    assert_eq!(governor.get_delegate(&admin), carol);
    governor.undelegate(&admin);
    assert_eq!(governor.get_delegate(&admin), admin);
    env.as_contract(&governor_id, || {
        assert!(!env
            .storage()
            .persistent()
            .has(&DataKey::Delegate(admin.clone())));
    });
}

#[test]
fn governance_delegation_requires_the_holder_and_emits_the_actual_destination() {
    let env = Env::default();
    let (admin, _, governor_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governor = GovernanceContractClient::new(&env, &governor_id);
    let bob = Address::generate(&env);
    env.set_auths(&[]);
    assert!(governor.try_delegate(&admin, &bob).is_err());
    assert!(governor.try_undelegate(&admin).is_err());
    env.mock_all_auths();
    governor.delegate(&admin, &bob);
    let (contract, _, data) = env.events().all().last().unwrap();
    assert_eq!(contract, governor_id);
    assert_eq!(
        Delegated::try_from_val(&env, &data).unwrap(),
        Delegated {
            delegator: admin.clone(),
            delegatee: bob
        }
    );
    governor.undelegate(&admin);
    let (_, _, data) = env.events().all().last().unwrap();
    assert_eq!(
        Delegated::try_from_val(&env, &data).unwrap().delegatee,
        admin
    );
}

fn text(env: &Env, value: &str) -> String {
    String::from_str(env, value)
}

#[test]
fn only_the_delegators_auth_tree_can_authorize_the_forwarded_token_call() {
    let env = Env::default();
    let (admin, token_id, governor_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governor = GovernanceContractClient::new(&env, &governor_id);
    let bob = Address::generate(&env);
    let args: soroban_sdk::Vec<Val> = (admin.clone(), bob.clone()).into_val(&env);
    env.mock_auths(&[MockAuth {
        address: &bob,
        invoke: &MockAuthInvoke {
            contract: &governor_id,
            fn_name: "delegate",
            args: args.clone(),
            sub_invokes: &[],
        },
    }]);
    assert!(governor.try_delegate(&admin, &bob).is_err());
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &governor_id,
            fn_name: "delegate",
            args: args.clone(),
            sub_invokes: &[MockAuthInvoke {
                contract: &token_id,
                fn_name: "delegate",
                args,
                sub_invokes: &[],
            }],
        },
    }]);
    governor.delegate(&admin, &bob);
    assert_eq!(governor.get_delegate(&admin), bob);
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &governor_id,
            fn_name: "undelegate",
            args: (admin.clone(),).into_val(&env),
            sub_invokes: &[MockAuthInvoke {
                contract: &token_id,
                fn_name: "delegate",
                args: (admin.clone(), admin.clone()).into_val(&env),
                sub_invokes: &[],
            }],
        },
    }]);
    governor.undelegate(&admin);
    assert_eq!(governor.get_delegate(&admin), admin);
}

#[test]
fn token_overflow_is_reported_with_the_governance_error_code() {
    let env = Env::default();
    let (admin, token_id, governor_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let governor = GovernanceContractClient::new(&env, &governor_id);
    let bob = Address::generate(&env);
    env.as_contract(&token_id, || {
        let mut history = soroban_sdk::Vec::new(&env);
        history.push_back(quorum_token::Checkpoint {
            ledger: env.ledger().sequence(),
            balance: i128::MAX,
        });
        env.storage().persistent().set(
            &quorum_token::DataKey::VoteCheckpoints(bob.clone()),
            &history,
        );
    });
    assert_eq!(
        governor.try_delegate(&admin, &bob),
        Err(Ok(GovernanceError::Overflow))
    );
    assert_eq!(governor.get_delegate(&admin), admin);
    env.as_contract(&governor_id, || {
        assert!(!env
            .storage()
            .persistent()
            .has(&DataKey::Delegate(admin.clone())));
    });
}

#[test]
fn a_stake_boost_counts_toward_the_snapshot_weight_and_the_vote() {
    let env = Env::default();
    env.ledger().set_sequence_number(10);
    let (admin, token_id, governor_id) = deploy(&env, 1_000_000, QUORUM_BPS);
    let token = QuorumTokenClient::new(&env, &token_id);
    let governor = GovernanceContractClient::new(&env, &governor_id);
    let holder = Address::generate(&env);
    token.transfer(&admin, &holder, &1_000);

    // Locked for the full term on ledger 20. The lock counts from ledger 21,
    // which is the snapshot ledger of the proposal opened there.
    env.ledger().set_sequence_number(20);
    token.stake(&holder, &1_000, &(LEDGERS_PER_DAY * 365));
    env.ledger().set_sequence_number(21);
    let proposal = governor.create_proposal(
        &admin,
        &text(&env, "Boost"),
        &text(&env, ""),
        &text(&env, ""),
    );

    // The balance's 1,000 plus a boost just under the full 1,000: the lock
    // has 365 days less one ledger to run.
    let snapshot_power = governor.get_voting_power(&proposal, &holder);
    assert_eq!(snapshot_power, 1_999);
    assert_eq!(snapshot_power, token.get_past_votes(&holder, &21));

    env.ledger().set_sequence_number(22);
    governor.vote(&holder, &proposal, &1);
    assert_eq!(governor.get_proposal(&proposal).for_votes, 1_999);
}
