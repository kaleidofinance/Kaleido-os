// Checks on the pure half of the price keeper. Run with plain node (tsx).
//
// Everything here is arithmetic and table lookups — no chain, no network, no key.
// The live behaviour was verified against Robinhood by pushing for real; what a
// test can add is the part that would break QUIETLY later:
//
//   1. Two publishers now write the same PushablePriceFeed — this module and
//      `smart-contract/scripts/libraries/hermes-prices.js`. If they scale a price
//      differently by one digit, the next push after the other publisher's looks
//      like a price move: small drift is invisible, large drift trips the
//      deviation guard and the feed goes stale with both keepers reporting
//      success. So `scaleToDecimals` is run against `scaleParsedPrice` itself
//      rather than against numbers I copied out of it.
//   2. The feed ids are read from the app's price table, and the feeds were
//      REGISTERED from `pyth-feeds.js`. A disagreement there publishes one
//      asset's price onto another asset's feed.
//
// The hardhat libs are loaded through a non-literal dynamic import: they are
// CommonJS with no type declarations, and a literal specifier would put
// smart-contract/ into the app's type graph — which is the coupling
// lib/keeper/pushFeeds.ts exists to avoid.
import { DEPLOYMENTS } from "@/constants/registry";
import { PYTH_FEEDS } from "@/lib/points/prices";

import {
  candidateFeeds,
  decimalToFixedPoint,
  deviationBps,
  scaleToDecimals,
  SELF_HOSTING_CANDIDATE_CHAINS,
} from "./pushFeeds.ts";

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

/** True when `fn` throws, whatever it throws. */
const throws = (fn: () => unknown): boolean => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

const HERMES_LIB = "../../../smart-contract/scripts/libraries/hermes-prices.js";
const PYTH_LIB = "../../../smart-contract/scripts/libraries/pyth-feeds.js";

/** CJS through tsx's interop: the namespace carries the keys, `default` the object. */
async function load<T>(specifier: string): Promise<T> {
  const mod = (await import(specifier)) as Record<string, unknown> & {
    default?: unknown;
  };
  const hasKeys = Object.keys(mod).some((k) => k !== "default");
  return (hasKeys ? mod : mod.default) as T;
}

