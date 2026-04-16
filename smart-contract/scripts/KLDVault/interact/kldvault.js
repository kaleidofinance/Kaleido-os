import { ethers } from "ethers";
import { ErrorDecoder } from "ethers-decode-error";
import * as dotenv from "dotenv";
import { kldVaultAbi } from "../../abi/KLDVault.js";
import { faucetAbi } from "../../abi/Faucet.js";
import { erc20Abi } from "../../abi/erc20Abi.js";
import { Contract } from "ethers";
import { Transaction } from "ethers";
dotenv.config();

// Error decoder setup (at the bottom of the file)
const errorDecoder = ErrorDecoder.create([kldVaultAbi]);
// 9e5345ca0415a07573d5b63737e0126382daceb88286d6947055b3d49270c139
//afb9e31102b0df2ddd451adba1fcc0dfdad8f7f806f0a7bb92ec1e6a89d9fba7
// 40eda24dde12f9f97a31022da6e3346b775827487afe41cec661d38802c1f3dc
//a96cf3e619b973a9363056efb395c5ffed7d8e0577d0550ab81ea690e704837d
const CONSTANTS = {
  PRIVATE_KEY:
    "9e5345ca0415a07573d5b63737e0126382daceb88286d6947055b3d49270c139",
  KLD_VAULT_ADDRESS: "0xb6fb7fd04eCF2723f8a5659134a145Bd7fE68748",
  kLD_TOKEN_ADDRESS: "0x0c61dbCF1e8DdFF0E237a256257260fDF6934505",
  stKLD_TOKEN_ADDRESS: "0x3FB832980638036e81231931cbD48F95A7746d41",
  RPC_URL: "https://api.testnet.abs.xyz",
  AMOUNT: 10000000,
};

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

// Constants

