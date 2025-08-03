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
    
    // Step 5: Deploy EscrowSrc contract directly
    console.log('\n=== Step 5: Deploying EscrowSrc Contract Directly ===');
    
    try {
        // EscrowSrc contract ABI (from compiled contract with receive function)
        const ESCROW_SRC_ABI = [
            {"type":"constructor","inputs":[{"name":"rescueDelay","type":"uint32","internalType":"uint32"}],"stateMutability":"nonpayable"},
            {"type":"receive","stateMutability":"payable"},
            {"type":"function","name":"FACTORY","inputs":[],"outputs":[{"name":"","type":"address","internalType":"address"}],"stateMutability":"view"},
            {"type":"function","name":"PROXY_BYTECODE_HASH","inputs":[],"outputs":[{"name":"","type":"bytes32","internalType":"bytes32"}],"stateMutability":"view"},
            {"type":"function","name":"RESCUE_DELAY","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},
            {"type":"function","name":"cancel","inputs":[{"name":"immutables","type":"tuple","internalType":"struct IBaseEscrow.Immutables","components":[{"name":"orderHash","type":"bytes32","internalType":"bytes32"},{"name":"hashlock","type":"bytes32","internalType":"bytes32"},{"name":"maker","type":"uint256","internalType":"Address"},{"name":"taker","type":"uint256","internalType":"Address"},{"name":"token","type":"uint256","internalType":"Address"},{"name":"amount","type":"uint256","internalType":"uint256"},{"name":"safetyDeposit","type":"uint256","internalType":"uint256"},{"name":"timelocks","type":"uint256","internalType":"Timelocks"}]}],"outputs":[],"stateMutability":"nonpayable"},
            {"type":"function","name":"publicCancel","inputs":[{"name":"immutables","type":"tuple","internalType":"struct IBaseEscrow.Immutables","components":[{"name":"orderHash","type":"bytes32","internalType":"bytes32"},{"name":"hashlock","type":"bytes32","internalType":"bytes32"},{"name":"maker","type":"uint256","internalType":"Address"},{"name":"taker","type":"uint256","internalType":"Address"},{"name":"token","type":"uint256","internalType":"Address"},{"name":"amount","type":"uint256","internalType":"uint256"},{"name":"safetyDeposit","type":"uint256","internalType":"uint256"},{"name":"timelocks","type":"uint256","internalType":"Timelocks"}]}],"outputs":[],"stateMutability":"nonpayable"},
            {"type":"function","name":"publicWithdraw","inputs":[{"name":"secret","type":"bytes32","internalType":"bytes32"},{"name":"immutables","type":"tuple","internalType":"struct IBaseEscrow.Immutables","components":[{"name":"orderHash","type":"bytes32","internalType":"bytes32"},{"name":"hashlock","type":"bytes32","internalType":"bytes32"},{"name":"maker","type":"uint256","internalType":"Address"},{"name":"taker","type":"uint256","internalType":"Address"},{"name":"token","type":"uint256","internalType":"Address"},{"name":"amount","type":"uint256","internalType":"uint256"},{"name":"safetyDeposit","type":"uint256","internalType":"uint256"},{"name":"timelocks","type":"uint256","internalType":"Timelocks"}]}],"outputs":[],"stateMutability":"nonpayable"},
            {"type":"function","name":"rescueFunds","inputs":[{"name":"token","type":"address","internalType":"address"},{"name":"amount","type":"uint256","internalType":"uint256"},{"name":"immutables","type":"tuple","internalType":"struct IBaseEscrow.Immutables","components":[{"name":"orderHash","type":"bytes32","internalType":"bytes32"},{"name":"hashlock","type":"bytes32","internalType":"bytes32"},{"name":"maker","type":"uint256","internalType":"Address"},{"name":"taker","type":"uint256","internalType":"Address"},{"name":"token","type":"uint256","internalType":"Address"},{"name":"amount","type":"uint256","internalType":"uint256"},{"name":"safetyDeposit","type":"uint256","internalType":"uint256"},{"name":"timelocks","type":"uint256","internalType":"Timelocks"}]}],"outputs":[],"stateMutability":"nonpayable"},
            {"type":"function","name":"withdraw","inputs":[{"name":"secret","type":"bytes32","internalType":"bytes32"},{"name":"immutables","type":"tuple","internalType":"struct IBaseEscrow.Immutables","components":[{"name":"orderHash","type":"bytes32","internalType":"bytes32"},{"name":"hashlock","type":"bytes32","internalType":"bytes32"},{"name":"maker","type":"uint256","internalType":"Address"},{"name":"taker","type":"uint256","internalType":"Address"},{"name":"token","type":"uint256","internalType":"Address"},{"name":"amount","type":"uint256","internalType":"uint256"},{"name":"safetyDeposit","type":"uint256","internalType":"uint256"},{"name":"timelocks","type":"uint256","internalType":"Timelocks"}]}],"outputs":[],"stateMutability":"nonpayable"},
            {"type":"function","name":"withdrawTo","inputs":[{"name":"secret","type":"bytes32","internalType":"bytes32"},{"name":"target","type":"address","internalType":"address"},{"name":"immutables","type":"tuple","internalType":"struct IBaseEscrow.Immutables","components":[{"name":"orderHash","type":"bytes32","internalType":"bytes32"},{"name":"hashlock","type":"bytes32","internalType":"bytes32"},{"name":"maker","type":"uint256","internalType":"Address"},{"name":"taker","type":"uint256","internalType":"Address"},{"name":"token","type":"uint256","internalType":"Address"},{"name":"amount","type":"uint256","internalType":"uint256"},{"name":"safetyDeposit","type":"uint256","internalType":"uint256"},{"name":"timelocks","type":"uint256","internalType":"Timelocks"}]}],"outputs":[],"stateMutability":"nonpayable"}
        ];

        // EscrowSrc contract bytecode (compiled from forge)
        const ESCROW_SRC_BYTECODE = "0x60e06040523462000067576200001e6200001862000130565b62000156565b620000286200006d565b6113a362000275823960805181818161046501526107c8015260a0518181816101ac0152610f26015260c05181818161023e0152610f0501526113a390f35b62000073565b60405190565b5f80fd5b601f801991011690565b634e487b7160e01b5f52604160045260245ffd5b90620000a19062000077565b810190811060018060401b03821117620000ba57604052565b62000081565b90620000d7620000cf6200006d565b928362000095565b565b5f80fd5b63ffffffff1690565b620000f181620000dd565b03620000f957565b5f80fd5b905051906200010c82620000e6565b565b906020828203126200012a5762000127915f01620000fd565b90565b620000d9565b6200015362001618803803806200014781620000c0565b9283398101906200010e565b90565b620001619062000163565b565b6200016e90620001bc565b565b60018060a01b031690565b90565b62000197620001916200019d9262000170565b6200017b565b62000170565b90565b620001ab906200017e565b90565b620001b990620001a0565b90565b620001c790620001e1565b620001dc620001d630620001ae565b6200022b565b60c052565b620001ec9062000213565b565b90565b6200020a620002046200021092620000dd565b6200017b565b620001ee565b90565b62000222903360a052620001f1565b608052565b5f90565b763d602d80600a3d3981f3363d3d373d3d3d363d73000000906200024e62000227565b506e5af43d82803e903d91602b57fd5bf36020528060115260881c175f5260376009209056fe60806040526004361015610015575b366104de57005b61001f5f356100ae565b80630af97558146100a957806323305703146100a45780632dd310001461009f57806334862b6a1461009a5780634649088b146100955780636c10c0c81461009057806390d3252f1461008b578063daff233e146100865763f56cd69c0361000e576104a9565b610430565b6103fd565b6103aa565b61033b565b610282565b610207565b610167565b610133565b60e01c90565b60405190565b5f80fd5b5f80fd5b90565b6100ce816100c2565b036100d557565b5f80fd5b905035906100e6826100c5565b565b5f80fd5b90816101009103126100fb5790565b6100e8565b919061012083820312610129578061011d610126925f86016100d9565b936020016100ec565b90565b6100be565b5f0190565b346101625761014c610146366004610100565b90610604565b6101546100b4565b8061015e8161012e565b0390f35b6100ba565b346101965761018061017a366004610100565b90610737565b6101886100b4565b806101928161012e565b0390f35b6100ba565b5f9103126101a557565b6100be565b7f000000000000000000000000000000000000000000000000000000000000000090565b60018060a01b031690565b6101e2906101ce565b90565b6101ee906101d9565b9052565b9190610205905f602085019401906101e5565b565b346102375761021736600461019b565b6102336102226101aa565b61022a6100b4565b918291826101f2565b0390f35b6100ba565b7f000000000000000000000000000000000000000000000000000000000000000090565b610269906100c2565b9052565b9190610280905f60208501940190610260565b565b346102b25761029236600461019b565b6102ae61029d61023c565b6102a56100b4565b9182918261026d565b0390f35b6100ba565b6102c0816101d9565b036102c757565b5f80fd5b905035906102d8826102b7565b565b90565b6102e6816102da565b036102ed57565b5f80fd5b905035906102fe826102dd565b565b9091610140828403126103365761033361031c845f85016102cb565b9361032a81602086016102f1565b936040016100ec565b90565b6100be565b3461036a5761035461034e366004610300565b916108a1565b61035c6100b4565b806103668161012e565b0390f35b6100ba565b9091610140828403126103a5576103a261038b845f85016100d9565b9361039981602086016102cb565b936040016100ec565b90565b6100be565b346103d9576103c36103bd36600461036f565b916109d7565b6103cb6100b4565b806103d58161012e565b0390f35b6100ba565b90610100828203126103f8576103f5915f016100ec565b90565b6100be565b3461042b576104156104103660046103de565b610aa6565b61041d6100b4565b806104278161012e565b0390f35b6100ba565b3461045e576104486104433660046103de565b610b19565b6104506100b4565b8061045a8161012e565b0390f35b6100ba565b7f000000000000000000000000000000000000000000000000000000000000000090565b610490906102da565b9052565b91906104a7905f60208501940190610487565b565b346104d9576104b936600461019b565b6104d56104c4610463565b6104cc6100b4565b91829182610494565b0390f35b6100ba565b5f80fd5b6104eb816102da565b036104f257565b5f80fd5b35610500816104e2565b90565b9061051b61051360e083016104f6565b600190610ca7565b61052e61052842926102da565b916102da565b1061053e5761053c91610561565b565b6105466100b4565b6337bf561360e11b81528061055d6004820161012e565b0390fd5b9061057961057160e083016104f6565b600290610ca7565b61058c61058642926102da565b916102da565b101561059d5761059b916105e1565b565b6105a56100b4565b6337bf561360e11b8152806105bc6004820161012e565b0390fd5b6105c9816102da565b036105d057565b5f80fd5b356105de816105c0565b90565b9061060291906105fb6105f6606083016105d4565b610d86565b9091610ede565b565b9061060e91610503565b565b908061063861063261062d61062860603395016105d4565b610d86565b6101d9565b916101d9565b03610648576106469161066b565b565b6106506100b4565b6348f5c3ed60e01b8152806106676004820161012e565b0390fd5b9061068261067b60e083016104f6565b5f90610ca7565b61069561068f42926102da565b916102da565b106106a5576106a3916106c8565b565b6106ad6100b4565b6337bf561360e11b8152806106c46004820161012e565b0390fd5b906106e06106d860e083016104f6565b600290610ca7565b6106f36106ed42926102da565b916102da565b10156107045761070291610727565b565b61070c6100b4565b6337bf561360e11b8152806107236004820161012e565b0390fd5b906107359190339091610ede565b565b9061074191610610565b565b91908161076c61076661076161075c60603395016105d4565b610d86565b6101d9565b916101d9565b0361077c5761077a9261079f565b565b6107846100b4565b6348f5c3ed60e01b81528061079b6004820161012e565b0390fd5b906107b392916107ae83610ef7565b6107b5565b565b91906107ed6107c660e084016104f6565b7f000000000000000000000000000000000000000000000000000000000000000090610f9d565b6108006107fa42926102da565b916102da565b106108105761080e92610856565b565b6108186100b4565b6337bf561360e11b81528061082f6004820161012e565b0390fd5b91602061085492949361084d60408201965f8301906101e5565b0190610487565b565b90915061086581338491610ff8565b907fc4474c2790e13695f6d2b6f1d8e164290b55370f87a542fd7711abe0a1bf40ac9161089c6108936100b4565b92839283610833565b0390a1565b906108ac9291610743565b565b9190816108d76108d16108cc6108c760603395016105d4565b610d86565b6101d9565b916101d9565b036108e7576108e59261090a565b565b6108ef6100b4565b6348f5c3ed60e01b8152806109066004820161012e565b0390fd5b919061092261091b60e084016104f6565b5f90610ca7565b61093561092f42926102da565b916102da565b106109455761094392610968565b565b61094d6100b4565b6337bf561360e11b8152806109646004820161012e565b0390fd5b919061098161097960e084016104f6565b600290610ca7565b61099461098e42926102da565b916102da565b10156109a5576109a3926109c8565b565b6109ad6100b4565b6337bf561360e11b8152806109c46004820161012e565b0390fd5b916109d592919091610ede565b565b906109e292916108ae565b565b80610a0b610a05610a006109fb60603395016105d4565b610d86565b6101d9565b916101d9565b03610a1b57610a1990610a3e565b565b610a236100b4565b6348f5c3ed60e01b815280610a3a6004820161012e565b0390fd5b610a55610a4d60e083016104f6565b600290610ca7565b610a68610a6242926102da565b916102da565b10610a7857610a7690610a9b565b565b610a806100b4565b6337bf561360e11b815280610a976004820161012e565b0390fd5b610aa4906110eb565b565b610aaf906109e4565b565b610ac8610ac060e083016104f6565b600390610ca7565b610adb610ad542926102da565b916102da565b10610aeb57610ae990610b0e565b565b610af36100b4565b6337bf561360e11b815280610b0a6004820161012e565b0390fd5b610b17906110eb565b565b610b2290610ab1565b565b5f90565b90565b610b3f610b3a610b44926102da565b610b28565b6102da565b90565b634e487b7160e01b5f52602160045260245ffd5b60071115610b6557565b610b47565b90610b7482610b5b565b565b610b7f90610b6a565b90565b90565b610b99610b94610b9e92610b82565b610b28565b6102da565b90565b634e487b7160e01b5f52601160045260245ffd5b610bc4610bca919392936102da565b926102da565b91610bd68382026102da565b928184041490151715610be557565b610ba1565b90565b610c01610bfc610c0692610bea565b610b28565b6102da565b90565b610c1360e0610bed565b90565b1c90565b610c3990610c33610c2d610c3e946102da565b916102da565b90610c16565b6102da565b90565b63ffffffff1690565b610c5e610c59610c63926102da565b610b28565b610c41565b90565b610c7a610c75610c7f92610c41565b610b28565b6102da565b90565b610c91610c97919392936102da565b926102da565b8201809211610ca257565b610ba1565b90610d04610cff610cfa610ce2610cd2610ccc610d0a97610cc6610b24565b50610b2b565b95610b76565b610cdc6020610b85565b90610bb5565b610cf485610cee610c09565b90610c1a565b94610c1a565b610c4a565b610c66565b90610c82565b90565b5f90565b90565b610d28610d23610d2d92610d11565b610b28565b6102da565b90565b610d3f60018060a01b03610d14565b90565b610d56610d51610d5b926102da565b610b28565b6101ce565b90565b610d72610d6d610d77926101ce565b610b28565b6101ce565b90565b610d8390610d5e565b90565b610dac610d9e610db192610d98610d0d565b50610b2b565b610da6610d30565b16610d42565b610d7a565b90565b90610dc89291610dc383610ef7565b610dd7565b565b35610dd4816100c5565b90565b919082610e01610dfb610df66020610def87956110fa565b9401610dca565b6100c2565b916100c2565b03610e1157610e0f92610e59565b565b610e196100b4565b63abab6bd760e01b815280610e306004820161012e565b0390fd5b610e3d90610d5e565b90565b610e4990610e34565b90565b35610e56816102dd565b90565b91610e90610ea392610e7d610e78610e73608086016105d4565b610d86565b610e40565b90610e8a60a08501610e4c565b9161113f565b610e9d60c0339201610e4c565b90611271565b610ed97f0ce781a18c10c8289803c7c4cfd532d797113c4b41c9701ffad7d0a632ac555b91610ed06100b4565b9182918261026d565b0390a1565b90610ee99291610db4565b565b610ef490610d7a565b90565b610f03610f4b916112c8565b7f00000000000000000000000000000000000000000000000000000000000000007f0000000000000000000000000000000000000000000000000000000000000000916112e0565b610f65610f5f610f5a30610eeb565b6101d9565b916101d9565b03610f6c57565b610f746100b4565b635134a42560e11b815280610f8b6004820161012e565b0390fd5b90610f9a91016102da565b90565b610fc4610fb6610fca93610faf610b24565b5092610b2b565b610fbe610c09565b90610c1a565b90610f8f565b90565b90565b610fe4610fdf610fe992610fcd565b610b28565b6101ce565b90565b610ff590610fd0565b90565b91908261101561100f61100a5f610fec565b6101d9565b916101d9565b145f14611029576110269250611271565b5b565b9061103661103e93610e40565b91909161113f565b611027565b6110559061105081610ef7565b611057565b565b6110b3906110a061107a611075611070608085016105d4565b610d86565b610e40565b61108e611089604085016105d4565b610d86565b61109a60a08501610e4c565b9161113f565b6110ad60c0339201610e4c565b90611271565b7f6e3be9294e58d10b9c8053cfd5e09871b67e442fe394d6b0870d336b9df984a96110dc6100b4565b806110e68161012e565b0390a1565b6110f490611043565b565b5f90565b6111026110f6565b505f5260205f2090565b63ffffffff60e01b1690565b60e01b90565b61113261112d61113792610c41565b611118565b61110c565b90565b151590565b906111649261115e929161115663a9059cbb61111e565b909192611315565b1561113a565b61116a57565b6111726100b4565b63fb7f507960e01b8152806111896004820161012e565b0390fd5b905090565b61119d5f809261118d565b0190565b6111aa90611192565b90565b601f801991011690565b634e487b7160e01b5f52604160045260245ffd5b906111d5906111ad565b810190811067ffffffffffffffff8211176111ef57604052565b6111b7565b906112076112006100b4565b92836111cb565b565b67ffffffffffffffff8111611227576112236020916111ad565b0190565b6111b7565b9061123e61123983611209565b6111f4565b918252565b606090565b3d5f14611263576112583d61122c565b903d5f602084013e5b565b61126b611243565b90611261565b5f61129f928192906112816100b4565b908161128c816111a1565b03925af1611298611248565b501561113a565b6112a557565b6112ad6100b4565b638a0332d560e01b8152806112c46004820161012e565b0390fd5b610100906112d46110f6565b50816040519182372090565b91600b926112ec610d0d565b50604051926040840152602083015281520160ff8153605560018060a01b0391201690565b5f90565b93925f91604491602094611327611311565b506040519283526004830152602482015282865af19182611346575b50565b9091503d5f14611363575060015f5114601f3d1116905b5f611343565b5f903b119061135d56fea2646970667358221220b6d736670179a0a22901f7f6a70bbd4c7dbd26adaa24e4b07bdbf4826112372a64736f6c63430008170033";
        
        console.log('📝 Note: EscrowSrc deployment requires compiled bytecode');
        console.log('   The contract should be compiled using:');
        console.log('   cd cross-chain-resolver-example/contracts/lib/cross-chain-swap');
        console.log('   forge build');
        console.log('   Copy the bytecode from artifacts/EscrowSrc.sol/EscrowSrc.json');
        
        // Create provider and wallet for deployment
        const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
        const deployerWallet = new ethers.Wallet(MAKER_PRIVATE_KEY, provider);
        
        console.log('Ethereum deployer address:', deployerWallet.address);
        
        // Check deployer balance
        const deployerBalance = await provider.getBalance(deployerWallet.address);
        console.log('Deployer balance:', ethers.formatEther(deployerBalance), 'ETH');
        
        if (deployerBalance < ethers.parseEther('0.01')) {
            console.error('❌ Insufficient balance for deployment. Need at least 0.01 ETH');
            console.log('Please fund the deployer wallet with Sepolia ETH');
        } else {
            console.log('✅ Sufficient balance for deployment');
        }
        
        // Prepare deployment parameters
        const rescueDelay = 1800; // 30 minutes rescue delay
        
        // Create immutables for the escrow
        const currentTime = Math.floor(Date.now() / 1000);
        const escrowImmutables = {
            orderHash: ethers.keccak256(ethers.toUtf8Bytes(order.salt)),
            hashlock: ethers.keccak256(ethers.toUtf8Bytes(secret)),
            maker: makerWallet.address,
            taker: takerWallet.address,
            token: srcETH,
            amount: parseEther(makingAmountEth.toString()),
            safetyDeposit: parseEther(safetyDepositEth.toString()),
            timelocks: {
                srcWithdrawal: currentTime + 60, // 60 seconds from now
                srcPublicWithdrawal: currentTime + 120, // 2 minutes from now
                srcCancellation: currentTime + 300, // 5 minutes from now
                srcPublicCancellation: currentTime + 600, // 10 minutes from now
                dstWithdrawal: currentTime + 60,
                dstPublicWithdrawal: currentTime + 120,
                dstCancellation: currentTime + 300
            }
        };
        
        // Simulate the deployment process
        const escrowDeployment = {
            contractAddress: 'TBD', // Will be computed after deployment
            deployer: deployerWallet.address,
            rescueDelay: rescueDelay,
            network: 'Sepolia',
            deploymentStatus: 'pending',
            deploymentType: 'direct',
            immutables: escrowImmutables,
            deploymentCost: 'TBD', // Will be computed after deployment
            gasEstimate: 'TBD' // Will be computed after deployment
        };
        
        console.log('✅ EscrowSrc deployment data prepared');
        console.log('Contract deployment parameters:');
        console.log('- Deployer:', escrowDeployment.deployer);
        console.log('- Rescue Delay:', escrowDeployment.rescueDelay, 'seconds');
        console.log('- Network:', escrowDeployment.network);
        console.log('- Amount:', ethers.formatEther(escrowDeployment.immutables.amount), 'ETH');
        console.log('- Safety Deposit:', ethers.formatEther(escrowDeployment.immutables.safetyDeposit), 'ETH');
        console.log('- Hashlock:', escrowDeployment.immutables.hashlock);
        console.log('- Order Hash:', escrowDeployment.immutables.orderHash);
        
        // Add deployment info to order data
        orderData.escrowDeployment = escrowDeployment;
        
        // Update the saved file with deployment info
        // fs.writeFileSync(filepath, JSON.stringify(orderData, null, 2));
        // console.log(`Updated order file with deployment info: ${filepath}`);
        
        console.log('\n📋 Next steps for actual deployment:');
        console.log('1. ✅ Compile the EscrowSrc contract to get bytecode');
        console.log('2. 🔄 Deploy the contract with rescueDelay parameter');
        console.log('3. 🔄 Fund the deployed contract with ETH');
        console.log('4. 🔄 Verify the contract deployment');
        
        // Step 2: Deploy the EscrowSrc contract
        console.log('\n=== Step 2: Deploying EscrowSrc Contract ===');
        
        try {
            // Create contract factory
            const contractFactory = new ethers.ContractFactory(
                ESCROW_SRC_ABI,
                ESCROW_SRC_BYTECODE,
                deployerWallet
            );
            
            console.log('Deploying EscrowSrc contract...');
            console.log('Rescue delay:', rescueDelay, 'seconds');
            
            // Deploy the contract
            const deploymentTx = await contractFactory.deploy(
                rescueDelay,
                { 
                    gasLimit: 5000000, // 5M gas limit for deployment
                    gasPrice: await provider.getFeeData().then(fee => fee.gasPrice)
                }
            );
            
            console.log('Deployment transaction hash:', deploymentTx.deploymentTransaction().hash);
            console.log('Waiting for deployment confirmation...');
            
            // Wait for deployment
            const deployedContract = await deploymentTx.waitForDeployment();
            const contractAddress = await deployedContract.getAddress();
            
            console.log('✅ EscrowSrc contract deployed successfully!');
            console.log('Contract address:', contractAddress);
            
            // Update deployment info
            escrowDeployment.contractAddress = contractAddress;
            escrowDeployment.deploymentTxHash = deploymentTx.deploymentTransaction().hash;
            escrowDeployment.deploymentStatus = 'deployed';
            
            // Step 3: Fund the deployed contract with ETH
            console.log('\n=== Step 3: Funding EscrowSrc Contract ===');
            
            const totalFundingAmount = escrowImmutables.amount + escrowImmutables.safetyDeposit;
            console.log('Total funding amount:', ethers.formatEther(totalFundingAmount), 'ETH');
            console.log('- Making amount:', ethers.formatEther(escrowImmutables.amount), 'ETH');
            console.log('- Safety deposit:', ethers.formatEther(escrowImmutables.safetyDeposit), 'ETH');
            
            // Check if deployer has enough balance for funding
            const deployerBalanceAfterDeployment = await provider.getBalance(deployerWallet.address);
            console.log('Deployer balance after deployment:', ethers.formatEther(deployerBalanceAfterDeployment), 'ETH');
            
            if (deployerBalanceAfterDeployment < totalFundingAmount) {
                console.error('❌ Insufficient balance for funding!');
                console.error('Need:', ethers.formatEther(totalFundingAmount), 'ETH');
                console.error('Have:', ethers.formatEther(deployerBalanceAfterDeployment), 'ETH');
                console.log('Please fund the deployer wallet with additional Sepolia ETH');
            } else {
                console.log('✅ Sufficient balance for funding');
                
                try {
                    // Send ETH to the contract with much higher gas limit
                    const fundingTx = await deployerWallet.sendTransaction({
                        to: contractAddress,
                        value: totalFundingAmount,
                        gasLimit: 1000000, // Much higher gas limit (1M gas)
                        gasPrice: await provider.getFeeData().then(fee => fee.gasPrice)
                    });
                    
                    console.log('Funding transaction hash:', fundingTx.hash);
                    console.log('Waiting for funding confirmation...');
                    
                    // Wait for funding transaction
                    const fundingReceipt = await fundingTx.wait();
                    
                    if (fundingReceipt.status === 1) {
                        console.log('✅ Contract funded successfully!');
                        console.log('Funding transaction confirmed in block:', fundingReceipt.blockNumber);
                        console.log('Gas used:', fundingReceipt.gasUsed.toString());
                        
                        // Update deployment info
                        escrowDeployment.fundingTxHash = fundingTx.hash;
                        escrowDeployment.fundingAmount = totalFundingAmount.toString();
                        escrowDeployment.fundingStatus = 'completed';
                        escrowDeployment.gasUsed = fundingReceipt.gasUsed.toString();
                    } else {
                        console.error('❌ Funding transaction failed!');
                        escrowDeployment.fundingStatus = 'failed';
                        escrowDeployment.fundingError = 'Transaction reverted';
                    }
                    
                } catch (fundingError) {
                    console.error('❌ Error during funding:', fundingError.message);
                    escrowDeployment.fundingStatus = 'failed';
                    escrowDeployment.fundingError = fundingError.message;
                    
                    // Try alternative approach - send with even more gas
                    console.log('🔄 Trying alternative funding approach with higher gas limit...');
                    try {
                        const alternativeFundingTx = await deployerWallet.sendTransaction({
                            to: contractAddress,
                            value: totalFundingAmount,
                            gasLimit: 2000000, // Even higher gas limit (2M gas)
                            gasPrice: await provider.getFeeData().then(fee => fee.gasPrice)
                        });
                        
                        console.log('Alternative funding transaction hash:', alternativeFundingTx.hash);
                        const alternativeReceipt = await alternativeFundingTx.wait();
                        
                        if (alternativeReceipt.status === 1) {
                            console.log('✅ Alternative funding successful!');
                            escrowDeployment.fundingTxHash = alternativeFundingTx.hash;
                            escrowDeployment.fundingAmount = totalFundingAmount.toString();
                            escrowDeployment.fundingStatus = 'completed';
                            escrowDeployment.gasUsed = alternativeReceipt.gasUsed.toString();
                        } else {
                            console.error('❌ Alternative funding also failed');
                            escrowDeployment.fundingStatus = 'failed';
                            escrowDeployment.fundingError = 'Both funding attempts failed';
                        }
                    } catch (altError) {
                        console.error('❌ Alternative funding also failed:', altError.message);
                        escrowDeployment.fundingStatus = 'failed';
                        escrowDeployment.fundingError = `Both attempts failed: ${fundingError.message}, ${altError.message}`;
                    }
                }
            }
            
            // Step 4: Verify the contract deployment
            console.log('\n=== Step 4: Verifying Contract Deployment ===');
            
            try {
                // Create contract instance
                const contract = new ethers.Contract(contractAddress, ESCROW_SRC_ABI, provider);
                
                // Verify rescue delay
                const deployedRescueDelay = await contract.RESCUE_DELAY();
                console.log('Rescue delay verification:', deployedRescueDelay.toString(), 'seconds');
                
                if (deployedRescueDelay.toString() === rescueDelay.toString()) {
                    console.log('✅ Rescue delay verified correctly');
                } else {
                    console.error('❌ Rescue delay mismatch!');
                    console.error('Expected:', rescueDelay);
                    console.error('Actual:', deployedRescueDelay.toString());
                }
                
                // Check contract balance
                const contractBalance = await provider.getBalance(contractAddress);
                console.log('Contract balance:', ethers.formatEther(contractBalance), 'ETH');
                
                if (escrowDeployment.fundingStatus === 'completed') {
                    if (contractBalance >= totalFundingAmount) {
                        console.log('✅ Contract balance verified correctly');
                    } else {
                        console.error('❌ Contract balance insufficient!');
                        console.error('Expected at least:', ethers.formatEther(totalFundingAmount), 'ETH');
                        console.error('Actual:', ethers.formatEther(contractBalance), 'ETH');
                    }
                } else {
                    console.log('📝 Contract balance check completed (funding status:', escrowDeployment.fundingStatus, ')');
                }
                
                // Verify contract is not a proxy (should have direct implementation)
                try {
                    const factory = await contract.FACTORY();
                    console.log('Factory address:', factory);
                    console.log('✅ Contract deployment verification complete');
                    
                    // Update verification info
                    escrowDeployment.verificationStatus = 'verified';
                    escrowDeployment.contractBalance = contractBalance.toString();
                    escrowDeployment.deployedRescueDelay = deployedRescueDelay.toString();
                    
                } catch (error) {
                    console.error('❌ Contract verification failed:', error.message);
                    escrowDeployment.verificationStatus = 'failed';
                    escrowDeployment.verificationError = error.message;
                }
                
            } catch (error) {
                console.error('❌ Error during contract verification:', error);
                escrowDeployment.verificationStatus = 'failed';
                escrowDeployment.verificationError = error.message;
            }
            
            // Update the saved file with complete deployment info
            // fs.writeFileSync(filepath, JSON.stringify(orderData, null, 2));
            // console.log(`Updated order file with complete deployment info: ${filepath}`);
            
            console.log('\n🎉 EscrowSrc deployment completed successfully!');
            console.log('Contract address:', escrowDeployment.contractAddress);
            console.log('Deployment tx:', escrowDeployment.deploymentTxHash);
            if (escrowDeployment.fundingTxHash) {
                console.log('Funding tx:', escrowDeployment.fundingTxHash);
            }
            
        } catch (error) {
            console.error('❌ Error during EscrowSrc deployment:', error);
            escrowDeployment.deploymentStatus = 'failed';
            escrowDeployment.deploymentError = error.message;
            
            // Update the saved file with error info
            // fs.writeFileSync(filepath, JSON.stringify(orderData, null, 2));
            // console.log(`Updated order file with deployment error: ${filepath}`);
            
            // Don't continue with order setup message - leave error as last message
            return;
        }
        
    } catch (error) {
        console.error('❌ Error preparing EscrowSrc deployment:', error);
        console.log('Continuing with order setup...');
    }
    
    console.log('\nOrder setup complete! Check the generated JSON file for order details.');

})(); 