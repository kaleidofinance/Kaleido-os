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
