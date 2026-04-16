const { ethers } = require("hardhat");

async function main() {
  console.log("--- 🏛️ STAKING REINTEGRATION: MODERNIZED GENESIS ---");

  const TREASURY_ADDR = "0xcB3D0069Cf6d6dfBB8E7Dee564DbE39eFa9c582d";
  const kfUSD_ADDR = "0x913f3354942366809A05e89D288cCE60d87d7348";
  const USDC_ADDR = "0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3";
  const KLD_ADDR = "0x0c61dbCF1e8DdFF0E237a256257260fDF6934505";

  const [deployer] = await ethers.getSigners();

  // 1. Deploy KLDVaultV2 (Linked to Treasury)
  console.log("1. Deploying KLDVaultV2...");
  const VaultFactory = await ethers.getContractFactory("KLDVaultV2");
  const vault = await VaultFactory.deploy(TREASURY_ADDR);
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log(`✅ KLDVaultV2 Deployed: ${vaultAddr}`);

  // 2. Deploy StKLD (Linked to Vault & KLD)
  console.log("2. Deploying StKLD V2...");
  const StKLDFactory = await ethers.getContractFactory("StKLD");
  const stkld = await StKLDFactory.deploy(vaultAddr, KLD_ADDR);
  await stkld.waitForDeployment();
  const stkldAddr = await stkld.getAddress();
  console.log(`✅ StKLD V2 Deployed: ${stkldAddr}`);

  // 3. Linking
  console.log("3. Linking Vault to stKLD...");
  await vault.setStKLD(stkldAddr);
  
  console.log("4. Authorizing Assets in Vault...");
  await vault.setSupport(kfUSD_ADDR, true);
  await vault.setSupport(USDC_ADDR, true);
  await vault.setSupport(KLD_ADDR, true);

  // 4. Treasury Handshake (Needs to happen via Treasury ADMIN_ROLE)
  console.log("--- 🤝 TREASURY HANDSHAKE RECOGNIZED ---");
  console.log(`ACTION REQUIRED: Grant VAULT_ROLE to ${vaultAddr} in Treasury ${TREASURY_ADDR}`);
  
  const treasuryFactory = await ethers.getContractFactory("YieldTreasury");
  const treasury = treasuryFactory.attach(TREASURY_ADDR).connect(deployer);
  
  const VAULT_ROLE = await treasury.VAULT_ROLE();
  console.log("5. Granting VAULT_ROLE to Vault...");
  await treasury.grantRole(VAULT_ROLE, vaultAddr);
  console.log("✅ Vault Authorized in Treasury");

  console.log("\n--- STAKING REINTEGRATION COMPLETE ---");
  console.log(`KLDVaultV2: ${vaultAddr}`);
  console.log(`stKLD_V2: ${stkldAddr}`);
}

main().catch(console.error);
