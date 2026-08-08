/**
 * @type import('hardhat/config').HardhatUserConfig
 *
 * Credentials come from the environment. Nothing secret belongs in this file:
 * the previous version hardcoded a deployer private key and two block-explorer
 * API keys, and because it is committed they are permanently public. Those keys
 * must never be reused — generate a fresh deployer offline for mainnet.
 *
 * Copy .env.example to .env (already gitignored) before deploying.
 */

require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

/**
 * zkSync plugins are needed only for Abstract — every other target is plain
 * EVM and compiles with solc. They are loaded optionally because they pull
 * git-hosted dependencies (@matterlabs/zksync-telemetry-js, and transitively
 * @zksync/contracts over git+ssh) that locked-down CI and sandboxed
 * environments refuse to fetch.
 *
 * Loading them optionally means someone deploying to Base or BNB does not need
 * the zkSync toolchain installed at all. If they are missing, the Abstract
 * networks below will fail at deploy time with a clear plugin error rather than
 * taking down the whole config at require time.
 */
try {
  require("@matterlabs/hardhat-zksync");
  require("@matterlabs/hardhat-zksync-upgradable");
} catch {
  console.warn(
    "[hardhat] zkSync plugins unavailable — EVM targets still work; " +
      "Abstract (abstractMainnet/abstractTestnet) requires them.",
  );
}

/**
 * Deployer accounts for a network.
 *
 * Returns an empty list when no key is configured so that `compile`, `test` and
 * every read-only task still work without credentials present. Deploying
 * without a key fails at that point, which is the correct moment to find out.
 */
const accounts = () => {
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!key) return [];
  return [key.startsWith("0x") ? key : `0x${key}`];
};

/** Per-chain RPC override, falling back to a public endpoint. */
const rpc = (envVar, fallback) => process.env[envVar] || fallback;

