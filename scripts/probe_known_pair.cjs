const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
    const provider = new ethers.JsonRpcProvider("https://api.testnet.abs.xyz");
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

    const POSITION_MANAGER = "0x4e45d4BeF55fD4d8c419a97853E645a0932CA051";
    const USDC = "0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3";
    const WETH = "0x618B1561b189972482168fd31f5B5a3B5A10Ce33";
    const FEE = 3000;
    const [t0, t1] = [USDC, WETH].sort();
    const sqrtPriceX96 = BigInt("79228162514264337593543950336");

    const manager = new ethers.Contract(POSITION_MANAGER, [
        "function createAndInitializePoolIfNecessary(address,address,uint24,uint160) external payable returns (address)",
        "function WETH9() view returns (address)"
    ], wallet);

    console.log("--- 🕵️ PROBING KNOWN PAIRS (USDC/WETH) ---");

    try {
        const internalWeth = await manager.WETH9();
        console.log(`Internal WETH: ${internalWeth}`);
        
        console.log(`Creating Pool: ${t0} / ${t1}`);
        const tx = await manager.createAndInitializePoolIfNecessary(
            t0, t1, FEE, sqrtPriceX96, { gasLimit: 10000000 }
        );
        console.log("Probe TX Sent:", tx.hash);
        await tx.wait();
        console.log("✅ Success! Standard Pool Created.");
    } catch (e) {
        console.error("❌ Known-Pair Probe Failed:", e.message);
    }
}

main();
