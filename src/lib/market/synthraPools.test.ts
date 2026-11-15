import assert from "node:assert/strict";
import { readSynthraPools } from "./synthraPools";

process.env.SYNTHRA_API_KEY = "test-key";

async function main() {
  const snapshot = await readSynthraPools(
    99901,
    async () =>
      new Response(
        JSON.stringify({
          state: "Success",
          pools: [
            {
              address: "0x1111111111111111111111111111111111111111",
              deployment: "v3.1",
              fee: 500,
              token0: {
                address: "0x2222222222222222222222222222222222222222",
                symbol: "USDC",
              },
              token1: {
                address: "0x3333333333333333333333333333333333333333",
                symbol: "WHYPE",
              },
              tvlUsd: 42,
            },
          ],
        }),
      ),
  );
  assert.equal(snapshot?.source, "synthra");
  assert.equal(snapshot?.pools[0]?.provider, "synthra");
  assert.equal(snapshot?.pools[0]?.feeTier, 0.05);
  assert.equal(snapshot?.pools[0]?.tvlUsd, 42);
  assert.equal(
    await readSynthraPools(56, async () => {
      throw new Error("must not fetch");
    }),
    null,
  );
  console.log("Synthra pool discovery checks passed");
}

void main();
