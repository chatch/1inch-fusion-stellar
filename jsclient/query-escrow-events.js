require('dotenv/config');
const ethers = require('ethers');

// EscrowSrc contract ABI (read-only functions + events)
const ESCROW_SRC_ABI = [
    {"type":"function","name":"FACTORY","inputs":[],"outputs":[{"name":"","type":"address","internalType":"address"}],"stateMutability":"view"},
    {"type":"function","name":"PROXY_BYTECODE_HASH","inputs":[],"outputs":[{"name":"","type":"bytes32","internalType":"bytes32"}],"stateMutability":"view"},
    {"type":"function","name":"RESCUE_DELAY","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},
    {"type":"event","name":"EscrowCancelled","inputs":[],"anonymous":false},
    {"type":"event","name":"FundsRescued","inputs":[{"name":"token","type":"address","indexed":false,"internalType":"address"},{"name":"amount","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},
    {"type":"event","name":"Withdrawal","inputs":[{"name":"secret","type":"bytes32","indexed":false,"internalType":"bytes32"}],"anonymous":false}
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

async function queryContractEvents(contractAddress, provider) {
    console.log('\n📡 Querying Contract Events:');
    console.log('-'.repeat(40));
    
    try {
        const contract = new ethers.Contract(contractAddress, ESCROW_SRC_ABI, provider);
        
        // Get deployment block (approximate) - use very small range to comply with RPC limits
        const currentBlock = await provider.getBlockNumber();
        const fromBlock = Math.max(0, currentBlock - 100); // Look back only 100 blocks
        
        console.log(`Searching events from block ${fromBlock} to ${currentBlock}...`);
        
        // Query specific events
        const withdrawalEvents = await contract.queryFilter(contract.filters.Withdrawal(), fromBlock, currentBlock);
        const cancellationEvents = await contract.queryFilter(contract.filters.EscrowCancelled(), fromBlock, currentBlock);
        const rescueEvents = await contract.queryFilter(contract.filters.FundsRescued(), fromBlock, currentBlock);
        
        console.log(`Found ${withdrawalEvents.length} withdrawal events`);
        console.log(`Found ${cancellationEvents.length} cancellation events`);
        console.log(`Found ${rescueEvents.length} rescue events`);
        
        // Process withdrawal events
        const withdrawals = [];
        for (const event of withdrawalEvents) {
            const block = await provider.getBlock(event.blockNumber);
            withdrawals.push({
                secret: event.args.secret,
                blockNumber: event.blockNumber,
                timestamp: block.timestamp,
                transactionHash: event.transactionHash
            });
        }
        
        // Process cancellation events
        const cancellations = [];
        for (const event of cancellationEvents) {
            const block = await provider.getBlock(event.blockNumber);
            cancellations.push({
                blockNumber: event.blockNumber,
                timestamp: block.timestamp,
                transactionHash: event.transactionHash
            });
        }
        
        // Process rescue events
        const rescues = [];
        for (const event of rescueEvents) {
            const block = await provider.getBlock(event.blockNumber);
            rescues.push({
                token: event.args.token,
                amount: event.args.amount,
                blockNumber: event.blockNumber,
                timestamp: block.timestamp,
                transactionHash: event.transactionHash
            });
        }
        
        return {
            withdrawals,
            cancellations,
            rescues,
            totalEvents: withdrawalEvents.length + cancellationEvents.length + rescueEvents.length
        };
        
    } catch (error) {
        console.error('❌ Error querying events:', error.message);
        throw error;
    }
}

async function queryDeploymentTransaction(contractAddress, provider) {
    console.log('\n🔍 Querying Deployment Transaction:');
    console.log('-'.repeat(40));
    
    try {
        // Get the contract creation transaction
        const code = await provider.getCode(contractAddress);
        if (code === '0x') {
            console.log('Contract not found or not deployed');
            return null;
        }
        
        // Try to get the transaction that created this contract
        const currentBlock = await provider.getBlockNumber();
        const fromBlock = Math.max(0, currentBlock - 1000);
        
        console.log(`Searching for deployment transaction from block ${fromBlock} to ${currentBlock}...`);
        
        // This is a simplified approach - in a real scenario you'd need to parse the deployment transaction
        console.log('Note: Full deployment transaction parsing requires additional logic');
        console.log('to extract constructor parameters from the transaction data.');
        
        return {
            blockNumber: 'Unknown',
            transactionHash: 'Unknown',
            timestamp: 'Unknown'
        };
        
    } catch (error) {
        console.error('❌ Error querying deployment:', error.message);
        return null;
    }
}

function determineEscrowPhase(immutables, currentTime) {
    console.log('\n⏰ Phase Determination:');
    console.log('-'.repeat(40));
    
    const timelocks = immutables.timelocks;
    
    console.log(`Current Time: ${new Date(currentTime * 1000).toISOString()}`);
    
    // Determine current phase based on timelocks
    let phaseInfo = {};
    
    if (currentTime < timelocks.srcWithdrawal) {
        phaseInfo = {
            phase: PHASES.FINALITY,
            description: 'Contract is in finality period - no actions allowed',
            timeRemaining: timelocks.srcWithdrawal - currentTime,
            nextPhase: PHASES.PRIVATE_WITHDRAWAL,
            nextPhaseTime: new Date(timelocks.srcWithdrawal * 1000).toISOString(),
            allowedActions: ['None - waiting for finality']
        };
    } else if (currentTime < timelocks.srcPublicWithdrawal) {
        phaseInfo = {
            phase: PHASES.PRIVATE_WITHDRAWAL,
            description: 'Private withdrawal period - maker can withdraw with secret',
            timeRemaining: timelocks.srcPublicWithdrawal - currentTime,
            nextPhase: PHASES.PUBLIC_WITHDRAWAL,
            nextPhaseTime: new Date(timelocks.srcPublicWithdrawal * 1000).toISOString(),
            allowedActions: ['Maker withdraw with secret', 'Taker withdraw with secret']
        };
    } else if (currentTime < timelocks.srcCancellation) {
        phaseInfo = {
            phase: PHASES.PUBLIC_WITHDRAWAL,
            description: 'Public withdrawal period - anyone can withdraw with secret',
            timeRemaining: timelocks.srcCancellation - currentTime,
            nextPhase: PHASES.PRIVATE_CANCELLATION,
            nextPhaseTime: new Date(timelocks.srcCancellation * 1000).toISOString(),
            allowedActions: ['Anyone withdraw with secret']
        };
    } else if (currentTime < timelocks.srcPublicCancellation) {
        phaseInfo = {
            phase: PHASES.PRIVATE_CANCELLATION,
            description: 'Private cancellation period - maker can cancel',
            timeRemaining: timelocks.srcPublicCancellation - currentTime,
            nextPhase: PHASES.PUBLIC_CANCELLATION,
            nextPhaseTime: new Date(timelocks.srcPublicCancellation * 1000).toISOString(),
            allowedActions: ['Maker cancel', 'Anyone withdraw with secret']
        };
    } else {
        phaseInfo = {
            phase: PHASES.PUBLIC_CANCELLATION,
            description: 'Public cancellation period - anyone can cancel',
            timeRemaining: 'No time limit',
            nextPhase: PHASES.EXPIRED,
            nextPhaseTime: 'N/A',
            allowedActions: ['Anyone cancel', 'Anyone withdraw with secret']
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
    
    console.log('🔍 EscrowSrc Contract Events Query Tool');
    console.log('=' .repeat(50));
    
    // Create provider
    const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
    
    try {
        // Query contract state
        const contractState = await queryEscrowContract(CONTRACT_ADDRESS, provider);
        
        // Query deployment transaction
        const deploymentInfo = await queryDeploymentTransaction(CONTRACT_ADDRESS, provider);
        
        // Query contract events
        const events = await queryContractEvents(CONTRACT_ADDRESS, provider);
        
        // Display event information
        if (events.withdrawals.length > 0) {
            console.log('\n💰 Withdrawal Events:');
            console.log('-'.repeat(40));
            events.withdrawals.forEach((withdrawal, index) => {
                console.log(`${index + 1}. Secret: ${withdrawal.secret}`);
                console.log(`   Block: ${withdrawal.blockNumber}`);
                console.log(`   Time: ${new Date(withdrawal.timestamp * 1000).toISOString()}`);
                console.log(`   TX: ${withdrawal.transactionHash}`);
            });
        }
        
        if (events.cancellations.length > 0) {
            console.log('\n❌ Cancellation Events:');
            console.log('-'.repeat(40));
            events.cancellations.forEach((cancellation, index) => {
                console.log(`${index + 1}. Block: ${cancellation.blockNumber}`);
                console.log(`   Time: ${new Date(cancellation.timestamp * 1000).toISOString()}`);
                console.log(`   TX: ${cancellation.transactionHash}`);
            });
        }
        
        if (events.rescues.length > 0) {
            console.log('\n🆘 Rescue Events:');
            console.log('-'.repeat(40));
            events.rescues.forEach((rescue, index) => {
                console.log(`${index + 1}. Token: ${rescue.token}`);
                console.log(`   Amount: ${ethers.formatEther(rescue.amount)} ETH`);
                console.log(`   Block: ${rescue.blockNumber}`);
                console.log(`   Time: ${new Date(rescue.timestamp * 1000).toISOString()}`);
                console.log(`   TX: ${rescue.transactionHash}`);
            });
        }
        
        // Note about immutables
        console.log('\n⚠️  Important Note:');
        console.log('-'.repeat(40));
        console.log('The immutables (timelocks, amounts, etc.) are NOT stored as');
        console.log('contract state variables. They are passed as parameters to');
        console.log('contract functions and must be provided by the caller.');
        console.log('');
        console.log('To get the actual immutables, you need to:');
        console.log('1. Check the order file (JSON) for deployment parameters');
        console.log('2. Look at the deployment transaction logs');
        console.log('3. Query the factory contract that deployed this escrow');
        console.log('4. Use the order hash to reconstruct the parameters');
        console.log('');
        console.log('This is by design - the contract is stateless and relies on');
        console.log('callers to provide the correct parameters for each operation.');
        
        // Summary
        console.log('\n📊 Contract Summary:');
        console.log('-'.repeat(40));
        console.log(`Contract Address: ${CONTRACT_ADDRESS}`);
        console.log(`Factory: ${contractState.factory}`);
        console.log(`Balance: ${ethers.formatEther(contractState.balance)} ETH`);
        console.log(`Rescue Delay: ${contractState.rescueDelay} seconds`);
        console.log(`Total Events: ${events.totalEvents}`);
        
        if (deploymentInfo) {
            console.log(`Deployment Block: ${deploymentInfo.blockNumber}`);
            console.log(`Deployment Time: ${deploymentInfo.timestamp}`);
        }
        
        return {
            contractState,
            events,
            deploymentInfo
        };
        
    } catch (error) {
        console.error('❌ Error in main:', error);
        process.exit(1);
    }
}

// Export functions for use in other scripts
module.exports = {
    queryEscrowContract,
    queryContractEvents,
    queryDeploymentTransaction,
    determineEscrowPhase,
    formatTimeRemaining,
    PHASES
};

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
} 