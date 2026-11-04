import assert from "node:assert/strict";
import { getPrice, PYTH_FEEDS } from "./prices";

async function main() {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.ok(String(input).includes(PYTH_FEEDS.USDG));
    return new Response(JSON.stringify([{ id: PYTH_FEEDS.USDG, price: { price: "99870000", expo: -8, publish_time: Math.floor(Date.now()/1000) } }]));
  };
  try { const price = await getPrice("USDG"); assert.equal(price.usd, 0.9987); assert.equal(price.source, "pyth"); console.log("USDG measured-price checks passed"); }
  finally { globalThis.fetch = original; }
}
void main();
