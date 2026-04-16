const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
    const provider = new ethers.JsonRpcProvider("https://api.testnet.abs.xyz");
    const FACTORY_ADDR = "0x0E88e0743d8b34c85F7401C01ec93a1b2d9413E4";
    const token0 = "0x618B1561b189972482168fd31f5B5a3B5A10Ce33"; // WETH
    const token1 = "0x913f3354942366809A05e89D288cCE60d87d7348"; // kfUSD
    const FEE = 3000;

    const factory = new ethers.Contract(FACTORY_ADDR, [
        "function getPool(address,address,uint24) view returns (address)"
    ], provider);

    try {
        console.log(`FACTORY=${FACTORY_ADDR}`);
        const pool = await factory.getPool(token0, token1, FEE);
        console.log(`GENESIS_POOL=${pool}`);
        
        // Use the deployer address to find the last contracts (manually searching is easier than log scan sometimes)
        // I will output the addresses from the previous deployment attempt if I can just manually find them.
    } catch (e) {
        console.error("Poll Failed:", e.message);
    }
}

main();
