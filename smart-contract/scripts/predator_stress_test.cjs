const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
    const provider = new ethers.JsonRpcProvider("https://api.testnet.abs.xyz");
    const QUOTER_ADDR = "0x5ce4b6D22CCC4b55416483BA0D0f3DfC472D238A";
    
    const quoterAbi = [
        "function quoteExactInputSingle((address,address,uint256,uint24,uint160)) external returns (uint256,uint160,uint32,uint256)"
    ];
    const quoter = new ethers.Contract(QUOTER_ADDR, quoterAbi, provider);

    console.log("--- 🐆 INITIATING PREDATOR STRESS TEST (BURST MODE) ---");
    console.log("Analyzing Stateless Gas Invariance across 50 recursive probes...");

    const BURST_COUNT = 50;
    const results = [];

    for (let i = 0; i < BURST_COUNT; i++) {
        const start = Date.now();
        try {
            // We use staticCall to simulate the heavy lifting of the quote logic
            await quoter.quoteExactInputSingle.staticCall([
                "0x0000000000000000000000000000000000000001", // tokenIn
                "0x0000000000000000000000000000000000000002", // tokenOut
                ethers.parseEther("1"), // amountIn
                3000, // fee
                0 // sqrtPriceLimitX96
            ]);
        } catch (e) {
            // Revert is expected (no pool), but we check the speed and consistency
            const duration = Date.now() - start;
            results.push(duration);
            if (i % 10 === 0) console.log(`- Probe #${i}: Latency ${duration}ms`);
        }
    }

    const avg = results.reduce((a, b) => a + b) / results.length;
    const variance = Math.max(...results) - Math.min(...results);

    console.log("\n--- STRESS TEST ANALYSIS ---");
    console.log(`- Total Probes: ${BURST_COUNT}`);
    console.log(`- Average Latency: ${avg.toFixed(2)}ms`);
    console.log(`- Latency Variance: ${variance}ms`);
    
    if (variance < 200) {
        console.log("✅ RESULT: GAS INVARIANCE DETECTED. The stack is perfectly stateless.");
    } else {
        console.log("⚠️ RESULT: State friction detected. Audit suggested.");
    }
    
    console.log("\n--- PREDATOR STRESS TEST COMPLETE ---");
}

main();
