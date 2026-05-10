#![no_std]
//! QUORUM — governance token for the Quorum protocol. SEP-41 compatible.
use soroban_sdk::{contract, contractimpl, contracttype, contracterror, Address, Env, String};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TokenError {
    AlreadyInitialized    = 1,
    Unauthorized          = 2,
    InsufficientBalance   = 3,
    InsufficientAllowance = 4,
    InvalidAmount         = 5,
    Overflow              = 6,
}

#[contracttype]
pub enum DataKey {
    Admin, Name, Symbol, Decimals, TotalSupply,
    Balance(Address),
    Allowance(Address, Address),
}

#[contract]
pub struct QuorumToken;

#[contractimpl]
impl QuorumToken {
    pub fn initialize(env: Env, admin: Address, name: String, symbol: String, decimals: u32, initial_supply: i128) -> Result<(), TokenError> {
        if env.storage().instance().has(&DataKey::Admin) { return Err(TokenError::AlreadyInitialized); }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        env.storage().instance().set(&DataKey::Decimals, &decimals);
        env.storage().instance().set(&DataKey::TotalSupply, &initial_supply);
        env.storage().persistent().set(&DataKey::Balance(admin), &initial_supply);
        Ok(())
    }

    pub fn balance(env: Env, owner: Address) -> i128 {
        env.storage().persistent().get(&DataKey::Balance(owner)).unwrap_or(0)
    }

    pub fn total_supply(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0)
    }
