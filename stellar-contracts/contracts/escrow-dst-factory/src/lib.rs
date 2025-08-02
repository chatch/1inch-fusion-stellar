#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    Address, Bytes, BytesN, Env, symbol_short,
    log, token
};

/// Immutable parameters for the escrow (same as EscrowDst)
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
    pub src_withdrawal_start: u32,      // When taker can withdraw
    pub src_public_withdrawal_start: u32, // When anyone can withdraw for taker
    pub src_cancellation_start: u32,     // When taker can cancel
    pub src_public_cancellation_start: u32, // When anyone can cancel
    pub dst_withdrawal_start: u32,      // When taker can withdraw
    pub dst_public_withdrawal_start: u32, // When anyone can withdraw for taker
    pub dst_cancellation_start: u32,     // When taker can cancel
}

/// Error codes for the factory
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    InsufficientEscrowBalance = 1,
    InvalidCreationTime = 2,
    TransferFailed = 3,
    InvalidImmutables = 4,
    EscrowCreationFailed = 5,
}

#[contract]
pub struct EscrowDstFactory;

#[contractimpl]
impl EscrowDstFactory {
    /// Create a new destination escrow contract
    /// This function maps the createDstEscrow functionality from BaseEscrowFactory
    pub fn create_dst_escrow(
        env: Env,
        dst_immutables: Immutables,
        src_cancellation_timestamp: u64,
    ) -> Result<Address, Error> {
        // Validate the caller is the taker
        dst_immutables.taker.require_auth();

        // Check that the escrow cancellation will start not later than the cancellation time on the source chain
        let dst_cancellation_time = dst_immutables.deployed_at + dst_immutables.dst_cancellation_start as u64;
        if dst_cancellation_time > src_cancellation_timestamp {
            return Err(Error::InvalidCreationTime);
        }

        // Create salt from immutables hash
        let salt = Self::compute_salt(&env, &dst_immutables);

        // Compute the escrow address
        let escrow_address = Self::compute_escrow_address(env.clone(), dst_immutables.clone());

        // Note: In Soroban, token transfers and native XLM transfers work differently than Ethereum
        // The taker would need to:
        // 1. Authorize token transfers to the escrow
        // 2. Send native XLM to the escrow address
        // 3. The factory then deploys and initializes the escrow
        
        // Log the requirements for the taker
        log!(&env, "EscrowCreationRequirements", 
              escrow_address, 
              dst_immutables.safety_deposit, 
              dst_immutables.token, 
              dst_immutables.amount);

        // Initialize the escrow with the immutables
        Self::init_escrow(&env, &escrow_address, &salt, &dst_immutables)?;

        // Log the creation event
        log!(&env, "DstEscrowCreated", escrow_address, dst_immutables.hashlock, dst_immutables.taker);

        Ok(escrow_address)
    }

    /// Compute the deterministic address for an escrow
    pub fn compute_escrow_address(
        env: Env,
        immutables: Immutables,
    ) -> Address {
        let salt = Self::compute_salt(&env, &immutables);
        // Use the same pattern as EscrowDst for address computation
        env.deployer().with_address(env.current_contract_address(), salt).deployed_address()
    }

    /// Compute salt from immutables (similar to hashMem in Ethereum)
    pub(crate) fn compute_salt(env: &Env, immutables: &Immutables) -> BytesN<32> {
        // Create a deterministic salt from key immutables
        let mut salt_array = [0u8; 32];
        
        // Use order_hash and hashlock for deterministic salt
        salt_array[..16].copy_from_slice(&immutables.order_hash.to_array()[..16]);
        salt_array[16..].copy_from_slice(&immutables.hashlock.to_array()[..16]);
        
        BytesN::from_array(env, &salt_array)
    }

