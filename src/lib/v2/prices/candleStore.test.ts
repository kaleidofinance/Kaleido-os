// Checks on the row<->candle mapping the KLD candle store round-trips through.
// Run with `npx tsx src/lib/v2/prices/candleStore.test.ts`.
//
// Only the pure mapping is tested here — the I/O needs a database. But the
// mapping is where a price silently corrupts: Postgres `numeric` arrives over
// the wire as a STRING, and the difference between reading it and coercing it is
// the difference between a real KLD price and a chart drawn at zero. So every
// path that could turn a bad row into a plausible candle is pinned:
//
//   1. A sub-cent price survives the string round trip without losing digits.
//   2. A null / NaN / non-positive field yields NULL, not a candle that prints
//      0 — a chart is better missing a bar than drawing one that never traded.
//   3. The pool address is lowercased on the way in, matching every other
//      address column, so a select can match without an ilike.

import { candleToRow, rowToCandle, type CandleRow } from "./candleStore.ts";
import type { Candle } from "./candles.ts";

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

console.log("\n— a candle round-trips through a row without losing a digit —");
{
  const candle: Candle = { t: 1_700_000_400, o: 0.00001234, h: 0.00001299, l: 0.00001201, c: 0.0000125, n: 3 };
  const row = candleToRow(84532, "0xABCdef0000000000000000000000000000000001", candle);

  check("chain and bucket carry over", row.chain_id === 84532 && row.bucket_start === candle.t);
  check("the pool address is lowercased", row.pool === "0xabcdef0000000000000000000000000000000001", row.pool);
  check("prices are sent as strings", typeof row.o === "string" && typeof row.c === "string");

  /* Simulate the wire: Postgres hands numeric back as a string. */
  const wire: CandleRow = { ...row, o: String(row.o), h: String(row.h), l: String(row.l), c: String(row.c) };
  const back = rowToCandle(wire);
  const near = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12) < 1e-9;
  check("it comes back a candle", back !== null);
  check("open survives the sub-cent round trip", !!back && near(back.o, candle.o), String(back?.o));
  check("high, low, close too", !!back && near(back.h, candle.h) && near(back.l, candle.l) && near(back.c, candle.c));
  check("n and t are intact", back?.n === 3 && back?.t === candle.t);
}

console.log("\n— a corrupt row is dropped, never drawn as zero —");
{
  const good: CandleRow = { chain_id: 1, pool: "0xpool", bucket_start: 900, o: "1", h: "1", l: "1", c: "1", n: 1 };
  check("a clean row reads", rowToCandle(good) !== null);

  const nulled = { ...good, l: null as unknown as string };
  check("a null price is dropped", rowToCandle(nulled) === null);
  check("a NaN price is dropped", rowToCandle({ ...good, h: "not-a-number" }) === null);
  check("a zero price is dropped", rowToCandle({ ...good, o: "0" }) === null);
  check("a negative price is dropped", rowToCandle({ ...good, c: "-5" }) === null);
  check("a non-finite bucket is dropped", rowToCandle({ ...good, bucket_start: Infinity }) === null);

  /* n is the one field allowed to be missing: an absent count is 0, not a
     reason to throw the price away. */
  const noN = rowToCandle({ ...good, n: undefined as unknown as number });
  check("a missing n defaults to zero, keeps the candle", noN !== null && noN.n === 0);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
