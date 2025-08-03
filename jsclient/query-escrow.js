require('dotenv/config');
const ethers = require('ethers');

// EscrowSrc contract ABI (read-only functions only)
const ESCROW_SRC_ABI = [
    {"type":"function","name":"FACTORY","inputs":[],"outputs":[{"name":"","type":"address","internalType":"address"}],"stateMutability":"view"},
    {"type":"function","name":"PROXY_BYTECODE_HASH","inputs":[],"outputs":[{"name":"","type":"bytes32","internalType":"bytes32"}],"stateMutability":"view"},
    {"type":"function","name":"RESCUE_DELAY","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"}
];

// Phase determination constants
const PHASES = {
    DEPLOYED: 'DEPLOYED',
    FINALITY: 'FINALITY',
    PRIVATE_WITHDRAWAL: 'PRIVATE_WITHDRAWAL',
    PUBLIC_WITHDRAWAL: 'PUBLIC_WITHDRAWAL',
    PRIVATE_CANCELLATION: 'PRIVATE_CANCELLATION',
    PUBLIC_CANCELLATION: 'PUBLIC_CANCELLATION',
    EXPIRED: 'EXPIRED'
};

async function queryEscrowContract(contractAddress, provider) {
    console.log(`\n🔍 Querying EscrowSrc contract: ${contractAddress}`);
    console.log('=' .repeat(60));
    
    try {
        const contract = new ethers.Contract(contractAddress, ESCROW_SRC_ABI, provider);
        
        // Query basic contract info
        console.log('\n📋 Basic Contract Information:');
        console.log('-'.repeat(40));
        
        const factory = await contract.FACTORY();
        console.log(`Factory Address: ${factory}`);
        
        const proxyBytecodeHash = await contract.PROXY_BYTECODE_HASH();
        console.log(`Proxy Bytecode Hash: ${proxyBytecodeHash}`);
        
        const rescueDelay = await contract.RESCUE_DELAY();
        console.log(`Rescue Delay: ${rescueDelay.toString()} seconds`);
        
        // Get contract balance
        const balance = await provider.getBalance(contractAddress);
        console.log(`Contract Balance: ${ethers.formatEther(balance)} ETH`);
        
        // Get current block timestamp
        const currentBlock = await provider.getBlock('latest');
        const currentTime = currentBlock.timestamp;
        console.log(`Current Block Time: ${new Date(currentTime * 1000).toISOString()}`);
        
        return {
            factory,
            proxyBytecodeHash,
            rescueDelay: rescueDelay.toString(),
            balance: balance.toString(),
            currentTime
        };
        
    } catch (error) {
        console.error('❌ Error querying contract:', error.message);
        throw error;
    }
}

function determineEscrowPhase(immutables, currentTime) {
    console.log('\n⏰ Phase Determination:');
    console.log('-'.repeat(40));
    
    const timelocks = immutables.timelocks;
    const deploymentTime = timelocks.srcWithdrawal - 60; // Assuming 60 seconds before first timelock
    
    console.log(`Deployment Time: ${new Date(deploymentTime * 1000).toISOString()}`);
    console.log(`Current Time: ${new Date(currentTime * 1000).toISOString()}`);
    console.log(`Time Since Deployment: ${currentTime - deploymentTime} seconds`);
    
    // Determine current phase based on timelocks
    let currentPhase = PHASES.DEPLOYED;
    let phaseInfo = {};
    
    if (currentTime < timelocks.srcWithdrawal) {
        currentPhase = PHASES.FINALITY;
        phaseInfo = {
            phase: PHASES.FINALITY,
            description: 'Contract is in finality period - no actions allowed',
            timeRemaining: timelocks.srcWithdrawal - currentTime,
            nextPhase: PHASES.PRIVATE_WITHDRAWAL,
            nextPhaseTime: new Date(timelocks.srcWithdrawal * 1000).toISOString()
        };
    } else if (currentTime < timelocks.srcPublicWithdrawal) {
        currentPhase = PHASES.PRIVATE_WITHDRAWAL;
        phaseInfo = {
            phase: PHASES.PRIVATE_WITHDRAWAL,
            description: 'Private withdrawal period - maker can withdraw with secret',
            timeRemaining: timelocks.srcPublicWithdrawal - currentTime,
            nextPhase: PHASES.PUBLIC_WITHDRAWAL,
            nextPhaseTime: new Date(timelocks.srcPublicWithdrawal * 1000).toISOString()
        };
    } else if (currentTime < timelocks.srcCancellation) {
        currentPhase = PHASES.PUBLIC_WITHDRAWAL;
        phaseInfo = {
            phase: PHASES.PUBLIC_WITHDRAWAL,
            description: 'Public withdrawal period - anyone can withdraw with secret',
            timeRemaining: timelocks.srcCancellation - currentTime,
            nextPhase: PHASES.PRIVATE_CANCELLATION,
            nextPhaseTime: new Date(timelocks.srcCancellation * 1000).toISOString()
        };
    } else if (currentTime < timelocks.srcPublicCancellation) {
        currentPhase = PHASES.PRIVATE_CANCELLATION;
        phaseInfo = {
            phase: PHASES.PRIVATE_CANCELLATION,
            description: 'Private cancellation period - maker can cancel',
            timeRemaining: timelocks.srcPublicCancellation - currentTime,
            nextPhase: PHASES.PUBLIC_CANCELLATION,
            nextPhaseTime: new Date(timelocks.srcPublicCancellation * 1000).toISOString()
        };
    } else {
        currentPhase = PHASES.PUBLIC_CANCELLATION;
        phaseInfo = {
            phase: PHASES.PUBLIC_CANCELLATION,
            description: 'Public cancellation period - anyone can cancel',
            timeRemaining: 'No time limit',
            nextPhase: PHASES.EXPIRED,
            nextPhaseTime: 'N/A'
        };
    }
    
    return phaseInfo;
}

