require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");
require("@matterlabs/hardhat-zksync");
require("@matterlabs/hardhat-zksync-upgradable");

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  zksolc: {
    version: "1.5.15",
    compilerSource: "binary",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      enableEraVMExtensions: true,
      codegen: "yul",
    },
  },

  defaultNetwork: "hardhat",
  networks: {
    hardhat: {
      chainId: 31337,
      zksync: false,
    },
    abstractTestnet: {
      url: "https://api.testnet.abs.xyz",
      ethNetwork: "sepolia",
      zksync: true,
      chainId: 11124,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      timeout: 120000,
    },
    base: {
      url: "https://mainnet.base.org",
      zksync: false,
      chainId: 8453,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    arbitrum: {
      url: "https://arb1.arbitrum.io/rpc",
      zksync: false,
      chainId: 42161,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    hyperliquid: {
      url: "https://rpc.hyperliquid.xyz/evm", // Placeholder for HL EVM
      zksync: false,
      chainId: 999, // Placeholder
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    }
  },
  
  // Scoped paths for DEX (V2 + V3)
  paths: {
    sources: "./contracts", 
    tests: "./test",
    cache: "./cache-dex",
    artifacts: "./artifacts-dex"
  },

  solidity: {
    compilers: [
      {
        version: "0.4.24",
        settings: {
          optimizer: { enabled: true, runs: 200 },
        },
      },
      {
        version: "0.6.12",
        settings: {
          optimizer: { enabled: true, runs: 200 },
        },
      },
      {
        version: "0.7.6",
        settings: {
          optimizer: { enabled: true, runs: 200 },
        },
      },
      {
        version: "0.8.9",
        settings: {
          optimizer: { enabled: true, runs: 200 },
        },
      },
      {
        version: "0.8.20",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          viaIR: true,
        },
      },
    ],
    overrides: {
      "contracts/dex/test/WETH9.sol": {
        version: "0.6.12",
        settings: { optimizer: { enabled: true, runs: 200 } }
      }
    }
  },
};
