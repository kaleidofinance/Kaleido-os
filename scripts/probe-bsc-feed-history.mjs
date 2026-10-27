import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
const require = createRequire(import.meta.url);
const { Interface } = require("ethers");
const abi = new Interface([
  "function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)",
  "function getRoundData(uint80) view returns(uint80,int256,uint256,uint256,uint80)",
]);
async function read(to, fn, args = []) {
  const r = await fetch("https://bsc-rpc.publicnode.com", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to, data: abi.encodeFunctionData(fn, args) }, "latest"],
    }),
    signal: AbortSignal.timeout(12000),
  });
  const j = await r.json();
  if (j.error) throw Error(j.error.message);
  return abi.decodeFunctionResult(fn, j.result);
}
const evidence = JSON.parse(
  await readFile("docs/product/BSC_LOAN_RISK_PROBE.json", "utf8"),
);
const report = {
  checkedAt: new Date().toISOString(),
  samples: {},
  limitation:
    "Recent rounds in current proxy phase only; sample gaps do not guarantee future heartbeats or peg/backing safety",
};
for (const name of ["usd1-usd", "fdusd-usd"]) {
  const address = evidence.feeds[name].proxy;
  const latest = await read(address, "latestRoundData");
  const samples = [];
  for (let i = 0; i < 12; i++) {
    try {
      const r =
        i === 0
          ? latest
          : await read(address, "getRoundData", [latest[0] - BigInt(i)]);
      samples.push({
        round: r[0].toString(),
        updatedAt: Number(r[3]),
        positive: r[1] > 0n,
        completed: r[4] >= r[0],
      });
    } catch (e) {
      samples.push({ error: e.message });
      break;
    }
  }
  const valid = samples.filter((r) => r.updatedAt);
  const gaps = valid
    .slice(0, -1)
    .map((r, i) => r.updatedAt - valid[i + 1].updatedAt);
  report.samples[name] = {
    proxy: address,
    advertisedHeartbeat: 86400,
    rounds: samples,
    maxObservedGapSeconds: gaps.length ? Math.max(...gaps) : null,
    minObservedGapSeconds: gaps.length ? Math.min(...gaps) : null,
  };
}
await writeFile(
  "docs/product/BSC_FEED_HISTORY.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
