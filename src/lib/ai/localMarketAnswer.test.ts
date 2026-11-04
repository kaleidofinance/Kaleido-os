import assert from "node:assert/strict";
import { poolQuestion, poolSnapshotAnswer, personalPortfolioQuestion } from "./localMarketAnswer";

assert.equal(poolQuestion("how many pool we have?"), "count");
assert.equal(poolQuestion("list our pools"), "list");
assert.equal(poolQuestion("which pool has the highest APR?"), "apr");
assert.equal(poolQuestion("compare pools by liquidity"), "liquidity");
assert.equal(poolQuestion("what is our total volume?"), null);
assert.equal(poolQuestion("what is our total pool volume today?"), "volume24h");
for (const text of ["add liquidity to my pool", "which pool should I invest in?", "what is a pool?", "how do pools work?", "list pools on Base", "how many USDC pools?", "compare these pools"]) {
  assert.equal(poolQuestion(text), null, text);
}
assert.equal(personalPortfolioQuestion("show my positions"), true);
assert.equal(personalPortfolioQuestion("what are my balances?"), true);
assert.equal(personalPortfolioQuestion("withdraw my positions"), false);
assert.equal(personalPortfolioQuestion("show my balances on Base"), false);
const scope = { chainId: 5042, chainName: "Arc" };
const rows = [
  { chainId: 5042, token0: { symbol: "USDC" }, token1: { symbol: "EURC" }, liquidity: 10, volumeTotal: 20, volume24h: 3, apr: 2, feeBps: 5 },
  { chainId: 5042, token0: { symbol: "WUSDC" }, token1: { symbol: "EURC" }, liquidity: null, volumeTotal: null, apr: null },
  { chainId: 8453, token0: { symbol: "OTHER" }, token1: { symbol: "TOKEN" }, liquidity: 999 },
];
assert.match(poolSnapshotAnswer("count", { pools: rows }, scope), /2 Kaleido pools on Arc/);
assert.doesNotMatch(poolSnapshotAnswer("list", { pools: rows }, scope), /OTHER/);
assert.match(poolSnapshotAnswer("liquidity", { pools: rows }, scope), /\$10\.00/);
assert.match(poolSnapshotAnswer("liquidity", { pools: rows }, scope), /missing for 1/);
assert.match(poolSnapshotAnswer("volume24h", { pools: rows }, scope), /\$3\.00/);
assert.match(poolSnapshotAnswer("apr", { pools: rows }, scope), /not a guaranteed return/);
assert.match(poolSnapshotAnswer("list", { pools: rows, stale: true }, scope), /out of date/);
assert.match(poolSnapshotAnswer("count", { pools: [], error: "unavailable" }, scope), /couldn't read/);
assert.match(poolSnapshotAnswer("count", {}, scope), /couldn't read/);
assert.match(poolSnapshotAnswer("count", { pools: [] }, scope), /does not confirm/);
console.log("Local market answer routing and snapshot checks passed");
