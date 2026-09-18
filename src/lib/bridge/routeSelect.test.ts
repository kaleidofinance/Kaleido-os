/**
 * The USDC dual-route selection, checked directly.
 *
 *   npx tsx src/lib/bridge/routeSelect.test.ts
 *
 * This is the whole behaviour change in feat/bridge-instant-default: on a USDC/
 * CCTP corridor two good routes exist — an instant aggregator solver-fill and
 * CCTP's exact 1:1 burn — and `pickBridgeRoutes` decides which is primary and
 * pairs it with the other as the alternative. Pure and offline: the network
 * helpers resolve the two routes, this only chooses, so the choice is tested
 * with fakes here and the resolver's wiring is exercised live in route.check.ts.
 */

import {
  pickBridgeRoutes,
  INSTANT_PREFERRED_MAX_USDC,
  INSTANT_MAX_ETA_SECONDS,
} from "@/lib/bridge/route";
import type { BridgeRoute } from "@/lib/v2/intents/build";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`  FAIL: ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`);
  }
}

/* Two recognisable fakes. Only `provider`/`receivedUnits` matter to the picker;
   the rest is filler so they type as BridgeRoute. */
const INSTANT: BridgeRoute = {
  to: "0xrouter",
  data: "0x",
  value: "0",
  toChainId: 8453,
  toChainName: "Base",
  provider: "lifi",
  etaSeconds: 2,
  receivedUnits: "9970700", // 9.9707 USDC — 1:1 minus the solver spread
};
/* Same instant fill but quoted SLOW — an ~18-minute message-bridge corridor. */
const INSTANT_SLOW: BridgeRoute = {
  ...({
    to: "0xrouter",
    data: "0x",
    value: "0",
    toChainId: 5042,
    toChainName: "Arc",
    provider: "lifi",
    etaSeconds: INSTANT_MAX_ETA_SECONDS + 900,
    receivedUnits: "9975000",
  } as BridgeRoute),
};
const INSTANT_NO_ETA: BridgeRoute = {
  ...({
    to: "0xrouter",
    data: "0x",
    value: "0",
    toChainId: 8453,
    toChainName: "Base",
    provider: "lifi",
    etaSeconds: null,
    receivedUnits: "9970000",
  } as BridgeRoute),
};

const EXACT: BridgeRoute = {
  to: "0xtokenmessenger",
  data: "0x",
  value: "0",
  toChainId: 8453,
  toChainName: "Base",
  provider: "cctp",
  etaSeconds: null,
  receivedUnits: "10000000", // exactly 10 USDC
};

const BELOW = 10; // $10, well under the threshold
const ABOVE = INSTANT_PREFERRED_MAX_USDC; // exactly at the threshold → exact
const WAY_ABOVE = INSTANT_PREFERRED_MAX_USDC * 4;

console.log("— default (no route pref): amount decides —");
{
  const r = pickBridgeRoutes({ instant: INSTANT, exact: EXACT, amountNum: BELOW });
  check("small amount → instant is primary", r?.primary === INSTANT);
  check("small amount → exact is the alternative", r?.alternative === EXACT);
}
{
  const r = pickBridgeRoutes({ instant: INSTANT, exact: EXACT, amountNum: ABOVE });
  check("at the threshold → exact is primary", r?.primary === EXACT, r?.primary.provider);
  check("at the threshold → instant is the alternative", r?.alternative === INSTANT);
}
{
  const r = pickBridgeRoutes({ instant: INSTANT, exact: EXACT, amountNum: WAY_ABOVE });
  check("well above → exact is primary", r?.primary === EXACT);
}
{
  const r = pickBridgeRoutes({ instant: INSTANT, exact: EXACT, amountNum: INSTANT_PREFERRED_MAX_USDC - 1 });
  check("just below the threshold → instant is primary", r?.primary === INSTANT);
}

console.log("— an explicit route preference overrides the amount —");
{
  const r = pickBridgeRoutes({ instant: INSTANT, exact: EXACT, route: "exact", amountNum: BELOW });
  check('route:"exact" on a small amount → exact primary', r?.primary === EXACT);
  check('route:"exact" → instant is the alternative', r?.alternative === INSTANT);
}
{
  const r = pickBridgeRoutes({ instant: INSTANT, exact: EXACT, route: "instant", amountNum: WAY_ABOVE });
  check('route:"instant" on a large amount → instant primary', r?.primary === INSTANT);
  check('route:"instant" → exact is the alternative', r?.alternative === EXACT);
}

console.log("— fallback when only one route resolved —");
{
  const r = pickBridgeRoutes({ instant: INSTANT, exact: null, amountNum: WAY_ABOVE });
  check("exact missing, large amount → still returns instant", r?.primary === INSTANT);
  check("exact missing → no alternative", r?.alternative === null);
}
{
  const r = pickBridgeRoutes({ instant: null, exact: EXACT, amountNum: BELOW });
  check("instant missing, small amount → still returns exact", r?.primary === EXACT);
  check("instant missing → no alternative", r?.alternative === null);
}
{
  const r = pickBridgeRoutes({ instant: null, exact: EXACT, route: "instant", amountNum: BELOW });
  check('route:"instant" but instant missing → falls back to exact', r?.primary === EXACT);
}
{
  const r = pickBridgeRoutes({ instant: null, exact: null, amountNum: BELOW });
  check("both missing → null", r === null);
}

console.log("— a non-finite amount is treated as large (prefers the exact 1:1) —");
{
  const r = pickBridgeRoutes({ instant: INSTANT, exact: EXACT, amountNum: Number.NaN });
  check("NaN amount → exact primary (unknown size is not \"small\")", r?.primary === EXACT);
  check("NaN amount → instant is the alternative", r?.alternative === INSTANT);
}

console.log("— a slow instant fill loses to the exact 1:1 even when small —");
{
  const r = pickBridgeRoutes({ instant: INSTANT_SLOW, exact: EXACT, amountNum: BELOW });
  check("slow instant (18 min) + small → exact is primary", r?.primary === EXACT, r?.primary.provider);
  check("slow instant → it is the alternative", r?.alternative === INSTANT_SLOW);
}
{
  const r = pickBridgeRoutes({ instant: INSTANT_NO_ETA, exact: EXACT, amountNum: BELOW });
  check("unknown instant ETA + small → exact is primary", r?.primary === EXACT);
}
{
  // A user who explicitly wants instant still gets it, slow or not.
  const r = pickBridgeRoutes({ instant: INSTANT_SLOW, exact: EXACT, route: "instant", amountNum: BELOW });
  check('route:"instant" overrides a slow ETA → instant primary', r?.primary === INSTANT_SLOW);
}
{
  // No exact route (non-CCTP corridor): a slow instant is still returned.
  const r = pickBridgeRoutes({ instant: INSTANT_SLOW, exact: null, amountNum: BELOW });
  check("slow instant with no exact alternative → still returns instant", r?.primary === INSTANT_SLOW);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
