const { ethers } = require("hardhat");

async function main() {
  const FACTORY_ADDR = "0xC75161E02E4599f1E68c4E9ea5bab001186D512B";
  const token0 = "0x0c61dbCF1e8DdFF0E237a256257260fDF6934505"; // KLD
  const token1 = "0x913f3354942366809A05e89D288cCE60d87d7348"; // kfUSD
  const FEE = 3000;

  const factoryCode = await ethers.provider.getCode(FACTORY_ADDR);
  console.log("FACTORY_CODE_LEN:", factoryCode.length);
  
  const kldCode = await ethers.provider.getCode(token0);
  const kfusdCode = await ethers.provider.getCode(token1);
  console.log("KLD_CODE_LEN:", kldCode.length);
  console.log("kfUSD_CODE_LEN:", kfusdCode.length);

  const factory = await ethers.getContractAt("contracts/dex-v3/core/interfaces/IKaleidoSwapV3Factory.sol:IKaleidoSwapV3Factory", FACTORY_ADDR);
  try {
    const tickSpacing = await factory.feeAmountTickSpacing(FEE);
    console.log(`FEE_${FEE}_TICK_SPACING:`, tickSpacing.toString());
  } catch (e) {
    console.log(`FEE_${FEE}_TICK_SPACING: (Unsupported)`);
  }
  
  const pool = await factory.getPool(token0, token1, FEE);
  console.log("POOL_ADDR:", pool);
  
  if (pool !== "0x0000000000000000000000000000000000000000") {
     const poolContract = await ethers.getContractAt("contracts/dex-v3/core/interfaces/IKaleidoSwapV3Pool.sol:IKaleidoSwapV3Pool", pool);
     try {
       const slot0 = await poolContract.slot0();
       console.log("INITIALIZED:", slot0.sqrtPriceX96.toString() !== "0");
       console.log("PRICE_X96:", slot0.sqrtPriceX96.toString());
     } catch (e) {
       console.log("INITIALIZED: FALSE (Reverted on slot0)");
     }
  }
}

main().catch(console.error);
