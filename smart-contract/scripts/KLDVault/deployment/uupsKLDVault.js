const hre = require("hardhat");

async function main() {
  const KLDVault = await hre.ethers.getContractFactory("KLDVault");

  const proxy = await hre.zkUpgrades.deployProxy(KLDVault, [], {
    initializer: "initialize",
    kind: "uups",
  });

  console.log("✅ Proxy deployed at:", await proxy.getAddress());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
