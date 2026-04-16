const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
    const provider = new ethers.JsonRpcProvider("https://api.testnet.abs.xyz");
    const FACTORY_ADDR = "0xf1bfB54ce66A1Fa8Fe04fbf2f48119ffD3a5eDDD";
    const token0 = "0x618B1561b189972482168fd31f5B5a3B5A10Ce33"; // WETH
    const token1 = "0x913f3354942366809A05e89D288cCE60d87d7348"; // kfUSD
    const FEE = 3000;

    const factory = new ethers.Contract(FACTORY_ADDR, [
        "function getPool(address,address,uint24) view returns (address)"
    ], provider);

    try {
        console.log(`--- 🕵️ DEFINITIVE VENUE RECOVERY (kfUSD/WETH) ---`);
        const pool = await factory.getPool(token0, token1, FEE);
        console.log(`FACTORY=${FACTORY_ADDR}`);
        console.log(`kfUSD_WETH_POOL=${pool}`);
        
        if (pool === "0x0000000000000000000000000000000000000000") {
            console.log("Status: IDLE / REVERTED");
        } else {
            console.log("Status: 🏛️ ANCHORED");
        }
    } catch (e) {
        console.error("Probe Failed:", e.message);
    }
}

main();
