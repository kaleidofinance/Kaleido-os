const hre = require("hardhat");

async function main() {
  const factoryAddress = "0x0960d0CFE3AaB7Bb7d0718d41A9d949Ab37F4063";
  const usdcAddress = "0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3";
  const usdtAddress = "0x717A36E56b33585Bd00260422FfCc3270af34D3E";
  const stableFee = 5;

  console.log("Attaching to KaleidoSwapFactory at:", factoryAddress);
  const factory = await hre.ethers.getContractAt("KaleidoSwapFactory", factoryAddress);

  const pair = await factory.getPair(usdcAddress, usdtAddress);
  console.log("Current Pair Address:", pair);

  if (pair !== "0x0000000000000000000000000000000000000000") {
    console.log("Pair already exists! Debugging skipped.");
    return;
  }

  console.log(`Attempting to create pair with fee ${stableFee} (Stable)...`);
  try {
    const tx = await factory.createPair(usdcAddress, usdtAddress, stableFee);
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
