import assert from "node:assert/strict";
import { dexTokenPrices } from "./dexPrices";
const original = globalThis.fetch;
const usdc = "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d";
const wbnb = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";
const elysiumUsdc = "0xb47c4c8f73f009cc0c0d3f92b388d13e293f0b65";
const kntq = "0xe45a355d9e9cad2add85f2d03e3ee3102a036acf0";
globalThis.fetch = async (input) => {
  const u = new URL(String(input));
  assert.equal(u.pathname, "/bsc/api/v1/routes");
  assert.equal(u.searchParams.get("tokenOut")?.toLowerCase(), usdc);
  assert.equal(u.searchParams.get("amountIn"), "1000000000000000000");
  return Response.json({
    data: { routeSummary: { amountOut: "742000000000000000000" } },
  });
};
async function main() {
  try {
    const result = await dexTokenPrices(56, [
      { address: wbnb, decimals: 18 },
      { address: usdc, decimals: 18 },
    ]);
    assert.equal(result[wbnb], 742, "BSC USDC denominator must be 18 decimals");
    assert.equal(result[usdc], 1);
    console.log("BSC USD quote scaling passed");

    globalThis.fetch = async (input) => {
      const u = new URL(String(input));
      assert.equal(u.pathname, "/elysium/api/v1/routes");
      assert.equal(u.searchParams.get("tokenOut")?.toLowerCase(), elysiumUsdc);
      assert.equal(u.searchParams.get("amountIn"), "1000000000000000000");
      return Response.json({
        data: { routeSummary: { amountOut: "291689" } },
      });
    };

    const elysium = await dexTokenPrices(99901, [
      { address: kntq, decimals: 18 },
    ]);
    assert.equal(elysium[kntq], 0.291689, "Elysium KNTQ must use the 6-decimal USDC quote");
    console.log("Elysium USD quote scaling passed");
  } finally {
    globalThis.fetch = original;
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
