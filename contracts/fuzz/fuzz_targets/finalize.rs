//! Fuzzes tally and quorum arithmetic through `vote` and `finalize`.
//!
//! Every iteration deploys a fresh token + governor from fuzzed configuration
//! (including the full u32 range for voting and timelock periods and supplies
//! up to i128::MAX), casts votes from up to four voters with raw `support`
//! values, optionally cancels, then finalizes twice past the deadline.
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
    let support_a = cursor.u32();
    let support_b = cursor.u32();
    let support_c = cursor.u32();
    let proposal_sel = cursor.u64();
    let adv_raw = cursor.u32();
    let flags = cursor.u8();

    let (env, h) = deploy(&cfg);
    let created = create_proposal(&env, &h);
    let end = created.and_then(|id| proposal_end(&env, &h, id));

    // Vote inside the window (last ledger of it when the proposal exists).
    if let Some(end) = end {
        set_sequence(&env, end);
    }

    let governance = GovernanceContractClient::new(&env, &h.governance_id);
    let proposal_id = pick_proposal(proposal_sel, created);
    fuzz_call!(
        "vote#0",
        governance.try_vote(h.voter(0), &proposal_id, &support_a)
    );
    fuzz_call!(
        "vote#1",
        governance.try_vote(h.voter(1), &proposal_id, &support_b)
    );
    fuzz_call!(
        "vote#2",
        governance.try_vote(h.voter(2), &proposal_id, &support_c)
    );
    fuzz_call!(
        "vote#3",
        governance.try_vote(h.voter(3), &proposal_id, &support_a)
    );
    fuzz_call!(
        "vote#4",
        governance.try_vote(h.voter(4), &proposal_id, &support_b)
    );

    // Cancel first half the time: finalize must handle a terminal status.
    if flags & 1 != 0 {
        fuzz_call!(
            "cancel",
            governance.try_cancel(&h.admin, &proposal_id)
        );
    }

    if let Some(end) = end {
        set_sequence(&env, end.saturating_add(1).saturating_add(adv_raw % 16));
    } else {
        advance(&env, None, 1, adv_raw);
    }

    // Finalizing twice: recomputing a finalized proposal must stay a clean
    // error, not a trap.
    fuzz_call!("finalize", governance.try_finalize(&proposal_id));
    fuzz_call!("finalize#2", governance.try_finalize(&proposal_id));
});
