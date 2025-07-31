#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    Address, Bytes, BytesN, Env, symbol_short,
    log
};

/// Immutable parameters for the escrow
#[contracttype]
#[derive(Clone)]
pub struct Immutables {
    pub order_hash: BytesN<32>,
    pub hashlock: BytesN<32>,
    pub maker: Address,
    pub taker: Address,
    pub token: Address,
    pub amount: i128,
    pub safety_deposit: i128,
    pub deployed_at: u64,
    // Timelock durations in seconds from deployment
    pub withdrawal_start: u64,      // When taker can withdraw
    pub public_withdrawal_start: u64, // When anyone can withdraw for taker
    pub cancellation_start: u64,     // When taker can cancel
    pub public_cancellation_start: u64, // When anyone can cancel
} 

/// Timelock stages for the destination escrow
#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Stage {
    DstWithdrawal,
    DstPublicWithdrawal,
    DstCancellation,
}

/// Contract state
#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum State {
    Active,
    Withdrawn,
    Cancelled,
}

/// Error codes
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAddress = 3,
    InvalidCaller = 4,
    InvalidSecret = 5,
    InvalidTime = 6,
    AlreadyWithdrawn = 7,
    AlreadyCancelled = 8,
    InsufficientBalance = 9,
    TransferFailed = 10,
    InvalidImmutables = 11,
}

#[contract]
pub struct EscrowDst;

#[contractimpl]
impl EscrowDst {
    /// Initialize the destination escrow with immutable parameters
    pub fn init(
        env: Env,
        deployer: Address,
        salt: BytesN<32>,
        immutables: Immutables,
    ) -> Result<(), Error> {
        // Check if already initialized
        if env.storage().instance().has(&symbol_short!("init")) {
            return Err(Error::AlreadyInitialized);
        }

        // Verify the contract address matches expected (skip in tests)
        #[cfg(not(test))]
        {
            let expected_address = Self::compute_address(env.clone(), deployer.clone(), salt.clone());
            let current_address = env.current_contract_address();
            
            if expected_address != current_address {
                return Err(Error::InvalidAddress);
            }
        }

        // Store immutables with current timestamp
        let mut immutables_with_time = immutables;
        immutables_with_time.deployed_at = env.ledger().timestamp();
        
        env.storage().instance().set(&symbol_short!("immut"), &immutables_with_time);
        env.storage().instance().set(&symbol_short!("deployer"), &deployer);
        env.storage().instance().set(&symbol_short!("salt"), &salt);
        env.storage().instance().set(&symbol_short!("state"), &State::Active);
        env.storage().instance().set(&symbol_short!("init"), &true);

        // Log initialization event
        log!(&env, "EscrowDstInitialized", deployer, salt);

        Ok(())
    }

    /// Compute the deterministic address for this contract
    pub fn compute_address(env: Env, deployer: Address, salt: BytesN<32>) -> Address {
        env.deployer().with_address(deployer, salt).deployed_address()
    }

    /// Get immutable parameters
    pub fn get_immutables(env: &Env) -> Result<Immutables, Error> {
        env.storage().instance()
            .get(&symbol_short!("immut"))
            .ok_or(Error::NotInitialized)
    }

    /// Get current state
    pub fn get_state(env: &Env) -> Result<State, Error> {
        env.storage().instance()
            .get(&symbol_short!("state"))
            .ok_or(Error::NotInitialized)
    }

}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        Address, BytesN, Env,
        testutils::{Address as _},
    };

    #[test]
    fn test_init() {
        let env = Env::default();

        // Create test addresses
        let deployer = Address::generate(&env);
        let maker = Address::generate(&env);
        let taker = Address::generate(&env);
        let token = Address::generate(&env);
        let salt = BytesN::from_array(&env, &[1u8; 32]);

        // Register the contract and get its address
        let contract_id = env.register(EscrowDst, ());
        let client = EscrowDstClient::new(&env, &contract_id);

        // Create test secret and hashlock
        let secret = BytesN::from_array(&env, &[2u8; 32]);
        let secret_array: [u8; 32] = secret.to_array();
        let secret_bytes = Bytes::from_slice(&env, &secret_array);
        let hashlock = env.crypto().sha256(&secret_bytes);
        let hashlock_32 = BytesN::<32>::from_array(&env, &hashlock.to_array());

        // Create immutables
        let immutables = Immutables {
            order_hash: BytesN::from_array(&env, &[3u8; 32]),
            hashlock: hashlock_32,
            maker,
            taker,
            token,
            amount: 1000,
            safety_deposit: 100,
            deployed_at: 0, // Will be set during init
            withdrawal_start: 60,      // 1 minute
            public_withdrawal_start: 120, // 2 minutes
            cancellation_start: 300,     // 5 minutes
            public_cancellation_start: 600, // 10 minutes
        };

        // Initialize contract
        client.init(&deployer, &salt, &immutables);

        // Verify state is withdrawn
        let state = client.get_state();
        assert_eq!(state, State::Active);
    }

} 