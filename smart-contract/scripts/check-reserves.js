const { ethers } = require("hardhat");

async function main() {
  const FACTORY_ADDRESS = "0x0960d0CFE3AaB7Bb7d0718d41A9d949Ab37F4063";
  
  const tokens = {
    KLD: "0x0c61dbCF1e8DdFF0E237a256257260fDF6934505",
    USDC: "0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3",
    WETH: "0x618B1561b189972482168fd31f5B5a3B5A10Ce33",
    USDT: "0x717A36E56b33585Bd00260422FfCc3270af34D3E"
  };

  const pairsToCheck = [
    ["KLD", "WETH"],
    ["KLD", "USDC"],
    ["USDC", "USDT"],
    ["USDC", "WETH"]
  ];

  const factory = await ethers.getContractAt("KaleidoSwapFactory", FACTORY_ADDRESS);

  console.log("Checking Reserves for Pools:");
  console.log("----------------------------");

  for (const [symA, symB] of pairsToCheck) {
    const addrA = tokens[symA];
    const addrB = tokens[symB];
    
    if (!addrA || !addrB) {
        console.log(`Skipping ${symA}-${symB}: Missing address`);
        continue;
    }

    try {
        const pairAddress = await factory.getPair(addrA, addrB);
        if (pairAddress === "0x0000000000000000000000000000000000000000") {
            console.log(`[${symA}-${symB}]: Pair NOT created.`);
            continue;
        }

        const pair = await ethers.getContractAt("KaleidoSwapPair", pairAddress);
        const { _reserve0, _reserve1 } = await pair.getReserves();
        
        // Basic resolution of which reserve is which token requires identifying token0/token1 order
        // but raw numbers are enough to say "Empty" or "Funded".
        const token0 = await pair.token0();
        const r0Sym = token0.toLowerCase() === addrA.toLowerCase() ? symA : symB;
        const r1Sym = r0Sym === symA ? symB : symA;

        console.log(`[${symA}-${symB}]: Found at ${pairAddress}`);
        console.log(`   Reserves: ${_reserve0.toString()} (${r0Sym}) / ${_reserve1.toString()} (${r1Sym})`);
        
        if (_reserve0 == 0n && _reserve1 == 0n) {
             console.log("   STATUS: EMPTY (Zero Liquidity)");
        } else {
             console.log("   STATUS: ACTIVE");
        }
    } catch (e) {
        console.log(`[${symA}-${symB}]: Error checking - ${e.message}`);
    }
    console.log("----------------------------");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
