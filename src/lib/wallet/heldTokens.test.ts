import { fromInsight, heldVocabulary, fetchHeldTokens } from "./heldTokens";
import { chainTokens } from "@/constants/tokens";
import { parseCommand } from "@/lib/v2/intents/fromCommand";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, extra?: unknown) => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? ` — ${JSON.stringify(extra).slice(0, 200)}` : ""}`);
};

const ARC = 5042;
const GLITCH = "0x08adbf431569a1aacac2606d2adcd18f4ebf2a71";
const rows = [
  { token_address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", balance: "1", decimals: 18, name: "USDC", symbol: "USDC" },
  { token_address: GLITCH, balance: "2171163526376908405597", decimals: 18, name: "GLITCH", symbol: "GLITCH" },
  { token_address: "0x07704b06981ea962b87296362a1281484d160000", balance: "5", decimals: 18, name: "ARCAT", symbol: "ARCAT" },
  { token_address: "0x1111111111111111111111111111111111111111", balance: "0", decimals: 18, name: "ZERO", symbol: "ZERO" },
  { token_address: "0x2222222222222222222222222222222222222222", balance: "9", decimals: 18, name: "Dup A", symbol: "PEPE" },
  { token_address: "0x3333333333333333333333333333333333333333", balance: "9", decimals: 18, name: "Dup B", symbol: "pepe" },
  { token_address: "0x4444444444444444444444444444444444444444", balance: "9", name: "No decimals", symbol: "NODEC" },
  { token_address: "0x5555555555555555555555555555555555555555", balance: "9", decimals: 18, name: "bad", symbol: "visit scam.site" },
];

const held = fromInsight(rows, ARC);
check("drops native, zero balance, missing decimals, junk symbols", held.map((t) => t.symbol).join(",") === "GLITCH,ARCAT,PEPE,pepe", held.map((t) => t.symbol));
check("held tokens are unverified and tagged", held.every((t) => !t.verified && t.tags?.includes("held") && t.chainId === ARC));

const registry = chainTokens(ARC);
const vocab = heldVocabulary(registry, held);
check("registry symbols are not shadowed (ARCAT stays the registry one)", !vocab.some((t) => t.symbol === "ARCAT"), vocab.map((t) => t.symbol));
check("ambiguous held symbols are left out", !vocab.some((t) => t.symbol.toLowerCase() === "pepe"));
check("an unlisted unique holding is added", vocab.length === 1 && vocab[0].address === GLITCH, vocab);

// End to end through the grammar.
const tokens = [...registry, ...vocab];
const r1 = parseCommand("sell 100% of GLITCH", tokens, { chainName: "Arc" });
const txt1 = JSON.stringify(r1);
check("'sell 100% of GLITCH' resolves to the held contract", txt1.toLowerCase().includes(GLITCH) && !/don't know a token/i.test(txt1), r1);
const r2 = parseCommand("sell 100% of GLITCH", registry, { chainName: "Arc" });
check("without the holding it is still unknown (control)", /don't know a token called GLITCH/i.test(JSON.stringify(r2)), r2);
const r3 = parseCommand("swap 10 USDC to GLITCH", tokens, { chainName: "Arc" });
check("buying more of a held token also resolves", JSON.stringify(r3).toLowerCase().includes(GLITCH), r3);

void (async () => {
  check("no client key → no request, empty", (await fetchHeldTokens("0x0Ce7f8Aeaad60b9E19ACBe9803518182adC351Bc", ARC, undefined)).length === 0);
  const fake = (async () => ({ ok: true, json: async () => ({ data: rows }) })) as unknown as typeof fetch;
  check("fetch maps Insight rows", (await fetchHeldTokens("0x0Ce7f8Aeaad60b9E19ACBe9803518182adC351Bc", ARC, "k", fake)).length === 4);
  const boom = (async () => { throw new Error("down"); }) as unknown as typeof fetch;
  check("network failure → empty, never throws", (await fetchHeldTokens("0x0Ce7f8Aeaad60b9E19ACBe9803518182adC351Bc", ARC, "k", boom)).length === 0);
})().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
});
