import { strict as assert } from "node:assert";
import { buildExternalPoolRefreshReport } from "./externalPoolReport";

async function main() {
  const routePayload = {
    data: {
      routeSummary: {
        timestamp: 1794434574,
        route: [[{
          pool: "0xcd82337e7d2d1ab66699457a8e25b4d8e78ca259",
          tokenIn: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          tokenOut: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          swapAmount: "1000",
          amountOut: "900",
          exchange: "pharaoh-lb",
        }]],
      },
    },
  };
  const report = await buildExternalPoolRefreshReport([
    {
      chainId: 99901,
      tokenIn: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      tokenOut: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      tokenSymbols: {
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": "WHYPE",
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb": "USDC",
      },
      amountIn: "1000",
    },
  ], {
    fetchImpl: async () => new Response(JSON.stringify(routePayload), { status: 200 }),
    readMetrics: async () => ({
      status: "unavailable" as const,
      metrics: null,
      reason: "Elysium metrics source unavailable",
    }),
  });
  assert.equal(report.routeObservations, 1);
  assert.equal(report.approved.length, 0);
  assert.equal(report.rejected.length, 1);
  assert.match(report.warnings.join(";"), /Elysium/);
  console.log("External pool refresh report checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
