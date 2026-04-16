const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
    const provider = new ethers.JsonRpcProvider("https://api.testnet.abs.xyz");
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

    const POSITION_MANAGER = "0x4e45d4BeF55fD4d8c419a97853E645a0932CA051";
    const token0 = "0x618B1561b189972482168fd31f5B5a3B5A10Ce33"; // WETH
    const token1 = "0x913f3354942366809A05e89D288cCE60d87d7348"; // kfUSD
    const FEE = 3000;
    const sqrtPriceX96 = BigInt("79228162514264337593543950336");

    const manager = new ethers.Contract(POSITION_MANAGER, [
        "function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) external payable returns (address pool)"
    ], wallet);

    console.log("--- 🐆 PREDATOR ANCHOR: VALUE-BACKED CREATION ---");

    try {
        // Attaching 0.01 ETH in case the factory requires a creation fee
        const tx = await manager.createAndInitializePoolIfNecessary(
            token0, 
            token1, 
            FEE, 
            sqrtPriceX96,
            { 
                value: ethers.parseEther("0.01"), 
                gasLimit: 10000000 
            }
        );
        console.log("Atomic Creation TX Sent:", tx.hash);
        await tx.wait();
        console.log("✅ Success! Pool Created and Initialized.");
    } catch (e) {
        console.error("❌ Value-Backed Creation Failed:", e.message);
    }
}

main();
