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
 * git-hosted dependencies (@matterlabs/zksync-telemetry-js over git+ssh) that
 * locked-down CI and sandboxed environments refuse to fetch. As of 2026-08-20
 * they are no longer declared in package.json at all, for that reason: dropping
 * them (together with @chainlink/contracts, which pulled era-contracts the same
 * way) left the install with zero git dependencies and no SSH requirement.
 *
 * Loading them optionally means someone deploying to Base or BNB does not need
 * the zkSync toolchain installed. If they are missing, the Abstract networks
 * below fail at deploy time with a clear plugin error rather than taking down
 * the whole config at require time.
 *
 * The warning is gated on actually asking for an Abstract network. Ungated it
 * fired on every single command — twice, because Hardhat loads the config more
 * than once per run — which is pure noise now that absence is the normal state.
 */
const wantsZkSync = process.argv.some((a) => /^abstract/i.test(a));
try {
  require("@matterlabs/hardhat-zksync");
  require("@matterlabs/hardhat-zksync-upgradable");
} catch {
  if (wantsZkSync) {
    console.warn(
      "[hardhat] zkSync plugins are not installed, and Abstract needs them.\n" +
        "          npm i -D @matterlabs/hardhat-zksync " +
        "@matterlabs/hardhat-zksync-upgradable\n" +
        "          (requires GitHub SSH access for a transitive git dependency)",
    );
  }
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
      /**
       * 16,777,216 (2^24) and not the 30,000,000 this used to be, which is the
       * block limit above rather than a per-transaction one. EIP-7825 caps a
       * single transaction at 2^24 gas, the EDR provider Hardhat now ships
       * enforces it, and a `gas` override is applied to every transaction the
       * test signer sends — so every deploy in every test failed with
       * "Transaction gas limit is 30000000 and exceeds transaction gas cap of
       * 16777216" before the contract under test was even constructed. It broke
       * 31 of the 37 cases in StablecoinSecurity.test.js alone, and it fails in
       * `beforeEach`, so the output blames a hook rather than naming a gas cap.
       *
       * Nothing here needs more: the largest deployment in the repo is
       * KaleidoSwapV3Factory at 24,116 bytes, and code deposit is 200 gas per
       * byte, so even with constructor execution it is a small fraction of the
       * cap. The block limit stays at 30,000,000 — a block may hold several
       * transactions, and lowering it would change how many fit.
       */
      gas: 16777216,
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
      /*
       * publicnode, not rpc.sepolia.org — that host serves a 404 HTML page to
       * eth_chainId (measured 2026-08-25) and has for some time. Nothing in .env
       * overrides SEPOLIA_RPC, so the fallback IS the endpoint every
       * `--network sepolia` run uses, and a dead default means the whole Sepolia
       * deploy path fails at connect. The other four testnet defaults were probed
       * in the same pass and all answer with the right chainId.
       */
      url: rpc("SEPOLIA_RPC", "https://ethereum-sepolia-rpc.publicnode.com"),
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
      /**
       * These three had customChains entries below but no key here, so
       * `hardhat verify` failed on them with "unrecognized network" before the
       * request was ever made. Both explorers are Blockscout, which does not
       * require a key — but hardhat-verify still needs the entry to exist, and
       * it rejects an empty string for a custom chain. The placeholder is what
       * Blockscout instances conventionally accept.
       */
      robinhoodTestnet: process.env.ROBINHOOD_EXPLORER_API_KEY || "blockscout",
      robinhood: process.env.ROBINHOOD_EXPLORER_API_KEY || "blockscout",
      arcTestnet: process.env.ARCSCAN_API_KEY || "blockscout",
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
    /**
     * evmVersion is pinned on every 0.8.x entry below. Left unset, solc picks a
     * default that tracks the compiler version rather than our deploy targets:
     * 0.8.20+ defaults to `shanghai` and emits PUSH0, and 0.8.24 defaults to
     * `cancun` and emits MCOPY/TSTORE. A chain that has not enabled those forks
     * rejects the bytecode outright, and we deploy to two young chains (Robinhood
     * Orbit, Arc) whose fork status we do not control. `paris` predates all three
     * opcodes and runs everywhere, at the cost of two bytes per zero push — see
     * the ProtocolFacet override, which is the only place that cost is close to
     * mattering.
     *
     * The four pre-0.8 compilers need nothing: `paris` did not exist before
     * 0.8.18, and none of them can emit PUSH0 in the first place. Do not add
     * evmVersion to 0.7.6 — any settings change there moves poolInitCodeHash.
     */
    compilers: [
      {
        version: "0.8.9",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          // `paris` is not a valid value for this compiler (added in 0.8.18).
          // `london` is its own default and is equally pre-PUSH0.
          evmVersion: "london",
        },
      },
      {
        version: "0.8.20",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          evmVersion: "paris",
        },
      },
      {
        version: "0.8.24",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          evmVersion: "paris",
        },
      },
      /**
       * The V3 fork. 73 files under contracts/dex-v3 pin `=0.7.6` exactly, so
       * without this entry `compile` fails on every one of them with "No
       * compiler version matched" — nothing in dex-v3 had ever been built in
       * this checkout before 2026-08-20.
       *
       * runs is 200, NOT the 1,000,000 upstream Uniswap V3 uses. That is
       * measured, not preference. At 1,000,000 this fork compiles to bytecode
       * that cannot be deployed to any EVM chain:
       *
       *              runs=1,000,000   runs=200    upstream v3-core @1.0.1
       *   Pool           30,514 ✗      21,797         22,142
       *   Factory        33,419 ✗      24,116         24,535
       *   NFTDescriptor  29,781 ✗      23,336              —
       *
       * against the EIP-170 ceiling of 24,576. Upstream fits at 1,000,000 and we
       * do not, because this fork was mechanically rewritten for solc 0.8's
       * stricter conversion rules and then pinned back to 0.7.6 — TickBitmap
       * carries `int24(int256(uint256(bitPos)))` where upstream has
       * `int24(bitPos)`. Those casts are semantic no-ops here, but at a high run
       * count they inline into ~8KB of redundant codegen. The ABI is identical to
       * upstream's (26 functions, no additions), so there is no extra surface to
       * remove — the run count is the only lever.
       *
       * The cost is real: a lower run count means more gas per swap than
       * upstream. A deployable DEX at higher swap gas beats an undeployable one,
       * and the Factory has only 460 bytes of headroom at runs=200 (it embeds
       * the pool's entire creation code, so it grows whenever the pool does).
       * Do not raise this value without re-running check-contract-sizes.js.
       *
       * metadata.bytecodeHash is "none" to match upstream: it drops the IPFS
       * source hash, which makes the bytecode reproducible across machines and
       * checkout paths. Full-source verification on Etherscan/Blockscout is
       * unaffected.
       *
       * Any change here moves poolInitCodeHash — the keccak of the compiled pool
       * bytecode, hardcoded in PoolAddress.sol and used by the periphery to
       * derive pool addresses via CREATE2. A stale hash does not fail at deploy;
       * it fails at the first swap, when the callback authenticates against a
       * derived address that holds no code. After changing these settings you
       * must re-run scripts/verify-pool-init-hash.js and update both
       * PoolAddress.sol and the registry.
       */
      { version: "0.7.6", settings: { optimizer: { enabled: true, runs: 200 }, metadata: { bytecodeHash: "none" } } },
      { version: "0.5.16", settings: { optimizer: { enabled: true, runs: 200 } } },
      { version: "0.6.6", settings: { optimizer: { enabled: true, runs: 200 } } },
      { version: "0.6.12", settings: { optimizer: { enabled: true, runs: 200 } } },
    ],
    overrides: {
      "@aragon/os/contracts/lib/math/SafeMath.sol": {
        version: "0.4.24",
        settings: { optimizer: { enabled: false } },
      },
      /**
       * Pinned to 0.6.12 — the V2 DEX's own compiler — not 0.5.16. This file
       * declares `pragma solidity >=0.5.0`, so the previous 0.5.16 override was
       * accepted by the pragma and then failed to parse: `receive()` and
       * `fallback()` did not exist before 0.6.0, and the whole compile aborted
       * with "ParserError: Expected identifier but got '('" at line 17. This was
       * the only error in the first compile this checkout has ever run.
       *
       * Not left to default to 0.8.24: nothing here needs checked arithmetic
       * (every mutation is already require-guarded), and keeping WETH9 in the
       * 0.6.x family matches the router and factory it exists to serve.
       */
      "contracts/dex/test/WETH9.sol": {
        version: "0.6.12",
        settings: { optimizer: { enabled: true, runs: 200 } },
      },
      /**
       * NonfungiblePositionManager and NonfungibleTokenPositionDescriptor used to
       * be overridden here to runs=2000, because at the old base of 1,000,000
       * they were over the size limit. With the base now at 200 those overrides
       * were inverted — they *raised* the run count above the compiler entry —
       * and at runs=2000 PositionManager measured 24,434 bytes, 142 from the
       * ceiling. Both now inherit runs=200 like the rest of the 0.7.6 family,
       * which brings PositionManager down to 22,933 bytes (1,643 of headroom),
       * measured from artifacts/ rather than carried over from the old override.
       * The largest 0.7.6 artifact is KaleidoSwapV3Factory at 24,116 (460 spare),
       * so that is the one to re-measure after any change to this family.
       */
      /**
       * ProtocolFacet does not compile without viaIR. It is not close to the
       * line and it is not a new problem: with the settings above, solc 0.8.24
       * aborts codegen with "Stack too deep" inside createLoanListing, which
       * takes six parameters through four modifiers and has not been edited in
       * this repo's history. liquidateUserRequest hit the same wall at three
       * separate points before it was split into
       * _seizeCollateralForLiquidation / _liquidationPenaltySplitUsd /
       * _settleLiquidationProceeds. Chasing the rest of them by hand means
       * rewriting untouched, working code to accommodate a limitation of the
       * legacy code generator, which is the thing viaIR exists to remove.
       *
       * Scoped to this one file rather than added to the 0.8.24 compiler entry
       * so that the stablecoin, staking and DEX contracts keep the codegen
       * their bytecode was last checked under, and so the (substantial) viaIR
       * compile-time cost is paid once rather than on every contract.
       *
       * Size check under these settings: 23,676 bytes against the EIP-170 limit
       * of 24,576 — 900 bytes of headroom, measured from artifacts/ on
       * 2026-08-25 after the four `Protocol__UnexpectedNativeValue` guards,
       * which cost 107 bytes (23,569 without them). The figure recorded here
       * before that was 24,207/369, which had drifted: the facet has since been
       * refactored — `liquidateUserRequest` split into three internals and
       * `repayLoan` reworked — and nothing re-measured. Re-measure rather than
       * carry a number forward; the drift ran in the safe direction this time,
       * but a stale figure is what would let an over-limit facet ship.
       *
       * 900 bytes is still the real constraint on this facet. The config comment
       * previously prescribed moving new surface into a separate facet, and that
       * is still right for anything that does not touch `_appStorage`. Note the
       * trap before trying it for something that does: this facet reads the app
       * storage struct as a *sequential* state variable starting at slot 1
       * (ReentrancyGuard takes slot 0), not through `LibAppStorage.layout()`'s
       * keccak slot. A new facet declaring the same struct without an identical
       * preceding layout would place every field one slot low and read garbage.
       * See the note on `getPythPriceOracle`.
       *
       * NOT applied to 0.7.6: viaIR changes the compiled pool bytecode and
       * therefore poolInitCodeHash. See the note on that compiler entry.
       */
      "contracts/facets/ProtocolFacet.sol": {
        version: "0.8.24",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          viaIR: true,
          evmVersion: "paris",
        },
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
