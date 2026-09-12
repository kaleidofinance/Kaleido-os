// Checks on route construction that do not need a chain — `intermediateTokens`
// is a pure projection of the registry, and its one subtle case is Arc, where
// "USDC" wears two faces at two decimal scalings. Run with `npm run test:route`.
//
// WHY THIS EXISTS. Arc's registered USDC is a precompile at 0x3600… that mirrors
// the native balance at 6 decimals, while the token pools actually hold is the
// 18-decimal wrapped-native WUSDC. `intermediateTokens` used to return the 6-dec
// alias as the USDC middle leg, guarded by a comment claiming it deduped against
// WUSDC — it did not (different addresses), so the search carried a candidate no
// pool uses, and a route crossing its 6 decimals against WUSDC's 18 would be
// mispriced by 10^12 the day a USDC pool is seeded on Arc. This pins the fix:
// the native-alias face is excluded, and WUSDC is the USDC-equivalent leg.
import { intermediateTokens, findRouteAcrossSources } from "./route.ts";

let pass = 0;
let fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

const ARC = 5042002;
const SEPOLIA = 11155111;
const BSC = 97;
const ROBINHOOD = 4663;

const NATIVE_ALIAS = "0x3600000000000000000000000000000000000000";

console.log("\n— Arc: the native-alias USDC face is never a swap intermediate —");
{
  const mids = intermediateTokens(ARC);
  const syms = mids.map((t) => `${t.symbol}(${t.decimals}d)`).join(", ");

  check(
    "the 6-decimal 0x3600 alias is excluded",
    !mids.some((t) => t.address.toLowerCase() === NATIVE_ALIAS),
    syms,
  );
  check(
    "no 6-decimal token is labelled USDC among the intermediates",
    !mids.some((t) => t.symbol.toUpperCase() === "USDC" && t.decimals === 6),
    syms,
  );
  /* The wrapped-native IS the USDC-equivalent leg on Arc, at 18 decimals — the
     form pools hold. It reaches the list through `wrapped`, not `bySymbol`. */
  check(
    "WUSDC (18 decimals) is present as the USDC-equivalent leg",
    mids.some((t) => t.symbol.toUpperCase() === "WUSDC" && t.decimals === 18),
    syms,
  );
  /* Every intermediate that survives must carry a real 20-byte address and a
     positive decimal count — a malformed leg becomes a "0x" path that reverts. */
  check(
    "every Arc intermediate is well-formed",
    mids.every(
      (t) => /^0x[0-9a-fA-F]{40}$/.test(t.address) && t.decimals > 0,
    ),
    syms,
  );
}

console.log("\n— other chains keep their real 6-decimal USDC leg —");
{
  for (const [id, name] of [
    [SEPOLIA, "Sepolia"],
    [BSC, "BSC"],
  ]) {
    const mids = intermediateTokens(id);
    const syms = mids.map((t) => `${t.symbol}(${t.decimals}d)`).join(", ");
    /* On every chain but Arc, USDC is a genuine 6-decimal ERC20 that pools use,
       and it must stay the quote-asset leg — the fix must not have reached it. */
    check(
      `${name} still carries USDC at 6 decimals`,
      mids.some((t) => t.symbol.toUpperCase() === "USDC" && t.decimals === 6),
      syms,
    );
    check(
      `${name} has no duplicate addresses`,
      new Set(mids.map((t) => t.address.toLowerCase())).size === mids.length,
      syms,
    );
  }
}

console.log("\n— Robinhood mainnet carries WETH and USDG as quote-asset legs —");
{
  const mids = intermediateTokens(ROBINHOOD);
  const syms = mids.map((t) => `${t.symbol}(${t.decimals}d)`).join(", ");
  check(
    "USDG (6 decimals) is an intermediate on Robinhood",
    mids.some((t) => t.symbol.toUpperCase() === "USDG" && t.decimals === 6),
    syms,
  );
  check(
    "WETH (18 decimals) is an intermediate on Robinhood",
    mids.some((t) => t.symbol.toUpperCase() === "WETH" && t.decimals === 18),
    syms,
  );
  check(
    "no duplicate Robinhood intermediates",
    new Set(mids.map((t) => t.address.toLowerCase())).size === mids.length,
    syms,
  );
}

console.log("\n— findRouteAcrossSources: our pools first, venue only as fallback —");
const runAsync = async () => {
  const A = { address: "0x" + "a".repeat(40), symbol: "A", decimals: 18 };
  const B = { address: "0x" + "b".repeat(40), symbol: "B", decimals: 18 };
  const OUR_ROUTER = "0x" + "d".repeat(40);
  const VENUE = {
    id: "uniswap-v3",
    label: "Uniswap V3",
    kind: "uniswap-v3",
    factory: "0x" + "f".repeat(40),
    router: "0x" + "c".repeat(40),
    quoter: "0x" + "e".repeat(40),
  };
  const nullQuote = async () => null;
  const hitQuote = async () => "5";
  let venueCalls = 0;
  const venueQuote = async () => {
    venueCalls++;
    return "7";
  };

  // Ours can't fill (null) → falls back to the venue, carrying its router/venue.
  const fellBack = await findRouteAcrossSources(SEPOLIA, A, B, "1", [
    { quote: nullQuote, router: OUR_ROUTER, venue: null },
    { quote: venueQuote, router: VENUE.router, venue: VENUE },
  ]);
  check(
    "falls back to the venue when our pools have no route",
    !!fellBack && fellBack.venue === VENUE && fellBack.router === VENUE.router,
    JSON.stringify(fellBack && { venue: fellBack.venue?.id, router: fellBack.router }),
  );

  // Ours fills → the venue is never quoted (first-hit; our liquidity preferred).
  venueCalls = 0;
  const ours = await findRouteAcrossSources(SEPOLIA, A, B, "1", [
    { quote: hitQuote, router: OUR_ROUTER, venue: null },
    { quote: venueQuote, router: VENUE.router, venue: VENUE },
  ]);
  check(
    "prefers our pools and does not quote the venue when ours fills",
    !!ours && ours.venue === null && ours.router === OUR_ROUTER && venueCalls === 0,
    JSON.stringify({ venue: ours && ours.venue, router: ours && ours.router, venueCalls }),
  );

  // Nobody can fill → null, not a throw.
  const none = await findRouteAcrossSources(SEPOLIA, A, B, "1", [
    { quote: nullQuote, router: OUR_ROUTER, venue: null },
    { quote: nullQuote, router: VENUE.router, venue: VENUE },
  ]);
  check("null when no source can fill", none === null, String(none));
};

runAsync().then(() => {
  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
});
