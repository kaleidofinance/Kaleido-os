/**
 * Curated external pools that have passed a one-time route probe.
 *
 * This is deliberately checked in rather than rebuilt during a page request.
 * The swap router remains live and chooses a fresh executable quote; this
 * registry is only the conservative inventory shown on the liquidity page.
 * Refresh it with an audited provider scan when a new pool is approved.
 */

export interface ExternalPoolRegistryEntry {
  address: string;
  chainId: number;
  exchange: string;
  feeTier: number | null;
  tvlUsd: number | null;
  volume24hUsd: number | null;
  fees24hUsd: number | null;
  tokens: Array<{ address: string; symbol: string }>;
  tokenSymbols: string[];
  /** Provider provenance captured by the audited refresh job. */
  provider?: "kyberswap" | "lifi" | "fly.trade" | "synthra";
  routeProbedAt?: string;
  metricsSource?: string;
  metricsAsOf?: string;
}

/** Last one-time route + pool-metrics scan used to approve this list. */
export const EXTERNAL_POOL_REGISTRY_SCANNED_AT = "2026-11-25T02:00:00.000Z";

export const EXTERNAL_POOL_REGISTRY: readonly ExternalPoolRegistryEntry[] = [
  // Arc mainnet (5042)
  {
    address: "0x82916bee18fcef517b26c72d7cb5f13694e1db41",
    chainId: 5042,
    exchange: "uniswap-v3-arc",
    feeTier: 0.01,
    tvlUsd: 9626044.74,
    volume24hUsd: 17668912.1,
    fees24hUsd: 1766.89,
    tokens: [
      { address: "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0", symbol: "cirBTC" },
      { address: "0x3600000000000000000000000000000000000000", symbol: "USDC" },
    ],
    tokenSymbols: ["cirBTC", "USDC"],
    metricsSource: "GeckoTerminal",
    metricsAsOf: "2026-11-25T02:00:00.000Z",
  },
  {
    address: "0xad5eea00214715cce97cdc4d0d13e9ee2b57eace",
    chainId: 5042,
    exchange: "aero-slipstream-arc",
    feeTier: 0.032,
    tvlUsd: 322602.81,
    volume24hUsd: 821948.87,
    fees24hUsd: 263.02,
    tokens: [
      { address: "0x128cC466B61f542da60c70e3aA11c10e19B84EDB", symbol: "WETH" },
      { address: "0x3600000000000000000000000000000000000000", symbol: "USDC" },
    ],
    tokenSymbols: ["WETH", "USDC"],
    metricsSource: "GeckoTerminal",
    metricsAsOf: "2026-11-25T02:00:00.000Z",
  },
  {
    address: "0x86a68d86465bcf19779454e1b4d31368740503c7",
    chainId: 5042,
    exchange: "aero-slipstream-arc",
    feeTier: 0.024,
    tvlUsd: 180599.13,
    volume24hUsd: 377396.89,
    fees24hUsd: 90.58,
    tokens: [
      { address: "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0", symbol: "cirBTC" },
      { address: "0x3600000000000000000000000000000000000000", symbol: "USDC" },
    ],
    tokenSymbols: ["cirBTC", "USDC"],
    metricsSource: "GeckoTerminal",
    metricsAsOf: "2026-11-25T02:00:00.000Z",
  },
  {
    address: "0x5e4d45a31beab080b73123b07f4757573e69f922",
    chainId: 5042,
    exchange: "aero-slipstream-arc",
    feeTier: 0.057,
    tvlUsd: 81163.26,
    volume24hUsd: 697362.49,
    fees24hUsd: 397.5,
    tokens: [
      { address: "0x128cC466B61f542da60c70e3aA11c10e19B84EDB", symbol: "WETH" },
      { address: "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0", symbol: "cirBTC" },
    ],
    tokenSymbols: ["WETH", "cirBTC"],
    metricsSource: "GeckoTerminal",
    metricsAsOf: "2026-11-25T02:00:00.000Z",
  },
  {
    address: "0x6f302decb49fb30b2d2c609bdd16e04e7dd096fc",
    chainId: 5042,
    exchange: "aero-cl",
    feeTier: 0.05,
    tvlUsd: 72824.7306,
    volume24hUsd: 48877.2336555364,
    fees24hUsd: 24.4386168277682,
    tokens: [
      { address: "0x3600000000000000000000000000000000000000", symbol: "USDC" },
      { address: "0x128cC466B61f542da60c70e3aA11c10e19B84EDB", symbol: "WETH" },
    ],
    tokenSymbols: ["USDC", "WETH"],
  },
  {
    address: "0x6fd5f2fb831940dcd61a98c5b3acb7d8c6f3bfc1",
    chainId: 5042,
    exchange: "uniswap-v3-arc",
    feeTier: 0.05,
    tvlUsd: 29208.53,
    volume24hUsd: 11179.17,
    fees24hUsd: 5.59,
    tokens: [
      { address: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1", symbol: "EURC" },
      { address: "0x3600000000000000000000000000000000000000", symbol: "USDC" },
    ],
    tokenSymbols: ["EURC", "USDC"],
    metricsSource: "GeckoTerminal",
    metricsAsOf: "2026-11-25T02:00:00.000Z",
  },

  // BNB Smart Chain mainnet (56)
  {
    address: "0x172fcd41e0913e95784454622d1c3724f546f849",
    chainId: 56,
    exchange: "pancakeswap-v3-bsc",
    feeTier: 0.01,
    tvlUsd: 8483297.71,
    volume24hUsd: 79815072.05,
    fees24hUsd: 7981.51,
    tokens: [
      { address: "0x55d398326f99059fF775485246999027B3197955", symbol: "USDT" },
      { address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", symbol: "WBNB" },
    ],
    tokenSymbols: ["USDT", "WBNB"],
    metricsSource: "GeckoTerminal",
    metricsAsOf: "2026-11-25T02:00:00.000Z",
  },
  {
    address: "0x1e40450f8e21bb68490d7d91ab422888fb3d60f1",
    chainId: 56,
    exchange: "nomiswap-stable",
    feeTier: 0.01,
    tvlUsd: 834822.2284,
    volume24hUsd: 498313.67512146,
    fees24hUsd: 49.83,
    tokens: [
      { address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", symbol: "USDC" },
      { address: "0x55d398326f99059fF775485246999027B3197955", symbol: "USDT" },
    ],
    tokenSymbols: ["USDC", "USDT"],
  },
  {
    address:
      "0xd37aa0f0d66ad670279f6b89325c88bdff17d0265144762fb01f54fca9779944",
    chainId: 56,
    exchange: "pancake-infinity-cl",
    feeTier: 0.007,
    tvlUsd: 425357.3454,
    volume24hUsd: 1476800.57696392,
    fees24hUsd: 103.3760403874744,
    tokens: [
      { address: "0x55d398326f99059fF775485246999027B3197955", symbol: "USDT" },
      { address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", symbol: "WBNB" },
    ],
    tokenSymbols: ["USDT", "WBNB"],
  },
  {
    address: "0xa830f3a087c9a642694f6eea98778e1c70097754",
    chainId: 56,
    exchange: "nomiswap",
    feeTier: 0.1,
    tvlUsd: 24051.8561,
    volume24hUsd: 616.8520758552,
    fees24hUsd: 0.62,
    tokens: [
      { address: "0x55d398326f99059fF775485246999027B3197955", symbol: "USDT" },
      { address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", symbol: "BTCB" },
    ],
    tokenSymbols: ["USDT", "BTCB"],
  },
  {
    address:
      "0x8749eb67c0de8c788fb736139c2363e0b57e7c29e107b470895df2146acf4b56",
    chainId: 56,
    exchange: "pancake-infinity-cl",
    feeTier: 0.01,
    tvlUsd: 15188.2076,
    volume24hUsd: 23442.5238440658,
    fees24hUsd: 2.34,
    tokens: [
      { address: "0x55d398326f99059fF775485246999027B3197955", symbol: "USDT" },
      { address: "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d", symbol: "USD1" },
    ],
    tokenSymbols: ["USDT", "USD1"],
  },

  // Base mainnet (8453)
  {
    address: "0xec3c3755b9ded4a2960ef50c9b48c1694ce274c2",
    chainId: 8453,
    exchange: "aero-slipstream-base",
    feeTier: 0.038,
    tvlUsd: 4793107.97,
    volume24hUsd: 171614887.92,
    fees24hUsd: 65213.66,
    tokens: [
      { address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", symbol: "cbBTC" },
      { address: "0x4200000000000000000000000000000000000006", symbol: "WETH" },
    ],
    tokenSymbols: ["cbBTC", "WETH"],
    metricsSource: "GeckoTerminal",
    metricsAsOf: "2026-11-25T02:00:00.000Z",
  },
  {
    address: "0x72ab388e2e2f6facef59e3c3fa2c4e29011c2d38",
    chainId: 8453,
    exchange: "pancakeswap-v3-base",
    feeTier: 0.01,
    tvlUsd: 2892194.11,
    volume24hUsd: 29477304.89,
    fees24hUsd: 2947.73,
    tokens: [
      { address: "0x4200000000000000000000000000000000000006", symbol: "WETH" },
      { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC" },
    ],
    tokenSymbols: ["WETH", "USDC"],
    metricsSource: "GeckoTerminal",
    metricsAsOf: "2026-11-25T02:00:00.000Z",
  },
  {
    address: "0xb94b22332abf5f89877a14cc88f2abc48c34b3df",
    chainId: 8453,
    exchange: "pancakeswap-v3-base",
    feeTier: 0.01,
    tvlUsd: 1099884.56,
    volume24hUsd: 5975836.62,
    fees24hUsd: 597.58,
    tokens: [
      { address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", symbol: "cbBTC" },
      { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC" },
    ],
    tokenSymbols: ["cbBTC", "USDC"],
    metricsSource: "GeckoTerminal",
    metricsAsOf: "2026-11-25T02:00:00.000Z",
  },
  {
    address: "0xb4cb800910b228ed3d0834cf79d697127bbb00e5",
    chainId: 8453,
    exchange: "uniswap-v3-base",
    feeTier: 0.01,
    tvlUsd: 560047.45,
    volume24hUsd: 13539168.27,
    fees24hUsd: 1353.92,
    tokens: [
      { address: "0x4200000000000000000000000000000000000006", symbol: "WETH" },
      { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC" },
    ],
    tokenSymbols: ["WETH", "USDC"],
    metricsSource: "GeckoTerminal",
    metricsAsOf: "2026-11-25T02:00:00.000Z",
  },

  // Elysium mainnet (99901)
  {
    address: "0x97796d80b6a1db78632f7451196b04f307329eb6",
    chainId: 99901,
    exchange: "aero-cl",
    feeTier: 0.085,
    tvlUsd: 498533.44,
    volume24hUsd: 1841018.49,
    fees24hUsd: 1564.87,
    tokens: [
      { address: "0xbA876237B0F021A6c6D852d6c26E107997cC5E81", symbol: "WHYPE" },
      { address: "0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65", symbol: "USDC" },
    ],
    tokenSymbols: ["WHYPE", "USDC"],
    provider: "kyberswap",
    routeProbedAt: "2026-11-25T02:00:00.000Z",
    metricsSource: "GeckoTerminal",
    metricsAsOf: "2026-11-25T02:00:00.000Z",
  },
  {
    // Uniswap v4 exposes a bytes32 PoolId rather than a pair contract address.
    address:
      "0x7bc032d75b742560db1a08dad3599623e39beae42856b592e132c0b498a62752",
    chainId: 99901,
    exchange: "uniswap-v4-elysium",
    feeTier: 0.05,
    tvlUsd: 413710.31,
    volume24hUsd: 515257.73,
    fees24hUsd: 257.63,
    tokens: [
      { address: "0xbA876237B0F021A6c6D852d6c26E107997cC5E81", symbol: "WHYPE" },
      { address: "0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65", symbol: "USDC" },
    ],
    tokenSymbols: ["WHYPE", "USDC"],
    provider: "kyberswap",
    routeProbedAt: "2026-11-25T02:00:00.000Z",
    metricsSource: "GeckoTerminal",
    metricsAsOf: "2026-11-25T02:00:00.000Z",
  },
  {
    address: "0xd329b88ba62483918c3f6c9421178345cf9eebc2",
    chainId: 99901,
    exchange: "ramses-v3-elysium",
    feeTier: 0.13,
    tvlUsd: 233168.25,
    volume24hUsd: 365651.49,
    fees24hUsd: 475.35,
    tokens: [
      { address: "0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65", symbol: "USDC" },
      { address: "0xbA876237B0F021A6c6D852d6c26E107997cC5E81", symbol: "WHYPE" },
    ],
    tokenSymbols: ["USDC", "WHYPE"],
    provider: "kyberswap",
    routeProbedAt: "2026-11-25T02:00:00.000Z",
    metricsSource: "GeckoTerminal",
    metricsAsOf: "2026-11-25T02:00:00.000Z",
  },
  {
    address: "0xde07161f99a7c01c56f602e73f31918cbdac9bbc",
    chainId: 99901,
    exchange: "ramses-v3",
    feeTier: 0.13,
    tvlUsd: 193125.3845,
    volume24hUsd: 293487.294785442,
    fees24hUsd: 381.53,
    tokens: [
      { address: "0xbA876237B0F021A6c6D852d6c26E107997cC5E81", symbol: "WHYPE" },
      { address: "0xe45a355d9e9cAd2aD85F2d03E3eE3102A036acF0", symbol: "KNTQ" },
    ],
    tokenSymbols: ["WHYPE", "KNTQ"],
    provider: "kyberswap",
    routeProbedAt: "2026-11-11T23:41:45.000Z",
    metricsSource: "GeckoTerminal",
    metricsAsOf: "2026-11-11T23:41:45.000Z",
  },
  {
    // Uniswap v4 exposes a bytes32 PoolId rather than a pair contract address.
    // GeckoTerminal accepts that PoolId for metrics, so keep it as-is and do
    // not truncate it into an explorer address.
    address:
      "0xf9b8a9101438145d62c9f03156b203c6c573931167e2d36f9061a32575706c8a",
    chainId: 99901,
    exchange: "uniswap-v4",
    feeTier: 0.05,
    tvlUsd: 150732.7348,
    volume24hUsd: 1530920.47058748,
    fees24hUsd: 765.46,
    tokens: [
      { address: "0xbA876237B0F021A6c6D852d6c26E107997cC5E81", symbol: "WHYPE" },
      { address: "0xe45a355d9e9cAd2aD85F2d03E3eE3102A036acF0", symbol: "KNTQ" },
    ],
    tokenSymbols: ["WHYPE", "KNTQ"],
    provider: "kyberswap",
    routeProbedAt: "2026-11-11T23:41:45.000Z",
    metricsSource: "GeckoTerminal",
    metricsAsOf: "2026-11-11T23:41:45.000Z",
  },

  // Robinhood Chain mainnet (4663)
  {
    address: "0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca",
    chainId: 4663,
    exchange: "uniswap-v3-robinhood",
    feeTier: 0.01,
    tvlUsd: 9546406.89,
    volume24hUsd: 151913015.69,
    fees24hUsd: 15191.3,
    tokens: [
      { address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", symbol: "USDG" },
      { address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", symbol: "WETH" },
    ],
    tokenSymbols: ["USDG", "WETH"],
    metricsSource: "GeckoTerminal",
    metricsAsOf: "2026-11-25T02:00:00.000Z",
  },
  {
    address: "0xd4eb21209c4d6093f80b5b84f5c45cc093ea14a3",
    chainId: 4663,
    exchange: "uniswap-v3-robinhood",
    feeTier: 0.05,
    tvlUsd: 1940831.3,
    volume24hUsd: 9731393.03,
    fees24hUsd: 4865.7,
    tokens: [
      { address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", symbol: "NVDA" },
      { address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", symbol: "USDG" },
    ],
    tokenSymbols: ["NVDA", "USDG"],
    metricsSource: "GeckoTerminal",
    metricsAsOf: "2026-11-25T02:00:00.000Z",
  },
  {
    address: "0x62ab521f71431f78ac374cdbadc6cda3c8916b6c",
    chainId: 4663,
    exchange: "uniswap-v3-robinhood",
    feeTier: 0.05,
    tvlUsd: 1312425.71,
    volume24hUsd: 7539107.72,
    fees24hUsd: 3769.55,
    tokens: [
      { address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", symbol: "NVDA" },
      { address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", symbol: "WETH" },
    ],
    tokenSymbols: ["NVDA", "WETH"],
    metricsSource: "GeckoTerminal",
    metricsAsOf: "2026-11-25T02:00:00.000Z",
  },
  {
    address: "0x7615926023bb149f36095645c2a81dc367d39750",
    chainId: 4663,
    exchange: "aero-slipstream-robinhood",
    feeTier: 0.18,
    tvlUsd: 1162029.06,
    volume24hUsd: 66976611.53,
    fees24hUsd: 120557.9,
    tokens: [
      { address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", symbol: "WETH" },
      { address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", symbol: "USDG" },
    ],
    tokenSymbols: ["WETH", "USDG"],
    metricsSource: "GeckoTerminal",
    metricsAsOf: "2026-11-25T02:00:00.000Z",
  },
  {
    address: "0xfae65eaa11943f45e83d5b45dc7a7c801c51bfb0",
    chainId: 4663,
    exchange: "ramses-v3-robinhood",
    feeTier: 0.01,
    tvlUsd: 478422.25,
    volume24hUsd: 2305683.12,
    fees24hUsd: 230.57,
    tokens: [
      { address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", symbol: "WETH" },
      { address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", symbol: "USDG" },
    ],
    tokenSymbols: ["WETH", "USDG"],
    metricsSource: "GeckoTerminal",
    metricsAsOf: "2026-11-25T02:00:00.000Z",
  },
  {
    address:
      "0x8068ab043efd411b87506c41be1add38faaf18c0af0016c663ca92feff0b8159",
    chainId: 4663,
    exchange: "orvex-cl-feemanager",
    feeTier: 0.05,
    tvlUsd: null,
    volume24hUsd: 4553.6189605349,
    fees24hUsd: 2.28,
    tokens: [
      { address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", symbol: "USDG" },
      { address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", symbol: "WETH" },
    ],
    tokenSymbols: ["USDG", "WETH"],
  },
] as const;
