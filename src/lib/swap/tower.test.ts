import assert from "node:assert/strict";
import {
  hasTowerSwap,
  isKnownTowerRouter,
  quoteTowerSwap,
  resolveTowerSwap,
  towerNetwork,
  towerRouter,
  TOWER_API,
} from "./tower";
import {
  ARC_REGIONAL_STABLECOINS,
  isRegionalStablecoin,
  getRegionalStablecoinBySymbol,
} from "./towerTokens";

async function runTests() {
  console.log("Testing Tower Exchange adapter...");

  // 1. Network and router checks
  assert.equal(towerNetwork(5042), "arc");
  assert.equal(towerNetwork(5042002), "arc-testnet");
  assert.equal(towerNetwork(56), undefined);
  assert.equal(towerNetwork(99901), undefined);

  assert.equal(hasTowerSwap(5042), true);
  assert.equal(hasTowerSwap(5042002), true);
  assert.equal(hasTowerSwap(56), false);

  const arcRouter = towerRouter(5042);
  assert.ok(arcRouter);
  assert.equal(isKnownTowerRouter(5042, arcRouter), true);
  assert.equal(isKnownTowerRouter(5042, arcRouter.toUpperCase()), true);
  assert.equal(isKnownTowerRouter(56, arcRouter), false);

  // 2. Regional stablecoins
  assert.equal(ARC_REGIONAL_STABLECOINS.length >= 5, true);
  const usdc = getRegionalStablecoinBySymbol("USDC");
  assert.ok(usdc);
  assert.equal(isRegionalStablecoin(usdc.address, 5042), true);

  const eurc = getRegionalStablecoinBySymbol("EURC");
  assert.ok(eurc);
  assert.equal(isRegionalStablecoin(eurc.address, 5042), true);

  // 3. Mock quoting
  const mockFetch = (async (url: string | URL | Request) => {
    const urlStr = url.toString();
    if (urlStr.includes("/api/public/swap/quote")) {
      return new Response(
        JSON.stringify({
          amountOut: "950000",
          priceImpactBps: 5,
          routeType: "stablefx",
          router: arcRouter,
        }),
        { status: 200 },
      );
    }
    if (urlStr.includes("/api/public/swap/build-tx")) {
      return new Response(
        JSON.stringify({
          to: arcRouter,
          data: "0x123456",
          value: "0",
          spender: arcRouter,
          amountOut: "950000",
          priceImpactBps: 5,
          routeType: "stablefx",
        }),
        { status: 200 },
      );
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  const quote = await quoteTowerSwap({
    chainId: 5042,
    tokenIn: usdc.address,
    tokenOut: eurc.address,
    amountUnits: "1000000",
    fetchImpl: mockFetch,
  });

  assert.ok(quote);
  assert.equal(quote.amountOut, "950000");
  assert.equal(quote.routeType, "stablefx");

  const execution = await resolveTowerSwap({
    chainId: 5042,
    tokenIn: usdc.address,
    tokenOut: eurc.address,
    amountUnits: "1000000",
    address: "0x1111111111111111111111111111111111111111",
    slippageBps: 50,
    fetchImpl: mockFetch,
  });

  assert.ok(execution);
  assert.equal(execution.to, arcRouter);
  assert.equal(execution.data, "0x123456");
  assert.equal(execution.amountOut, "950000");

  console.log("Tower Exchange adapter checks passed.");
}

runTests().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
