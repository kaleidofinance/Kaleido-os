const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
    const provider = new ethers.JsonRpcProvider("https://api.testnet.abs.xyz");
    const FACTORY_ADDR = "0xC75161E02E4599f1E68c4E9ea5bab001186D512B";
    
    // PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)
    const topic0 = ethers.id("PoolCreated(address,address,uint24,int24,address)");

    console.log("--- 🎙️ SCANNING FACTORY EVENT LOGS ---");
    
    try {
        const logs = await provider.getLogs({
            address: FACTORY_ADDR,
            topics: [topic0],
            fromBlock: 0,
            toBlock: "latest"
        });

        console.log(`POOLS_DISCOVERED=${logs.length}`);
        
        for (const log of logs) {
            const token0 = "0x" + log.topics[1].slice(26);
            const token1 = "0x" + log.topics[2].slice(26);
            const fee = parseInt(log.topics[3], 16);
            console.log(`FOUND_POOL: ${token0} / ${token1} | Fee: ${fee}`);
        }
    } catch (e) {
        console.error("Log Scan Failed:", e.message);
    }
}

main();
