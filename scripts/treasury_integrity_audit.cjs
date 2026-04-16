const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
    const provider = new ethers.JsonRpcProvider("https://api.testnet.abs.xyz");
    const TREASURY_ADDR = "0xcB3D0069Cf6d6dfBB8E7Dee564DbE39eFa9c582d";

    const treasury = new ethers.Contract(TREASURY_ADDR, [
        "function kafUSD() view returns (address)",
        "function accumulatedYieldPerShare() view returns (uint256)",
        "function owner() view returns (address)"
    ], provider);

    try {
        console.log(`--- 🕵️ YIELD TREASURY INTEGRITY AUDIT ---`);
        const kafUSD = await treasury.kafUSD();
        const ayps = await treasury.accumulatedYieldPerShare();
        const owner = await treasury.owner();
        
        console.log(`TREASURY=${TREASURY_ADDR}`);
        console.log(`kfUSD_ANCHOR=${kafUSD}`);
        console.log(`AYPS_INDEX=${ayps}`);
        console.log(`OWNER=${owner}`);
        
        if (kafUSD.toLowerCase() === "0x913f3354942366809a05e89d288cce60d87d7348") {
            console.log("Status: 🏛️ SYSTEM ALIGNED");
        } else {
            console.log("Status: ⚠️ MISALIGNED");
        }
    } catch (e) {
        console.error("Audit Failed:", e.message);
    }
}

main();
