const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
    const provider = new ethers.JsonRpcProvider("https://api.testnet.abs.xyz");
    const TREASURY_ADDR = "0xcB3D0069Cf6d6dfBB8E7Dee564DbE39eFa9c582d";
    const kfUSD = "0x913f3354942366809A05e89D288cCE60d87d7348";

    const treasury = new ethers.Contract(TREASURY_ADDR, [
        "function kafUSDContract() view returns (address)",
        "function accYieldPerShare(address) view returns (uint256)",
        "function getRoleMemberCount(bytes32) view returns (uint256)",
        "function DEFAULT_ADMIN_ROLE() view returns (bytes32)"
    ], provider);

    try {
        console.log(`--- 🕵️ CORRECTED YIELD TREASURY AUDIT ---`);
        const anchor = await treasury.kafUSDContract();
        const ayps = await treasury.accYieldPerShare(kfUSD);
        
        console.log(`TREASURY=${TREASURY_ADDR}`);
        console.log(`kfUSD_ANCHOR=${anchor}`);
        console.log(`AYPS_INDEX(kfUSD)=${ayps}`);
        
        if (anchor.toLowerCase() === kfUSD.toLowerCase()) {
            console.log("Status: 🏛️ SYSTEM ALIGNED (AYPS ACTIVE)");
        } else {
            console.log("Status: ⚠️ MISALIGNED");
        }
    } catch (e) {
        console.error("Audit Failed:", e.message);
    }
}

main();
