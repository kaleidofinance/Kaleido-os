const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
    const provider = new ethers.JsonRpcProvider("https://api.testnet.abs.xyz");
    const FACTORY_ADDR = "0xf1bfB54ce66A1Fa8Fe04fbf2f48119ffD3a5eDDD";
    const token0 = "0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3"; // USDC
    const token1 = "0x618B1561b189972482168fd31f5B5a3B5A10Ce33"; // WETH
    const FEE = 3000;

    const factory = new ethers.Contract(FACTORY_ADDR, [
        "function getPool(address,address,uint24) view returns (address)"
    ], provider);

    try {
        console.log(`--- 🕵️ RECOVERING VENUE ANCHOR ---`);
        const pool = await factory.getPool(token0, token1, FEE);
        console.log(`FACTORY=${FACTORY_ADDR}`);
        console.log(`USDC_WETH_POOL=${pool}`);
    } catch (e) {
        console.error("Recovery Failed:", e.message);
    }
}

main();