const run = async () => {
  const { scaleParsedPrice } = await load<{
    scaleParsedPrice: (p: string, e: number, d: number) => bigint;
  }>(HERMES_LIB);
  const { FEEDS } = await load<{
    FEEDS: Record<string, { id: string; symbol: string; source: string }>;
  }>(PYTH_LIB);

  console.log("\n— the two publishers scale a price identically —");
  {
    check(
      "the hardhat lib exports the function under test",
      typeof scaleParsedPrice === "function",
    );

    /* Each row is a shape a real answer arrives in. The last two are the ones
       that differ from the common case: a source at coarser precision than the
       feed (shift up), and one finer than it (truncate). */
    const table: [string, number, number, string][] = [
      ["241871000000", -8, 8, "ETH at $2418.71, Pyth's own shape, no shift"],
      ["99983200", -8, 8, "USDC just off par"],
      ["2418710000", -6, 8, "a 6-decimal source into an 8-decimal feed"],
      ["24187100000000", -10, 8, "a 10-decimal source, truncated to the feed"],
      ["241871000000", -8, 18, "the same ether into an 18-decimal feed"],
      ["1", -8, 8, "the smallest answer a feed can hold"],
      ["24187123456789", -10, 6, "truncation twice over"],
    ];
    for (const [priceStr, expo, decimals, what] of table) {
      const ours = scaleToDecimals(priceStr, expo, decimals);
      const theirs = scaleParsedPrice(priceStr, expo, decimals);
      check(
        `${what}: ${ours}`,
        ours === theirs,
        `ours ${ours} vs hermes-prices ${theirs}`,
      );
    }

    /* Spot-check one row against arithmetic done by hand, so the pair agreeing
       is not the only evidence — two identical ports of one mistake would agree
       with each other perfectly. */
    check(
      "and the no-shift case really is the integer the feed stores",
      scaleToDecimals("241871000000", -8, 8) === 241_871_000_000n,
    );
    check(
      "shifting up multiplies rather than reinterprets",
      scaleToDecimals("2418710000", -6, 8) === 241_871_000_000n,
    );
    check(
      "truncation drops the tail, it does not round it up",
      scaleToDecimals("24187199999999", -10, 8) === 241_871_999_999n,
    );
  }

  console.log("\n— and refuse the same answers —");
  {
    /* A feed rejects answer <= 0 on chain, so a keeper that sent one would spend
       gas to be reverted. Both publishers stop before that. */
    for (const bad of ["0", "-1", "-241871000000"]) {
      check(
        `a price of ${bad} is refused by both`,
        throws(() => scaleToDecimals(bad, -8, 8)) &&
          throws(() => scaleParsedPrice(bad, -8, 8)),
      );
    }
    /* Truncating to zero is the dangerous one: zero passes a truthiness check and
       then divides by zero in getTokenAmountFromUsd. */
    check(
      "a price below the feed's smallest unit is refused, not published as zero",
      throws(() => scaleToDecimals("5", -10, 8)) &&
        throws(() => scaleParsedPrice("5", -10, 8)),
      `got ${(() => {
        try {
          return String(scaleToDecimals("5", -10, 8));
        } catch {
          return "throw";
        }
      })()}`,
    );
  }

  console.log("\n— a decimal price becomes the exact integer, not a float —");
  {
    /* The reason decimalToFixedPoint does string surgery: 2458.93 * 1e8 is
       245892999999.99997 in binary floating point, so multiplying publishes a
       price one unit low. CoinGecko hands us decimals like these on every
       fallback, which since 2026-08-28 is every run. */
    const f = decimalToFixedPoint(2458.93);
    check(
      "2458.93 renders as 245893000000, the value 2458.93 * 1e8 misses",
      f.priceStr === "245893000000" && f.expo === -8,
      JSON.stringify(f),
    );
    check(
      "and the float route really does miss it",
      Math.trunc(2458.93 * 1e8) === 245_892_999_999,
    );

    const cases: [number, string][] = [
      [0.999832, "99983200"],
      [1, "100000000"],
      [2418.71, "241871000000"],
      [0.00001234, "1234"],
      [1234.5678, "123456780000"],
    ];
    for (const [usd, expected] of cases) {
      const got = decimalToFixedPoint(usd);
      check(
        `$${usd} → ${expected}`,
        got.priceStr === expected,
        `got ${got.priceStr}`,
      );
    }

    check(
      "the pair round-trips a dollar into an 8-decimal feed",
      (() => {
        const { priceStr, expo } = decimalToFixedPoint(0.999832);
        return scaleToDecimals(priceStr, expo, 8) === 99_983_200n;
      })(),
    );

    for (const bad of [0, -1, NaN, Infinity]) {
      check(`${bad} is not a usable price`, throws(() => decimalToFixedPoint(bad)));
    }
    /* A price finer than 1e-8 renders as 0.00000000 and survives the regex; it is
       refused one step later, by scaleToDecimals, rather than published. Asserted
       because the guard is split across two functions and could be lost in
       either. */
    check(
      "a price below 1e-8 is refused by the pair, not published as zero",
      throws(() => {
        const { priceStr, expo } = decimalToFixedPoint(1e-12);
        return scaleToDecimals(priceStr, expo, 8);
      }),
    );
  }

  console.log("\n— deviation, as PushablePriceFeed computes it —");
  {
    /* _deviationBps: (|next - prev| * 10_000) / prev, integer division, prev as
       the denominator both ways. Anything else here and the pre-flight check
       either skips a push the feed would have accepted or spends gas on one it
       reverts. */
    check("no move is no deviation", deviationBps(100n, 100n) === 0n);
    check("1% up is 100 bps", deviationBps(100_00n, 101_00n) === 100n);
    check(
      "the denominator is the previous answer, so the same move is asymmetric",
      deviationBps(100n, 110n) === 1000n && deviationBps(110n, 100n) === 909n,
    );
    check(
      "a halving reads 5000 bps, exactly the guard on Robinhood's feeds",
      deviationBps(241_871_000_000n, 120_935_500_000n) === 5000n,
    );
    check(
      "sub-bp moves floor to zero, the same way the contract's division does",
      deviationBps(241_871_000_000n, 241_871_000_001n) === 0n,
    );
    check(
      "a $0.46 move on $2418.71 reads 19 bps, the size measured on 2026-09-01",
      deviationBps(241_871_000_000n, 242_330_555_000n) === 19n,
      String(deviationBps(241_871_000_000n, 242_330_555_000n)),
    );
  }

  console.log("\n— feed ids come from the table the feeds were registered from —");
  {
    check("pyth-feeds.js exports FEEDS", FEEDS !== undefined && typeof FEEDS === "object");

    const norm = (id: string) =>
      (id.startsWith("0x") ? id : `0x${id}`).toLowerCase();

    for (const [symbol, id] of Object.entries(PYTH_FEEDS)) {
      const registered = FEEDS[symbol];
      check(
        `${symbol} is the same feed in both tables`,
        registered !== undefined && norm(registered.id) === norm(id),
        registered ? `app ${norm(id)} vs registered ${norm(registered.id)}` : "absent from pyth-feeds.js",
      );
    }

    /* One direction only. pyth-feeds.js carries feeds the app does not value
       (BTC, WBTC, USDE, WUSDC) and that is fine — but an id HERE that is not
       THERE was typed by hand into the app's table, which is precisely what
       pyth-feeds.js's provenance rules exist to prevent. */
    const registeredIds = new Set(Object.values(FEEDS).map((f) => norm(f.id)));
    const strays = Object.entries(PYTH_FEEDS).filter(
      ([, id]) => !registeredIds.has(norm(id)),
    );
    check(
      "no app-side id is unknown to the registration table",
      strays.length === 0,
      strays.map(([s, id]) => `${s}=${id}`).join(", "),
    );

    const candidates = candidateFeeds();
    check(
      "ETH and WETH share one feed, so they cost one request",
      candidates.some(
        (c) => c.symbols.includes("ETH") && c.symbols.includes("WETH"),
      ) && candidates.length < Object.keys(PYTH_FEEDS).length,
      `${candidates.length} candidates from ${Object.keys(PYTH_FEEDS).length} symbols`,
    );
    check(
      "every candidate id is a 0x-prefixed 32-byte word, as feedAggregator wants",
      candidates.every((c) => /^0x[0-9a-f]{64}$/.test(c.id)),
      candidates.map((c) => c.id).join(" "),
    );
    check(
      "and every candidate carries at least one symbol to report it under",
      candidates.every((c) => c.symbols.length > 0),
    );
  }

  console.log("\n— which chains the keeper will even talk to —");
  {
    /* Derived from the generated registry rather than listed, so the assertion is
       on the derivation: any aggregator-v3 chain is in, anything else is out.
       That holds across a redeploy, which a hardcoded list would not. */
    const expected = Object.keys(DEPLOYMENTS)
      .map(Number)
      .filter((id) => {
        const c = DEPLOYMENTS[id];
        return Boolean(c?.priceOracle) && c?.oracleKind === "aggregator-v3";
      })
      .sort((a, b) => a - b);

    check(
      "the candidate chains are exactly the aggregator-v3 deployments",
      JSON.stringify([...SELF_HOSTING_CANDIDATE_CHAINS]) ===
        JSON.stringify(expected),
      `${SELF_HOSTING_CANDIDATE_CHAINS.join(",")} vs ${expected.join(",")}`,
    );
    check(
      "there is at least one, so the route is not a no-op",
      SELF_HOSTING_CANDIDATE_CHAINS.length > 0,
    );
    check(
      "Robinhood is among them — it is the chain this keeper exists for",
      SELF_HOSTING_CANDIDATE_CHAINS.includes(46630),
      SELF_HOSTING_CANDIDATE_CHAINS.join(","),
    );
    /* Arc's oracle takes a signed Pyth relay, not a pushed answer. Including it
       would send the keeper to a contract with no pushAnswer to call. */
    const pythChains = Object.keys(DEPLOYMENTS)
      .map(Number)
      .filter((id) => DEPLOYMENTS[id]?.oracleKind === "pyth");
    check(
      "no Pyth-backed chain is in the list",
      pythChains.every((id) => !SELF_HOSTING_CANDIDATE_CHAINS.includes(id)),
      `pyth chains ${pythChains.join(",")}`,
    );
  }
};

/* Not `await run()`: tsx compiles this to CJS, where top-level await is a syntax
   error. The report is chained instead of following the call. */
run().then(() => {
  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
});
