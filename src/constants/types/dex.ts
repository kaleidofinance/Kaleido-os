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
 * One pool, on one chain, at either venue.
 *
 * Named for a V2 pair because that is all it described when `usePoolData` was the
 * only producer. It now carries a V3 pool as well (`version`) and says which chain
 * it was read from (`chainId`), because both enumerators sweep every deployment —
 * so two rows in one table can be the same pair on two chains, and nothing but
 * these two fields tells them apart.
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
  /**
   * Which chain this pool is on.
   *
   * Required, and required for the same reason `version` is: both enumerators now
   * sweep every chain the protocol is deployed to, so a list of pools is a list
   * drawn from several chains and an address on its own no longer identifies one.
   * Three consumers cannot work without it — the chain tag under each row, the
   * provider the transactions table reads the pool's own logs through, and the
   * explorer link on the detail page — and every one of them would otherwise
   * default to the read chain, which is the bug this field exists to remove: a
   * Base pool's logs read on Sepolia come back empty, and its explorer link lands
   * on a page for an address that holds nothing.
   */
  chainId: number;
  /**
   * Which venue this pool belongs to.
   *
   * Load-bearing rather than decorative, and required rather than optional: the
   * two enumerators behind this type read pools whose *shapes* differ, and three
   * consumers have to branch on it — the `· V2` badge on a row, the depth curve
   * (constant product, so V3 has no such curve to draw), and the event ABI the
   * transactions table decodes with. A producer that forgot to set it would
   * silently render a V3 pool as V2 in all three places, which is why there is
   * no default.
   */
  version: "v2" | "v3";
  /**
   * Whether the protocol's own deployer opened this pool and funded it.
   *
   * Required rather than optional, and the reason is about producers rather than
   * consumers: a `seeded?:` would let a new enumerator ship rows that quietly
   * make no claim either way, and the row it emits is the only place a reader
   * ever learns the difference. Required means the compiler asks.
   *
   * Answered by `isSeededPool` from the committed deployment records. What it
   * claims is narrow and worth keeping straight — that a run of ours created
   * this pool and minted the first liquidity into it at an oracle price. Not
   * that we still hold that liquidity, and not that the price is still fair:
   * anyone may add to a V3 pool, and a seeded pool drifts with whoever trades
   * it. It is here because the alternative is worse — at the same pair and tier,
   * a pool a stranger opened at a price they picked is otherwise identical in
   * the table to one we opened at the oracle's.
   */
  seeded: boolean;
  token0: IToken;
  token1: IToken;
  /**
   * What the pool holds right now, in base units.
   *
   * On V2 these are the pair's own `getReserves()`, and the whole curve follows
   * from them. On V3 they are the pool contract's token balances, which is the
   * same fact about custody but *not* a curve: V3 liquidity is spread across
   * ticks, so nothing about execution can be derived from these two numbers
   * alone. Anything computing a price impact from them must check `version`.
   */
  reserves: {
    reserve0: string | number;
    reserve1: string | number;
  };
  /**
   * token1 per token0, in human units — the pool's own quote, not a market
   * price. From the reserves on V2 and from `slot0`'s tick on V3. Null when the
   * pool has no quote at all: an unfunded V2 pair, a V3 pool that was created but
   * never initialised, or a V3 pool whose tick is pinned at the clamp a drained
   * pool stops at — see `isTickPinned`. That last one is not an edge case worth
   * hoping about: a testnet KLD/USDC pool reached it in normal use, and reading
   * its tick as a price published a $6.47e48 headline off 117 dollars of USDC.
   */
  price: number | null;
  /**
   * LP token supply in base units, or null where the concept does not exist.
   *
   * A string, like `reserves`, because an 18-decimal supply runs past float64's
   * exact range — the same reason the mirror tables store amounts as text. Null
   * on V3, where a position is an NFT with its own range and there is no fungible
   * supply to report; a zero here would read as "nobody has provided liquidity".
   */
  totalSupply: string | null;
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
   * Each leg's USD value on its own, null where that leg could not be priced.
   *
   * These are what `liquidity` is built from rather than a second measurement of
   * it, and they exist so a consumer can see the shape of the pool instead of
   * only its total. Two things become visible that the sum hides:
   *
   *  - Whether `liquidity` is exact or inferred. Both legs priced from the spot
   *    table means it is the sum of what the pool holds. On V2, one priced leg
   *    means the other was doubled, which is sound on a constant-product curve
   *    but is an inference. On V3 doubling would be wrong — a concentrated
   *    position is not 50/50 at any price — so the unpriced leg is valued through
   *    the pool's own quote instead, which is exact arithmetic on an input the
   *    pool itself sets. That is how a pool whose only price is its own gets a
   *    TVL at all, and it is also why such a pool cannot show drift against spot.
   *  - How far the pool sits off the external price, when both legs came from the
   *    spot table. Measured at the pool's own ratio the two legs are *always*
   *    equal — that is what the ratio means — so a split drawn from the pool
   *    price alone would be 50/50 for every pool ever.
   */
  value0: number | null;
  value1: number | null;
  /** Swap fees the pool collected over the same extrapolated day, in USD. */
  fees24h: number | null;
  /** fees24h annualised against liquidity, in percent. */
  apr: number | null;
  /**
   * The pool's own fee, in basis points of 10000.
   *
   * Read from the contract, not inferred. On V2 it is the pair's `swapFee()`,
   * which `createPair` takes as an argument and is permissionless — so 30 bps is
   * a router default rather than a property of the pool. On V3 it is the tier the
   * pool was created at, whose denominator is 1e6, converted here so that one
   * column formats both: 3000 hundredths-of-a-bip is 0.3%, which is 30 bps.
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
