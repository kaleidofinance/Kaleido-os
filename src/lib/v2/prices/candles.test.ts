// Checks on the arithmetic that turns our own pool's swaps into KLD candles.
// Run with `npx tsx src/lib/v2/prices/candles.test.ts`.
//
// Every way this fails is quiet, which is why the list is ordered by how badly:
//
//   1. THE ORIENTATION. A V3 pool orders its tokens by address, so KLD is
//      token0 on Base Sepolia and token1 on Sepolia — both read on chain. The
//      same formula therefore means USDC-per-KLD on one and KLD-per-USDC on the
//      other, and both are plausible numbers on an axis. A chart that is upside
//      down on half the deployments is the worst outcome available here, so it
//      is tested first and tested as a reciprocal pair.
//   2. THE CLAMP. A pool this thin is emptied by one trade and leaves a tick at
//      the contract's own bound; v3Math measured 3.4e50 USDC per KLD on the
//      Robinhood pool after a 117 USDC buy. That must vanish, not be drawn, and
//      it must not drag a bucket's high with it on the way out.
//   3. OPEN AND CLOSE. They are defined by order, and two swaps in one block are
//      ordered only by logIndex. Getting that wrong produces a candle whose
//      body is backwards and whose wicks are right.
//   4. IDEMPOTENCE. The indexer re-scans the open bucket every run and a resumed
//      scan can replay a page. Neither may double-count.

