const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
    const provider = new ethers.JsonRpcProvider("https://api.testnet.abs.xyz");
    const FACTORY_ADDR = "0xC75161E02E4599f1E68c4E9ea5bab001186D512B";
    const factory = new ethers.Contract(FACTORY_ADDR, [
        "function allPoolsLength() view returns (uint256)",
        "function allPools(uint256) view returns (address)"
    ], provider);

    try {
        const length = await factory.allPoolsLength();
        console.log(`POOLS_FOUND=${length}`);
        for (let i = 0; i < Math.min(Number(length), 5); i++) {
            const addr = await factory.allPools(i);
            console.log(`POOL_${i}=${addr}`);
        }
    } catch (e) {
        console.error("Factory Poll Failed:", e.message);
    }
}

main();
