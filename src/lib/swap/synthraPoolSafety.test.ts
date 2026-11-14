import assert from "node:assert/strict";
import { verifySynthraPoolRoute } from "./synthraPoolSafety";

async function main() {
  const a = "0x1111111111111111111111111111111111111111";
  const b = "0x2222222222222222222222222222222222222222";
  const pool = "0x3333333333333333333333333333333333333333";
  const leg = {
    protocol: "v3",
    pool,
    fee: 500,
    tokenIn: { address: a, chainId: 99901 },
    tokenOut: { address: b, chainId: 99901 },
  };
  const raw = {
    state: "Success",
    chainId: 99901,
    route: [{ percentage: 100, legs: [leg] }],
    warnings: [],
    debug: {
      risk: {
        blocked: false,
        minPoolTvlUsd: 50_000,
        lowTvlThresholdUsd: 10_000,
        warnings: [],
      },
    },
  };
  assert.equal(
    (await verifySynthraPoolRoute(raw, 99901, async () => pool))?.length,
    1,
  );
  assert.equal(
    await verifySynthraPoolRoute(
      { ...raw, warnings: ["low_tvl_pool"] },
      99901,
      async () => pool,
    ),
    null,
  );
  assert.equal(await verifySynthraPoolRoute(raw, 99901, async () => a), null);
  assert.equal(
    await verifySynthraPoolRoute(
      {
        ...raw,
        route: [
          {
            percentage: 100,
            legs: [
              { ...leg, pool: "0x0000000000000000000000000000000000000000" },
            ],
          },
        ],
      },
      99901,
      async () => "0x0000000000000000000000000000000000000000",
    ),
    null,
  );
  assert.equal(
    await verifySynthraPoolRoute(raw, 99901, async () => {
      throw new Error("RPC unavailable");
    }),
    null,
  );
  assert.equal(
    await verifySynthraPoolRoute(
      { ...raw, debug: {} },
      99901,
      async () => pool,
    ),
    null,
  );
  assert.equal(
    await verifySynthraPoolRoute(
      { ...raw, route: [{ ...raw.route[0], legs: [{ ...leg, fee: 250 }] }] },
      99901,
      async () => pool,
    ),
    null,
  );
  console.log("Synthra pool safety checks passed");
}
void main();
