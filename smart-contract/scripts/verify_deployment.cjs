const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
    const provider = new ethers.JsonRpcProvider("https://api.testnet.abs.xyz");
    const addresses = [
        { name: "YieldTreasury", address: "0xc0bf4A43D272Afe4aF9DF0B82bE390db5DC3CFAB" },
        { name: "SwapRouter", address: "0xA094fcdBBf2b195f81DeFA488141B03e7C855f70" },
        { name: "NFTPositionManager", address: "0x4e45d4BeF55fD4d8c419a97853E645a0932CA051" },
        { name: "QuoterV2", address: "0x5ce4b6D22CCC4b55416483BA0D0f3DfC472D238A" }
    ];

    console.log("--- ON-CHAIN DEPLOYMENT AUDIT: ABSTRACT TESTNET ---");
    
    for (const item of addresses) {
        try {
            const code = await provider.getCode(item.address);
            const exists = code !== "0x" && code !== "0x0";
            console.log(`${item.name.padEnd(20)} | ${item.address} | ${exists ? "✅ EXISTS" : "❌ NOT FOUND"}`);
        } catch (e) {
            console.log(`${item.name.padEnd(20)} | ${item.address} | ⚠️ ERROR: ${e.message}`);
        }
    }
    
    console.log("--- AUDIT COMPLETE ---");
}

main();