import {
  bucketStart,
  candlesFrom,
  INTERVALS,
  isInterval,
  mergeCandles,
  priceFromTick,
  type PoolShape,
  type SwapTick,
} from "./candles.ts";
import { MAX_TICK, tickToPrice } from "../../../constants/utils/v3Math.ts";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, got?: string) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${got === undefined ? "" : ` ${got}`}`);
  }
};

/* The two real shapes, as read on chain. KLD is 18 decimals, USDC is 6. */
const BASE: PoolShape = {
  kldIsToken0: true,
  decimals0: 18,
  decimals1: 6,
  fee: 3000,
};
const SEPOLIA: PoolShape = {
  kldIsToken0: false,
  decimals0: 6,
  decimals1: 18,
  fee: 3000,
};

const near = (a: number, b: number, tol = 1e-6) =>
  Math.abs(a - b) / Math.max(Math.abs(b), 1e-12) < tol;

console.log("\n— the same market, both token orderings —");
{
  /* A tick and its negation are reciprocal prices. Flipping BOTH the sign and
     which side KLD sits on describes the same market from the other end, so the
     two must agree — this is the assertion that would have caught an inverted
     chart on Sepolia while Base looked perfect. */
  const t = 60_000;
  const onBase = priceFromTick(t, BASE);
  const onSepolia = priceFromTick(-t, SEPOLIA);
  check(
    "both orderings price the same market alike",
    onBase !== null && onSepolia !== null && near(onBase, onSepolia),
    `${onBase} vs ${onSepolia}`,
  );

  /* Agreeing is not enough on its own — two identically inverted readings agree
     too. So this asserts against the RAW helper, in both directions, which is
     what actually pins the normalisation:
       - KLD as token0: tickToPrice is already USDC per KLD, passed through.
       - KLD as token1: tickToPrice is KLD per USDC, and must come back flipped.
     If `kldIsToken0` were ever ignored, exactly one of these breaks. */
  const rawBase = tickToPrice(0, BASE.decimals0, BASE.decimals1);
  const rawSepolia = tickToPrice(0, SEPOLIA.decimals0, SEPOLIA.decimals1);
  check(
    "a token0 pool is passed through",
    near(priceFromTick(0, BASE)!, rawBase),
    `${priceFromTick(0, BASE)} vs ${rawBase}`,
  );
  check(
    "a token1 pool is flipped, not passed through",
    near(priceFromTick(0, SEPOLIA)!, 1 / rawSepolia),
    `${priceFromTick(0, SEPOLIA)} vs ${1 / rawSepolia}`,
  );
  check(
    "so both report the same side of the pair",
    near(priceFromTick(0, BASE)!, priceFromTick(0, SEPOLIA)!),
  );
  check("and neither is zero or infinite", Number.isFinite(rawBase) && rawBase > 0);
}

console.log("\n— a clamped pool is not a price —");
{
  check("a pinned tick has no price", priceFromTick(MAX_TICK - 1, BASE) === null);
  check("negative clamp too", priceFromTick(-(MAX_TICK - 1), BASE) === null);
  check("a non-finite tick has no price", priceFromTick(NaN, BASE) === null);
  check("an ordinary tick does", priceFromTick(1_000, BASE) !== null);

  /* The clamp must not survive as a wick. A bucket holding one good swap and
     one clamped one is a one-swap bucket, and its high is the good price. */
  const swaps: SwapTick[] = [
    { blockNumber: 1, logIndex: 0, timestamp: 0, tick: 1_000 },
    { blockNumber: 2, logIndex: 0, timestamp: 60, tick: MAX_TICK - 1 },
  ];
  const [c] = candlesFrom(swaps, "15m", BASE);
  const good = priceFromTick(1_000, BASE)!;
  check("a clamped swap is dropped, not wicked", !!c && c.n === 1 && near(c.h, good), JSON.stringify(c));

  /* A bucket whose every swap was clamped produces NO candle — a quiet market
     and a flat one are different facts. */
  const allPinned = candlesFrom(
    [{ blockNumber: 1, logIndex: 0, timestamp: 0, tick: MAX_TICK - 1 }],
    "15m",
    BASE,
  );
  check("an all-clamped bucket yields no candle", allPinned.length === 0, JSON.stringify(allPinned));
}

console.log("\n— open and close are an ordering, not a guess —");
{
  /* Deliberately handed over out of order, and with the two extremes in the
     middle, so a naive "first element is open" fails. */
  const swaps: SwapTick[] = [
    { blockNumber: 10, logIndex: 1, timestamp: 100, tick: 3_000 },
    { blockNumber: 10, logIndex: 0, timestamp: 100, tick: 1_000 },
    { blockNumber: 11, logIndex: 0, timestamp: 200, tick: 5_000 },
    { blockNumber: 9, logIndex: 5, timestamp: 50, tick: 2_000 },
  ];
  const [c] = candlesFrom(swaps, "1h", BASE);
  const p = (t: number) => priceFromTick(t, BASE)!;
  check("one bucket for one hour of swaps", candlesFrom(swaps, "1h", BASE).length === 1);
  check("open is the earliest swap", !!c && near(c.o, p(2_000)), String(c?.o));
  check("close is the latest swap", !!c && near(c.c, p(5_000)), String(c?.c));
  check("high is the highest", !!c && near(c.h, p(5_000)));
  check("low is the lowest", !!c && near(c.l, p(1_000)));
  check("every swap counted", c?.n === 4, String(c?.n));

  /* Same block, so only logIndex separates them: the open must be logIndex 0. */
  const sameBlock = candlesFrom(
    [
      { blockNumber: 7, logIndex: 2, timestamp: 10, tick: 4_000 },
      { blockNumber: 7, logIndex: 0, timestamp: 10, tick: 1_000 },
    ],
    "1h",
    BASE,
  );
  check(
    "logIndex orders swaps inside a block",
    near(sameBlock[0].o, p(1_000)) && near(sameBlock[0].c, p(4_000)),
    JSON.stringify(sameBlock[0]),
  );
}

console.log("\n— buckets —");
{
  check("15m floors to the quarter hour", bucketStart(1_000_000 + 899, "15m") % 900 === 0);
  check("1h floors to the hour", bucketStart(1_234_567, "1h") % 3_600 === 0);
  check("4h floors to four hours", bucketStart(1_234_567, "4h") % 14_400 === 0);
  check("1d floors to the day", bucketStart(1_234_567, "1d") % 86_400 === 0);
  check("a timestamp sits at or after its bucket", bucketStart(1_234_567, "4h") <= 1_234_567);
  check("the four intervals are the offered set", Object.keys(INTERVALS).join(",") === "15m,1h,4h,1d");
  check("isInterval accepts one", isInterval("4h"));
  check("isInterval rejects a near miss", !isInterval("5m") && !isInterval("1D"));

  /* Gaps stay gaps: two swaps an hour apart in 15m buckets are two candles,
     not five with three invented between them. */
  const spread = candlesFrom(
    [
      { blockNumber: 1, logIndex: 0, timestamp: 0, tick: 1_000 },
      { blockNumber: 2, logIndex: 0, timestamp: 3_600, tick: 2_000 },
    ],
    "15m",
    BASE,
  );
  check("a quiet hour is a gap, not flat candles", spread.length === 2, String(spread.length));
  check("and they come back in time order", spread[0].t < spread[1].t);
}

console.log("\n— scanning the same swap twice must not double it —");
{
  const swap: SwapTick = { blockNumber: 5, logIndex: 0, timestamp: 0, tick: 1_000 };
  const [c] = candlesFrom([swap, { ...swap }], "15m", BASE);
  check("a replayed swap is counted once", c.n === 1, String(c.n));

  /* The indexer re-scans the open bucket every run, so a re-fold must replace
     that bucket rather than accumulate beside it. */
  const stored = candlesFrom([swap], "15m", BASE);
  const fresh = candlesFrom(
    [swap, { blockNumber: 6, logIndex: 0, timestamp: 60, tick: 2_000 }],
    "15m",
    BASE,
  );
  const merged = mergeCandles(stored, fresh);
  check("re-folding the open bucket replaces it", merged.length === 1, String(merged.length));
  check("and carries the newer close", near(merged[0].c, priceFromTick(2_000, BASE)!));
  check("merging is stable on an untouched bucket", mergeCandles(stored, []).length === 1);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
