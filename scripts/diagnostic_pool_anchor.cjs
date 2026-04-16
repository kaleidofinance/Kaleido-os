const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
    const provider = new ethers.JsonRpcProvider("https://api.testnet.abs.xyz");
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

    const FACTORY_ADDR = "0x0E88e0743d8b34c85F7401C01ec93a1b2d9413E4";
    const token0 = "0x618B1561b189972482168fd31f5B5a3B5A10Ce33"; // WETH
    const token1 = "0x913f3354942366809A05e89D288cCE60d87d7348"; // kfUSD
    
    const factory = new ethers.Contract(FACTORY_ADDR, [
        "function createPool(address,address,uint24) external returns (address)",
        "function getPool(address,address,uint24) view returns (address)"
    ], wallet);

    console.log("--- 🕵️ DIAGNOSTIC: MULTI-TIER POOL ANCHOR ---");
    const tiers = [500, 3000, 10000];

    for (const fee of tiers) {
        try {
            console.log(`Checking Fee Tier ${fee}...`);
            let pool = await factory.getPool(token0, token1, fee);
            if (pool === "0x0000000000000000000000000000000000000000") {
                console.log(`Tier ${fee} empty. Attempting creation...`);
                const tx = await factory.createPool(token0, token1, fee, { gasLimit: 8000000 });
                console.log(`TX Sent: ${tx.hash}`);
                await tx.wait();
                pool = await factory.getPool(token0, token1, fee);
                console.log(`✅ Tier ${fee} SUCCESS! Pool: ${pool}`);
                break; // Stop if one succeeds
            } else {
                console.log(`✅ Tier ${fee} already exists at: ${pool}`);
                break;
            }
        } catch (e) {
            console.error(`❌ Tier ${fee} Failed:`, e.message);
        }
    }
}

main();
