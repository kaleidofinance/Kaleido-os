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
  BOT_PRIVATE_KEY:
    "40eda24dde12f9f97a31022da6e3346b775827487afe41cec661d38802c1f3dc",
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

      //ETH WIHDRAWAL
      const ethBalance = await provider.getBalance(CONSTANTS.VAULT_ADDRESS);
      console.log("Vault ETH balance:", ethers.formatEther(ethBalance));

      //USDC WITHDRAWAL
      // const balance = await usdc.balanceOf(CONSTANTS.VAULT_ADDRESS);
      // console.log("Vault USDC balance:", ethers.formatUnits(balance, 6));

      const tx = await vault.withdrawFees(
        CONSTANTS.TOKEN,
        ethBalance,
        "0x28b7b3dc96e5b2C6047D7Ad9b05Fd9E2FC7E8955",
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

const DiamondOperations = {
  async getUsdValue() {
    try {
      const { signer } = getProviderAndSigner();
      const contract = new ethers.Contract(
        CONSTANTS.DIAMOND_CONTRACT_ADDRESS,
        diamondAbi,
        signer,
      );

      const usdValue = await contract.getUsdValue(
        CONSTANTS.USDR,
        "1000000000000000000",
        18,
      );
      const ethPrice = Number(usdValue.toString()) / 1e16;
      console.log(`✅ ETH Price: $${ethPrice.toFixed(2)}`);
    } catch (error) {
      // console.log("❌❌❌ Error in getUsdValue:", error);
      await handleError(error, errorDecoder);
    }
  },

  async createLendingRequest(amount, interest, returnDate, loanCurrency) {
    try {
      const { signer } = getProviderAndSigner();
      const contract = new ethers.Contract(
        CONSTANTS.DIAMOND_CONTRACT_ADDRESS,
        diamondAbi,
        signer,
      );

      if (amount <= 0) throw new Error("Invalid amount");
      if (returnDate <= Math.floor(Date.now() / 1000))
        throw new Error("Return date must be in the future");

      const tx = await contract.createLendingRequest(
        amount,
        interest,
        returnDate,
        loanCurrency,
      );
      console.log("📤 Transaction submitted:", tx.hash);
      await tx.wait();
      console.log("✅ Lending request created!");
    } catch (error) {
      await handleError(error, errorDecoder);
    }
  },

  async liquidateUserRequest(requestId) {
    try {
      const { signer, provider } = getProviderAndSigner();
      // const provider = new ethers.JsonRpcProvider(CONSTANTS.RPC_URL);
      // const signer = new ethers.Wallet(CONSTANTS.BOT_PRIVATE_KEY, provider);
      const contract = new ethers.Contract(
        CONSTANTS.DIAMOND_CONTRACT_ADDRESS,
        diamondAbi,
        signer,
      );

      await contract.liquidateUserRequest.estimateGas(requestId);

      console.log(`🚨 Liquidating request ID: ${requestId}`);
      const tx = await contract.liquidateUserRequest(requestId, {
        // gasLimit: "5000000",
        // gasPrice: ethers.parseUnits("1", "gwei"),
      });
      console.log("📤 Transaction sent:", tx.hash);

      const receipt = await tx.wait();
      console.log(
        receipt.status === 1
          ? `✅ Liquidation complete for request ID ${requestId}`
          : "❌ Transaction failed",
      );
    } catch (error) {
      await handleError(error, errorDecoder);
    }
    // const { signer, provider } = getProviderAndSigner();
    // const tx = {
    //   to: CONSTANTS.DIAMOND_CONTRACT_ADDRESS,
    //   data: contract.interface.encodeFunctionData("liquidateUserRequest", [
    //     requestId,
    //   ]),
    //   from: await signer.getAddress(),
    // };

    // try {
    //   const result = await provider.call(tx);
    //   console.log("Call result (success):", result);
    // } catch (error) {
    //   handleError(error, errorDecoder);
    //   console.error("❌ Raw eth_call failed:", error);

    //   if (error.data) {
    //     try {
    //       const revertReason = ethers.AbiCoder.defaultAbiCoder().decode(
    //         ["string"],
    //         "0x" + error.data.slice(138),
    //       );
    //       console.error("Decoded Revert Reason:", revertReason[0]);
    //     } catch (decodeErr) {
    //       console.error("❌ Failed to decode revert reason.", decodeErr);
    //     }
    //   }
    // }
  },

  async setBotAddress(_botAddress) {
    try {
      const { signer } = getProviderAndSigner();
      const contract = new ethers.Contract(
        CONSTANTS.DIAMOND_CONTRACT_ADDRESS,
        diamondAbi,
        signer,
      );
      const tx = await contract.setBotAddress(_botAddress);
      console.log("📤 Transaction sent:", tx.hash);
      await tx.wait();
      console.log("✅ Bot address set successfully!");
    } catch (error) {
      console.error("❌ Error in setBotAddress:", error);
    }
  },

  async setSwapRouter(_swapRouter) {
    try {
      const { signer } = getProviderAndSigner();
      const contract = new ethers.Contract(
        CONSTANTS.DIAMOND_CONTRACT_ADDRESS,
        diamondAbi,
        signer,
      );
      const tx = await contract.setSwapRouter(_swapRouter);
      console.log("📤 Transaction sent:", tx.hash);
      await tx.wait();
      console.log("✅ Swap router set successfully!");
    } catch (error) {
      console.error("❌ Error in setSwapRouter:", error);
    }
  },

  async setBPS(_bps) {
    try {
      const { signer } = getProviderAndSigner();
      const contract = new ethers.Contract(
        CONSTANTS.DIAMOND_CONTRACT_ADDRESS,
        diamondAbi,
        signer,
      );
      const tx = await contract.setBPS(_bps);
      console.log("📤 Transaction sent:", tx.hash);
      await tx.wait();
      console.log("✅ BPS set successfully!");
    } catch (error) {
      console.error("❌ Error in setBPS:", error);
    }
  },

  async setLiquidityBps(_bps) {
    try {
      const { signer } = getProviderAndSigner();
      const contract = new ethers.Contract(
        CONSTANTS.DIAMOND_CONTRACT_ADDRESS,
        diamondAbi,
        signer,
      );
      const tx = await contract.setLiquidityBps(_bps);
      console.log("📤 Transaction sent:", tx.hash);
      await tx.wait();
      console.log("✅ lIQUIDITY BPS set successfully!");
    } catch (error) {
      console.error("❌ Error in setBPS:", error);
    }
  },

  async setFeeVault(_feeVault) {
    try {
      const { signer } = getProviderAndSigner();
      const contract = new ethers.Contract(
        CONSTANTS.DIAMOND_CONTRACT_ADDRESS,
        diamondAbi,
        signer,
      );
      const tx = await contract.setFeeVault(_feeVault);
      console.log("📤 Transaction sent:", tx.hash);
      await tx.wait();
      console.log("✅ Fee vault address set successfully!");
    } catch (error) {
      console.error("❌ Error in setFeeVault:", error);
    }
  },

  async setPythOracle(_pythOracle) {
    try {
      const { signer } = getProviderAndSigner();
      const contract = new ethers.Contract(
        CONSTANTS.DIAMOND_CONTRACT_ADDRESS,
        diamondAbi,
        signer,
      );
      const tx = await contract.setPythOracle(_pythOracle);
      console.log("📤 Transaction sent:", tx.hash);
      await tx.wait();
      console.log("✅ Pyth Oracle address set successfully!");
    } catch (error) {
      console.error("❌ Error in setFeeVault:", error);
    }
  },

  async getAccountdepositedValue() {
    try {
      const { signer } = getProviderAndSigner();
      const contract = new ethers.Contract(
        CONSTANTS.DIAMOND_CONTRACT_ADDRESS,
        diamondAbi,
        signer,
      );
      const value = await contract.getAccountCollateralValue(
        "0x7CD9208361f897AABDB2A3f22Fb728eb52282d3a",
      );

      const availValue = await contract.getAccountAvailableValue(
        "0x7CD9208361f897AABDB2A3f22Fb728eb52282d3a",
      );
      console.log("📤  Collateral Bal:", value);
      console.log("📤  Available Bal:", availValue);
      // console.log("✅ USDC Available Bal retrieved successfully!");
    } catch (error) {
      await handleError(error, errorDecoder);
      // console.error("❌ Error in gettingAccountBalance:", error);
    }
  },

  async getServicedRequestIds() {
    try {
      const { signer } = getProviderAndSigner();
      const contract = new ethers.Contract(
        CONSTANTS.DIAMOND_CONTRACT_ADDRESS,
        diamondAbi,
        signer,
      );
      const requests = await contract.getAllRequests(0, 2000);

      console.log("📤 All Requests:", requests.length);

      const servicedRequestIds = requests
        .filter((request) => request[10] === 1n) // BigInt literal for 1
        .map((request) => Number(request[0])); // Convert BigInt requestId to Number

      console.log("✅ Serviced Request IDs:", servicedRequestIds.length);
      return servicedRequestIds;
    } catch (error) {
      await handleError(error, errorDecoder);
      return [];
    }
  },

  async getAllRequest() {
    try {
      const { signer } = getProviderAndSigner();
      const contract = new ethers.Contract(
        CONSTANTS.DIAMOND_CONTRACT_ADDRESS,
        diamondAbi,
        signer,
      );

      // const requests = await contract.getUserActiveRequests(
      //   "0x7CD9208361f897AABDB2A3f22Fb728eb52282d3a",
      // );
      const requests = await contract.getRequestToColateral(
        17056,
        "0x0000000000000000000000000000000000000001",
      );
      // const requests = await contract.getRequest(16815);
      console.log("📤 All Requests (first 1000):", requests);
      // console.log("✅ Requests retrieved successfully!");
    } catch (error) {
      await handleError(error, errorDecoder);
    }
  },
  async fetchAllRequests() {
    const { signer } = getProviderAndSigner();
    const contract = new ethers.Contract(
      CONSTANTS.DIAMOND_CONTRACT_ADDRESS,
      diamondAbi,
      signer,
    );

    const requests = [];

    for (let id = 1; id <= totalRequests; id++) {
      try {
        const request = await contract.getRequest(id);
        requests.push(request);
        console.log(`Fetched request ID ${id}`);
      } catch (error) {
        // Handle cases where request ID does not exist or was deleted
        console.warn(`Request ID ${id} not found or error: ${error.message}`);
      }
    }

    return requests;
  },

  async removeCollateralTokens() {
    const { signer } = getProviderAndSigner();
    const contract = new ethers.Contract(
      CONSTANTS.DIAMOND_CONTRACT_ADDRESS,
      diamondAbi,
      signer,
    );
    try {
      const tx = await contract.removeCollateralTokens([
        "0x85ca16fd0e81659e0b8be337294149e722528731",
      ]);
      console.log("📤 Transaction sent:", tx.hash);
      await tx.wait();
      console.log("✅ Collateral tokens removed successfully!");
    } catch (error) {
      console.error("❌ Error in removeCollateralTokens:", error);
    }
  },
};

const getTotalClaimed = async () => {
  try {
    const { signer } = getProviderAndSigner();
    const contract = new ethers.Contract(
      "0xc99eddf1f7c9250728a47978732928ae158396e7",
      diamondAbi,
      signer,
    );

    const requests = await contract.getRequest(10);
    // const usdcTotalClaimed = await contract.totalClaimed();
    // const kldTotalClaimed = await contract.totalKLDClaimed();

    // console.log(
    //   `Total USDC claimed: ${ethers.utils.formatUnits(usdcTotalClaimed, 6)} USDC`,
    // );
    // console.log(
    //   `Total KLD claimed: ${ethers.utils.formatEther(kldTotalClaimed)} KLD`,
    // );
    console.log("📤 All Requests:", requests);
    console.log("✅ Requests retrieved successfully!");
  } catch (error) {}
  // Using ethers.js
};

// Example usage
// DiamondOperations.setBotAddress("0x28b7b3dc96e5b2C6047D7Ad9b05Fd9E2FC7E8955");
// DiamondOperations.setBPS(100); // 1%
// DiamondOperations.setLiquidityBps(500); // 5%
// DiamondOperations.setFeeVault("0x1FDD717733CDf231C8E7e27def75A849673F9293");
// DiamondOperations.setPythOracle("0xCCd51348cD067adD83747AD7082E557257f7C17d");
// DiamondOperations.liquidateUserRequest(17056);
// DiamondOperations.getAccountdepositedValue();
// DiamondOperations.getUsdValue();
DiamondOperations.getAllRequest();
// DiamondOperations.getServicedRequestIds();
// DiamondOperations.removeCollateralTokens();

//Vault
// VaultOperations.withdrawFees();

//  50388n;
