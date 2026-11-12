import { strict as assert } from "node:assert";
import { readExternalPoolMetrics } from "./externalPoolMetrics";

async function main() {
const result = await readExternalPoolMetrics(
  56,
  "0x1111111111111111111111111111111111111111",
  async (input) => {
    assert.match(String(input), /networks\/bsc\/pools/);
    return new Response(JSON.stringify({
      data: { attributes: {
        reserve_in_usd: "42000",
        volume_usd: { h24: "18000" },
        fee_usd_24h: "21",
        updated_at: "2026-11-11T00:00:00.000Z",
      } },
    }), { status: 200 });
  },
);
assert.equal(result.status, "ok");
assert.equal(result.metrics?.tvlUsd, 42000);
assert.equal(result.metrics?.volume24hUsd, 18000);

const elysium = await readExternalPoolMetrics(
  99901,
  "0x8b3bcaf34559f781421277626ebb51fb09ce360f",
  async (input) => {
    assert.match(String(input), /networks\/elysium\/pools/);
    return new Response(JSON.stringify({
      data: { attributes: {
        reserve_in_usd: "48805.2503",
        volume_usd: { h24: "668439.4102" },
        fee_usd_24h: "123.45",
        updated_at: "2026-11-12T00:00:00.000Z",
      } },
    }), { status: 200 });
  },
);
assert.equal(elysium.status, "ok");
assert.equal(elysium.metrics?.tvlUsd, 48805.2503);
assert.equal(elysium.metrics?.volume24hUsd, 668439.4102);
assert.equal(elysium.metrics?.source, "GeckoTerminal");

let attempts = 0;
const retried = await readExternalPoolMetrics(
  99901,
  "0x180aa783d1cffc984cecb27b710686146a8905db",
  async () => {
    attempts += 1;
    if (attempts === 1) return new Response("rate limited", { status: 429 });
    return new Response(JSON.stringify({
      data: { attributes: {
        reserve_in_usd: "229391.4586",
        volume_usd: { h24: "33601.0577" },
        updated_at: "2026-11-12T00:00:00.000Z",
      } },
    }), { status: 200 });
  },
  { retryDelayMs: 0, maxRetries: 1 },
);
assert.equal(attempts, 2);
assert.equal(retried.status, "ok");
assert.equal(retried.metrics?.tvlUsd, 229391.4586);
console.log("External pool metrics checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
