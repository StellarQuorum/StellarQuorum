//! Shared input decoding and scenario setup for the `vote` and `finalize`
//! fuzz targets.
//!
//! Inputs are decoded sequentially, little-endian, from raw bytes: bytes past
//! the end of a short input decode as zero, so every input has a defined
//! meaning and corpus files stay hand-writable. `contracts/fuzz/corpus/` seeds
//! follow exactly this layout.

#![allow(dead_code)]

use quorum_governance::{GovernanceContract, GovernanceContractClient};
use quorum_token::{QuorumToken, QuorumTokenClient};
use soroban_sdk::testutils::{Address as _, EnvTestConfig, Ledger as _};
use soroban_sdk::{Address, Env, String};

/// Unwraps a `try_` client call.
///
/// - `Ok(Ok(v))` → success
/// - `Err(Ok(e))` → the contract returned one of its declared errors (fine)
/// - anything else → panic here, which fails the fuzz iteration: invoke-level
///   failures carry the host's WASM-trap emulation of a native contract panic
///   (overflow, `panic!`, unwrap), and on-chain those are real traps.
#[macro_export]
macro_rules! fuzz_call {
    ($label:expr, $expr:expr) => {
        match $expr {
            Ok(Ok(value)) => Some(value),
            Ok(Err(err)) => panic!("{}: return conversion failed: {:?}", $label, err),
            Err(Ok(_)) => None,
            Err(Err(err)) => panic!("{}: invoke-level failure (trap): {:?}", $label, err),
        }
    };
}

/// Sequential little-endian reader over the fuzz input.
pub struct Cursor<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    pub fn new(buf: &'a [u8]) -> Self {
        Self { buf, pos: 0 }
    }

    fn take(&mut self, n: usize) -> [u8; 16] {
        let mut out = [0u8; 16];
        for (i, slot) in out.iter_mut().take(n).enumerate() {
            *slot = self.buf.get(self.pos + i).copied().unwrap_or(0);
        }
        self.pos += n;
        out
    }

    pub fn u8(&mut self) -> u8 {
        self.take(1)[0]
    }

    pub fn u32(&mut self) -> u32 {
        let b = self.take(4);
        u32::from_le_bytes([b[0], b[1], b[2], b[3]])
    }

    pub fn u64(&mut self) -> u64 {
        let b = self.take(8);
        let mut le = [0u8; 8];
        le.copy_from_slice(&b[..8]);
        u64::from_le_bytes(le)
    }

    pub fn i128(&mut self) -> i128 {
        let b = self.take(16);
        let mut le = [0u8; 16];
        le.copy_from_slice(&b[..16]);
        i128::from_le_bytes(le)
    }
}

/// Fuzzed contract configuration plus the funding split applied at deploy.
///
/// Field order here defines the first 62 bytes of every seed.
pub struct FuzzConfig {
    pub quorum_bps: u32,
    pub voting_period: u32,
    pub timelock_period: u32,
    pub proposal_threshold: i128,
    pub supply: i128,
    pub flags: u8,
    /// Amounts transferred from the admin to voters 0..3 before any proposal.
    pub shares: [i128; 3],
}

impl FuzzConfig {
    pub fn decode(c: &mut Cursor) -> Self {
        let quorum_bps = c.u32() % 10_001;
        // Full u32 range: an absurd voting or timelock period is valid input
        // to initialize() and must never trap downstream.
        let voting_period = c.u32();
        let timelock_period = c.u32();
        let proposal_threshold = c.i128() % (1i128 << 40);
        let supply_selector = c.u8() % 4;
        let supply_raw = c.u64();
        let supply = match supply_selector {
            0 => 1 + i128::from(supply_raw) % (1i128 << 80),
            // Exercise the top of the range: quorum math against i128::MAX.
            1 => i128::MAX,
            2 => 0,
            _ => (1i128 << 40) + i128::from(supply_raw) % (1i128 << 24),
        };
        let flags = c.u8();

        // Split at most the admin's balance across three voters, so token
        // sums never overflow independently of what the fuzzed calls do.
        let mut shares = [0i128; 3];
        let mut remaining = supply;
        for share in shares.iter_mut() {
            let cap = remaining / 4 + 1;
            *share = i128::from(c.u64()) % cap;
            remaining -= *share;
        }

        Self {
            quorum_bps,
            voting_period,
            timelock_period,
            proposal_threshold,
            supply,
            flags,
            shares,
        }
    }
}

pub struct Harness {
    pub admin: Address,
    pub token_id: Address,
    pub governance_id: Address,
    /// [funded, funded, funded, zero balance, admin]
    pub voters: [Address; 5],
}

