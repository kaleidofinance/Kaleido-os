// Checks on resolveChain — the chain-name resolver Luca's bridge leans on. Run
// with tsx. Regression cover for two reported misses: "Arc chain" (a trailing
// generic word) and "BNB Chain" (Binance's name for what the registry calls
// "BNB Smart Chain"), while keeping testnets un-collapsible from a mainnet name.
import { getBridgeQuote, resolveChain } from "./bridgeQuotes.ts";

let pass = 0;
let fail = 0;
const eq = (name: string, input: string | number, expectId: number | undefined) => {
  const got = resolveChain(input)?.id;
  if (got === expectId) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} — got ${got}, want ${expectId}`);
  }
};

console.log("\n— exact + id —");
eq("bare shortName 'Arc'", "Arc", 5042);
eq("full name 'BNB Smart Chain'", "BNB Smart Chain", 56);
eq("shortName 'BSC'", "BSC", 56);
eq("numeric id", 5042, 5042);
eq("numeric string id", "8453", 8453);

console.log("\n— trailing generic word (the 'Arc chain' bug) —");
eq("'arc chain'", "arc chain", 5042);
eq("'Arc network'", "Arc network", 5042);
eq("'base chain'", "base chain", 8453);

console.log("\n— common aliases (the 'BNB Chain' bug) —");
eq("'BNB Chain'", "BNB Chain", 56);
eq("'bnb'", "bnb", 56);
eq("'binance'", "binance", 56);
eq("'eth'", "eth", 1);
eq("'Ethereum'", "Ethereum", 1);

console.log("\n— testnets are NOT collapsed to mainnet —");
eq("'Arc Testnet' stays the testnet", "Arc Testnet", 5042002);
eq("'arc testnet' stays the testnet", "arc testnet", 5042002);
eq("'base sepolia' stays the testnet", "base sepolia", 84532);
eq("bare 'arc' is the mainnet (first match)", "arc", 5042);

console.log("\n— unknown —");
eq("nonsense is undefined", "wonderland chain", undefined);
eq("empty is undefined", "", undefined);

/* ---------------------------------------------------- cross-asset quote -- *
 * getBridgeRoute's `toAsset`: "how much USDC would 0.02 BNB get me on Arc?".
 * fetch is stubbed, so this is offline and can assert WHICH provider is asked:
 * a cross-asset quote must come from LI.FI (the provider the bridge action
 * executes it through) and never Relay, with the expected + minimum received. */
async function crossAsset() {
  const ok = (name: string, cond: boolean, got = "") => {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name} — ${got}`); }
  };
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("li.quest")) {
      return new Response(JSON.stringify({
        estimate: { feeCosts: [{ amountUSD: "0.05" }], executionDuration: 120, toAmount: "12400000", toAmountMin: "12100000" },
        action: { toToken: { decimals: 6 } },
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ fees: { relayer: { amountUsd: "0.01" } }, details: { timeEstimate: 30 } }), { status: 200 });
  }) as typeof fetch;
  try {
    console.log("\n— cross-asset quote (toAsset) —");
    const q = await getBridgeQuote({ fromChain: "BSC", toChain: "Arc", asset: "BNB", amount: "0.02", toAsset: "usdc" });
    const lifiCall = calls.find((c) => c.includes("li.quest")) ?? "";
    ok("quoted by LI.FI, never Relay", !!lifiCall && !calls.some((c) => c.includes("relay")), calls.join(" | "));
    ok("LI.FI is asked for BNB in, USDC out", lifiCall.includes("fromToken=BNB") && lifiCall.includes("toToken=USDC"), lifiCall);
    ok(
      "the quote carries the expected and minimum received",
      !("error" in q) && q.toAsset === "USDC" && q.amountOut === "12.4" && q.amountOutMin === "12.1" && q.provider === "LIFI",
      JSON.stringify(q),
    );

    calls.length = 0;
    const same = await getBridgeQuote({ fromChain: "BSC", toChain: "Arc", asset: "BNB", amount: "0.02" });
    ok(
      "a same-token quote is unchanged: Relay first, no received-token fields",
      !("error" in same) && same.provider === "RELAY" && same.toAsset === undefined && calls[0].includes("relay"),
      JSON.stringify(same),
    );

    calls.length = 0;
    const self = await getBridgeQuote({ fromChain: "BSC", toChain: "Arc", asset: "BNB", amount: "0.02", toAsset: "bnb" });
    ok("toAsset equal to asset is a same-token quote", !("error" in self) && self.provider === "RELAY" && self.toAsset === undefined, JSON.stringify(self));
  } finally {
    globalThis.fetch = real;
  }
}

/* The amount each provider is asked for, in the SOURCE chain's decimals. A
   symbol-keyed table quoted "10 USDT from BSC" (18 decimals there) as 10×10⁶
   units — a quote for 0.00000001 USDT. */
async function perChainDecimals() {
  const ok = (name: string, cond: boolean, got = "") => {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name} — ${got}`); }
  };
  const sent: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("relay")) {
      sent.push(String(JSON.parse(String(init?.body ?? "{}")).amount));
      return new Response(JSON.stringify({ fees: { relayer: { amountUsd: "0.01" } }, details: { timeEstimate: 30 } }), { status: 200 });
    }
    sent.push(new URL(url).searchParams.get("fromAmount") ?? "");
    return new Response(JSON.stringify({ estimate: { executionDuration: 60 } }), { status: 200 });
  }) as typeof fetch;
  try {
    console.log("\n— amounts are scaled by the source chain's decimals —");
    for (const [from, to, asset, amount, want] of [
      ["BSC", "Base", "USDT", "10", "10000000000000000000"],
      ["BSC", "Base", "USDC", "10", "10000000000000000000"],
      ["Base", "BSC", "USDC", "10", "10000000"],
      ["Ethereum", "Base", "USDT", "2.5", "2500000"],
      ["Base", "Arc", "ETH", "0.0000001", "100000000000"],
    ] as const) {
      sent.length = 0;
      const q = await getBridgeQuote({ fromChain: from, toChain: to, asset, amount });
      ok(`${amount} ${asset} from ${from} is ${want} units`, !("error" in q) && sent[0] === want, `${sent[0]} ${JSON.stringify(q).slice(0, 120)}`);
    }
    const nope = await getBridgeQuote({ fromChain: "Base", toChain: "Arc", asset: "NOPE", amount: "1" });
    ok("a token the source chain doesn't carry is refused, not guessed", "error" in nope && /isn't a token Kaleido knows on/.test(nope.error), JSON.stringify(nope));
    const fine = await getBridgeQuote({ fromChain: "Base", toChain: "Arc", asset: "USDC", amount: "1.1234567" });
    ok("more precision than the token holds is refused", "error" in fine && /6 decimals/.test(fine.error), JSON.stringify(fine));
    const zero = await getBridgeQuote({ fromChain: "Base", toChain: "Arc", asset: "USDC", amount: "0" });
    ok("zero is refused", "error" in zero, JSON.stringify(zero));
  } finally {
    globalThis.fetch = real;
  }
}

crossAsset().then(perChainDecimals).then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
});