function formatTimeRemaining(seconds) {
    if (typeof seconds === 'string') return seconds;
    
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (days > 0) {
        return `${days}d ${hours}h ${minutes}m ${secs}s`;
    } else if (hours > 0) {
        return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${secs}s`;
    } else {
        return `${secs}s`;
    }
}

async function main() {
    // Configuration
    const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org';
    const CONTRACT_ADDRESS = process.env.ESCROW_CONTRACT_ADDRESS || '0x934BF8d123f94724f16Ccc435c5bB42EAeda57Ea';
    
    console.log('🔍 EscrowSrc Contract Query Tool');
    console.log('=' .repeat(50));
    
    // Create provider
    const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
    
    try {
        // Query contract state
        const contractState = await queryEscrowContract(CONTRACT_ADDRESS, provider);
        
        // For demonstration, we'll use the immutables from the last deployment
        // In a real scenario, you'd get these from the order file or contract events
        const mockImmutables = {
            timelocks: {
                srcWithdrawal: Math.floor(Date.now() / 1000) + 60, // 60 seconds from now
                srcPublicWithdrawal: Math.floor(Date.now() / 1000) + 120, // 2 minutes from now
                srcCancellation: Math.floor(Date.now() / 1000) + 300, // 5 minutes from now
                srcPublicCancellation: Math.floor(Date.now() / 1000) + 600 // 10 minutes from now
            }
        };
        
        // Determine current phase
        const phaseInfo = determineEscrowPhase(mockImmutables, contractState.currentTime);
        
        // Display phase information
        console.log(`\n🎯 Current Phase: ${phaseInfo.phase}`);
        console.log(`📝 Description: ${phaseInfo.description}`);
        if (phaseInfo.timeRemaining !== 'No time limit') {
            console.log(`⏱️  Time Remaining: ${formatTimeRemaining(phaseInfo.timeRemaining)}`);
        }
        console.log(`⏭️  Next Phase: ${phaseInfo.nextPhase}`);
        console.log(`🕐 Next Phase Time: ${phaseInfo.nextPhaseTime}`);
        
        // Display all timelocks
        console.log('\n📅 All Timelocks:');
        console.log('-'.repeat(40));
        console.log(`Finality End: ${new Date(mockImmutables.timelocks.srcWithdrawal * 1000).toISOString()}`);
        console.log(`Private Withdrawal End: ${new Date(mockImmutables.timelocks.srcPublicWithdrawal * 1000).toISOString()}`);
        console.log(`Private Cancellation Start: ${new Date(mockImmutables.timelocks.srcCancellation * 1000).toISOString()}`);
        console.log(`Public Cancellation Start: ${new Date(mockImmutables.timelocks.srcPublicCancellation * 1000).toISOString()}`);
        
        // Summary
        console.log('\n📊 Contract Summary:');
        console.log('-'.repeat(40));
        console.log(`Contract Address: ${CONTRACT_ADDRESS}`);
        console.log(`Factory: ${contractState.factory}`);
        console.log(`Balance: ${ethers.formatEther(contractState.balance)} ETH`);
        console.log(`Rescue Delay: ${contractState.rescueDelay} seconds`);
        console.log(`Current Phase: ${phaseInfo.phase}`);
        
        return {
            contractState,
            phaseInfo,
            timelocks: mockImmutables.timelocks
        };
        
    } catch (error) {
        console.error('❌ Error in main:', error);
        process.exit(1);
    }
}

// Export functions for use in other scripts
module.exports = {
    queryEscrowContract,
    determineEscrowPhase,
    formatTimeRemaining,
    PHASES
};

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
} 