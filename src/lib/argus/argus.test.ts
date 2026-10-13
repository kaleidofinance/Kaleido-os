/**
 * Argus pool math — pool identity, price, swap direction and the hook cost
 * schedule. Pure; the reader (launch.ts) is exercised on-chain, not here.
 * Run with `npx tsx src/lib/argus/argus.test.ts`.
 *
 * The poolId case is a REGRESSION VECTOR verified against the live chain
 * 2026-09-23: computePoolId(...) for the ARGONAUT launch returned this id, and
 * Uniswap v4 StateView.getSlot0(id) answered with a real price — which it only
 * does for a correctly-derived, initialized pool id.
 */
import {
  orderCurrencies,
  computePoolId,
  priceFromSqrtX96,
  swapDirection,
  effectiveCostBps,
  isSnipeWindow,
  COMBINED_RATE_CAP_BPS,
  POOL_FEE_BPS,
} from "./poolMath.ts";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, got?: string) => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — ${got}`}`); }
};

console.log("\n— currency ordering —");
{
  const USDC = "0x3600000000000000000000000000000000000000";
  const TOKEN = "0x6A70f331a702d0604D9e985d7822ed22D3a0C2fb";
  const o = orderCurrencies(TOKEN, USDC);
  check("lower address sorts to currency0", o.currency0.toLowerCase() === USDC.toLowerCase(), o.currency0);
  check("tokenA (the token) is NOT token0 here", o.tokenIsToken0 === false);
  const o2 = orderCurrencies(USDC, TOKEN);
  check("ordering is stable regardless of arg order", o2.currency0.toLowerCase() === USDC.toLowerCase());
}

console.log("\n— poolId (live-verified regression vector) —");
{
  const USDC = "0x3600000000000000000000000000000000000000";
  const TOKEN = "0x6A70f331a702d0604D9e985d7822ed22D3a0C2fb"; // ARGONAUT
  const HOOK = "0x551FD9a18C67d498F3ac8C3F08b9f13EFA1Da044";
  const EXPECTED = "0xf1068051eefe28e362eb047e0bb92cc1edbb80e69a3fc0822ac72f6112bc0c01";
  const id = computePoolId(USDC, TOKEN, HOOK);
  check("ARGONAUT poolId matches on-chain-verified value", id === EXPECTED, id);
  check("poolId is a 32-byte hex", /^0x[0-9a-f]{64}$/.test(id));
  const swapped = computePoolId(TOKEN, USDC, HOOK);
  check("poolId is order-sensitive (currencies not auto-sorted)", swapped !== id);
}

console.log("\n— price from sqrtPriceX96 —");
{
  const Q96 = 2n ** 96n;
  // sqrt = 2^96 → r = 1. Equal decimals → price 1.
  check("r=1 with equal decimals → 1", Math.abs(priceFromSqrtX96(Q96, true, 18, 18) - 1) < 1e-9);
  // token is currency0, token 18-dec vs quote 6-dec → ×10^12.
  check("decimal scaling applies (token0, 18 vs 6)", Math.abs(priceFromSqrtX96(Q96, true, 18, 6) - 1e12) / 1e12 < 1e-9);
  // token is currency1 → invert r (still 1 here).
  check("token1 inverts r", Math.abs(priceFromSqrtX96(Q96, false, 18, 18) - 1) < 1e-9);
  check("zero sqrt → 0 price", priceFromSqrtX96(0n, true, 18, 18) === 0);
}

console.log("\n— swap direction (v4 zeroForOne) —");
{
  // token is currency1: buy = quote(c0)→token(c1) = zeroForOne true.
  check("buy, token=currency1 → zeroForOne", swapDirection("buy", false).zeroForOne === true);
  check("sell, token=currency1 → !zeroForOne", swapDirection("sell", false).zeroForOne === false);
  // token is currency0: buy = quote(c1)→token(c0) = zeroForOne false.
  check("buy, token=currency0 → !zeroForOne", swapDirection("buy", true).zeroForOne === false);
  check("sell, token=currency0 → zeroForOne", swapDirection("sell", true).zeroForOne === true);
}

console.log("\n— effective cost bps (pool fee + capped tax) —");
{
  check("1% tax, no snipe → 100 pool + 100 = 200", effectiveCostBps(100, 0) === POOL_FEE_BPS + 100, String(effectiveCostBps(100, 0)));
  check("10% tax + snipe caps the combined at 99%", effectiveCostBps(1000, 100000) === POOL_FEE_BPS + COMBINED_RATE_CAP_BPS, String(effectiveCostBps(1000, 100000)));
  check("leg+snipe under cap adds through", effectiveCostBps(300, 200) === POOL_FEE_BPS + 500);
  check("zero tax + zero snipe → just the pool fee", effectiveCostBps(0, 0) === POOL_FEE_BPS);
}

console.log("\n— snipe-window guard —");
{
  check("0 snipe is not the snipe window", isSnipeWindow(0) === false);
  check("3% snipe is at the guard edge (not over)", isSnipeWindow(300) === false);
  check("a big opening surcharge trips the guard", isSnipeWindow(9900) === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
