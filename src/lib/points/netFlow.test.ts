/*
 * Round-trip netting for swap points. Run with `npm run test:netflow`.
 * The regression: a USDC→EURC→USDC round trip earned points on both legs.
 */
import { USD_ASSET, assetKey, netCreditableUsd, swapAssets, type SwapLeg } from "./netFlow.ts";

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

const USDC = "0x3600000000000000000000000000000000000000";
const WUSDC = "0x8c6c0a4c5500c2bc196383b4d85feb7f08a5c75b";
const EURC = "0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1";
const BTC = "0x171a4217b86a807a64eb94757db6849fb4bdbaa0";
const USD_TOKENS = [USDC, WUSDC];
const W = "0x3238000000000000000000000000000000006f27";
const ROUTER = "0x6131b5fae19ea4f9d964eac0408e4408b66337b5";

const buy = (usd: number, asset = EURC): SwapLeg => ({ assetIn: USD_ASSET, assetOut: asset, usd });
const sell = (usd: number, asset = EURC): SwapLeg => ({ assetIn: asset, assetOut: USD_ASSET, usd });
const credit = (legs: SwapLeg[]) => legs.map((leg, i) => netCreditableUsd(legs.slice(0, i), leg));
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

console.log("\n— round trips —");
{
  const c = credit([buy(260), sell(258.86)]);
  check("the measured $260 round trip earns on one leg only", c[0] === 260 && c[1] === 0, JSON.stringify(c));
}
{
  // The 25 Sep pattern: $101 out, split back in three, then out again. Net runs
  // +101 → +50.71 → -0.29 → -50.66 → +50.13, never past the first high of 101,
  // so the whole $353 of gross volume earns on $101.
  const c = credit([buy(101), sell(50.29), sell(51), sell(50.37), buy(100.79)]);
  const total = c.reduce((a, x) => a + x, 0);
  check(
    "a split-and-return sequence earns on its net high ($101), not its gross ($353)",
    near(c[0], 101) && c.slice(1).every((x) => x === 0) && near(total, 101),
    JSON.stringify(c),
  );
}
{
  const c = credit([buy(100), sell(99), buy(100)]);
  check("buying back after a return earns only past the previous high", c[0] === 100 && c[1] === 0 && near(c[2], 1), JSON.stringify(c));
}

console.log("\n— genuine trading still earns —");
{
  const c = credit([buy(100), buy(100)]);
  check("two buys in the same direction both earn", c[0] === 100 && c[1] === 100, JSON.stringify(c));
}
{
  const c = credit([buy(100, EURC), buy(100, BTC)]);
  check("different pairs never net against each other", c[0] === 100 && c[1] === 100, JSON.stringify(c));
}
{
  const c = credit([buy(100, EURC), sell(100, EURC), buy(100, BTC)]);
  check("rotating EURC out and into cirBTC still pays the new pair", c[2] === 100, JSON.stringify(c));
}
{
  const c = credit([buy(100), sell(300)]);
  check("a net seller earns on what pushes past the day's high", c[0] === 100 && c[1] === 100, JSON.stringify(c));
}
check("nothing earlier that day → the full size", netCreditableUsd([], buy(42)) === 42);
check("never more than the swap's own size", netCreditableUsd([sell(1000)], buy(10)) <= 10);
check("zero or negative size earns nothing", netCreditableUsd([], buy(0)) === 0 && netCreditableUsd([], buy(-5)) === 0);
check("a same-asset 'swap' earns nothing", netCreditableUsd([], { assetIn: EURC, assetOut: EURC, usd: 50 }) === 0);

console.log("\n— the dollar assets are one asset —");
check("0x3600 USDC and wrapped-native both key as usd", assetKey(USDC, USD_TOKENS) === USD_ASSET && assetKey(WUSDC.toUpperCase().replace("0X", "0x"), USD_TOKENS) === USD_ASSET);
check("any other token keys as its lowercased address", assetKey(EURC.toUpperCase().replace("0X", "0x"), USD_TOKENS) === EURC);

console.log("\n— reading a swap's assets from its transfers —");
{
  const a = swapAssets({
    wallet: W,
    inputToken: USDC,
    transfers: [
      { token: USDC, from: W, to: ROUTER, value: 260_000_000n },
      { token: EURC, from: ROUTER, to: "0xfee0000000000000000000000000000000000000", value: 1n },
      { token: EURC, from: ROUTER, to: W, value: 228_000_000n },
    ],
    usdTokens: USD_TOKENS,
  });
  check("USDC in, EURC out", !!a && a.assetIn === USD_ASSET && a.assetOut === EURC, JSON.stringify(a));
}
{
  const a = swapAssets({
    wallet: W,
    inputToken: EURC,
    transfers: [{ token: EURC, from: W, to: ROUTER, value: 228_000_000n }],
    usdTokens: USD_TOKENS,
  });
  check("EURC in with no ERC-20 arrival = native USDC out", !!a && a.assetIn === EURC && a.assetOut === USD_ASSET, JSON.stringify(a));
}
{
  const a = swapAssets({
    wallet: W,
    inputToken: WUSDC,
    transfers: [
      { token: WUSDC, from: W, to: ROUTER, value: 10n ** 18n },
      { token: USDC, from: ROUTER, to: W, value: 1_000_000n },
    ],
    usdTokens: USD_TOKENS,
  });
  check("a dollar-for-dollar move has no distinct output → unclassified (credited as before)", a === null, JSON.stringify(a));
}
{
  const a = swapAssets({ wallet: W, inputToken: USDC, transfers: [{ token: USDC, from: W, to: ROUTER, value: 5n }], usdTokens: USD_TOKENS });
  check("dollar in with no visible output → unclassified, not guessed", a === null);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
