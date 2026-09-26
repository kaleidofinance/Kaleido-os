/**
 * How far the points-swap indexer may advance its block cursor after a run.
 *
 * The run scans [fromBlock, scanTo] and processes at most `maxTxs` transactions,
 * oldest block first. The cursor must move only past blocks it FULLY drained, so
 * a capped run re-scans the remainder next run (idempotent — point_actions is
 * keyed by tx_hash). Pure arithmetic so it can be tested without RPC or a DB.
 */
export function computeCursorAdvance(opts: {
  fromBlock: number;
  scanTo: number;
  /** Block number of each UNIQUE tx in the scanned range, ascending. */
  uniqueTxBlocks: number[];
  maxTxs: number;
}): { advancedTo: number; blockCapOverflow: boolean } {
  const { fromBlock, scanTo, uniqueTxBlocks, maxTxs } = opts;

  // Everything in the range was processed → the whole range is drained.
  if (uniqueTxBlocks.length <= maxTxs)
    return { advancedTo: scanTo, blockCapOverflow: false };

  // We stopped at the cap. The first tx we did NOT process sits at this block,
  // which is therefore only partially drained — stop one block before it.
  const firstExcludedBlock = uniqueTxBlocks[maxTxs];
  let advancedTo = firstExcludedBlock - 1;
  let blockCapOverflow = false;

  // Pathological: a single block holds more than maxTxs fee-swaps, so we cannot
  // even finish its own block. Accept it as done rather than stall forever; the
  // surplus in that block is dropped (the caller should raise maxTxs).
  if (advancedTo < fromBlock) {
    advancedTo = firstExcludedBlock;
    blockCapOverflow = true;
  }
  return { advancedTo, blockCapOverflow };
}

/**
 * The backfill range requested on the points-swap cron, or why it is invalid.
 *
 * The live run only moves forward from its cursor, so a direct native-pool trade
 * from before that scan learned to read pool `Swap` events sits behind the cursor
 * and was never credited or counted. A backfill re-scans an explicit historical
 * range instead. Both ends are required and must be whole block numbers with
 * from <= to; `dryRun` is only meaningful WITH a range (a dry live run would
 * still move the cursor past trades it did not credit), so it is refused alone.
 * Pure so the gate is tested without a request.
 */
export function parseBackfillParams(params: {
  get(name: string): string | null;
}):
  | { mode: "live" }
  | { mode: "backfill"; from: number; to: number; dryRun: boolean }
  | { mode: "invalid"; error: string } {
  const from = params.get("backfillFrom");
  const to = params.get("backfillTo");
  const dryRun = params.get("dryRun") === "1";
  if (from === null && to === null) {
    return dryRun
      ? { mode: "invalid", error: "dryRun needs a backfill range (backfillFrom + backfillTo)" }
      : { mode: "live" };
  }
  if (from === null || to === null || !/^\d+$/.test(from) || !/^\d+$/.test(to)) {
    return { mode: "invalid", error: "backfillFrom and backfillTo must both be whole block numbers" };
  }
  const f = Number(from);
  const t = Number(to);
  if (f > t) return { mode: "invalid", error: "backfillFrom must not be after backfillTo" };
  return { mode: "backfill", from: f, to: t, dryRun };
}

/**
 * Where the next backfill call should resume, or null when the range is done.
 * `drainedTo` is computeCursorAdvance's `advancedTo` for this call — the last
 * block fully processed — so resuming one past it neither skips nor repeats.
 */
export function backfillNextFrom(
  drainedTo: number | null,
  to: number,
): number | null {
  if (drainedTo === null || drainedTo >= to) return null;
  return drainedTo + 1;
}
