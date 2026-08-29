// Checks on the pools table's search box and filter panel.
// Run with `npx tsx "src/app/(app)/pool/filters.test.ts"`.
//
// A search box fails silently. It returns fewer rows, and fewer rows is exactly
// what it is for — so a rule that quietly does not match reads as "there is no
// such pool", which is the one answer the reader will act on without checking.
// Nothing on screen distinguishes the two.
//
// What is under test, in order of how badly it fails when wrong:
//
//   1. hideEmpty against a null TVL. `liquidity: null` means "the legs have no
//      USD price", not "the pool is empty" — the type says so at length — so a
//      filter that treats them alike hides funded pools and asserts something
//      the table does not know. Test 12.
//   2. AND across words. With OR, typing a second word to narrow *widens* the
//      result, which is the opposite of what the box is for. Test 4.
//   3. An empty facet list meaning "no constraint". Getting this backwards
//      empties the table the moment the reader unchecks their last box, and it
//      is the state the panel opens in. Test 13.
//   4. The separator set. "USDC / USDT" is rendered with slashes and spaces;
//      only matching one spelling of what is on screen is the silent-miss case
//      above. Tests 2 and 3.

import {
  NO_FILTERS,
  activeFilterCount,
  applyPoolFilters,
  poolFacets,
  poolMatchesQuery,
  toggle,
  type PoolFilters,
} from "./filters";
import type { IToken, ITradingPair } from "@/constants/types/dex";

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

const token = (symbol: string, name: string, decimals: number): IToken => ({
  address: `0x${symbol.toLowerCase().padEnd(40, "0")}`,
  name,
  symbol,
  decimals,
  verified: true,
});

const USDC = token("USDC", "USD Coin", 6);
const USDT = token("USDT", "Tether USD", 6);
const WETH = token("WETH", "Wrapped Ether", 18);

/* Chain ids are real ones, because the haystack looks the chain up in the
   registry: a made-up id would silently drop the chain name from the searchable
   text and half of these assertions would pass for the wrong reason. */
const SEPOLIA = 11155111;
const BASE_SEPOLIA = 84532;
const BSC_TESTNET = 97;

const row = (over: Partial<ITradingPair> = {}): ITradingPair => ({
  address: "0x1111111111111111111111111111111111111111",
  chainId: SEPOLIA,
  version: "v3",
  token0: USDC,
  token1: USDT,
  reserves: { reserve0: "0", reserve1: "0" },
  price: 1,
  totalSupply: null,
  volume24h: null,
  volumeWindowSec: null,
  liquidity: 1000,
  value0: null,
  value1: null,
  fees24h: null,
  apr: null,
  feeBps: 30,
  ...over,
});

const usdcUsdtSepolia = row();
const wethUsdcBase = row({
  address: "0x2222222222222222222222222222222222222222",
  chainId: BASE_SEPOLIA,
  token0: WETH,
  token1: USDC,
  price: 3000,
  feeBps: 5,
});
const usdcUsdtBsc = row({
  address: "0x3333333333333333333333333333333333333333",
  chainId: BSC_TESTNET,
  version: "v2",
  feeBps: 100,
});
const ALL = [usdcUsdtSepolia, wethUsdcBase, usdcUsdtBsc];

const found = (query: string, filters: PoolFilters = NO_FILTERS) =>
  applyPoolFilters(ALL, filters, query).map((p) => p.address);

/* ------------------------------------------------------------------ 1 -- */
check("an empty query matches every row", found("").length === 3);
check("whitespace is not a query", found("   ").length === 3);

/* ------------------------------------------------------------------ 2 -- */
/* Every spelling of what the row actually renders. The pair cell reads
   "USDC / USDT", so all three of these are someone typing what they see. */
for (const q of ["usdc/usdt", "usdc / usdt", "USDC USDT", "usdt/usdc"]) {
  check(
    `"${q}" finds both USDC/USDT pools`,
    found(q).length === 2,
    JSON.stringify(found(q)),
  );
}
check("a symbol on its own finds every pool holding it", found("usdc").length === 3);

/* ------------------------------------------------------------------ 3 -- */
check("the chain name is searchable", found("base").length === 1);
/* "sepolia" is a substring of "Base Sepolia", and that is the intended
   behaviour: the reader is matching text, and narrowing to one of the two is
   what the second word is for. */
check(
  "sepolia matches both Sepolia and Base Sepolia",
  found("sepolia").length === 2,
);
check("base sepolia narrows to the one", found("base sepolia").length === 1);

/* ------------------------------------------------------------------ 4 -- */
/* AND, not OR. With OR this would be 3 — every USDC pool plus every BSC pool. */
check(
  "words narrow rather than widen",
  found("usdc bsc").length === 1 &&
    found("usdc bsc")[0] === usdcUsdtBsc.address,
  JSON.stringify(found("usdc bsc")),
);
check("a word that matches nothing empties the list", found("usdc arc").length === 0);

/* ------------------------------------------------------------------ 5 -- */
check("a pool address prefix finds its pool", found("0x2222").length === 1);
check("the full address finds it", found(wethUsdcBase.address).length === 1);

