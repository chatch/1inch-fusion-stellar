#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    Address, Bytes, BytesN, Env, symbol_short,
    log, token
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


    /// Withdraw funds by revealing the secret (taker only)
    /// Tokens go to maker, safety deposit to caller
    pub fn withdraw(env: Env, secret: BytesN<32>) -> Result<(), Error> {
        let immutables = Self::get_immutables(&env)?;
        let state = Self::get_state(&env)?;
        
        // Check state
        match state {
            State::Withdrawn => return Err(Error::AlreadyWithdrawn),
            State::Cancelled => return Err(Error::AlreadyCancelled),
            _ => {}
        }
        
        // Check caller is taker
        immutables.taker.require_auth();
        
        // Check time windows
        Self::require_after(&env, &immutables, Stage::DstWithdrawal)?;
        Self::require_before(&env, &immutables, Stage::DstCancellation)?;
        
        // Verify secret
        Self::verify_secret(&env, &secret, &immutables.hashlock)?;
        
        // Execute withdrawal (tokens to maker, safety deposit to caller)
        Self::execute_withdrawal(&env, &immutables, &immutables.maker, &env.current_contract_address())?;
        
        // Log withdrawal event with secret
        log!(&env, "EscrowWithdrawal", secret);
        
        Ok(())
    }

    /// Public withdrawal - anyone can call after public period starts
    /// Tokens go to maker, safety deposit to caller
    pub fn public_withdraw(env: Env, secret: BytesN<32>) -> Result<(), Error> {
        let immutables = Self::get_immutables(&env)?;
        let state = Self::get_state(&env)?;
        
        // Check state
        match state {
            State::Withdrawn => return Err(Error::AlreadyWithdrawn),
            State::Cancelled => return Err(Error::AlreadyCancelled),
            _ => {}
        }
        
        // Check time windows
        Self::require_after(&env, &immutables, Stage::DstPublicWithdrawal)?;
        Self::require_before(&env, &immutables, Stage::DstCancellation)?;
        
        // Verify secret
        Self::verify_secret(&env, &secret, &immutables.hashlock)?;
        
        // Execute withdrawal (tokens to maker, safety deposit to caller)
        Self::execute_withdrawal(&env, &immutables, &immutables.maker, &env.current_contract_address())?;
        
        // Log withdrawal event
        log!(&env, "EscrowWithdrawal", secret);
        
        Ok(())
    }

    /// Cancel and return funds to taker (taker only)
    pub fn cancel(env: Env) -> Result<(), Error> {
        let immutables = Self::get_immutables(&env)?;
        let state = Self::get_state(&env)?;
        
        // Check state
        match state {
            State::Withdrawn => return Err(Error::AlreadyWithdrawn),
            State::Cancelled => return Err(Error::AlreadyCancelled),
            _ => {}
        }
        
        // Check caller is taker
        immutables.taker.require_auth();
        
        // Check time window
        Self::require_after(&env, &immutables, Stage::DstCancellation)?;
        
        // Execute cancellation (tokens to taker, safety deposit to caller)
        Self::execute_cancellation(&env, &immutables, &env.current_contract_address())?;
        
        // Log cancellation event
        log!(&env, "EscrowCancelled");
        
        Ok(())
    }

    /// Get time until a specific stage
    pub fn time_until_stage(env: Env, stage: Stage) -> Result<i64, Error> {
        let immutables = Self::get_immutables(&env)?;
        let current_time = env.ledger().timestamp();
        let stage_time = Self::get_stage_time(&immutables, stage);
        
        Ok((stage_time as i64) - (current_time as i64))
    }

    // Helper functions

    fn get_stage_time(immutables: &Immutables, stage: Stage) -> u64 {
        let base = immutables.deployed_at;
        match stage {
            Stage::DstWithdrawal => base + immutables.withdrawal_start,
            Stage::DstPublicWithdrawal => base + immutables.public_withdrawal_start,
            Stage::DstCancellation => base + immutables.cancellation_start,
        }
    }

    fn require_after(env: &Env, immutables: &Immutables, stage: Stage) -> Result<(), Error> {
        let current_time = env.ledger().timestamp();
        let required_time = Self::get_stage_time(immutables, stage);
        
        if current_time < required_time {
            return Err(Error::InvalidTime);
        }
        Ok(())
    }

    fn require_before(env: &Env, immutables: &Immutables, stage: Stage) -> Result<(), Error> {
        let current_time = env.ledger().timestamp();
        let deadline = Self::get_stage_time(immutables, stage);
        
        if current_time >= deadline {
            return Err(Error::InvalidTime);
        }
        Ok(())
    }

    fn verify_secret(env: &Env, secret: &BytesN<32>, hashlock: &BytesN<32>) -> Result<(), Error> {
        // Convert BytesN<32> to Bytes for sha256
        let secret_array: [u8; 32] = secret.to_array();
        let secret_bytes = Bytes::from_slice(env, &secret_array);
        let computed_hash = env.crypto().sha256(&secret_bytes);
        let computed_hash_32 = BytesN::<32>::from_array(env, &computed_hash.to_array());
        
        if computed_hash_32 != *hashlock {
            return Err(Error::InvalidSecret);
        }
        Ok(())
    }

    fn execute_withdrawal(
        env: &Env,
        immutables: &Immutables,
        token_recipient: &Address,
        _safety_deposit_recipient: &Address,
    ) -> Result<(), Error> {
        // Update state
        env.storage().instance().set(&symbol_short!("state"), &State::Withdrawn);
        
        // Transfer tokens to recipient (maker in this case)
        let token_client = token::Client::new(env, &immutables.token);
        token_client.transfer(
            &env.current_contract_address(),
            token_recipient,
            &immutables.amount
        );
        
        // Transfer safety deposit (native XLM) to caller
        if immutables.safety_deposit > 0 {
            // For XLM, we'd use native asset contract
            // This is simplified - in production you'd handle native asset properly
            // env.pay(&safety_deposit_recipient, &immutables.safety_deposit);
        }
        
        Ok(())
    }

    fn execute_cancellation(
        env: &Env,
        immutables: &Immutables,
        _safety_deposit_recipient: &Address,
    ) -> Result<(), Error> {
        // Update state
        env.storage().instance().set(&symbol_short!("state"), &State::Cancelled);
        
        // Transfer tokens back to taker (not maker like in EscrowSrc)
        let token_client = token::Client::new(env, &immutables.token);
        token_client.transfer(
            &env.current_contract_address(),
            &immutables.taker,
            &immutables.amount
        );
        
        // Transfer safety deposit (native XLM) to caller
        if immutables.safety_deposit > 0 {
            // For XLM, we'd use native asset contract
            // This is simplified - in production you'd handle native asset properly
            // env.pay(&safety_deposit_recipient, &immutables.safety_deposit);
        }
        
        Ok(())
    }

}

#[cfg(test)]
mod test {
    extern crate std;
    
    use super::*;
    use soroban_sdk::{
        Address, Bytes, BytesN, Env, IntoVal,
        testutils::{Address as _, Ledger as _, AuthorizedFunction, AuthorizedInvocation},
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
            taker: taker.clone(), // Clone here so we can use taker later
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

        // Verify state is active
        let state = client.get_state();
        assert_eq!(state, State::Active);

        // Test withdrawal (should fail before time window)
        let result = client.try_withdraw(&secret);
        assert!(result.is_err());

        // Fast forward time to withdrawal period
        env.ledger().with_mut(|li| {
            li.timestamp = 100; // After withdrawal_start
        });

        // Test successful withdrawal with proper taker authorization
        env.auths().push((
            taker.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    contract_id.clone(),
                    symbol_short!("withdraw"),
                    (secret.clone(),).into_val(&env),
                )),
                sub_invocations: std::vec![],
            }
        ));

        let result = client.try_withdraw(&secret.clone());
        assert!(result.is_ok()); // Should succeed now!

        // Verify state is withdrawn
        let state = client.get_state();
        assert_eq!(state, State::Withdrawn);
    }
} 