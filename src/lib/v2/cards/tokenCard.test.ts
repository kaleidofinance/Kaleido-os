// Paste a contract → token card. Run with plain node like the rest:
//   npx tsx src/lib/v2/cards/tokenCard.test.ts
//
// Three things are pinned here, in the order they fail most expensively:
// 1. every command a card button SENDS parses into the trade its label says
//    (a "Buy 5" that parsed as a sell would be the worst possible bug here);
// 2. the card is local-only — the wire validator drops it, the local one keeps it;
// 3. detection is narrow enough that a typed command still reaches the grammar.
import {
  pastedTokenAddress,
  tokenCardFrom,
  formatUsdPrice,
  formatUsdCompact,
  formatBps,
  type TokenFacts,
} from "./tokenCard.ts";
import { localCards, cardsFromChat } from "./fromChat.ts";
import { parseCommand } from "../intents/fromCommand.ts";
import { argusAddressToken } from "../../argus/token.ts";

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

const GLITCH = "0x08AdbF431569A1AaCAC2606d2aDCD18F4eBF2A71";
const ARGUS: TokenFacts = {
  ok: true,
  source: "argus",
  address: GLITCH,
  symbol: "GLITCH",
  name: "Glitch",
  decimals: 18,
  priceUsd: 0.00004103,
  marketCapUsd: 41_030,
  buyTaxBps: 100,
  sellTaxBps: 100,
  snipeActive: false,
  bonded: false,
};

console.log("\n— paste detection is narrow —");
{
  check("bare address", pastedTokenAddress(GLITCH) === GLITCH);
  check("bare address with surrounding space", pastedTokenAddress(`  ${GLITCH}\n`) === GLITCH);
  check(
    "explorer link → the token in the path",
    pastedTokenAddress(`https://arcscan.app/token/${GLITCH}`) === GLITCH,
  );
  check(
    "link with two addresses → the last one",
    pastedTokenAddress(
      `https://x.io/0x1111111111111111111111111111111111111111/token/${GLITCH}`,
    ) === GLITCH,
  );
  check("a typed buy command is NOT a paste", pastedTokenAddress(`buy ${GLITCH} with 5 usdc`) === null);
  check("a sentence mentioning an address is NOT a paste", pastedTokenAddress(`what is ${GLITCH}`) === null);
  check("41 hex chars is not an address", pastedTokenAddress("0x08AdbF431569A1AaCAC2606d2aDCD18F4eBF2A7") === null);
  check("plain word", pastedTokenAddress("glitch") === null);
  check("empty", pastedTokenAddress("   ") === null);
}

console.log("\n— formatting —");
{
  check("tiny price, no exponent", formatUsdPrice(0.00004103) === "$0.00004103", formatUsdPrice(0.00004103));
  check("sub-dollar price", formatUsdPrice(0.5) === "$0.5", formatUsdPrice(0.5));
  check("price over a dollar", formatUsdPrice(1234.5) === "$1,234.5", formatUsdPrice(1234.5));
  check("zero price is a dash, not $0", formatUsdPrice(0) === "—");
  check("compact market cap", formatUsdCompact(1_234_567) === "$1.2M", formatUsdCompact(1_234_567));
  check("bps → percent", formatBps(100) === "1%" && formatBps(250) === "2.5%");
}

console.log("\n— an Argus launch gets the full card —");
{
  const card = tokenCardFrom(ARGUS);
  check("kind is token", card.kind === "token");
  if (card.kind === "token") {
    check("symbol + short address", card.symbol === "GLITCH" && card.address === "0x08Ad…2A71", card.address);
    check("price formatted", card.price === "$0.00004103", card.price);
    check("badge says Argus launch", card.badge?.text === "Argus launch");
    const labels = card.rows.map((r) => r.label).join(",");
    check("rows: market cap, taxes, status", labels === "Market cap,Buy tax,Sell tax,Status", labels);
    check("1% taxes are not a warning", card.rows.every((r) => r.tone !== "warn"));
    check(
      "buy presets: 10/25/50/75/100%, none disabled",
      card.buys.map((b) => b.label).join(",") === "10%,25%,50%,75%,100%" && card.buys.every((b) => !b.disabled),
      card.buys.map((b) => b.label).join(","),
    );
    check("buy command spends a share of USDC, by address", card.buys[1].command === `buy ${GLITCH} with 25% of my usdc`, card.buys[1].command);
    check(
      "sell presets: 10/25/50/75/100%",
      card.sells.map((s) => s.label).join(",") === "10%,25%,50%,75%,100%",
    );
    check("no surcharge note when clear", card.note === undefined);
  }
}

console.log("\n— the opening surcharge greys the buys —");
{
  const card = tokenCardFrom({ ...ARGUS, snipeActive: true });
  if (card.kind === "token") {
    check("every buy disabled", card.buys.every((b) => b.disabled === true));
    check("sells stay live (exits aren't surcharged here)", card.sells.length === 5 && card.sells.every((s) => !("disabled" in s)));
    check("status row reads bad", card.rows.some((r) => r.label === "Status" && r.tone === "bad"));
    check("note explains the wait", Boolean(card.note?.includes("surcharge")));
  } else check("still a token card", false, card.kind);
}

