import { ethers } from "ethers";
import { ErrorDecoder } from "ethers-decode-error";
import * as dotenv from "dotenv";
import { erc20Abi } from "./abi/erc20Abi.js";
import { vaultAbi } from "./abi/Vault.js";
import { diamondAbi } from "./abi/ProtocolFacet.js";

dotenv.config();

// Error decoder setup (at the bottom of the file)
const errorDecoder = ErrorDecoder.create([diamondAbi]);
// Constants
const CONSTANTS = {
  PRIVATE_KEY:
    "9e5345ca0415a07573d5b63737e0126382daceb88286d6947055b3d49270c139",
  PROTOCOL_CONTRACT_ADDRESS: "0xBCc9e3d13CeB24C46Aa2BC7521265B3ace4bb410",
  DIAMOND_CONTRACT_ADDRESS: "0x2aC60481a9EA2e67D80CdfBF587c63c88A5874ac",
  RPC_URL: "https://api.testnet.abs.xyz",
  LOCAL_HOST_RPC: "http://localhost:8545",
  ETH_PYTH_FEED_ID:
    "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  USDC_PYTH_FEED_ID:
    "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
  TOKEN: "0x0000000000000000000000000000000000000001",
  USDC: "0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3",
  USDR: "0x769EBD1dc2470186f0a4911113754DfD13f2CDA3",
  VAULT_ADDRESS: "0x1FDD717733CDf231C8E7e27def75A849673F9293",
};

// Setup provider and signer utility function
const getProviderAndSigner = () => {
  const provider = new ethers.JsonRpcProvider(CONSTANTS.RPC_URL);
  const signer = new ethers.Wallet(CONSTANTS.PRIVATE_KEY, provider);
  return { provider, signer };
};

// Error handling utility
const handleError = async (error, errorDecoder) => {
  console.error("❌ Error:", error);
  if (errorDecoder) {
    const decodedError = await errorDecoder.decode(error);
    console.error("Decoded error:", decodedError);
  }
};

// Vault Functions
const VaultOperations = {
  async withdrawFees() {
    try {
      const { provider, signer } = getProviderAndSigner();
      const usdc = new ethers.Contract(CONSTANTS.USDC, erc20Abi, provider);
      const vault = new ethers.Contract(
        CONSTANTS.VAULT_ADDRESS,
        vaultAbi,
        signer,
      );

      const balance = await usdc.balanceOf(CONSTANTS.VAULT_ADDRESS);
      console.log("Vault USDC balance:", ethers.formatUnits(balance, 6));

      const tx = await vault.withdrawFees(
        CONSTANTS.USDC,
        balance,
        "0xC77B506Ca574B0C401c9B651ca29afB35DD47b0F",
      );
      await tx.wait();
      console.log("✅ Withdraw successful!");
    } catch (error) {
      await handleError(error, errorDecoder);
    }
  },

  async addTokens() {
    try {
      const { signer } = getProviderAndSigner();
      const vault = new ethers.Contract(
        CONSTANTS.VAULT_ADDRESS,
        vaultAbi,
        signer,
      );

      const tokens = [CONSTANTS.TOKEN, CONSTANTS.USDC];
      const tx = await vault.addTokens(tokens);
      await tx.wait();
      console.log("✅ Tokens added successfully!");
    } catch (error) {
      await handleError(error, errorDecoder);
    }
  },
};
