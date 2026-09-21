/**
 * Platform totals — the pool strip's cumulative "Total volume/fees", checked
 * offline. Run: `npx tsx src/lib/stats/platform.test.ts`.
 *
 * The two readers (swaps ledger, bridge ledger) are injected, so the summing and
 * the degradation rules are tested with no database.
 */

import {
  readPlatformTotals,
  sumBridgeVolume,
  type BridgeStats,
} from "@/lib/stats/platform";
import type { AggregatorStats } from "@/lib/stats/aggregator";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  FAIL: ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`);
  }
}

const swaps = (volumeUsd: number, feesUsd: number, swapCount = 3): AggregatorStats => ({
  swapCount,
  volumeUsd,
  feesUsd,
  lastOccurredAt: null,
  source: "verified-kyberswap-ledger",
  note: "",
});
const bridge = (volumeUsd: number, count = 2): BridgeStats => ({
  volumeUsd,
  count,
  source: "cctp-transfers",
});
const deps = (s: AggregatorStats | null, b: BridgeStats | null) => ({
  swaps: async () => s,
  bridge: async () => b,
});

async function main() {
  console.log("— sumBridgeVolume: human USDC amounts, junk ignored —");
  check("sums positive numeric amounts", sumBridgeVolume([{ amount: "10" }, { amount: "5.5" }]) === 15.5);
  check("ignores non-numeric / null / negative / zero", sumBridgeVolume([{ amount: "x" }, { amount: null }, { amount: "-4" }, { amount: "0" }, {}]) === 0);
  check("empty is 0", sumBridgeVolume([]) === 0);

  console.log("\n— readPlatformTotals: both sources —");
  {
    const r = await readPlatformTotals(deps(swaps(1000, 2), bridge(300)));
    check("volume is swaps + bridges", r?.volumeUsd === 1300, r?.volumeUsd);
    check("fees is swap fees only (bridge fees not indexed)", r?.feesUsd === 2);
    check("breakdown carries both", r?.breakdown.swapVolumeUsd === 1000 && r?.breakdown.bridgeVolumeUsd === 300);
  }

  console.log("\n— partial: one source down still returns a real total —");
  {
    const r = await readPlatformTotals(deps(swaps(1000, 2), null));
    check("bridge down → swaps-only volume", r?.volumeUsd === 1000);
    check("bridge down → bridge breakdown is null (not 0)", r?.breakdown.bridgeVolumeUsd === null);
  }
  {
    const r = await readPlatformTotals(deps(null, bridge(300)));
    check("swaps down → bridge-only volume", r?.volumeUsd === 300);
    check("swaps down → fees 0 and swap breakdown null", r?.feesUsd === 0 && r?.breakdown.swapVolumeUsd === null);
  }

  console.log("\n— both down → null (unavailable, not a confident zero) —");
  {
    const r = await readPlatformTotals(deps(null, null));
    check("both null → null", r === null);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
