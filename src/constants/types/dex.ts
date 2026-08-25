export interface IToken {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  chainId?: number;
  logoURI?: string;
  verified: boolean;
  tags?: string[];
  isNative?: boolean;
  priceUrl?: string;
}

export interface ITokenBalance {
  token: IToken;
  balance: string;
  balanceFormatted: string;
  usdValue: number;
}

export interface ITokenPrice {
  address: string;
  price: number; // USD
  priceChange24h: number;
  volume24h: number;
  marketCap?: number;
  lastUpdated: number;
}

/**
 * A KaleidoSwap V2 pair, as `usePoolData` reads it.
 *
 * Every derived figure is nullable, and null means "not measurable", never
 * zero. A pool whose legs have no USD price is not an empty pool, and a chain
 * whose recent blocks give no usable time window has not traded nothing — but
 * rendered as `0` the two are indistinguishable from the real thing. The
 * removed fields (`stable`, `createdAt`, `volumeChange24h`,
 * `liquidityChange24h`) were all constants pretending to be measurements; see
 * usePoolData's header.
 */
export interface ITradingPair {
  address: string;
  token0: IToken;
  token1: IToken;
  reserves: {
    reserve0: string | number;
    reserve1: string | number;
  };
  /** token1 per token0, straight from the reserves. Null when reserve0 is 0. */
  price: number | null;
  /**
   * LP token supply in base units.
   *
   * A string, like `reserves`, because an 18-decimal supply runs past float64's
   * exact range — the same reason the mirror tables store amounts as text.
   */
  totalSupply: string;
  /** USD, extrapolated from a real sampled block window. */
  volume24h: number | null;
  /**
   * Seconds the volume sample actually covered.
   *
   * Travels with `volume24h` so a consumer can see how much of a day was
   * observed instead of taking the extrapolation on trust. Null when no usable
   * window was found.
   */
  volumeWindowSec: number | null;
  /** USD value of both reserves. */
  liquidity: number | null;
  /**
   * Each leg's USD value on its own, null where that token has no price.
   *
   * These are what `liquidity` is built from rather than a second measurement of
   * it, and they exist so a consumer can see the shape of the pool instead of
   * only its total. Two things become visible that the sum hides:
   *
   *  - Whether `liquidity` is exact or extrapolated. Both non-null means it is
   *    the sum of what the pool holds; one non-null means the other leg was
   *    doubled, which is sound on a constant-product curve but is an inference.
   *  - How far the pool sits off the external price. Measured at the pool's own
   *    ratio the two legs are *always* equal — that is what the ratio means — so
   *    a split drawn from the pool price alone would be 50/50 for every pool
   *    ever. These are priced from the shared spot table instead, and the gap
   *    between them is the pool's drift against it.
   */
  value0: number | null;
  value1: number | null;
  /** Swap fees the pool collected over the same extrapolated day, in USD. */
  fees24h: number | null;
  /** fees24h annualised against liquidity, in percent. */
  apr: number | null;
  /**
   * The pair's own `swapFee()`, in basis points of 10000.
   *
   * Read from the contract, not inferred. `createPair` takes the fee as an
   * argument and is permissionless, so 30 bps is a router default rather than a
   * property of the pool.
   */
  feeBps: number | null;
}

export type Address = `0x${string}`;
export type BigNumber = any; // Using any for now to avoid ethers dependency
/* Deleted: `type ChainId = 11124 | 2741`. It had zero importers and asserted that
 * the only chain ids in existence were Abstract's testnet and mainnet, so
 * annotating anything with it would have rejected all five chains we deploy to.
 * Chain ids are plain numbers here; the registry decides which ones are real. */
export type Wei = any;
export type TransactionHash = string;

export type TokenTag =
  | "native"
  | "stablecoin"
  | "wrapped"
  | "oracle"
  | "dex"
  | "governance"
  | "layer2"
  | "defi"
  | "synthetic";

export interface ILiquidityPosition {
  pairAddress: Address;
  pair: ITradingPair;
  lpTokenBalance: BigNumber;
  lpTokenBalanceFormatted: string;
  shareOfPool: number; // percentage (0-100)
  token0Amount: BigNumber;
  token1Amount: BigNumber;
  token0AmountFormatted: string;
  token1AmountFormatted: string;
  totalValue: number; // USD
  unclaimedFees: number; // USD
}

export interface ITransaction {
  hash: string;
  type: "swap" | "add_liquidity" | "remove_liquidity";
  status: "pending" | "confirmed" | "failed";
  timestamp: number;
  tokens: IToken[];
  amounts: string[];
  usdValue: number;
  gasUsed?: BigNumber;
  gasPrice?: BigNumber;
}

export interface IPoolStat {
  title: string;
  amount: string;
  token0?: {
    amount: string;
    symbol?: string;
  };
  token1?: {
    amount: string;
    symbol?: string;
  };
  change24h?: number;
}
