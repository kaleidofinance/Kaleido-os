const hre = require("hardhat");

async function main() {
  const factoryAddress = "0x0960d0CFE3AaB7Bb7d0718d41A9d949Ab37F4063";
  const wethAddress = "0x618B1561b189972482168fd31f5B5a3B5A10Ce33";
  const usdtAddress = "0x717A36E56b33585Bd00260422FfCc3270af34D3E";
  const volatileFee = 30; // 0.3%

  console.log("Attaching to KaleidoSwapFactory at:", factoryAddress);
  const factory = await hre.ethers.getContractFactory("KaleidoSwapFactory");
  const factoryContract = factory.attach(factoryAddress);

  const pair = await factoryContract.getPair(wethAddress, usdtAddress);
  console.log("Current Pair Address:", pair);

  if (pair !== "0x0000000000000000000000000000000000000000") {
    console.log("Pair already exists! Debugging skipped.");
    return;
  }

  console.log(`Attempting to create WETH-USDT pair with fee ${volatileFee}...`);
  try {
    const tx = await factoryContract.createPair(wethAddress, usdtAddress, volatileFee);
    console.log("Transaction sent:", tx.hash);
    await tx.wait();
    console.log("Pair created successfully!");
  } catch (error) {
    console.error("Create Pair Failed!");
    if (error.data) {
        console.error("Error Data:", error.data);
    } else {
        console.error("Error Object:", error);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