module.exports = {
  zksolc: {
    version: "1.5.11",
    compilerSource: "binary",
    settings: {
      optimizer: { enabled: true, mode: "z" },
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

    // --- Abstract (zkSync stack — compiled with zksolc, hence zksync: true) ---
    abstractTestnet: {
      url: rpc("ABSTRACT_TESTNET_RPC", "https://api.testnet.abs.xyz"),
      ethNetwork: "sepolia",
      zksync: true,
      chainId: 11124,
      accounts: accounts(),
      timeout: 120000,
      verifyURL: "https://api-sepolia.abscan.org/api",
    },
    abstractMainnet: {
      url: rpc("ABSTRACT_MAINNET_RPC", "https://api.mainnet.abs.xyz"),
      ethNetwork: "mainnet",
      zksync: true,
      chainId: 2741,
      accounts: accounts(),
      timeout: 120000,
      verifyURL: "https://api.abscan.org/api",
    },

    // --- Ethereum ---
    sepolia: {
      url: rpc("SEPOLIA_RPC", "https://rpc.sepolia.org"),
      chainId: 11155111,
      accounts: accounts(),
      timeout: 120000,
    },
    ethereum: {
      url: rpc("ETHEREUM_RPC", "https://eth.merkle.io"),
      chainId: 1,
      accounts: accounts(),
      timeout: 120000,
    },

    // --- Base ---
    baseTestnet: {
      url: rpc("BASE_SEPOLIA_RPC", "https://sepolia.base.org"),
      chainId: 84532,
      accounts: accounts(),
      timeout: 120000,
    },
    base: {
      url: rpc("BASE_RPC", "https://mainnet.base.org"),
      chainId: 8453,
      accounts: accounts(),
      timeout: 120000,
    },

    // --- BNB Smart Chain ---
    bscTestnet: {
      url: rpc("BSC_TESTNET_RPC", "https://data-seed-prebsc-1-s1.bnbchain.org:8545"),
      chainId: 97,
      accounts: accounts(),
      timeout: 120000,
    },
    bsc: {
      url: rpc("BSC_RPC", "https://bsc-dataseed.bnbchain.org"),
      chainId: 56,
      accounts: accounts(),
      timeout: 120000,
    },

    // --- Robinhood Chain (Arbitrum Orbit L2) ---
    robinhoodTestnet: {
      url: rpc("ROBINHOOD_TESTNET_RPC", "https://rpc.testnet.chain.robinhood.com"),
      chainId: 46630,
      accounts: accounts(),
      timeout: 120000,
    },
    robinhood: {
      url: rpc("ROBINHOOD_RPC", "https://rpc.mainnet.chain.robinhood.com"),
      chainId: 4663,
      accounts: accounts(),
      timeout: 120000,
    },

    // --- Arc (Circle). Testnet only: mainnet has not launched. ---
    arcTestnet: {
      url: rpc("ARC_TESTNET_RPC", "https://rpc.testnet.arc.network"),
      chainId: 5042002,
      accounts: accounts(),
      timeout: 120000,
    },
  },

  etherscan: {
    apiKey: {
      abstractTestnet: process.env.ABSCAN_API_KEY || "",
      abstractMainnet: process.env.ABSCAN_API_KEY || "",
      sepolia: process.env.ETHERSCAN_API_KEY || "",
      mainnet: process.env.ETHERSCAN_API_KEY || "",
      baseTestnet: process.env.BASESCAN_API_KEY || "",
      base: process.env.BASESCAN_API_KEY || "",
      bscTestnet: process.env.BSCSCAN_API_KEY || "",
      bsc: process.env.BSCSCAN_API_KEY || "",
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
      {
        network: "baseTestnet",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org/",
        },
      },
      {
        network: "robinhoodTestnet",
        chainId: 46630,
        urls: {
          apiURL: "https://explorer.testnet.chain.robinhood.com/api",
          browserURL: "https://explorer.testnet.chain.robinhood.com/",
        },
      },
      {
        network: "robinhood",
        chainId: 4663,
        urls: {
          apiURL: "https://robinhoodchain.blockscout.com/api",
          browserURL: "https://robinhoodchain.blockscout.com/",
        },
      },
      {
        network: "arcTestnet",
        chainId: 5042002,
        urls: {
          apiURL: "https://testnet.arcscan.app/api",
          browserURL: "https://testnet.arcscan.app/",
        },
      },
    ],
  },

  solidity: {
    compilers: [
      { version: "0.8.9", settings: { optimizer: { enabled: true, runs: 200 } } },
      { version: "0.8.20", settings: { optimizer: { enabled: true, runs: 200 } } },
      { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 } } },
      /**
       * The V3 fork. 73 files under contracts/dex-v3 pin `=0.7.6` exactly, so
       * without this entry `compile` fails on every one of them with "No
       * compiler version matched" — nothing in dex-v3 has ever been built in
       * this checkout.
       *
       * runs is 1,000,000 to match upstream Uniswap V3. This is not cosmetic:
       * poolInitCodeHash in src/constants/registry.ts is the keccak of the
       * compiled pool bytecode, so changing the optimizer settings changes the
       * hash, and a stale hash does not fail at deploy — it fails at the first
       * swap, when the callback authenticates against a derived address that
       * holds no code. Change these settings and you must re-run
       * scripts/verify-pool-init-hash.js and update the registry.
       */
      { version: "0.7.6", settings: { optimizer: { enabled: true, runs: 1000000 } } },
      { version: "0.5.16", settings: { optimizer: { enabled: true, runs: 200 } } },
      { version: "0.6.6", settings: { optimizer: { enabled: true, runs: 200 } } },
      { version: "0.6.12", settings: { optimizer: { enabled: true, runs: 200 } } },
    ],
    overrides: {
      "@aragon/os/contracts/lib/math/SafeMath.sol": {
        version: "0.4.24",
        settings: { optimizer: { enabled: false } },
      },
      "contracts/KLDStake/Token/stKLD.sol": {
        version: "0.8.9",
        settings: { optimizer: { enabled: true, runs: 200 } },
      },
      "contracts/dex/test/WETH9.sol": {
        version: "0.5.16",
        settings: { optimizer: { enabled: true, runs: 200 } },
      },
      /**
       * These two exceed the 24,576-byte contract size limit at runs=1,000,000.
       * Upstream Uniswap periphery compiles them at a low run count for exactly
       * this reason. Neither is the pool, so lowering runs here does not affect
       * poolInitCodeHash.
       */
      "contracts/dex-v3/periphery/NonfungiblePositionManager.sol": {
        version: "0.7.6",
        settings: { optimizer: { enabled: true, runs: 2000 } },
      },
      "contracts/dex-v3/periphery/NonfungibleTokenPositionDescriptor.sol": {
        version: "0.7.6",
        settings: { optimizer: { enabled: true, runs: 2000 } },
      },
    },
  },

  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },

  mocha: { timeout: 40000 },
};
