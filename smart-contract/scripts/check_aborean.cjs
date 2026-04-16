const { ethers } = require("hardhat");

async function main() {
  const target = "0x3032eE3C14caed0E58e91A92CaBffba7AC89A0e9";
  const code = await ethers.provider.getCode(target);
  console.log(`Target: ${target}`);
  console.log(`Bytecode Length: ${code.length}`);
  
  if (code.length > 2) {
    console.log("✅ CONTRACT IS LIVE");
  } else {
    console.log("❌ CONTRACT IS EMPTY (EOA OR SELF-DESTRUCTED)");
  }
}

main().catch(console.error);
