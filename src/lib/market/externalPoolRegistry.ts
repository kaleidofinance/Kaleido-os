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
  provider?: "kyberswap" | "lifi" | "fly.trade";
  routeProbedAt?: string;
  metricsSource?: string;
  metricsAsOf?: string;
}

/** Last one-time Kyber route + pool-metrics scan used to approve this list. */
export const EXTERNAL_POOL_REGISTRY_SCANNED_AT = "2026-11-11T23:41:45.000Z";

export const EXTERNAL_POOL_REGISTRY: readonly ExternalPoolRegistryEntry[] = [
  // Arc mainnet
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
  // BNB Smart Chain mainnet
  {
    address: "0x1e40450f8e21bb68490d7d91ab422888fb3d60f1",
    chainId: 56,
    exchange: "nomiswap-stable",
    feeTier: null,
    tvlUsd: 834822.2284,
    volume24hUsd: 498313.67512146,
    fees24hUsd: null,
    tokens: [
      { address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", symbol: "USDC" },
      { address: "0x55d398326f99059fF775485246999027B3197955", symbol: "USDT" },
    ],
    tokenSymbols: ["USDC", "USDT"],
  },
  {
    address:
      "0x8749eb67c0de8c788fb736139c2363e0b57e7c29e107b470895df2146acf4b56",
    chainId: 56,
    exchange: "pancake-infinity-cl",
    feeTier: null,
    tvlUsd: 15188.2076,
    volume24hUsd: 23442.5238440658,
    fees24hUsd: null,
    tokens: [
      { address: "0x55d398326f99059fF775485246999027B3197955", symbol: "USDT" },
      { address: "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d", symbol: "USD1" },
    ],
    tokenSymbols: ["USDT", "USD1"],
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
    feeTier: null,
    tvlUsd: 24051.8561,
    volume24hUsd: 616.8520758552,
    fees24hUsd: null,
    tokens: [
      { address: "0x55d398326f99059fF775485246999027B3197955", symbol: "USDT" },
      { address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", symbol: "BTCB" },
    ],
    tokenSymbols: ["USDT", "BTCB"],
  },

  // Elysium mainnet. Both pools passed an executable Kyber route probe and a
  // dated GeckoTerminal reserve/volume check on the same review run.
  {
    address: "0x97796d80b6a1db78632f7451196b04f307329eb6",
    chainId: 99901,
    exchange: "aero-cl",
    feeTier: null,
    tvlUsd: 728625.0399,
    volume24hUsd: 4726191.82095473,
    fees24hUsd: null,
    tokens: [
      { address: "0xbA876237B0F021A6c6D852d6c26E107997cC5E81", symbol: "WHYPE" },
      { address: "0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65", symbol: "USDC" },
    ],
    tokenSymbols: ["WHYPE", "USDC"],
    provider: "kyberswap",
    routeProbedAt: "2026-11-11T23:41:44.000Z",
    metricsSource: "GeckoTerminal",
    metricsAsOf: "2026-11-11T23:41:44.000Z",
  },
  {
    address: "0xde07161f99a7c01c56f602e73f31918cbdac9bbc",
    chainId: 99901,
    exchange: "ramses-v3",
    feeTier: null,
    tvlUsd: 193125.3845,
    volume24hUsd: 293487.294785442,
    fees24hUsd: null,
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
    feeTier: null,
    tvlUsd: 150732.7348,
    volume24hUsd: 1530920.47058748,
    fees24hUsd: null,
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

  // Robinhood Chain mainnet. GeckoTerminal has no reserve for this pool, but
  // the route probe returned a positive USDG/WETH quote, so it stays visible
  // with unknown TVL rather than being presented as a measured reserve.
  {
    address:
      "0x8068ab043efd411b87506c41be1add38faaf18c0af0016c663ca92feff0b8159",
    chainId: 4663,
    exchange: "orvex-cl-feemanager",
    feeTier: null,
    tvlUsd: null,
    volume24hUsd: 4553.6189605349,
    fees24hUsd: null,
    tokens: [
      { address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", symbol: "USDG" },
      { address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", symbol: "WETH" },
    ],
    tokenSymbols: ["USDG", "WETH"],
  },
] as const;
