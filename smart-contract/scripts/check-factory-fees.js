const { ethers } = require("hardhat");

async function main() {
  const FACTORY_ADDRESS = "0x0960d0CFE3AaB7Bb7d0718d41A9d949Ab37F4063";
  
  const abi = [
    "function feeTo() external view returns (address)",
    "function feeToSetter() external view returns (address)"
  ];
  
  const factory = await ethers.getContractAt(abi, FACTORY_ADDRESS);
  
  console.log("Querying Factory at:", FACTORY_ADDRESS);
  const feeTo = await factory.feeTo();
  const feeToSetter = await factory.feeToSetter();
  
  console.log("Current feeTo (Recipient):", feeTo);
  console.log("Current feeToSetter (Admin):", feeToSetter);
  
  if (feeTo === "0x0000000000000000000000000000000000000000") {
    console.log("Note: Fees are currently DISABLED (sending to 0x0 address).");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
