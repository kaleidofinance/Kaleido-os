const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
    const provider = new ethers.JsonRpcProvider("https://api.testnet.abs.xyz");
    const FACTORY_ADDR = "0x5977417061Be3C2A9581823E7b50bBbd5a7b113c";
    const t0 = "0x618B1561b189972482168fd31f5B5a3B5A10Ce33"; // WETH
    const t1 = "0x913f3354942366809A05e89D288cCE60d87d7348"; // kfUSD
    const FEE = 3000;

    const factory = new ethers.Contract(FACTORY_ADDR, [
        "function getPool(address,address,uint24) view returns (address)"
    ], provider);

    try {
        const pool = await factory.getPool(t0, t1, FEE);
        console.log(`POOL_0x597=${pool}`);
    } catch (e) {
        console.error("Audit Failed:", e.message);
    }
}

main();
