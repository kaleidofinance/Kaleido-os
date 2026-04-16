const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
    const provider = new ethers.JsonRpcProvider("https://api.testnet.abs.xyz");
    const FACTORY_ADDR = "0xC75161E02E4599f1E68c4E9ea5bab001186D512B";
    const factory = new ethers.Contract(FACTORY_ADDR, [
        "function owner() view returns (address)",
        "function feeAmountTickSpacing(uint24) view returns (int24)"
    ], provider);

    try {
        const owner = await factory.owner();
        console.log(`FACTORY_OWNER=${owner}`);
        
        const tiers = [100, 500, 3000, 10000];
        for (const t of tiers) {
            const spacing = await factory.feeAmountTickSpacing(t);
            console.log(`TIER_${t}_SPACING=${spacing}`);
        }
    } catch (e) {
        console.error("Deep Audit Failed:", e.message);
    }
}

main();
