//! Fuzzes `vote`, then drives the same proposal into `finalize`.
//!
//! Every iteration deploys a fresh token + governor from fuzzed configuration,
//! opens a proposal, moves the ledger to a fuzzed position, casts one or two
//! votes with raw `support` values, and finalizes past the voting deadline.
//! Valid entry-point input must never panic or trap: contract errors are
//! expected outcomes, panics are failures.
#![no_main]

mod common;

use common::*;
use libfuzzer_sys::fuzz_target;
use quorum_governance::GovernanceContractClient;

fuzz_target!(|data: &[u8]| {
    let mut cursor = Cursor::new(data);
    let cfg = FuzzConfig::decode(&mut cursor);
    let support = cursor.u32();
    let proposal_sel = cursor.u64();
    let voter_idx = cursor.u8();
    let adv_mode = cursor.u8();
    let adv_raw = cursor.u32();
    let support2 = cursor.u32();
    let voter_idx2 = cursor.u8();

    let (env, h) = deploy(&cfg);
    let created = create_proposal(&env, &h);
    let end = created.and_then(|id| proposal_end(&env, &h, id));
    advance(&env, end, adv_mode, adv_raw);

    let proposal_id = pick_proposal(proposal_sel, created);
    let governance = GovernanceContractClient::new(&env, &h.governance_id);

    fuzz_call!(
        "vote",
        governance.try_vote(h.voter(voter_idx), &proposal_id, &support)
    );

    // Second vote: double-vote rejection, a different voter's power, or a
    // vote on a proposal that no longer exists.
    if cfg.flags & 1 != 0 {
        fuzz_call!(
            "vote#2",
            governance.try_vote(h.voter(voter_idx2), &proposal_id, &support2)
        );
    }
    // Re-creating after the ledger moved exercises start/end ledger
    // arithmetic against a non-zero sequence.
    if cfg.flags & 2 != 0 {
        let _ = create_proposal(&env, &h);
    }

    // Always finish past the first proposal's deadline so finalize runs too.
    if let Some(end) = end {
        set_sequence(
            &env,
            end.saturating_add(1).saturating_add(adv_raw % 16),
        );
    }
    fuzz_call!("finalize", governance.try_finalize(&proposal_id));
});
