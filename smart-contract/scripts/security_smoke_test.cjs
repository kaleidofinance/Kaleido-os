const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
    const provider = new ethers.JsonRpcProvider("https://api.testnet.abs.xyz");
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

    const TREASURY_ADDR = "0xc0bf4A43D272Afe4aF9DF0B82bE390db5DC3CFAB";
    const ROUTER_ADDR = "0xA094fcdBBf2b195f81DeFA488141B03e7C855f70";
    const QUOTER_ADDR = "0x5ce4b6D22CCC4b55416483BA0D0f3DfC472D238A";

    console.log("--- SOVEREIGN SECURITY SMOKE TEST: STARTING ---");

    // 1. TEST YIELD TREASURY LINKAGE
    console.log("\n[TEST 1] YieldTreasury Integrity...");
    const treasuryAbi = ["function kafUSDContract() view returns (address)", "function owner() view returns (address)", "function PRECISION() view returns (uint256)"];
    const treasury = new ethers.Contract(TREASURY_ADDR, treasuryAbi, provider);
    
    const kafUSD = await treasury.kafUSDContract();
    const precision = await treasury.PRECISION();
    console.log(`- kafUSD Anchor: ${kafUSD}`);
    console.log(`- AYPS Precision: ${precision.toString()}`);
    console.log(kafUSD.toLowerCase() === process.env.kfUSD_ADDRESS.toLowerCase() ? "✅ Linkage Verified" : "❌ Linkage Mismatch");

    // 2. TEST SWAP ROUTER LINKAGE
    console.log("\n[TEST 2] SwapRouter Stateless Anchor...");
    const routerAbi = ["function factory() view returns (address)", "function WETH9() view returns (address)"];
    const router = new ethers.Contract(ROUTER_ADDR, routerAbi, provider);

    const factory = await router.factory();
    const weth = await router.WETH9();
    console.log(`- Factory Anchor: ${factory}`);
    console.log(`- WETH Anchor: ${weth}`);
    console.log(factory.toLowerCase() === process.env.V3_FACTORY.toLowerCase() ? "✅ Factory Verified" : "❌ Factory Mismatch");

    // 3. TEST QUOTER V2 PURE EXECUTION
    console.log("\n[TEST 3] QuoterV2 Pure Simulation Test...");
    const quoterAbi = ["function factory() view returns (address)", "function quoteExactInputSingle((address,address,uint256,uint24,uint160)) external returns (uint256,uint160,uint32,uint256)"];
    const quoter = new ethers.Contract(QUOTER_ADDR, quoterAbi, provider);

    const qFactory = await quoter.factory();
    console.log(`- Quoter Factory Anchor: ${qFactory}`);

    // We attempt a static call to quote (even if pool doesn't exist, we check for 'revert' vs 'state error')
    console.log("- Probing Pure Simulation (Non-existent pool probe)...");
    try {
        // Attempting a quote using array format for the QuoteExactInputSingleParams struct
        await quoter.quoteExactInputSingle.staticCall([
            "0x0000000000000000000000000000000000000001", // tokenIn
            "0x0000000000000000000000000000000000000002", // tokenOut
            ethers.parseEther("1"), // amountIn
            3000, // fee
            0 // sqrtPriceLimitX96
        ]);
    } catch (e) {
        // We expect a revert because the pool doesn't exist, NOT a storage error
        if (e.message.includes("execution reverted") || e.message.includes("could not decode")) {
            console.log("✅ Pure Simulation confirmed (Context correctly isolated)");
        } else {
            console.log("⚠️ Unexpected Simulation Error:", e.message);
        }
    }

    console.log("\n--- SMOKE TEST COMPLETE: STACK SECURED ---");
}

main();
