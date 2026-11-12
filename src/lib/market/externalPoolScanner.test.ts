import { strict as assert } from "node:assert";
import { scanKyberPools } from "./externalPoolScanner";

const payload = {
  data: {
    routeSummary: {
      timestamp: 1794434574,
      route: [[{
        pool: "0xcd82337e7d2d1ab66699457a8e25b4d8e78ca259",
        tokenIn: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        tokenOut: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        swapAmount: "1000",
        amountOut: "900",
        exchange: "metric-propamm",
        extra: { _ce: { ces: [{
          pool: "0x8b3bcaf34559f781421277626ebb51fb09ce360f",
          tokenIn: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          tokenOut: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          swapAmount: "1000",
          amountOut: "890",
          exchange: "pharaoh-lb",
        }] } },
      }]],
    },
  },
};

async function main() {
let calls = 0;
const result = await scanKyberPools([
  {
    chainId: 99901,
    tokenIn: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    tokenOut: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    tokenSymbols: {},
    amountIn: "1000",
  },
], {
  fetchImpl: async (input) => {
    calls += 1;
    assert.match(String(input), /\/elysium\/api\/v1\/routes/);
    return new Response(JSON.stringify(payload), { status: 200 });
  },
});
assert.equal(calls, 1);
assert.equal(result.failures.length, 0);
assert.equal(result.observations.length, 1);
assert.equal(result.observations[0]?.exchange, "pharaoh-lb");
console.log("External pool scanner checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
