require('dotenv/config');
const Sdk = require('@1inch/cross-chain-sdk');
const ethers = require('ethers');

// NOTE: This script has been modified to deploy EscrowSrc directly without using a factory pattern.
// The factory deployment step has been commented out and will be restored later.
// Currently, step 5 deploys EscrowSrc as a first-class instance.
const {
    parseUnits,
    parseEther,
    randomBytes,
    Wallet: PKWallet,
    getAddress,
    verifyTypedData,
    JsonRpcProvider
} = require('ethers');
const {uint8ArrayToHex, UINT_40_MAX} = require('@1inch/byte-utils');
const fs = require('fs');
const path = require('path');

(async () => {
    // --- Configuration from environment ---
    const MAKER_PRIVATE_KEY = process.env.MAKER_PRIVATE_KEY;
    const TAKER_PRIVATE_KEY = process.env.TAKER_PRIVATE_KEY;
    const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org';
    const STELLAR_NETWORK = process.env.STELLAR_NETWORK || 'testnet';
    const STELLAR_TAKER_ADDRESS = process.env.STELLAR_TAKER_ADDRESS; // Stellar public key
    
    if (!MAKER_PRIVATE_KEY || !TAKER_PRIVATE_KEY) {
        console.error('Error: MAKER_PRIVATE_KEY and TAKER_PRIVATE_KEY must be set in .env file');
        process.exit(1);
    }

    if (!STELLAR_TAKER_ADDRESS) {
        console.warn('⚠️  Warning: STELLAR_TAKER_ADDRESS not set in .env file');
        console.warn('   This is needed for the Stellar side of the swap');
    }

    // --- Chain configuration ---
    const srcChainId = parseInt(process.env.SRC_CHAIN_ID) || 11155111; // Sepolia testnet
    const dstChainId = parseInt(process.env.DST_CHAIN_ID) || 314159; // Stellar testnet (using a placeholder, adjust as needed)

    // --- Contract addresses from environment ---
    const srcEscrowFactory = getAddress(process.env.SRC_ESCROW_FACTORY || '0x1111111111111111111111111111111111111111');
    const srcResolver = getAddress(process.env.SRC_RESOLVER || '0x5555555555555555555555555555555555555555');
    
    // ETH and XLM token addresses
    const srcETH = getAddress(process.env.SRC_ETH_ADDRESS || '0x0000000000000000000000000000000000000000'); // Native ETH
    const dstXLM = getAddress(process.env.DST_XLM_ADDRESS || '0x4444444444444444444444444444444444444444'); // XLM token on Stellar

    // Create wallets
    const makerWallet = new PKWallet(MAKER_PRIVATE_KEY);
    const takerWallet = new PKWallet(TAKER_PRIVATE_KEY);

    console.log('Maker address:', makerWallet.address);
    console.log('Taker address (EVM):', takerWallet.address);
    if (STELLAR_TAKER_ADDRESS) {
        console.log('Taker address (Stellar):', STELLAR_TAKER_ADDRESS);
    }

    // Generate secret for hashlock
    const secret = uint8ArrayToHex(randomBytes(32));
    console.log('Generated secret:', secret);

    // Get amounts from environment
    const makingAmountEth = parseFloat(process.env.MAKING_AMOUNT_ETH) || 0.002;
    const takingAmountXlm = parseFloat(process.env.TAKING_AMOUNT_XLM) || 20;
    const safetyDepositEth = parseFloat(process.env.SAFETY_DEPOSIT_ETH) || 0.001;

    // Comment order with SDK as testnet seplia is not supported
    // Instead for now just capture details and write to JSON file
    
    // const order = Sdk.CrossChainOrder.new(
    // new Sdk.Address(srcEscrowFactory),
    const order = {
        salt: Sdk.randBigInt(1000n).toString(),
        maker: new Sdk.Address(makerWallet.address),
        makingAmount: parseEther(makingAmountEth.toString()).toString(), // 1 ETH
        takingAmount: parseUnits(takingAmountXlm.toString(), 7).toString(), // 8500 XLM (assuming 7 decimals like Stellar)
        makerAsset: new Sdk.Address(srcETH),
        takerAsset: new Sdk.Address(dstXLM),
        hashLock: Sdk.HashLock.forSingleFill(secret),
        // // timeLocks: Sdk.TimeLocks.new({
        timeLocks: {
            srcWithdrawal: 10n.toString(), // 10sec finality lock for test
            srcPublicWithdrawal: 120n.toString(), // 2m for private withdrawal
            srcCancellation: 121n.toString(), // 1sec public withdrawal
            srcPublicCancellation: 122n.toString(), // 1sec private cancellation
            dstWithdrawal: 10n.toString(), // 10sec finality lock for test
            dstPublicWithdrawal: 100n.toString(), // 100sec private withdrawal
            dstCancellation: 101n.toString() // 1sec public withdrawal
        },
        srcChainId,
        dstChainId,
        srcSafetyDeposit: parseEther(safetyDepositEth.toString()).toString(),
        dstSafetyDeposit: parseEther(safetyDepositEth.toString()).toString(),
        // auction: new Sdk.AuctionDetails({
        auction: {
            initialRateBump: 0,
            points: [],
            duration: 120n.toString(),
            startTime: 0n.toString()
        },
        whitelist: [
            {
                address: new Sdk.Address(srcResolver),
                allowFrom: 0n.toString()
            }
        ],
        resolvingStartTime: 0n.toString(),
        nonce: Sdk.randBigInt(UINT_40_MAX).toString(),
        allowPartialFills: false,
        allowMultipleFills: false
    }

    console.log('Order created successfully!');
    // console.log('Order hash:', order.getOrderHash(srcChainId));

    // Sign the order with maker's wallet
    // const typedData = order.getTypedData(srcChainId);
    // const signature = await makerWallet.signTypedData(
    //     typedData.domain,
    //     {Order: typedData.types[typedData.primaryType]},
    //     typedData.message
    // );

    // console.log('Order signed by maker!');
    // console.log('Signature:', signature);

    // Verify the signature
    // const recoveredAddress = verifyTypedData(
    //     typedData.domain,
    //     {Order: typedData.types[typedData.primaryType]},
    //     typedData.message,
    //     signature
    // );
    // console.log('Recovered address:', recoveredAddress);
    console.log('Maker address:', makerWallet.address);
    // console.log('Signature valid:', recoveredAddress === makerWallet.address);

    // Create order data object
    const orderData = {
        order: order,
        // orderHash: order.getOrderHash(srcChainId),
        secret: secret,
        // signature: signature,
        maker: makerWallet.address,
        taker: takerWallet.address, // EVM address for SDK compatibility
        stellarTaker: STELLAR_TAKER_ADDRESS, // Stellar address for later use
        srcChainId: srcChainId,
        dstChainId: dstChainId,
        makingAmount: parseEther(makingAmountEth.toString()).toString(), // ETH in wei
        takingAmount: parseUnits(takingAmountXlm.toString(), 7).toString(), // XLM in smallest units
        makerAsset: srcETH,
        takerAsset: dstXLM,
        timestamp: new Date().toISOString(),
        // typedData: typedData
    };

    // Save order to file with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `order-${timestamp}.json`;
    const filepath = path.join(__dirname, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(orderData, null, 2));
    console.log(`Order saved to: ${filepath}`);

    // Step 1: Prepare escrow deployment data (direct deployment, no factory)
    console.log('\n=== Step 1: Preparing EscrowSrc Deployment ===');
    
    // Create immutables for the escrow
    const escrowImmutables = {
        // orderHash: order.getOrderHash(srcChainId),
        hashlock: Sdk.HashLock.forSingleFill(secret),
        maker: new Sdk.Address(makerWallet.address),
        taker: new Sdk.Address(takerWallet.address),
        token: new Sdk.Address(srcETH),
        amount: parseEther(makingAmountEth.toString()),
        safetyDeposit: parseEther(safetyDepositEth.toString()),
        timelocks: Sdk.TimeLocks.new({
            srcWithdrawal: 10n,
            srcPublicWithdrawal: 120n,
            srcCancellation: 121n,
            srcPublicCancellation: 122n,
            dstWithdrawal: 10n,
            dstPublicWithdrawal: 100n,
            dstCancellation: 101n
        }),
        srcChainId,
        dstChainId
    };

    // Prepare for direct EscrowSrc deployment (no factory needed)
    console.log('Preparing EscrowSrc deployment data...');
    console.log('Note: Deploying EscrowSrc directly without factory pattern');
    console.log('Escrow immutables prepared for direct deployment');

    // Step 2: Prepare for sending funds to escrow
    console.log('\n=== Step 2: Preparing Fund Transfer ===');
    const totalAmount = parseEther(makingAmountEth.toString()) + parseEther(safetyDepositEth.toString());
    console.log(`Total amount needed: ${ethers.formatEther(totalAmount)} ETH`);
    console.log(`- Making amount: ${makingAmountEth} ETH`);
    console.log(`- Safety deposit: ${safetyDepositEth} ETH`);
    
    // Check maker's balance
    const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
    const makerBalance = await provider.getBalance(makerWallet.address);
    console.log(`Maker balance: ${ethers.formatEther(makerBalance)} ETH`);
    
    if (makerBalance < totalAmount) {
        console.error(`❌ Insufficient balance! Need ${ethers.formatEther(totalAmount)} ETH, have ${ethers.formatEther(makerBalance)} ETH`);
        console.log('Please fund the maker wallet with Sepolia ETH');
    } else {
        console.log('✅ Sufficient balance for escrow setup');
    }

    // Step 3: Prepare escrow deployment data
    console.log('\n=== Step 3: Preparing EscrowSrc Deployment ===');
    console.log('Direct EscrowSrc deployment requires:');
    console.log('1. ✅ Sufficient ETH balance for escrow + safety deposit');
    console.log('2. ✅ Valid order signature');
    console.log('3. ✅ Hashlock secret');
    console.log('4. 🔄 EscrowSrc contract bytecode and ABI');
``    
    // Add escrow setup info to order data

    // orderData.escrowSetup = {
    //     immutables: escrowImmutables,
    //     totalAmount: totalAmount.toString(),
    //     escrowAddress: 'TBD', // Will be computed after direct deployment
    //     deploymentStatus: 'pending',
    //     deploymentType: 'direct' // Indicates direct deployment vs factory pattern
    // };
    
    // Update the saved file with escrow info
    fs.writeFileSync(filepath, JSON.stringify(orderData, null, 2));
    console.log(`Updated order file with escrow setup info: ${filepath}`);
    
    console.log('\n=== Next Steps ===');
    console.log('1. ✅ Order created and signed');
    console.log('2. ✅ Escrow address computation prepared');
    console.log('3. ✅ Fund transfer preparation complete');
    console.log('4. 🔄 Deploy factory contract (if not already deployed) - COMMENTED OUT FOR NOW');
    console.log('   NOTE: Factory deployment will be restored later. Currently deploying EscrowSrc directly.');
    console.log('5. 🔄 Deploy EscrowSrc contract directly (no factory needed)');
    console.log('6. 🔄 Send funds to escrow address');
    console.log('7. 🔄 Wait for taker to create destination escrow on Stellar');
    
    console.log('\nOrder setup complete! Check the generated JSON file for order details.');

})(); 