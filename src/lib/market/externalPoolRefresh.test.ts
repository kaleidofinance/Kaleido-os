import { strict as assert } from "node:assert";
import {
  evaluateExternalPoolCandidate,
  extractKyberRoutePools,
} from "./externalPoolRefresh";

const ELYSIUM_ROUTE = {
  data: {
    routeSummary: {
      timestamp: 1794434574,
      route: [
        [
          {
            pool: "0xcd82337e7d2d1ab66699457a8e25b4d8e78ca259",
            tokenIn: "0xba876237b0f021a6c6d852d6c26e107997cc5e81",
            tokenOut: "0xb47c4c8f73f009cc0c0d3f92b388d13e293f0b65",
            swapAmount: "1000000000000000000",
            amountOut: "71817112",
            exchange: "metric-propamm",
            extra: {
              _ce: {
                ces: [
                  {
                    pool: "0x8b3bcaf34559f781421277626ebb51fb09ce360f",
                    tokenIn: "0xba876237b0f021a6c6d852d6c26e107997cc5e81",
                    tokenOut: "0xb47c4c8f73f009cc0c0d3f92b388d13e293f0b65",
                    swapAmount: "1000000000000000000",
                    amountOut: "71764980",
                    exchange: "pharaoh-lb",
                    poolExtra: { blockNumber: 4983280 },
                  },
                ],
              },
            },
          },
        ],
      ],
    },
  },
};

const route = extractKyberRoutePools(ELYSIUM_ROUTE, {
  chainId: 99901,
  tokenSymbols: {},
});
assert.equal(route.length, 1, "nested Kyber wrappers are not registry pools");
assert.equal(route[0]?.exchange, "pharaoh-lb");
assert.equal(route[0]?.pool, "0x8b3bcaf34559f781421277626ebb51fb09ce360f");

const approved = evaluateExternalPoolCandidate({
  route: route[0]!,
  tokens: [
    { address: route[0]!.tokenIn, symbol: "WHYPE" },
    { address: route[0]!.tokenOut, symbol: "USDC" },
  ],
  metrics: {
    tvlUsd: 42_000,
    volume24hUsd: 18_000,
    fees24hUsd: 21,
    asOf: "2026-11-11T00:00:00.000Z",
    source: "test metrics",
  },
});
assert.equal(approved.approved, true);
assert.equal(approved.entry?.provider, "kyberswap");
assert.equal(approved.entry?.metricsAsOf, "2026-11-11T00:00:00.000Z");

const thin = evaluateExternalPoolCandidate({
  route: route[0]!,
  tokens: [
    { address: route[0]!.tokenIn, symbol: "WHYPE" },
    { address: route[0]!.tokenOut, symbol: "USDC" },
  ],
  metrics: {
    tvlUsd: 9_999,
    volume24hUsd: 100,
    fees24hUsd: 1,
    asOf: "2026-11-11T00:00:00.000Z",
    source: "test metrics",
  },
});
assert.equal(thin.approved, false);
assert.match(thin.reasons.join(";"), /approval floor/);

const unknown = evaluateExternalPoolCandidate({
  route: route[0]!,
  tokens: [
    { address: route[0]!.tokenIn, symbol: "WHYPE" },
    { address: route[0]!.tokenOut, symbol: "USDC" },
  ],
  metrics: {
    tvlUsd: null,
    volume24hUsd: null,
    fees24hUsd: null,
    asOf: "2026-11-11T00:00:00.000Z",
    source: "test metrics",
  },
});
assert.equal(unknown.approved, false);
assert.match(unknown.reasons.join(";"), /TVL is unknown/);

const unknownToken = evaluateExternalPoolCandidate({
  route: route[0]!,
  tokens: [
    { address: route[0]!.tokenIn, symbol: "WHYPE" },
    { address: route[0]!.tokenOut, symbol: "UNKNOWN" },
  ],
  metrics: {
    tvlUsd: 100_000,
    volume24hUsd: 1_000,
    fees24hUsd: 1,
    asOf: "2026-11-11T00:00:00.000Z",
    source: "test metrics",
  },
});
assert.equal(unknownToken.approved, false);
assert.match(unknownToken.reasons.join(";"), /token identity/);

const testnet = evaluateExternalPoolCandidate({
  route: { ...route[0]!, chainId: 99801 },
  tokens: [
    { address: route[0]!.tokenIn, symbol: "WHYPE" },
    { address: route[0]!.tokenOut, symbol: "USDC" },
  ],
  metrics: {
    tvlUsd: 100_000,
    volume24hUsd: 1_000,
    fees24hUsd: 1,
    asOf: "2026-11-11T00:00:00.000Z",
    source: "test metrics",
  },
});
assert.equal(testnet.approved, false);
assert.match(testnet.reasons.join(";"), /mainnet scan target/);

console.log("External pool refresh evaluator checks passed");