console.log("\n— a heavy tax is flagged —");
{
  const card = tokenCardFrom({ ...ARGUS, sellTaxBps: 1000 });
  if (card.kind === "token") {
    check("10% sell tax tone warn", card.rows.some((r) => r.label === "Sell tax" && r.tone === "warn"));
  }
}

console.log("\n— a listed token trades by symbol —");
{
  const card = tokenCardFrom({
    ok: true,
    source: "listed",
    address: "0x1234567890abcdef1234567890abcdef12345678",
    symbol: "EURC",
    decimals: 6,
    priceUsd: null,
  });
  if (card.kind === "token") {
    check("buy command uses the symbol", card.buys[0].command === "buy EURC with 10% of my usdc", card.buys[0].command);
    check("no price row invented", card.price === undefined);
    check("badge says Listed", card.badge?.text === "Listed");
  } else check("listed → token card", false, card.kind);
}

console.log("\n— not tradable here → a notice, never buttons —");
{
  const unknown = tokenCardFrom({ ok: true, source: "unknown", address: GLITCH, symbol: "RANDO", decimals: 9 });
  check("unknown ERC-20 → notice", unknown.kind === "notice");
  const bad = tokenCardFrom({ ok: false, address: GLITCH, reason: "That address isn't a token contract on Arc." });
  check(
    "unreadable → warn notice with the reason",
    bad.kind === "notice" && bad.tone === "warn" && Boolean(bad.body?.includes("isn't a token")),
  );
  const quote = tokenCardFrom({ ok: true, isQuote: true, address: "0x3600000000000000000000000000000000000000", symbol: "USDC" });
  check("pasting USDC itself → notice", quote.kind === "notice");
}

console.log("\n— local-only: the wire drops it, the local gate keeps it —");
{
  const card = tokenCardFrom(ARGUS);
  const local = localCards([card]);
  check("localCards keeps the token card", local.length === 1 && local[0].kind === "token");
  if (local[0]?.kind === "token") {
    check("…with its buttons intact", local[0].buys.length === 5 && local[0].sells.length === 5);
    check("…and the disabled flag survives validation", tokenCardFrom({ ...ARGUS, snipeActive: true }).kind === "token" &&
      (localCards([tokenCardFrom({ ...ARGUS, snipeActive: true })])[0] as { buys: { disabled?: boolean }[] }).buys.every((b) => b.disabled === true));
  }
  const wire = cardsFromChat({ context: { cards: [card] } });
  check("cardsFromChat DROPS a model-emitted token card", wire.length === 0, JSON.stringify(wire));
  const smuggled = localCards([{ ...card, onClick: "x", href: "https://evil" } as never]);
  check(
    "extra fields don't ride through validation",
    !("onClick" in (smuggled[0] ?? {})) && !("href" in (smuggled[0] ?? {})),
  );
}

console.log("\n— every button command parses into the trade its label says —");
{
  const TOKENS = [
    { address: "0x3600000000000000000000000000000000000000", name: "USD Coin", symbol: "USDC", decimals: 6, chainId: 5042, verified: true },
  ];
  const ctx = { addressToken: (w: string) => argusAddressToken(w) };
  const card = tokenCardFrom(ARGUS);
  if (card.kind === "token") {
    for (const b of card.buys) {
      const r = parseCommand(b.command, TOKENS as never, ctx) as {
        status: string;
        command?: { kind: string; amount?: string; relative?: { num: number; den: number }; tokenIn?: { symbol: string }; tokenOut?: { address: string } };
      };
      const pct = Number(b.label.replace("%", ""));
      check(
        `Buy ${b.label} → spend ${pct}/100 of USDC on GLITCH`,
        r.status === "ok" &&
          r.command?.kind === "swap" &&
          r.command.amount === undefined &&
          r.command.relative?.num === pct &&
          r.command.relative?.den === 100 &&
          r.command.tokenIn?.symbol === "USDC" &&
          r.command.tokenOut?.address.toLowerCase() === GLITCH.toLowerCase(),
        JSON.stringify(r).slice(0, 160),
      );
    }
    for (const b of card.sells) {
      const r = parseCommand(b.command, TOKENS as never, ctx) as {
        status: string;
        command?: { kind: string; relative?: { num: number; den: number }; tokenIn?: { address: string }; tokenOut?: { symbol: string } };
      };
      const [num, den] = [Number(b.label.replace("%", "")), 100];
      check(
        `Sell ${b.label} → sell ${num}/${den} of GLITCH for USDC`,
        r.status === "ok" &&
          r.command?.kind === "swap" &&
          r.command.relative?.num === num &&
          r.command.relative?.den === den &&
          r.command.tokenIn?.address.toLowerCase() === GLITCH.toLowerCase() &&
          r.command.tokenOut?.symbol === "USDC",
        JSON.stringify(r).slice(0, 160),
      );
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
