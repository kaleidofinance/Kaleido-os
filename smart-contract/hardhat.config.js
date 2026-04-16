/**
 * @type import('hardhat/config').HardhatUserConfig
 */

require("@nomicfoundation/hardhat-toolbox");
require("@matterlabs/hardhat-zksync");
require("@matterlabs/hardhat-zksync-upgradable");

module.exports = {
  zksolc: {
    version: "1.5.11",
    compilerSource: "binary",
    settings: {
      optimizer: {
        enabled: true,
        mode: "z",
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
      allowUnlimitedContractSize: true,
      blockGasLimit: 30000000,
      gas: 30000000,
      initialBaseFeePerGas: 0,
    },
    baseTestnet: {
      url: "https://sepolia.base.org",
      chainId: 84532,
      accounts: [
        "9e5345ca0415a07573d5b63737e0126382daceb88286d6947055b3d49270c139",
      ],
      timeout: 120000,
    },
    abstractTestnet: {
      url: "https://api.testnet.abs.xyz",
      ethNetwork: "sepolia",
      zksync: true,
      chainId: 11124,
      accounts: [
        "9e5345ca0415a07573d5b63737e0126382daceb88286d6947055b3d49270c139",
      ],
      timeout: 120000,
      verifyURL: "https://api-sepolia.abscan.org/api",
    },
    abstractMainnet: {
      url: "https://api.mainnet.abs.xyz",
      ethNetwork: "mainnet",
      zksync: true,
      chainId: 2741,
      accounts: [
        "9e5345ca0415a07573d5b63737e0126382daceb88286d6947055b3d49270c139",
      ],
      timeout: 60000,
    },
  },
  etherscan: {
    apiKey: {
      abstractTestnet: "TACK2D1RGYX9U7MC31SZWWQ7FCWRYQ96AD",
      abstractMainnet: "IEYKU3EEM5XCD76N7Y7HF9HG7M9ARZ2H4A",
    },
    customChains: [
      {
        network: "abstractTestnet",
        chainId: 11124,
        urls: {
          apiURL: "https://api-sepolia.abscan.org/api",
          browserURL: "https://sepolia.abscan.org/",
        },
      },
      {
        network: "abstractMainnet",
        chainId: 2741,
        urls: {
          apiURL: "https://api.abscan.org/api",
          browserURL: "https://abscan.org/",
        },
      },
    ],
  },
  solidity: {
    compilers: [
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
        },
      },
      {
        version: "0.8.24",
        settings: {
          optimizer: { enabled: true, runs: 200 },
        },
      },
      {
        version: "0.5.16",
        settings: {
          optimizer: { enabled: true, runs: 200 },
        },
      },
      {
        version: "0.6.6",
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
    ],
    overrides: {
      "@aragon/os/contracts/lib/math/SafeMath.sol": {
        version: "0.4.24",
        settings: { optimizer: { enabled: false } }
      },
      "contracts/KLDStake/Token/stKLD.sol": {
        version: "0.8.9",
        settings: { optimizer: { enabled: true, runs: 200 } }
      },
      "contracts/dex/test/WETH9.sol": {
        version: "0.5.16",
        settings: { optimizer: { enabled: true, runs: 200 } }
      }
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  // Exclude KLDStake contracts from compilation (they have Solidity version conflicts)
  // We only need stablecoin contracts for this deployment
  mocha: {
    timeout: 40000
  },
};