const KldVaultOperations = {
  async deposit() {
    try {
      const { signer } = getProviderAndSigner();
      const contract = new ethers.Contract(
        CONSTANTS.KLD_VAULT_ADDRESS,
        kldVaultAbi,
        signer,
      );
      const KldTokenContract = new ethers.Contract(
        CONSTANTS.kLD_TOKEN_ADDRESS,
        erc20Abi,
        signer,
      );

      // Approve vault to spend tokens
      const approveTx = await KldTokenContract.approve(
        CONSTANTS.KLD_VAULT_ADDRESS,
        ethers.parseUnits("100000", 18),
      );
      await approveTx.wait();

      console.log("Amount Approved:", approveTx.hash);

      // Deposit tokens
      const depositTx = await contract.deposit(
        CONSTANTS.kLD_TOKEN_ADDRESS,
        CONSTANTS.stKLD_TOKEN_ADDRESS,

        ethers.parseUnits("100", 18),
      );
      const receipt = await depositTx.wait();
      console.log("Successfully deposited:", receipt);
    } catch (error) {
      handleError(error, errorDecoder);
    }
  },

  async setSupportedToken() {
    try {
      const { signer } = getProviderAndSigner();
      const contract = new ethers.Contract(
        CONSTANTS.KLD_VAULT_ADDRESS,
        kldVaultAbi,
        signer,
      );

      const transaction = await contract.setSupportedToken(
        CONSTANTS.kLD_TOKEN_ADDRESS,
        // CONSTANTS.stKLD_TOKEN_ADDRESS,
      );
      console.log("Token set!!:", transaction.hash);
    } catch (error) {
      handleError(error, errorDecoder);
    }
  },

  async getTotalShares() {
    try {
      const { signer } = getProviderAndSigner();
      const contract = new ethers.Contract(
        CONSTANTS.KLD_VAULT_ADDRESS,
        kldVaultAbi,
        signer,
      );
      const totalShare = await contract.getTotalShares(
        CONSTANTS.stKLD_TOKEN_ADDRESS,
      );
      // CONSTANTS.stKLD_TOKEN_ADDRESS,
      console.log("TotalShares is:", totalShare);
    } catch (error) {
      handleError(error, errorDecoder);
    }
  },

  async getTotalPooledKld() {
    try {
      const { signer } = getProviderAndSigner();
      const contract = new ethers.Contract(
        CONSTANTS.KLD_VAULT_ADDRESS,
        kldVaultAbi,
        signer,
      );
      const totalPooledKld = await contract.getTotalPooledKld(
        CONSTANTS.kLD_TOKEN_ADDRESS,
        // CONSTANTS.stKLD_TOKEN_ADDRESS,
      );
      console.log("totalPooledKld is:", totalPooledKld);
    } catch (error) {
      handleError(error, errorDecoder);
    }
  },

  async compoundRewards() {
    try {
      const { signer } = getProviderAndSigner();
      const contract = new ethers.Contract(
        CONSTANTS.KLD_VAULT_ADDRESS,
        kldVaultAbi,
        signer,
      );
      const KldTokenContract = new ethers.Contract(
        CONSTANTS.kLD_TOKEN_ADDRESS,
        erc20Abi,
        signer,
      );

      // Approve vault to spend tokens
      const approveTx = await KldTokenContract.approve(
        CONSTANTS.KLD_VAULT_ADDRESS,
        ethers.parseUnits("20000", 18),
      );
      await approveTx.wait();
      const tx = await contract.compoundRewards(
        CONSTANTS.kLD_TOKEN_ADDRESS,
        ethers.parseUnits("20000", 18),
      );
      const receipt = await tx.wait();
      console.log("Reward Compounded confirmed in block:", receipt.blockNumber);
    } catch (error) {
      handleError(error, errorDecoder);
    }
  },

  async withdraw() {
    try {
      const { signer } = getProviderAndSigner();
      const contract = new ethers.Contract(
        CONSTANTS.KLD_VAULT_ADDRESS,
        kldVaultAbi,
        signer,
      );
      const transaction = await contract.withdraw(
        CONSTANTS.kLD_TOKEN_ADDRESS,
        CONSTANTS.stKLD_TOKEN_ADDRESS,

        ethers.parseUnits("120", 18),
      );
      console.log("KLD Successfully claimed:", transaction);
    } catch (error) {
      handleError(error, errorDecoder);
    }
  },

  async getUserDeposit() {
    try {
      const { signer } = getProviderAndSigner();
      const contract = new ethers.Contract(
        CONSTANTS.KLD_VAULT_ADDRESS,
        kldVaultAbi,
        signer,
      );
      const klddeposit = await contract.getUserDeposit(
        "0xB3988b8a447C154112D7D58119eB4f5Ec2193669",
        CONSTANTS.stKLD_TOKEN_ADDRESS,
      );
      console.log("User Deposited KLD:", klddeposit);
    } catch (error) {
      handleError(error, errorDecoder);
    }
  },

  async pause() {
    try {
      const { signer } = getProviderAndSigner();
      const contract = new ethers.Contract(
        CONSTANTS.KLD_VAULT_ADDRESS,
        kldVaultAbi,
        signer,
      );
      const transaction = await contract.pause();
      console.log("KLDVault Succesfully Paused:", transaction);
    } catch (error) {
      handleError(error, errorDecoder);
    }
  },

  async unPause() {
    try {
      const { signer } = getProviderAndSigner();
      const contract = new ethers.Contract(
        CONSTANTS.KLD_VAULT_ADDRESS,
        kldVaultAbi,
        signer,
      );
      const transaction = await contract.unpause();
      console.log("KLDVault Succesfully UnPaused:", transaction);
    } catch (error) {
      handleError(error, errorDecoder);
    }
  },

  async requestWithdrawal() {
    try {
      const { signer } = getProviderAndSigner();
      const contract = new ethers.Contract(
        CONSTANTS.KLD_VAULT_ADDRESS,
        kldVaultAbi,
        signer,
      );
      const transaction = await contract.requestWithdrawal(
        CONSTANTS.stKLD_TOKEN_ADDRESS,
      );
      console.log("Withdrawal Request Submitted Successfully:", transaction);
    } catch (error) {
      handleError(error, errorDecoder);
    }
  },

  async setCooldownTime() {
    try {
      const { signer } = getProviderAndSigner();
      const contract = new ethers.Contract(
        "0xC99eddf1f7C9250728A47978732928aE158396E7",
        faucetAbi,
        signer,
      );
      const transaction = await contract.setCooldown(36000);
      console.log("CoolDown Time period correctly set", transaction);
    } catch (error) {
      handleError(error, errorDecoder);
    }
  },

  async getCooldownTime() {
    try {
      const { signer } = getProviderAndSigner();
      const contract = new ethers.Contract(
        "0xC99eddf1f7C9250728A47978732928aE158396E7",
        faucetAbi,
        signer,
      );
      const res = await contract.COOLDOWN();
      console.log("The cooldownTime", res);
    } catch (error) {
      handleError(error, errorDecoder);
    }
  },
};

// KldVaultOperations.getUserDeposit();
// KldVaultOperations.deposit();
// KldVaultOperations.requestWithdrawal();
// KldVaultOperations.withdraw();
// KldVaultOperations.getTotalPooledKld();
// KldVaultOperations.getTotalShares();
KldVaultOperations.compoundRewards();
// KldVaultOperations.setSupportedToken();
// KldVaultOperations.pause();
// KldVaultOperations.unPause();
// KldVaultOperations.setCooldownTime();
// KldVaultOperations.getCooldownTime();
