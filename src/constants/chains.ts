/**
 * Canonical cross-chain registry. Single source of truth for chain IDs, RPCs,
 * explorers and icon lookups — verified against viem/chains (already a repo
 * dependency) and each chain's own docs, not invented.
 *
 * NOTHING IS DEPLOYED ANYWHERE TODAY. The contracts were rewritten and are
 * being redeployed from scratch, testnet first. `TESTNET_WAVE` in registry.ts is
 * the order and the single source for it — do not restate it here, because a
 * second copy is what went stale: this header used to name a five-chain order
 * (Arc first, Ethereum last) that is now close to the reverse of the real one,
 * which is ordered by how much has to be built before a chain is exercisable.
 * Abstract is no longer the home chain — it stays registered for balance reading
 * only.
 *
 * So every chain here is currently wired for wallet network-switching and the
 * omni-chain balance indexer (portfolio viewing), and none is tradable. Do not
 * read `tradable` alone as "you can trade here": it means "the Diamond is
 * *intended* to be here", and must be paired with `isDeployed()` from
 * registry.ts, which checks whether an address actually exists. `tradableChains()`
 * does exactly that and is the function UI should gate on.
 */

export interface ChainMeta {
  id: number;
  name: string;
  shortName: string;
  network: "mainnet" | "testnet";
  /** Chain id of the counterpart network (mainnet<->testnet), if it exists. */
  pairChainId?: number;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  blockExplorer: { name: string; url: string };
  /** Icon id/chainId to pass to @web3icons/react's <NetworkIcon />. */
  iconId: string;
  /** Fallback dot color when the icon library has no asset yet. */
  color: string;
  /**
   * True where the Kaleido Diamond is *intended* to live. NOT a deployment
   * check on its own — nothing is deployed anywhere yet. Pair it with
   * `isDeployed()` from registry.ts, or just use `tradableChains()`, which
   * ands the two together.
   */
  tradable?: boolean;
  /** True for chains announced but not yet live on mainnet (e.g. Arc). */
  comingSoon?: boolean;
}

/*
 * Order is the display order. NetworkSelector and TokenSelector both partition
 * this array by `network` and otherwise preserve it, so the sequence here is
 * what a user reads top to bottom — which makes it a product decision, not a
 * filing convention.
 *
 * Priority order first (Arc, Base, Robinhood, BNB, Ethereum are where the
 * Diamond is going), then the read-only chains, then Abstract last. Abstract
 * used to lead this list from when it was the home chain; leaving it there
 * pointed every user at the one mainnet entry that says "Balances only" before
 * they reached a single tradable chain.
 */
