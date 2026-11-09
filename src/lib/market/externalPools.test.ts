import { strict as assert } from "node:assert";
import { chainTokenByAddress } from "@/constants/tokens";
import { EXTERNAL_POOL_REGISTRY } from "./externalPoolRegistry";
import { readExternalPools } from "./externalPools";

async function main() {
  const seen = new Set<string>();
  for (const pool of EXTERNAL_POOL_REGISTRY) {
    assert.match(pool.address, /^0x[0-9a-f]{40}$|^0x[0-9a-f]{64}$/i);
    assert.ok(
      pool.chainId === 4663 || (pool.tvlUsd !== null && pool.tvlUsd >= 10_000),
      `${pool.chainId}:${pool.tokenSymbols.join("/")} is below the registry TVL floor`,
    );
    const key = `${pool.chainId}:${pool.address.toLowerCase()}`;
    assert.equal(seen.has(key), false, `duplicate pool ${key}`);
    seen.add(key);
    assert.equal(pool.tokens.length, 2, "pool must contain exactly two tokens");
    assert.deepEqual(
      pool.tokenSymbols,
      pool.tokens.map((token) => token.symbol),
    );
    for (const token of pool.tokens) {
      assert.equal(
        chainTokenByAddress(pool.chainId, token.address)?.symbol,
        token.symbol,
        `${pool.chainId}:${token.symbol} must be a declared chain token`,
      );
    }
  }

  for (const chainId of [5042, 4663, 56]) {
    const snapshot = await readExternalPools(chainId, async () => {
      throw Error("registry must not call a provider");
    });
    assert.equal(snapshot?.source, "registry");
    assert.ok((snapshot?.pools.length ?? 0) > 0, `registry has ${chainId}`);
    assert.equal(snapshot?.asOf, "2026-11-09T00:00:00.000Z");
  }
  assert.equal(await readExternalPools(1), null);
  console.log("External pool registry checks passed for all three chains");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
