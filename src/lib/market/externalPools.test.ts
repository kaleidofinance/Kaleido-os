import { strict as assert } from "node:assert";
import { readExternalPools } from "./externalPools";

async function main() {
  const row = {
    address: `0x${"a".repeat(64)}`, exchange: "uniswap-v4", chain: { id: 4663 },
    tvl: null, volume1d: "", earnFee: 0,
    tokens: [{ address: `0x${"b".repeat(40)}`, symbol: "WETH", logoURI: "https://example.com/chain-4663-token.png" },
      { address: `0x${"c".repeat(40)}`, symbol: "USDG", logoURI: "javascript:alert(1)" }],
  };
  const fetchImpl: typeof fetch = async () => Response.json({ code: 0, data: {
    pools: [row, row, { ...row, chain: { id: 5042 } }, { ...row, tokens: null }],
    pagination: { totalItems: 20 },
  } });
  const result = await readExternalPools(4663, fetchImpl);
  assert.equal(result?.sampledPools, 1, "deduplicate IDs and exclude malformed/wrong-chain rows");
  assert.equal(result?.sampledTvlUsd, null, "unknown TVL is not zero");
  assert.equal(result?.sampledVolume24hUsd, null, "empty volume is not zero");
  assert.equal(result?.sampledFees24hUsd, 0, "measured zero is retained");
  assert.equal(result?.pools[0].address.length, 66, "V4 pool IDs are retained without pretending to be addresses");
  assert.equal(result?.pools[0].tokens[0].address, row.tokens[0].address, "swap links preserve token identity");
  assert.equal(result?.pools[0].tokens[0].logoURI, row.tokens[0].logoURI, "logo stays attached to upstream chain/address metadata");
  assert.equal(result?.pools[0].tokens[1].logoURI, undefined, "unsafe logo URLs are discarded");
  assert.equal(result?.partial, true, "ranked sample is disclosed");
  assert.equal(await readExternalPools(1, fetchImpl), null, "unsupported chain is not substituted");
  assert.equal(await readExternalPools(4663, async () => Response.json({ code: 0, data: { pools: {} } })), null);

  const usdc = "0x3600000000000000000000000000000000000000";
  const argus = "0xeCe5cA8bf9220718E5727754026757512212cb3c";
  const routePool = `0x${"d".repeat(64)}`;
  const arcFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("aggregator-api")) return Response.json({ data: { routeSummary: { route: [[{
      pool: routePool, tokenIn: usdc, tokenOut: argus, exchange: "uniswap-v4", poolExtra: { fee: 2500 },
    }]] } } });
    return Response.json({ data: [{ id: `arc_${routePool}`, attributes: {
      reserve_in_usd: "1000", volume_usd: { h24: "200" },
    } }] });
  };
  const arc = await readExternalPools(5042, arcFetch);
  assert.equal(arc?.source, "kyberswap-routes", "Arc is sourced from executable aggregator routes");
  assert.equal(arc?.sampledPools, 1, "the same routed pool is deduplicated across token quotes");
  assert.equal(arc?.pools[0].tokenSymbols.join("/"), "USDC/ARGUS", "route legs retain registered token identity");
  assert.equal(arc?.pools[0].feeTier, 0.25, "Kyber millionths become a percentage fee tier");
  assert.equal(arc?.pools[0].fees24hUsd, 0.5, "estimated fees use volume times fee percentage");
  const bscUsdc = "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d";
  const wbnb = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";
  const bscFetch: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "aggregator-api.kyberswap.com") {
      assert.equal(url.pathname, "/bsc/api/v1/routes");
      assert.equal(url.searchParams.get("amountIn"), "1000000000000000000", "BSC USDC quotes use 18 decimals");
      return Response.json({ data: { routeSummary: { route: [[{ pool: routePool, tokenIn: bscUsdc, tokenOut: wbnb, exchange: "pancake-infinity-cl" }]] } } });
    }
    assert.ok(url.pathname.startsWith("/api/v2/networks/bsc/pools/multi/"));
    return Response.json({ data: [{ id: `arc_${routePool}`, attributes: { reserve_in_usd: "999" } }, { id: `bsc_${routePool}`, attributes: { reserve_in_usd: "1500", volume_usd: { h24: "100" } } }] });
  };
  const bsc = await readExternalPools(56, bscFetch);
  assert.equal(bsc?.pools.length, 1);
  assert.equal(bsc?.pools[0].chainId, 56);
  assert.equal(bsc?.pools[0].exchange, "pancake-infinity-cl");
  assert.equal(bsc?.pools[0].tvlUsd, 1500, "wrong-chain enrichment is ignored");
  assert.equal(bsc?.pools[0].feeTier, null, "absent venue fee remains unknown");
  console.log("External pool checks passed for Arc, Robinhood and BSC");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