impl Harness {
    pub fn voter(&self, idx: u8) -> &Address {
        &self.voters[(idx % 5) as usize]
    }
}

/// Highest ledger the harness will ever run a contract call on.
///
/// Deploy raises `min_persistent_entry_ttl` to the protocol maximum, so every
/// entry written at ledger 0 stays live until 6,311,999. Past that the host
/// refuses with a testing-only "archived entry" internal error — on-chain the
/// transaction would be rejected before the contract runs at all (the host's
/// own message says so) — so the harness clamps every ledger position here
/// rather than fuzzing protocol-level archival.
pub const SAFE_MAX_SEQUENCE: u32 = 6_300_000;

/// Moves the ledger to `seq`, clamped to [`SAFE_MAX_SEQUENCE`].
pub fn set_sequence(env: &Env, seq: u32) {
    env.ledger()
        .set_sequence_number(seq.min(SAFE_MAX_SEQUENCE));
}

/// Deploys and initializes a token and a governor wired to it, with the
/// fuzzed configuration, and funds the voter addresses.
///
/// Snapshot capture on Env drop is disabled: a fuzz run creates an Env per
/// iteration and would otherwise write thousands of test snapshot files.
pub fn deploy(cfg: &FuzzConfig) -> (Env, Harness) {
    let env = Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
    });
    // Model freshly renewed ledger entries: without this, default entries
    // live only 4,096 ledgers and any fuzzed jump past them trips the
    // testing-only archived-entry panic instead of exercising the contract.
    env.ledger().set_min_persistent_entry_ttl(6_312_000);
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_id = env.register(QuorumToken, ());
    QuorumTokenClient::new(&env, &token_id).initialize(
        &admin,
        &String::from_str(&env, "Quorum"),
        &String::from_str(&env, "QUORUM"),
        &7u32,
        &cfg.supply,
    );

    let governance_id = env.register(GovernanceContract, ());
    GovernanceContractClient::new(&env, &governance_id).initialize(
        &admin,
        &token_id,
        &cfg.quorum_bps,
        &cfg.voting_period,
        &cfg.timelock_period,
        &cfg.proposal_threshold,
    );

    let token = QuorumTokenClient::new(&env, &token_id);
    let funded = [
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    ];
    for (voter, share) in funded.iter().zip(cfg.shares) {
        if share > 0 {
            crate::fuzz_call!("transfer", token.try_transfer(&admin, voter, &share));
        }
    }
    let zero_balance = Address::generate(&env);

    let harness = Harness {
        voters: [
            funded[0].clone(),
            funded[1].clone(),
            funded[2].clone(),
            zero_balance,
            admin.clone(),
        ],
        admin,
        token_id,
        governance_id,
    };
    (env, harness)
}

/// Opens a proposal as the admin; `None` when the contract rejected it
/// (below threshold, quorum math overflow, ledger window overflow, ...).
pub fn create_proposal(env: &Env, h: &Harness) -> Option<u64> {
    let governance = GovernanceContractClient::new(env, &h.governance_id);
    crate::fuzz_call!(
        "create_proposal",
        governance.try_create_proposal(
            &h.admin,
            &String::from_str(env, "Fuzz proposal"),
            &String::from_str(env, "Fuzz description."),
        )
    )
}

/// `id` of the proposal the input refers to: the created one on even
/// selectors, otherwise a number that usually does not exist.
pub fn pick_proposal(sel: u64, created: Option<u64>) -> u64 {
    if sel % 2 == 0 {
        created.unwrap_or(1)
    } else {
        1 + sel % 1_000
    }
}

/// End ledger of a proposal, or `None` if it cannot be read.
pub fn proposal_end(env: &Env, h: &Harness, id: u64) -> Option<u32> {
    let governance = GovernanceContractClient::new(env, &h.governance_id);
    crate::fuzz_call!("get_proposal", governance.try_get_proposal(&id))
        .map(|proposal| proposal.end_ledger)
}

/// Moves the ledger to a position derived from `mode`:
/// 0 = stay put, 1 = step forward, 2 = just before the voting deadline,
/// 3 = past the voting deadline.
///
/// Positions are saturating so a fuzzed u32 can never itself panic the
/// harness — only the contract under test can.
pub fn advance(env: &Env, end_ledger: Option<u32>, mode: u8, raw: u32) {
    let current = env.ledger().sequence();
    let target = match mode % 4 {
        1 => current.saturating_add(raw % 1_024),
        2 => end_ledger.map_or(current, |end| end.saturating_sub(raw % 4)),
        3 => end_ledger.map_or_else(
            || current.saturating_add(raw % 1_024),
            |end| end.saturating_add(1).saturating_add(raw % 16),
        ),
        _ => current,
    };
    set_sequence(env, target);
}
