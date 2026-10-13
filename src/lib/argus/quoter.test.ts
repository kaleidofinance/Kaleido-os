process.env.ARGUS_ENABLED = "1";
/**
 * Tax-aware Argus quoter — properties that a mistake would break: output grows
 * with input but sub-linearly (price impact), tax/snipe reduce output, the snipe
 * window is flagged, and a trade past the single position's range is flagged.
 * Run with `npx tsx src/lib/argus/quoter.test.ts`.
 */
import { quoteArgusSwap } from "./quoter.ts";
import type { ArgusLaunch, ArgusPoolState } from "./launch.ts";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, got?: string) => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — ${got}`}`); }
};

// Synthetic launch: token = currency1 (tokenIsToken0 false, like ARGONAUT), quote
// = currency0. 18-dec token, 6-dec quote. Wide range so normal trades stay in it.
const launch: ArgusLaunch = {
  token: "0x0000000000000000000000000000000000000001",
  portal: "0x0000000000000000000000000000000000000002",
  hook: "0x0000000000000000000000000000000000000003",
  splitter: "0x0000000000000000000000000000000000000004",
  locker: "0x0000000000000000000000000000000000000005",
  quoteAsset: "0x3600000000000000000000000000000000000000",
  buyTaxBps: 100,
  sellTaxBps: 100,
  tickStart: 0,
  tickBond: 800000,
  tokenIsToken0: false,
  positionId: 1n,
  currency0: "0x3600000000000000000000000000000000000000",
  currency1: "0x0000000000000000000000000000000000000001",
  poolId: "0x" + "11".repeat(32),
};
const sqrtP = 1e9;
const state = (snipeBps = 0): ArgusPoolState => ({
  sqrtPriceX96: BigInt(Math.round(sqrtP * 2 ** 96)),
  tick: 414486,
  liquidity: 10n ** 18n,
  snipeBps,
  bonded: false,
  pricePerTokenInQuote: 0,
  buyCostBps: 0,
  sellCostBps: 0,
});
const buy = (amtQuote6: bigint, snipe = 0, buyTax = 100) =>
  quoteArgusSwap({
    launch: { ...launch, buyTaxBps: buyTax },
    state: state(snipe),
    side: "buy",
    amountInRaw: amtQuote6,
    tokenDecimals: 18,
    quoteDecimals: 6,
  })!;

console.log("\n— basic buy —");
{
  const q = buy(1000n * 10n ** 6n); // 1000 USDC
  check("returns a quote", !!q && q.estimate === true);
  check("outputs a positive token amount", q.amountOut > 0, String(q.amountOut));
  check("total cost = pool 100 + tax 100 = 200 bps", q.totalCostBps === 200, String(q.totalCostBps));
  check("not in snipe window", q.snipeBlocked === false);
  check("stays within the position range", q.exhaustsRange === false);
}

console.log("\n— output grows with input, but sub-linearly (price impact) —");
{
  const q1 = buy(1000n * 10n ** 6n);
  const q2 = buy(2000n * 10n ** 6n);
  check("2× input → more output", q2.amountOut > q1.amountOut);
  check("…but less than 2× (impact)", q2.amountOut < 2 * q1.amountOut, `${q2.amountOut} vs ${2 * q1.amountOut}`);
  check("bigger trade has higher price impact", q2.priceImpactBps > q1.priceImpactBps, `${q2.priceImpactBps} vs ${q1.priceImpactBps}`);
}

console.log("\n— tax and snipe reduce output —");
{
  const base = buy(1000n * 10n ** 6n, 0, 100);
  const hiTax = buy(1000n * 10n ** 6n, 0, 1000); // 10% leg
  const sniped = buy(1000n * 10n ** 6n, 5000, 100); // +50% snipe
  check("higher leg tax → less output", hiTax.amountOut < base.amountOut, `${hiTax.amountOut} vs ${base.amountOut}`);
  check("snipe surcharge → even less output", sniped.amountOut < base.amountOut);
  check("snipe raises total cost", sniped.totalCostBps > base.totalCostBps, `${sniped.totalCostBps}`);
  check("snipe combined is capped at 99% + pool fee", buy(1000n * 10n ** 6n, 100000, 1000).totalCostBps === 100 + 9900);
}

console.log("\n— snipe-window guard —");
{
  check("snipe above guard → snipeBlocked", buy(1000n * 10n ** 6n, 5000).snipeBlocked === true);
  check("no snipe → not blocked", buy(1000n * 10n ** 6n, 0).snipeBlocked === false);
}

console.log("\n— range exhaustion on a huge trade —");
{
  const huge = buy(10n ** 18n * 10n ** 6n); // absurd size — drives price out of the range
  check("a trade past the position range is flagged", huge.exhaustsRange === true);
}

console.log("\n— sell returns the quote asset —");
{
  const q = quoteArgusSwap({
    launch, state: state(), side: "sell",
    amountInRaw: 1000n * 10n ** 18n, // 1000 tokens
    tokenDecimals: 18, quoteDecimals: 6,
  })!;
  check("sell produces a positive quote amount", q.amountOut > 0, String(q.amountOut));
  check("sell side recorded", q.side === "sell");
}

console.log("\n— disabled flag → null —");
{
  const prev = process.env.ARGUS_ENABLED;
  process.env.ARGUS_ENABLED = "";
  const q = quoteArgusSwap({ launch, state: state(), side: "buy", amountInRaw: 1n, tokenDecimals: 18, quoteDecimals: 6 });
  check("returns null when ARGUS_ENABLED is off", q === null);
  process.env.ARGUS_ENABLED = prev;
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
