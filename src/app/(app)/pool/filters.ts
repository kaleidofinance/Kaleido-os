import { getChainMeta } from "@/constants/chains";
import type { ITradingPair } from "@/constants/types/dex";
import { feeLabel } from "./format";

/**
 * Searching and filtering the pools table, as pure functions.
 *
 * The table lists both venues on all five deployed chains, which is what makes
 * this necessary rather than decorative: the same pair at the same fee on two
 * chains is two rows that differ only in a tag, and finding one by eye means
 * reading a list that grows with every deployment. There is no server cursor
 * behind it — both hooks have already swept everything into memory — so this is a
 * filter over an array and nothing here is debounced. `BorrowBookView`'s search
 * box is, and for a reason that does not apply: each keystroke there re-runs a
 * paged fetch.
 *
 * Kept out of the component so the matching rules can be tested. A search box
 * fails by quietly not matching something the reader can see on screen, which is
 * indistinguishable from "no such pool" — see filters.test.ts.
 */

export type PoolVenue = ITradingPair["version"];

/**
 * An empty list means "no constraint on this facet", never "match nothing".
 *
 * That is the convention every checkbox filter uses and it is the one the modal
 * relies on: unchecking the last chain returns the full table rather than
 * emptying it, which is the behaviour a reader expects from a control they were
 * using to narrow.
 */
export interface PoolFilters {
  venues: readonly PoolVenue[];
  chainIds: readonly number[];
  feeBps: readonly number[];
  /**
   * Drop pools holding nothing. Strictly `liquidity === 0` — a null TVL is a pool
   * whose legs have no USD price, which is not an empty pool, and hiding those
   * would be the table asserting something it does not know. See
   * `ITradingPair.liquidity`.
   */
  hideEmpty: boolean;
}

export const NO_FILTERS: PoolFilters = {
  venues: [],
  chainIds: [],
  feeBps: [],
  hideEmpty: false,
};

/** Adds or removes one value, for a checkbox row. */
export function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

/**
 * How many facets are narrowing the table, for the button's badge.
 *
 * Facets, not selections: three chains checked is one constraint the reader put
 * on the list, and a badge reading 3 would suggest three separate things are
 * hidden.
 */
export function activeFilterCount(f: PoolFilters): number {
  return (
    (f.venues.length ? 1 : 0) +
    (f.chainIds.length ? 1 : 0) +
    (f.feeBps.length ? 1 : 0) +
    (f.hideEmpty ? 1 : 0)
  );
}

/**
 * Everything about a row that is visible on screen, lowercased into one string.
 *
 * Deliberately includes the chain's name and the fee label rather than only the
 * symbols: those are rendered on the row, and a reader who types what they can
 * see and gets nothing back concludes the pool is not listed. The pool address is
 * in here too — it is not on the row, but it is what a URL, an explorer tab or a
 * deployment record hands you, and pasting one is the fastest way to find a pool
 * you already know about.
 */
export function poolHaystack(pool: ITradingPair): string {
  const meta = getChainMeta(pool.chainId);
  return [
    pool.token0.symbol,
    pool.token1.symbol,
    `${pool.token0.symbol}/${pool.token1.symbol}`,
    pool.token0.name,
    pool.token1.name,
    pool.address,
    pool.version,
    feeLabel(pool.feeBps),
    meta?.name,
    meta?.shortName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Every word of the query has to appear somewhere in the row.
 *
 * Split on slashes as well as whitespace, so all four of "usdc/usdt",
 * "usdc / usdt", "usdt usdc" and "usdc sepolia" find what the reader means. AND
 * rather than OR because the second word is how they narrow: with OR, adding
 * "sepolia" to "usdc" would *widen* the result to every pool on Sepolia.
 */
export function poolMatchesQuery(pool: ITradingPair, query: string): boolean {
  const words = query.toLowerCase().split(/[\s/,]+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = poolHaystack(pool);
  return words.every((w) => hay.includes(w));
}

/** The rows that survive the box and the checkboxes, in the order given. */
export function applyPoolFilters(
  pools: readonly ITradingPair[],
  filters: PoolFilters,
  query: string,
): ITradingPair[] {
  return pools.filter((p) => {
    if (filters.venues.length && !filters.venues.includes(p.version))
      return false;
    if (filters.chainIds.length && !filters.chainIds.includes(p.chainId))
      return false;
    if (
      filters.feeBps.length &&
      (p.feeBps === null || !filters.feeBps.includes(p.feeBps))
    )
      return false;
    if (filters.hideEmpty && p.liquidity === 0) return false;
    return poolMatchesQuery(p, query);
  });
}

/**
 * The options to offer, taken from the rows themselves.
 *
 * Not from `FEE_TIERS` or the chain registry: a filter for a tier no pool uses,
 * or a chain nothing was found on, is a control whose only outcome is an empty
 * table. Chains keep first-appearance order rather than being sorted by id — the
 * rows arrive sorted by TVL, so that puts the chain holding the deepest pool
 * first, which is a more useful order in this panel than 97 before 84532.
 */
export function poolFacets(pools: readonly ITradingPair[]): {
  venues: PoolVenue[];
  chainIds: number[];
  feeBps: number[];
} {
  const venues: PoolVenue[] = [];
  const chainIds: number[] = [];
  const feeBps: number[] = [];
  for (const p of pools) {
    if (!venues.includes(p.version)) venues.push(p.version);
    if (!chainIds.includes(p.chainId)) chainIds.push(p.chainId);
    if (p.feeBps !== null && !feeBps.includes(p.feeBps)) feeBps.push(p.feeBps);
  }
  venues.sort();
  feeBps.sort((a, b) => a - b);
  return { venues, chainIds, feeBps };
}
