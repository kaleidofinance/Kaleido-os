const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
    const [wallet] = await ethers.getSigners();

    const FACTORY_ADDR = "0xC75161E02E4599f1E68c4E9ea5bab001186D512B";
    const token0 = "0x0c61dbCF1e8DdFF0E237a256257260fDF6934505"; // KLD
    const token1 = "0x913f3354942366809A05e89D288cCE60d87d7348"; // kfUSD
    const FEE = 3000;

    const factory = new ethers.Contract(FACTORY_ADDR, [
        "function createPool(address tokenA, address tokenB, uint24 fee) external returns (address)",
        "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)"
    ], wallet);

    console.log("--- 🏗️ CREATING SOVEREIGN V3 POOL (SORTED) ---");
    
    try {
        const tx = await factory.createPool(token0, token1, FEE, {
            gasLimit: 5000000 // Explicit gas for Abstract VM
        });
        console.log("Creation TX Sent:", tx.hash);
        await tx.wait();
        const poolAddr = await factory.getPool(token0, token1, FEE);
        console.log(`✅ Success! Pool Created at: ${poolAddr}`);

        // Initialize the pool (1:1 Price)
        console.log("--- ⚖️ INITIALIZING POOL PRICE (1:1) ---");
        const pool = new ethers.Contract(poolAddr, [
            "function initialize(uint160 sqrtPriceX96) external"
        ], wallet);
        
        // 2^96 = 79228162514264337593543950336
        const sqrtPriceX96 = "79228162514264337593543950336"; 
        const initTx = await pool.initialize(sqrtPriceX96, {
            gasLimit: 3000000
        });
        await initTx.wait();
        console.log("✅ Pool Initialized!");
    } catch (e) {
        console.error("❌ Sorted Creation Failed:", e.message);
    }
}

main();