/* ------------------------------------------------------------------ 6 -- */
check("the venue is searchable", found("v2").length === 1);
check("the token name is searchable", found("tether").length === 2);

/* ------------------------------------------------------------------ 7 -- */
/* The fee is rendered as "0.30%", so that is what a reader can type. */
check("the fee label is searchable", found("0.30").length === 1);
check("0.05% is searchable", found("0.05").length === 1);

/* ------------------------------------------------------------------ 8 -- */
check("matching ignores case", found("UsDc / uSdT").length === 2);
check(
  "poolMatchesQuery agrees with applyPoolFilters",
  poolMatchesQuery(usdcUsdtBsc, "usdc bsc") &&
    !poolMatchesQuery(usdcUsdtSepolia, "usdc bsc"),
);

/* ------------------------------------------------------------------ 9 -- */
check(
  "the venue filter keeps only that venue",
  found("", { ...NO_FILTERS, venues: ["v2"] }).length === 1,
);
check(
  "both venues checked is the same as neither",
  found("", { ...NO_FILTERS, venues: ["v2", "v3"] }).length === 3,
);

/* ----------------------------------------------------------------- 10 -- */
check(
  "the chain filter keeps only those chains",
  found("", { ...NO_FILTERS, chainIds: [SEPOLIA, BSC_TESTNET] }).length === 2,
);

/* ----------------------------------------------------------------- 11 -- */
check(
  "the fee filter matches on bps of 10000",
  found("", { ...NO_FILTERS, feeBps: [5] }).length === 1,
);
/* A pool whose fee could not be read cannot satisfy a fee constraint, and must
   not pass it by accident — `null` is unknown, not "any". */
const unreadableFee = row({
  address: "0x4444444444444444444444444444444444444444",
  feeBps: null,
});
check(
  "a null fee is excluded when a fee is asked for",
  applyPoolFilters([unreadableFee], { ...NO_FILTERS, feeBps: [30] }, "")
    .length === 0,
);
check(
  "a null fee survives when no fee is asked for",
  applyPoolFilters([unreadableFee], NO_FILTERS, "").length === 1,
);

/* ----------------------------------------------------------------- 12 -- */
/* The one that matters. Zero is measured emptiness; null is an unpriced pool,
   which may hold millions. */
const emptyPool = row({
  address: "0x5555555555555555555555555555555555555555",
  liquidity: 0,
});
const unpricedPool = row({
  address: "0x6666666666666666666666666666666666666666",
  liquidity: null,
});
const hidden = applyPoolFilters(
  [usdcUsdtSepolia, emptyPool, unpricedPool],
  { ...NO_FILTERS, hideEmpty: true },
  "",
).map((p) => p.address);
check("hideEmpty drops a pool with zero TVL", !hidden.includes(emptyPool.address));
check(
  "hideEmpty keeps a pool whose TVL is unmeasurable",
  hidden.includes(unpricedPool.address),
  JSON.stringify(hidden),
);
check("hideEmpty keeps funded pools", hidden.includes(usdcUsdtSepolia.address));

/* ----------------------------------------------------------------- 13 -- */
check("NO_FILTERS constrains nothing", found("", NO_FILTERS).length === 3);
check(
  "an empty facet list is not an empty result",
  found("", { venues: [], chainIds: [], feeBps: [], hideEmpty: false })
    .length === 3,
);

/* ----------------------------------------------------------------- 14 -- */
check("no filters is a count of zero", activeFilterCount(NO_FILTERS) === 0);
check(
  "three chains is one constraint, not three",
  activeFilterCount({
    ...NO_FILTERS,
    chainIds: [SEPOLIA, BASE_SEPOLIA, BSC_TESTNET],
  }) === 1,
);
check(
  "each facet counts once",
  activeFilterCount({
    venues: ["v2"],
    chainIds: [SEPOLIA],
    feeBps: [30],
    hideEmpty: true,
  }) === 4,
);

/* ----------------------------------------------------------------- 15 -- */
const facets = poolFacets(ALL);
check(
  "facets list only the venues present",
  JSON.stringify(facets.venues) === JSON.stringify(["v2", "v3"]),
  JSON.stringify(facets.venues),
);
check(
  "facets list fees ascending",
  JSON.stringify(facets.feeBps) === JSON.stringify([5, 30, 100]),
  JSON.stringify(facets.feeBps),
);
check(
  "facets keep first-appearance chain order",
  JSON.stringify(facets.chainIds) ===
    JSON.stringify([SEPOLIA, BASE_SEPOLIA, BSC_TESTNET]),
  JSON.stringify(facets.chainIds),
);
check(
  "an unreadable fee contributes no option",
  poolFacets([unreadableFee]).feeBps.length === 0,
);
check("facets of nothing are empty", poolFacets([]).chainIds.length === 0);

/* ----------------------------------------------------------------- 16 -- */
check("toggle adds", JSON.stringify(toggle<number>([], 1)) === "[1]");
check("toggle removes", JSON.stringify(toggle([1, 2], 1)) === "[2]");
check("toggle does not mutate", (() => {
  const before = [1, 2];
  toggle(before, 3);
  return before.length === 2;
})());

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
