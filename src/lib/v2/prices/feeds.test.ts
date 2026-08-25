// Checks on the price-feed allowlist. Plain node, same as the other suites here.
//
// The bias under test: `/api/prices` makes an outbound request on behalf of
// whoever calls it, and the feed id lands inside the upstream URL. So the only
// thing standing between a caller-supplied string and an arbitrary outbound
// fetch is `feedFor` refusing to return anything it does not itself know. Every
// check below is some version of "a symbol we did not write down resolves to
// null" — and the second half asserts the registry cannot quietly grow a feed
// for a token that has no market.
import {
  DEFAULT_RANGE,
  RANGES,
  RANGE_SPECS,
  feedFor,
  hasFeed,
  isPriceRange,
} from "./feeds.ts";
// Relative, not "@/constants/registry" — plain node has no path aliases.
import { TOKENS } from "../../../constants/registry.ts";

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

console.log("\n— known symbols resolve —");
check("USDC resolves", feedFor("USDC") === "usd-coin");
check("case is normalised", feedFor("usdc") === "usd-coin");
check("surrounding space is trimmed", feedFor("  ETH  ") === "ethereum");
check(
  "wrapped native prices as its underlying",
  feedFor("WETH") === feedFor("ETH"),
);
check("WBNB prices as BNB", feedFor("WBNB") === feedFor("BNB"));
check(
  "every BTC wrapper shares one feed",
  feedFor("WBTC") === "bitcoin" &&
    feedFor("CBBTC") === "bitcoin" &&
    feedFor("BTCB") === "bitcoin",
);
check("hasFeed agrees with feedFor", hasFeed("DAI") && !hasFeed("KLD"));

console.log("\n— nothing else does —");
check("unknown symbol is null", feedFor("NOTATOKEN") === null);
check("empty string is null", feedFor("") === null);
check("null is null", feedFor(null) === null);
check("undefined is null", feedFor(undefined) === null);
check("a number is null", feedFor(42) === null);
check("an object is null", feedFor({ toString: () => "ETH" }) === null);
// The three that would actually hurt: each is a string that, interpolated into
// the upstream URL, would reach somewhere we did not intend.
check("path traversal is null", feedFor("../../etc/passwd") === null);
check(
  "a query-string smuggle is null",
  feedFor("ethereum&vs_currency=btc") === null,
);
check("an absolute URL is null", feedFor("https://evil.example") === null);
check(
  "a prototype key does not resolve",
  feedFor("constructor") === null &&
    feedFor("toString") === null &&
    feedFor("__proto__") === null,
);

console.log("\n— our own tokens have no feed, because they have no market —");
for (const sym of ["KLD", "KFUSD", "KAFUSD", "STKLD"]) {
  check(`${sym} is unpriced`, feedFor(sym) === null);
}
check("a testnet native is not its mainnet asset", feedFor("tBNB") === null);

console.log("\n— ranges —");
check("the default is a real range", RANGES.includes(DEFAULT_RANGE));
check(
  "every range has a spec",
  RANGES.every((r) => Boolean(RANGE_SPECS[r])),
);
check(
  "only 1H trims a window",
  RANGES.every((r) => (r === "1H") === (RANGE_SPECS[r].window !== null)),
);
check(
  "days and ttl are positive finite numbers",
  RANGES.every((r) => {
    const spec = RANGE_SPECS[r];
    return (
      Number.isFinite(spec.days) &&
      spec.days > 0 &&
      Number.isFinite(spec.ttl) &&
      spec.ttl > 0
    );
  }),
);
check(
  "a longer window is not cached more eagerly than a shorter one",
  RANGES.every(
    (r, i) => i === 0 || RANGE_SPECS[r].ttl >= RANGE_SPECS[RANGES[i - 1]].ttl,
  ),
);
check("isPriceRange accepts a known range", isPriceRange("1W"));
check(
  "isPriceRange rejects everything else",
  !isPriceRange("1w") &&
    !isPriceRange("2H") &&
    !isPriceRange("") &&
    !isPriceRange(null) &&
    !isPriceRange(7),
);

console.log("\n— registry coverage —");
{
  /*
   * Not "every registry token must have a feed" — that would make adding a
   * long-tail ERC20 a failing test, and an uncharted token is a supported state
   * the panel renders honestly. This is the weaker, useful claim: the symbols we
   * do carry are the ones users will actually pick, so a gap in the common ones
   * is worth knowing about. Reported, not enforced.
   */
  const symbols = new Set();
  for (const list of Object.values(TOKENS)) {
    for (const t of list) symbols.add(t.symbol.toUpperCase());
  }
  const missing = [...symbols].filter((s) => !hasFeed(s));
  if (missing.length > 0) {
    console.log(
      `  note registry symbols without a feed: ${missing.join(", ")}`,
    );
  }
  check(
    "the stablecoins in the registry are all priced",
    ["USDC", "USDT", "DAI"].every((s) => hasFeed(s)),
  );
  check("at least one registry symbol is charted", symbols.size > 0);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
