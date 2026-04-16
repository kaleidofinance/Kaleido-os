const { ethers } = require("ethers");

async function main() {
  const RPC_URL = "https://api.testnet.abs.xyz";
  const KFUSD_ADDRESS = "0x913f3354942366809A05e89D288cCE60d87d7348";
  const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: 11124, name: "abstract-testnet" }, { staticNetwork: true });

  const abi = [
    "function mintFee() view returns (uint256)",
    "function redeemFee() view returns (uint256)"
  ];
  const kfusd = new ethers.Contract(KFUSD_ADDRESS, abi, provider);

  try {
    const mFee = await kfusd.mintFee();
    const rFee = await kfusd.redeemFee();
    console.log("Current Mint Fee:", mFee.toString(), "bps (", Number(mFee)/100, "%)");
    console.log("Current Redeem Fee:", rFee.toString(), "bps (", Number(rFee)/100, "%)");
  } catch (e) {
    console.error("Failed:", e.message);
  }
}

main();
