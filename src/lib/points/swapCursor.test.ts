/**
 * The points-swap cursor advance: the arithmetic that decides how far the
 * indexer's block cursor moves after a run. A mistake here either skips swaps
 * (never credited) or stalls the cursor (nothing ever credited), so it is worth
 * pinning down. Run with `npx tsx src/lib/points/swapCursor.test.ts`.
 */
import {
  backfillNextFrom,
  computeCursorAdvance,
  parseBackfillParams,
} from "./swapCursor.ts";

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

console.log("\n— backfill params: the gate on re-scanning history —");
{
  const q = (o: Record<string, string>) => ({ get: (k: string) => (k in o ? o[k] : null) });
  check("no params → the live run", parseBackfillParams(q({})).mode === "live");
  const ok = parseBackfillParams(q({ backfillFrom: "100", backfillTo: "200" }));
  check(
    "a whole range → backfill, not a dry run",
    ok.mode === "backfill" && ok.from === 100 && ok.to === 200 && ok.dryRun === false,
    JSON.stringify(ok),
  );
  const dry = parseBackfillParams(q({ backfillFrom: "1", backfillTo: "2", dryRun: "1" }));
  check("dryRun=1 with a range → a dry backfill", dry.mode === "backfill" && dry.dryRun === true, JSON.stringify(dry));
  check(
    "dryRun alone is refused (a dry LIVE run would move the cursor past trades it did not credit)",
    parseBackfillParams(q({ dryRun: "1" })).mode === "invalid",
  );
  check("one end missing is refused", parseBackfillParams(q({ backfillFrom: "100" })).mode === "invalid");
  check("a non-integer end is refused", parseBackfillParams(q({ backfillFrom: "1e3", backfillTo: "2000" })).mode === "invalid");
  check("a negative end is refused", parseBackfillParams(q({ backfillFrom: "-5", backfillTo: "10" })).mode === "invalid");
  check("from after to is refused", parseBackfillParams(q({ backfillFrom: "300", backfillTo: "200" })).mode === "invalid");
}

console.log("\n— backfill resume point —");
{
  check("drained short of `to` → resume one past it", backfillNextFrom(150, 200) === 151);
  check("drained exactly to `to` → done", backfillNextFrom(200, 200) === null);
  check("drained past `to` (head clamp) → done", backfillNextFrom(250, 200) === null);
  check("nothing drained → done, never loops", backfillNextFrom(null, 200) === null);
}

console.log("\n— backfill sources + ledgerOnly —");
{
  const q = (o: Record<string, string>) => ({ get: (k: string) => (k in o ? o[k] : null) });
  const r = { backfillFrom: "1", backfillTo: "2" };
  const def = parseBackfillParams(q(r));
  check(
    "default: pools only, credits points (#449 behaviour unchanged)",
    def.mode === "backfill" && def.sources.pools && !def.sources.fee && !def.ledgerOnly,
    JSON.stringify(def),
  );
  const all = parseBackfillParams(q({ ...r, sources: "all", ledgerOnly: "1" }));
  check("sources=all + ledgerOnly", all.mode === "backfill" && all.sources.pools && all.sources.fee && all.ledgerOnly, JSON.stringify(all));
  const fee = parseBackfillParams(q({ ...r, sources: "fee" }));
  check("sources=fee re-scans only the fee wallet", fee.mode === "backfill" && fee.sources.fee && !fee.sources.pools, JSON.stringify(fee));
  const both = parseBackfillParams(q({ ...r, sources: "pools, fee" }));
  check("a comma list is accepted", both.mode === "backfill" && both.sources.fee && both.sources.pools, JSON.stringify(both));
  check("an unknown source is refused", parseBackfillParams(q({ ...r, sources: "bridge" })).mode === "invalid");
  check("ledgerOnly without a range is refused", parseBackfillParams(q({ ledgerOnly: "1" })).mode === "invalid");
  check("sources without a range is refused", parseBackfillParams(q({ sources: "fee" })).mode === "invalid");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
