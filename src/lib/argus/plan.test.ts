process.env.ARGUS_ENABLED = "1";
/**
 * Argus trade-plan assembler — the ordered steps Luca would sign, the snipe
 * block, and the min-out safety floor. Run with `npx tsx src/lib/argus/plan.test.ts`.
 */
import { buildArgusTradePlan } from "./plan.ts";
import type { ArgusLaunch, ArgusPoolState } from "./launch.ts";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, got?: string) => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — ${got}`}`); }
};

const USDC = "0x3600000000000000000000000000000000000000";
const TOKEN = "0x6A70f331a702d0604D9e985d7822ed22D3a0C2fb";
const launch: ArgusLaunch = {
  token: TOKEN, portal: "0x00000000000000000000000000000000000000B0", hook: "0x551FD9a18C67d498F3ac8C3F08b9f13EFA1Da044",
  splitter: "0x0000000000000000000000000000000000000004", locker: "0x0000000000000000000000000000000000000005",
  quoteAsset: USDC, buyTaxBps: 100, sellTaxBps: 100, tickStart: 0, tickBond: 800000,
  tokenIsToken0: false, positionId: 1n, currency0: USDC, currency1: TOKEN, poolId: "0x" + "11".repeat(32), poolFee: 10000,
};
const state = (snipeBps = 0): ArgusPoolState => ({
  sqrtPriceX96: BigInt(Math.round(1e9 * 2 ** 96)), tick: 414486, liquidity: 10n ** 18n,
  snipeBps, bonded: false, pricePerTokenInQuote: 0, buyCostBps: 0, sellCostBps: 0,
});
const plan = (opts: Partial<Parameters<typeof buildArgusTradePlan>[0]> = {}) =>
  buildArgusTradePlan({
    wallet: "0x000000000000000000000000000000000000dEaD", launch, state: state(),
    side: "buy", amountInRaw: 1000n * 10n ** 6n, tokenDecimals: 18, quoteDecimals: 6, ...opts,
  });

console.log("\n— happy path (buy) —");
{
  const p = plan()!;
  check("ok", p.ok === true, p.reason);
  check("three ordered steps: erc20 approve → permit2 → swap",
    p.steps.map((s) => s.kind).join(",") === "approve-erc20,approve-permit2,swap", p.steps.map((s) => s.kind).join(","));
  check("last step is the swap to the router", p.steps[2].to === p.swap!.to);
  check("carries a quote", !!p.quote && p.quote.amountOut > 0);
  check("min-out > 0 (protected)", p.amountOutMinimum > 0n);
  check("default Kaleido fee is 0 on Argus", p.kaleidoFeeBps === 0);
  check("plan is marked unverified", p.unverified === true);
}

console.log("\n— slippage lowers the min-out —");
{
  const tight = plan({ slippageBps: 50 })!;
  const loose = plan({ slippageBps: 1000 })!;
  check("looser slippage → lower min-out", loose.amountOutMinimum < tight.amountOutMinimum, `${loose.amountOutMinimum} vs ${tight.amountOutMinimum}`);
  check("min-out ≈ quote × (1 − slippage)", tight.amountOutMinimum < BigInt(Math.floor(tight.quote!.amountOut * 1e18)));
}

console.log("\n— snipe window blocks the plan —");
{
  const p = buildArgusTradePlan({ wallet: "0x000000000000000000000000000000000000dEaD", launch, state: state(5000), side: "buy", amountInRaw: 1000n * 10n ** 6n, tokenDecimals: 18, quoteDecimals: 6 })!;
  check("ok=false in snipe window", p.ok === false);
  check("reason mentions snipe", /snipe/i.test(p.reason ?? ""), p.reason);
  check("no steps emitted", p.steps.length === 0);
}

console.log("\n— sell path —");
{
  const p = plan({ side: "sell", amountInRaw: 1_000_000n * 10n ** 18n })!;
  check("sell ok with 3 steps", p.ok === true && p.steps.length === 3);
  check("sell approves the token first", p.steps[0].to.toLowerCase() === TOKEN.toLowerCase());
}

console.log("\n— gated off —");
{
  const prev = process.env.ARGUS_ENABLED;
  process.env.ARGUS_ENABLED = "";
  check("ARGUS_ENABLED off → null", plan() === null);
  process.env.ARGUS_ENABLED = prev;
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
