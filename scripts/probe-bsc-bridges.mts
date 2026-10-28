// Quote/build requests only; no bridge is signed or submitted.
import fs from "node:fs";
import { getBridgeExecution } from "../src/lib/ai/bridgeQuotes.ts";
const user = "0x0Ce7f8Aeaad60b9E19ACBe9803518182adC351Bc";
const USDC_BSC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  USDC_ARC = "0x3600000000000000000000000000000000000000";
const results: any = {
  checkedAt: new Date().toISOString(),
  scope:
    "provider route availability only; neither source execution nor destination settlement verified",
  lifi: [],
  relay: [],
};
for (const [from, to, address, decimals] of [
  [56, 5042, USDC_BSC, 18],
  [5042, 56, USDC_ARC, 6],
] as const) {
  try {
    const r = await getBridgeExecution({
      fromChainId: from,
      toChainId: to,
      asset: "USDC",
      units: (10n * 10n ** BigInt(decimals)).toString(),
      address: user,
      fromTokenAddress: address,
    });
    results.lifi.push({
      from,
      to,
      available: !!r,
      ...(r
        ? {
            router: r.to,
            spender: r.spender,
            txChainId: r.txChainId,
            fromToken: r.fromToken,
            toToken: r.toToken,
            minOutput: r.toAmountMin,
            value: r.value,
          }
        : {}),
    });
  } catch (e: any) {
    results.lifi.push({ from, to, error: e.message });
  }
}
for (const [from, to, fromToken, toToken, decimals] of [
  [56, 5042, USDC_BSC, USDC_ARC, 18],
  [5042, 56, USDC_ARC, USDC_BSC, 6],
] as const) {
  try {
    const r = await fetch("https://api.relay.link/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        user,
        originChainId: from,
        destinationChainId: to,
        originCurrency: fromToken,
        destinationCurrency: toToken,
        amount: (10n * 10n ** BigInt(decimals)).toString(),
        tradeType: "EXACT_INPUT",
      }),
      signal: AbortSignal.timeout(20000),
    });
    const b: any = await r.json();
    results.relay.push({
      from,
      to,
      httpStatus: r.status,
      available: r.ok && Array.isArray(b.steps) && b.steps.length > 0,
      ...(r.ok
        ? {
            steps: b.steps?.map((s: any) => ({ kind: s.kind, id: s.id })),
            fromCurrency: b.details?.currencyIn?.currency,
            toCurrency: b.details?.currencyOut?.currency,
          }
        : { error: b.message || b.errorCode || b.error }),
    });
  } catch (e: any) {
    results.relay.push({ from, to, error: e.message });
  }
}
fs.writeFileSync(
  "docs/product/BSC_BRIDGE_QUOTES.json",
  JSON.stringify(results, null, 2) + "\n",
);
console.log(JSON.stringify(results, null, 2));
