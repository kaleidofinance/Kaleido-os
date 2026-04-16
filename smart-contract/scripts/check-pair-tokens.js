const { ethers } = require("ethers");

async function main() {
  const RPC_URL = "https://api.testnet.abs.xyz";
  const PAIR_ADDRESS = "0x8286b07adc7833ffD2Afa430AA208e57B23401a3";
  const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: 11124, name: "abstract-testnet" }, { staticNetwork: true });

  const pairAbi = [
    "function token0() view returns (address)",
    "function token1() view returns (address)"
  ];
  const tokenAbi = ["function symbol() view returns (string)"];

  const pair = new ethers.Contract(PAIR_ADDRESS, pairAbi, provider);

  try {
    const t0 = await pair.token0();
    const t1 = await pair.token1();
    
    const k0 = new ethers.Contract(t0, tokenAbi, provider);
    const k1 = new ethers.Contract(t1, tokenAbi, provider);
    
    const s0 = await k0.symbol();
    const s1 = await k1.symbol();
    
    console.log("Token 0:", s0, t0);
    console.log("Token 1:", s1, t1);
  } catch (e) {
    console.error("Failed:", e.message);
  }
}

main();
