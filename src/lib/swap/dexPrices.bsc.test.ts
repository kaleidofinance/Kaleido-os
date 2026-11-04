import assert from "node:assert/strict";
import { dexTokenPrices } from "./dexPrices";
const original = globalThis.fetch;
const usdc = "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d";
const wbnb = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";
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
  } finally {
    globalThis.fetch = original;
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
