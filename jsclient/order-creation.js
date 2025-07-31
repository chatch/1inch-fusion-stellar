require('dotenv/config');
const Sdk = require('@1inch/cross-chain-sdk');
const {
    parseUnits,
    parseEther,
    randomBytes,
    Wallet: PKWallet,
    getAddress,
    verifyTypedData
} = require('ethers');
const {uint8ArrayToHex, UINT_40_MAX} = require('@1inch/byte-utils');

(async () => {
    // --- Minimal config and mock addresses for demonstration ---
    const srcChainId = 1
    const dstChainId = 56

    const srcEscrowFactory = getAddress('0x1111111111111111111111111111111111111111')
    const srcUserAddress = getAddress('0x2222222222222222222222222222222222222222')
    const dstUserAddress = getAddress('0x3333333333333333333333333333333333333333')
    const srcUSDC = getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48') // USDC on Ethereum
    const dstUSDC = getAddress('0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d') // USDC on BSC
    const srcResolver = getAddress('0x4444444444444444444444444444444444444444')

    // Create a mock wallet for signing
    const wallet = new PKWallet('0x1234567890123456789012345678901234567890123456789012345678901234')

    // User creates order
    const secret = uint8ArrayToHex(randomBytes(32)) // note: use crypto secure random number in real world

    // Create the order with the correct structure
    const order = Sdk.CrossChainOrder.new(
        new Sdk.Address(srcEscrowFactory),
        {
            salt: Sdk.randBigInt(1000n),
            maker: new Sdk.Address(srcUserAddress),
            makingAmount: parseUnits('100', 6),
            takingAmount: parseUnits('99', 6),
            makerAsset: new Sdk.Address(srcUSDC),
            takerAsset: new Sdk.Address(dstUSDC)
        },
        {
            hashLock: Sdk.HashLock.forSingleFill(secret),
            timeLocks: Sdk.TimeLocks.new({
                srcWithdrawal: 10n, // 10sec finality lock for test
                srcPublicWithdrawal: 120n, // 2m for private withdrawal
                srcCancellation: 121n, // 1sec public withdrawal
                srcPublicCancellation: 122n, // 1sec private cancellation
                dstWithdrawal: 10n, // 10sec finality lock for test
                dstPublicWithdrawal: 100n, // 100sec private withdrawal
                dstCancellation: 101n // 1sec public withdrawal
            }),
            srcChainId,
            dstChainId,
            srcSafetyDeposit: parseEther('0.001'),
            dstSafetyDeposit: parseEther('0.001')
        },
        {
            auction: new Sdk.AuctionDetails({
                initialRateBump: 0,
                points: [],
                duration: 120n,
                startTime: 0n // You can set this to a real timestamp if needed
            }),
            whitelist: [
                {
                    address: new Sdk.Address(srcResolver),
                    allowFrom: 0n
                }
            ],
            resolvingStartTime: 0n
        },
        {
            nonce: Sdk.randBigInt(UINT_40_MAX),
            allowPartialFills: false,
            allowMultipleFills: false
        }
    )

    console.log('Order created successfully!')
    console.log('Order hash:', order.getOrderHash(srcChainId))
    console.log('Secret used:', secret)

    // Sign the order
    const typedData = order.getTypedData(srcChainId)
    const signature = await wallet.signTypedData(
        typedData.domain,
        {Order: typedData.types[typedData.primaryType]},
        typedData.message
    )

    console.log('Order signed!')
    console.log('Signature:', signature)

    // Verify the signature
    const recoveredAddress = verifyTypedData(
        typedData.domain,
        {Order: typedData.types[typedData.primaryType]},
        typedData.message,
        signature
    )
    console.log('Recovered address:', recoveredAddress)
    console.log('Wallet address:', wallet.address)
    console.log('Signature valid:', recoveredAddress === wallet.address)
})(); 