export const CHAINS: ChainMeta[] = [
  // ---- Ethereum ----
  {
    id: 1,
    name: "Ethereum",
    shortName: "Ethereum",
    network: "mainnet",
    pairChainId: 11155111,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://eth.merkle.io", "https://cloudflare-eth.com"],
    blockExplorer: { name: "Etherscan", url: "https://etherscan.io" },
    iconId: "ethereum",
    color: "#627eea",
    tradable: true,
  },
  {
    id: 11155111,
    name: "Sepolia",
    shortName: "Sepolia",
    network: "testnet",
    pairChainId: 1,
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: [
      "https://11155111.rpc.thirdweb.com",
      /* Was https://rpc.sepolia.org, which serves an Apache 404 to a JSON-RPC
         POST rather than failing as a node — measured 2026-08-25. A fallback that
         answers HTML is worse than no fallback: ethers reports a parse error, not
         an unreachable endpoint. publicnode agreed with thirdweb on both chain id
         and height when the two were compared. */
      "https://ethereum-sepolia-rpc.publicnode.com",
    ],
    blockExplorer: { name: "Etherscan", url: "https://sepolia.etherscan.io" },
    iconId: "sepolia",
    color: "#627eea",
    tradable: true,
  },

  // ---- Base ----
  {
    id: 8453,
    name: "Base",
    shortName: "Base",
    network: "mainnet",
    pairChainId: 84532,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://mainnet.base.org"],
    blockExplorer: { name: "Basescan", url: "https://basescan.org" },
    iconId: "base",
    color: "#0052ff",
    tradable: true,
  },
  {
    id: 84532,
    name: "Base Sepolia",
    shortName: "Base Sepolia",
    network: "testnet",
    pairChainId: 8453,
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://sepolia.base.org"],
    blockExplorer: { name: "Basescan", url: "https://sepolia.basescan.org" },
    iconId: "base-sepolia",
    color: "#0052ff",
    tradable: true,
  },

  // ---- BNB Smart Chain ----
  {
    id: 56,
    name: "BNB Smart Chain",
    shortName: "BSC",
    network: "mainnet",
    pairChainId: 97,
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    rpcUrls: ["https://rpc.ankr.com/bsc", "https://bsc-dataseed.bnbchain.org"],
    blockExplorer: { name: "BscScan", url: "https://bscscan.com" },
    iconId: "binance-smart-chain",
    color: "#f0b90b",
    tradable: true,
  },
  {
    id: 97,
    name: "BNB Smart Chain Testnet",
    shortName: "BSC Testnet",
    network: "testnet",
    pairChainId: 56,
    nativeCurrency: { name: "BNB", symbol: "tBNB", decimals: 18 },
    rpcUrls: ["https://data-seed-prebsc-1-s1.bnbchain.org:8545"],
    blockExplorer: { name: "BscScan", url: "https://testnet.bscscan.com" },
    iconId: "binance-smart-chain-testnet",
    color: "#f0b90b",
    tradable: true,
  },

  // ---- Robinhood Chain (Arbitrum Orbit L2, launched 2025) ----
  {
    id: 4663,
    name: "Robinhood Chain",
    shortName: "Robinhood",
    network: "mainnet",
    pairChainId: 46630,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
    blockExplorer: {
      name: "Blockscout",
      url: "https://robinhoodchain.blockscout.com",
    },
    iconId: "robinhood",
    color: "#00c805",
    tradable: true,
  },
  {
    id: 46630,
    name: "Robinhood Chain Testnet",
    shortName: "Robinhood",
    network: "testnet",
    pairChainId: 4663,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://rpc.testnet.chain.robinhood.com"],
    blockExplorer: {
      name: "Blockscout",
      url: "https://explorer.testnet.chain.robinhood.com",
    },
    iconId: "robinhood",
    color: "#00c805",
    tradable: true,
  },

  // ---- Arc (Circle's stablecoin L1 — testnet only, mainnet targeted summer 2026) ----
  {
    id: 5042002,
    name: "Arc Testnet",
    shortName: "Arc",
    network: "testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: [
      "https://rpc.testnet.arc.network",
      "https://rpc.quicknode.testnet.arc.network",
      "https://rpc.blockdaemon.testnet.arc.network",
    ],
    blockExplorer: { name: "ArcScan", url: "https://testnet.arcscan.app" },
    iconId: "arc",
    color: "#5546ff",
    tradable: true,
  },

  // ---- Already indexed by the omni-chain balance reader; kept for parity ----
  {
    id: 137,
    name: "Polygon",
    shortName: "Polygon",
    network: "mainnet",
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    rpcUrls: ["https://polygon-rpc.com"],
    blockExplorer: { name: "PolygonScan", url: "https://polygonscan.com" },
    iconId: "polygon",
    color: "#8247e5",
  },
  {
    id: 42161,
    name: "Arbitrum One",
    shortName: "Arbitrum",
    network: "mainnet",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://arb1.arbitrum.io/rpc"],
    blockExplorer: { name: "Arbiscan", url: "https://arbiscan.io" },
    iconId: "arbitrum-one",
    color: "#12aaff",
  },
  {
    id: 999,
    name: "Hyperliquid",
    shortName: "Hyperliquid",
    network: "mainnet",
    nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
    rpcUrls: ["https://rpc.hyperliquid.xyz/evm"],
    blockExplorer: {
      name: "Hyperliquid Explorer",
      url: "https://hyperliquid.cloud.blockscout.com",
    },
    iconId: "hyperliquid",
    color: "#97fce4",
  },

  // ---- Abstract, last (deprioritised: balance reading only, never tradable) --
  {
    id: 2741,
    name: "Abstract",
    shortName: "Abstract",
    network: "mainnet",
    pairChainId: 11124,
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://api.mainnet.abs.xyz"],
    blockExplorer: { name: "Abscan", url: "https://abscan.org" },
    iconId: "abstract",
    color: "#00b383",
  },
  {
    id: 11124,
    name: "Abstract Testnet",
    shortName: "Abstract",
    network: "testnet",
    pairChainId: 2741,
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://api.testnet.abs.xyz"],
    blockExplorer: { name: "Abscan", url: "https://explorer.testnet.abs.xyz" },
    iconId: "abstract-sepolia",
    color: "#00b383",
  },
];

export const CHAINS_BY_ID: Record<number, ChainMeta> = Object.fromEntries(
  CHAINS.map((c) => [c.id, c]),
);

/**
 * There is deliberately no DEFAULT_CHAIN_ID.
 *
 * It used to be 11124 (Abstract Testnet), which is now neither the home chain
 * nor deployed. Any constant of this shape is a guess that outlives the reason
 * for it: the previous one silently sent reads, `chainId ?? DEFAULT` fallbacks
 * and the agent's token resolution to a chain the app had moved off, and none
 * of those call sites failed — they just produced answers about the wrong
 * chain.
 *
 * Callers should use the wallet's connected chain and handle "not connected"
 * or "not deployed here" explicitly. `isDeployed()` in registry.ts is the check
 * for the latter.
 *
 * The one exception is `READ_ONLY_CHAIN_ID` in config/provider.ts, and it is an
 * exception because it is not a fallback: the read-only provider has no wallet
 * to ask, so configuration is the only thing that can name its chain. It is
 * configured via `NEXT_PUBLIC_READ_CHAIN_ID`, and its own default is private to
 * that module precisely so it cannot be borrowed as the constant this comment
 * refuses.
 */

/** Chains where the Diamond is *intended* to live. Not a deployment check —
 * every entry is still undeployed today. Use `tradableChains()` from
 * registry.ts to get the ones a user can actually trade on. */
export const INTENDED_TRADABLE_CHAIN_IDS = CHAINS.filter((c) => c.tradable).map(
  (c) => c.id,
);

export const getChainMeta = (
  chainId: number | undefined,
): ChainMeta | undefined =>
  chainId === undefined ? undefined : CHAINS_BY_ID[chainId];

/** Builds a thirdweb Chain object from the registry, for wallet network switching. */
export function toThirdwebChainOptions(meta: ChainMeta) {
  return {
    id: meta.id,
    name: meta.name,
    rpc: meta.rpcUrls[0],
    nativeCurrency: meta.nativeCurrency,
    blockExplorers: [
      { name: meta.blockExplorer.name, url: meta.blockExplorer.url },
    ],
    testnet: meta.network === "testnet" ? (true as const) : undefined,
  };
}
