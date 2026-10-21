import { strict as assert } from "node:assert";
import { readExternalPools } from "./externalPools";

async function main() {
  const row = {
    address: `0x${"a".repeat(64)}`, exchange: "uniswap-v4", chain: { id: 4663 },
    tvl: null, volume1d: "", earnFee: 0,
    tokens: [{ address: `0x${"b".repeat(40)}`, symbol: "WETH" },
      { address: `0x${"c".repeat(40)}`, symbol: "USDG" }],
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
  assert.equal(result?.partial, true, "ranked sample is disclosed");
  assert.equal(await readExternalPools(5042, fetchImpl), null, "unsupported chain is not substituted");
  assert.equal(await readExternalPools(4663, async () => Response.json({ code: 0, data: { pools: {} } })), null);
  console.log("9 external pool checks passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
