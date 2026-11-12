import assert from "node:assert/strict";
import { getPrice } from "./prices";

async function main() {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.match(String(input), /hyperliquid/);
    return new Response(JSON.stringify({ hyperliquid: { usd: 71.54 } }));
  };
  try {
    const price = await getPrice("HYPE");
    assert.equal(price.usd, 71.54);
    assert.equal(price.source, "coingecko");
    console.log("HYPE CoinGecko pricing check passed");
  } finally {
    globalThis.fetch = original;
  }
}

void main();
