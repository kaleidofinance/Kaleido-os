/**
 * The points-swap cursor advance: the arithmetic that decides how far the
 * indexer's block cursor moves after a run. A mistake here either skips swaps
 * (never credited) or stalls the cursor (nothing ever credited), so it is worth
 * pinning down. Run with `npx tsx src/lib/points/swapCursor.test.ts`.
 */
import { computeCursorAdvance } from "./swapCursor.ts";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, got?: string) => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — ${got}`}`); }
};

console.log("\n— fully drained (no overflow) → advance to scanTo —");
{
  const r = computeCursorAdvance({ fromBlock: 100, scanTo: 200, uniqueTxBlocks: [110, 150, 199], maxTxs: 500 });
  check("advances to scanTo", r.advancedTo === 200, String(r.advancedTo));
  check("no block-cap overflow", r.blockCapOverflow === false);
}
{
  // No txs at all still advances the whole empty range.
  const r = computeCursorAdvance({ fromBlock: 100, scanTo: 200, uniqueTxBlocks: [], maxTxs: 500 });
  check("empty range advances to scanTo", r.advancedTo === 200, String(r.advancedTo));
}
{
  // Exactly at the cap is NOT overflow.
  const r = computeCursorAdvance({ fromBlock: 100, scanTo: 200, uniqueTxBlocks: [110, 120, 130], maxTxs: 3 });
  check("exactly maxTxs is fully drained", r.advancedTo === 200 && !r.blockCapOverflow, JSON.stringify(r));
}

console.log("\n— overflow → stop before the first partial block —");
{
  // 4 txs, cap 2. First excluded tx is at block 130 → advance to 129.
  const r = computeCursorAdvance({ fromBlock: 100, scanTo: 200, uniqueTxBlocks: [110, 120, 130, 140], maxTxs: 2 });
  check("advances to firstExcludedBlock - 1", r.advancedTo === 129, String(r.advancedTo));
  check("not flagged as single-block overflow", r.blockCapOverflow === false);
}
{
  // The cap falls MID-block: blocks [120,120,120,150], cap 2. First excluded is
  // block 120 → advance to 119 so block 120 is fully re-scanned next run.
  const r = computeCursorAdvance({ fromBlock: 100, scanTo: 200, uniqueTxBlocks: [120, 120, 120, 150], maxTxs: 2 });
  check("re-scans a block split by the cap", r.advancedTo === 119, String(r.advancedTo));
  check("not a stall (119 >= fromBlock-1)", r.advancedTo >= 99);
}

console.log("\n— pathological: one block exceeds the cap → don't stall —");
{
  // fromBlock itself holds > maxTxs txs. Can't finish it; accept it as done so
  // the cursor moves forward, and flag it.
  const r = computeCursorAdvance({ fromBlock: 100, scanTo: 200, uniqueTxBlocks: [100, 100, 100, 100], maxTxs: 2 });
  check("advances to the block (no stall)", r.advancedTo === 100, String(r.advancedTo));
  check("flags block-cap overflow", r.blockCapOverflow === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
