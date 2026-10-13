/**
 * Platform totals — the pool strip's cumulative "Total volume/fees", checked
 * offline. Run: `npx tsx src/lib/stats/platform.test.ts`.
 *
 * The three readers (swaps, CCTP bridges, route bridges) and the LI.FI fee rate
 * are injected, so the summing, the fee derivation and the degradation rules are
 * tested with no database and no env.
 */

import {
  readPlatformTotals,
  sumBridgeVolume,
  sumRouteBridgeVolume,
  type BridgeStats,
  type PlatformDeps,
} from "@/lib/stats/platform";
import { toAggregatorStats, type AggregatorStats } from "@/lib/stats/aggregator";

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
const bridge = (volumeUsd: number, count = 2): BridgeStats => ({ volumeUsd, count });

function deps(
  s: AggregatorStats | null,
  c: BridgeStats | null,
  r: BridgeStats | null,
  feeRate = 0,
): PlatformDeps {
  return {
    swaps: async () => s,
    cctpBridge: async () => c,
    routeBridge: async () => r,
    feeRate: () => feeRate,
  };
}

async function main() {
  console.log("— pure sums —");
  check("sumBridgeVolume sums positive amounts", sumBridgeVolume([{ amount: "10" }, { amount: "5.5" }]) === 15.5);
  check("sumBridgeVolume ignores junk", sumBridgeVolume([{ amount: "x" }, { amount: null }, { amount: "-4" }, {}]) === 0);
  check("sumRouteBridgeVolume sums usd_value", sumRouteBridgeVolume([{ usd_value: 100 }, { usd_value: "50" }]) === 150);
  check("sumRouteBridgeVolume ignores null/neg", sumRouteBridgeVolume([{ usd_value: null }, { usd_value: -1 }, {}]) === 0);

  console.log("\n— all three sources, with a LI.FI fee —");
  {
    const r = await readPlatformTotals(deps(swaps(1000, 2), bridge(300), bridge(500), 0.002));
    check("volume = swaps + cctp + route", r?.volumeUsd === 1800, r?.volumeUsd);
    check("fees = swap fees + route*feeRate", r?.feesUsd === 2 + 500 * 0.002, r?.feesUsd);
    check("breakdown carries route bridge + bridge fees", r?.breakdown.routeBridgeVolumeUsd === 500 && r?.breakdown.bridgeFeesUsd === 1);
    check(
      "all sources present → not partial",
      r?.partial === false &&
        r?.sources.swaps === true &&
        r?.sources.cctpBridge === true &&
        r?.sources.routeBridge === true,
      JSON.stringify({ partial: r?.partial, sources: r?.sources }),
    );
  }

  console.log("\n— a source reading 0 is available, not missing —");
  {
    const r = await readPlatformTotals(deps(swaps(0, 0, 0), bridge(0, 0), bridge(0, 0), 0.002));
    check("all zero volume", r?.volumeUsd === 0);
    check("a real 0 is not a gap → not partial", r?.partial === false, JSON.stringify(r?.sources));
  }

  console.log("\n— fee rate 0 → no bridge-fee revenue —");
  {
    const r = await readPlatformTotals(deps(swaps(1000, 2), null, bridge(500), 0));
    check("route volume counts even when the fee is off", r?.volumeUsd === 1500);
    check("fees are just swap fees when LIFI_FEE is 0", r?.feesUsd === 2);
  }

  console.log("\n— partial: one source down still returns a real total —");
  {
    const r = await readPlatformTotals(deps(swaps(1000, 2), null, null, 0.002));
    check("only swaps → swaps-only volume", r?.volumeUsd === 1000);
    check("only swaps → cctp + route breakdown null", r?.breakdown.cctpBridgeVolumeUsd === null && r?.breakdown.routeBridgeVolumeUsd === null);
    check(
      "a missing source flags partial and names which answered",
      r?.partial === true &&
        r?.sources.swaps === true &&
        r?.sources.cctpBridge === false &&
        r?.sources.routeBridge === false,
      JSON.stringify({ partial: r?.partial, sources: r?.sources }),
    );
  }
  {
    const r = await readPlatformTotals(deps(null, null, bridge(500), 0.002));
    check("only route bridges → volume + fees from route", r?.volumeUsd === 500 && r?.feesUsd === 1);
    check("only route bridges → partial, only routeBridge available", r?.partial === true && r?.sources.routeBridge === true && r?.sources.swaps === false);
  }

  console.log("\n— swap fees are charged on fee-paying volume only —");
  {
    const row = { swap_count: 3, volume_usd: "124", fees_usd: "0.2", last_occurred_at: null, fee_volume_usd: "104" };
    const s = toAggregatorStats(row, 20);
    check("volume is all swaps", s.volumeUsd === 124, s.volumeUsd);
    check("fees = fee-paying volume × rate (a direct pool trade pays none)", Math.abs(s.feesUsd - 104 * 0.002) < 1e-9, s.feesUsd);
    const pre = toAggregatorStats({ swap_count: 1, volume_usd: 100, fees_usd: 0.2, last_occurred_at: null }, 20);
    check("before the migration (no fee_volume_usd) fees fall back to total volume", Math.abs(pre.feesUsd - 0.2) < 1e-9, pre.feesUsd);
  }

  console.log("\n— every source down → null —");
  check("all null → null", (await readPlatformTotals(deps(null, null, null, 0.002))) === null);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