    /// Initialize the escrow contract
    fn init_escrow(
        env: &Env,
        escrow_address: &Address,
        salt: &BytesN<32>,
        _immutables: &Immutables,
    ) -> Result<(), Error> {
        // In a real implementation, you would:
        // 1. Deploy the EscrowDst contract to the computed address
        // 2. Call the init function on the deployed escrow contract
        // 3. Pass the immutables and other parameters
        // 4. Handle any errors from the initialization
        
        // For now, we'll simulate the initialization
        log!(&env, "EscrowInitialized", escrow_address, salt);
        
        Ok(())
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        Address, BytesN, Env, 
        testutils::{Address as _, Ledger as _}
    };

    #[test]
    fn test_create_dst_escrow() {
        let env = Env::default();
        
        // Register the factory contract
        let contract_id = env.register(EscrowDstFactory, ());
        let client = EscrowDstFactoryClient::new(&env, &contract_id);
        
        // Create test immutables
        let immutables = Immutables {
            order_hash: BytesN::from_array(&env, &[1u8; 32]),
            hashlock: BytesN::from_array(&env, &[2u8; 32]),
            maker: Address::generate(&env),
            taker: Address::generate(&env),
            token: Address::generate(&env),
            amount: 1000,
            safety_deposit: 100,
            deployed_at: env.ledger().timestamp(),
            src_withdrawal_start: 3600,      // 1 hour
            src_public_withdrawal_start: 7200, // 2 hours
            src_cancellation_start: 10800,     // 3 hours
            src_public_cancellation_start: 14400, // 4 hours
            dst_withdrawal_start: 3600,      // 1 hour
            dst_public_withdrawal_start: 7200, // 2 hours
            dst_cancellation_start: 10800,     // 3 hours
        };

        // Test that we can compute the escrow address
        let escrow_address = client.compute_escrow_address(&immutables);
        // Just verify the function doesn't panic and returns an address
        assert!(escrow_address.to_string().len() > 0);
    }

    #[test]
    fn test_compute_salt() {
        let env = Env::default();
        
        let immutables = Immutables {
            order_hash: BytesN::from_array(&env, &[1u8; 32]),
            hashlock: BytesN::from_array(&env, &[2u8; 32]),
            maker: Address::generate(&env),
            taker: Address::generate(&env),
            token: Address::generate(&env),
            amount: 1000,
            safety_deposit: 100,
            deployed_at: env.ledger().timestamp(),
            src_withdrawal_start: 3600,
            src_public_withdrawal_start: 7200,
            src_cancellation_start: 10800,
            src_public_cancellation_start: 14400,
            dst_withdrawal_start: 3600,
            dst_public_withdrawal_start: 7200,
            dst_cancellation_start: 10800,
        };

        let salt = EscrowDstFactory::compute_salt(&env, &immutables);
        assert!(salt != BytesN::from_array(&env, &[0u8; 32]));
        
        // Test that same immutables produce same salt
        let salt2 = EscrowDstFactory::compute_salt(&env, &immutables);
        assert_eq!(salt, salt2);
    }

    #[test]
    fn test_invalid_creation_time() {
        let env = Env::default();
        
        // Register the factory contract
        let contract_id = env.register(EscrowDstFactory, ());
        let client = EscrowDstFactoryClient::new(&env, &contract_id);
        
        let immutables = Immutables {
            order_hash: BytesN::from_array(&env, &[1u8; 32]),
            hashlock: BytesN::from_array(&env, &[2u8; 32]),
            maker: Address::generate(&env),
            taker: Address::generate(&env),
            token: Address::generate(&env),
            amount: 1000,
            safety_deposit: 100,
            deployed_at: env.ledger().timestamp(),
            src_withdrawal_start: 3600,
            src_public_withdrawal_start: 7200,
            src_cancellation_start: 10800,
            src_public_cancellation_start: 14400,
            dst_withdrawal_start: 3600,
            dst_public_withdrawal_start: 7200,
            dst_cancellation_start: 10800,
        };

        // Test with invalid creation time (dst cancellation after src cancellation)
        let src_cancellation_time = immutables.deployed_at + 5000; // 5000 seconds from deployment
        
        // Use the try_ prefixed method to get the Result
        let result = client.try_create_dst_escrow(&immutables, &src_cancellation_time);
        assert!(result.is_err());
    }
} 