// Read-only risk evidence. Token/feed presence never automatically enables lending.
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
const require = createRequire(import.meta.url);
const { Interface, keccak256, toUtf8Bytes, formatUnits } = require("ethers");
const rpcUrl = "https://bsc-rpc.publicnode.com";
async function rpc(method, params = []) {
  const r = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(12000),
  });
  const j = await r.json();
  if (j.error) throw Error(j.error.message);
  return j.result;
}
async function attempt(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: e.message.slice(0, 220) };
  }
}
async function read(address, signature, args = []) {
  const abi = new Interface([signature]);
  const f = abi.fragments[0];
  return abi.decodeFunctionResult(
    f,
    await rpc("eth_call", [
      { to: address, data: abi.encodeFunctionData(f, args) },
      "latest",
    ]),
  )[0];
}
const tokens = {
  USDC: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
  USDT: "0x55d398326f99059ff775485246999027b3197955",
  USD1: "0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d",
  FDUSD: "0xc5f0f7b66764f6ec8c8dff7ba683102295e16409",
  BTCB: "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c",
};
const report = {
  checkedAt: new Date().toISOString(),
  tokens: {},
  feeds: {},
  admission: "pending; evidence only",
  limitations: [
    "optional method failures do not prove absence of privileged controls",
    "positive supply and quotes do not verify backing or liquidation depth",
    "latest-state reads are independent, not a pinned-block audit",
  ],
};
if (Number(BigInt(await rpc("eth_chainId"))) !== 56) throw Error("wrong chain");
report.block = await rpc("eth_blockNumber");
for (const [symbol, address] of Object.entries(tokens)) {
  const out = { address };
  report.tokens[symbol] = out;
  for (const [key, signature] of Object.entries({
    symbol: "function symbol() view returns(string)",
    name: "function name() view returns(string)",
    decimals: "function decimals() view returns(uint8)",
    totalSupply: "function totalSupply() view returns(uint256)",
    owner: "function owner() view returns(address)",
    paused: "function paused() view returns(bool)",
  }))
    out[key] = await attempt(async () => {
      const v = await read(address, signature);
      return typeof v === "bigint" ? v.toString() : v;
    });
  out.codeBytes = await attempt(
    async () =>
      ((await rpc("eth_getCode", [address, "latest"])).length - 2) / 2,
  );
  for (const name of ["implementation", "admin"])
    out[name + "Slot"] = await attempt(() =>
      rpc("eth_getStorageAt", [
        address,
        "0x" +
          (BigInt(keccak256(toUtf8Bytes("eip1967.proxy." + name))) - 1n)
            .toString(16)
            .padStart(64, "0"),
        "latest",
      ]),
    );
  out.quotes = [];
  if (out.decimals.ok)
    for (const amount of symbol === "BTCB"
      ? ["0.001", "0.01", "0.1"]
      : ["100", "1000", "10000"]) {
      const decimals = Number(out.decimals.value),
        [whole, fraction = ""] = amount.split(".");
      const units =
        BigInt(whole) * 10n ** BigInt(decimals) +
        BigInt(fraction.padEnd(decimals, "0"));
      out.quotes.push({
        amount,
        quote: await attempt(async () => {
          const q = new URLSearchParams({
            tokenIn: address,
            tokenOut: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
            amountIn: units.toString(),
          });
          const r = await fetch(
            "https://aggregator-api.kyberswap.com/bsc/api/v1/routes?" + q,
            { signal: AbortSignal.timeout(15000) },
          );
          const j = await r.json();
          if (!r.ok || !j.data?.routeSummary)
            throw Error(j.message || "no route");
          const s = j.data.routeSummary;
          return {
            amountOut: s.amountOut,
            amountInUsd: s.amountInUsd,
            amountOutUsd: s.amountOutUsd,
            venues: [...new Set(s.route.flat().map((l) => l.exchange))],
          };
        }),
      });
    }
}
const directory = await (
  await fetch(
    "https://reference-data-directory.vercel.app/feeds-bsc-mainnet.json",
    { signal: AbortSignal.timeout(15000) },
  )
).json();
for (const path of [
  "usd1-usd",
  "fdusd-usd",
  "btc-usd",
  "usdc-usd",
  "usdt-usd",
]) {
  const d = directory.find((r) => r.path === path);
  if (!d) {
    report.feeds[path] = { found: false };
    continue;
  }
  const address = d.proxyAddress;
  const roundAbi = new Interface([
    "function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)",
  ]);
  report.feeds[path] = {
    proxy: address,
    heartbeat: d.heartbeat,
    deviationPercent: d.threshold,
    category: d.feedCategory,
    live: await attempt(async () => {
      const r = roundAbi.decodeFunctionResult(
        "latestRoundData",
        await rpc("eth_call", [
          { to: address, data: roundAbi.encodeFunctionData("latestRoundData") },
          "latest",
        ]),
      );
      const dec = Number(
        await read(address, "function decimals() view returns(uint8)"),
      );
      return {
        description: await read(
          address,
          "function description() view returns(string)",
        ),
        decimals: dec,
        answer: formatUnits(r[1], dec),
        updatedAt: Number(r[3]),
        ageSeconds: Math.floor(Date.now() / 1000) - Number(r[3]),
        completed: r[0] === r[4],
        positive: r[1] > 0n,
      };
    }),
  };
}
await writeFile(
  "docs/product/BSC_LOAN_RISK_PROBE.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      checkedAt: report.checkedAt,
      tokens: Object.fromEntries(
        Object.entries(report.tokens).map(([k, v]) => [
          k,
          {
            symbol: v.symbol,
            decimals: v.decimals,
            paused: v.paused,
            owner: v.owner,
            quoteSuccesses: v.quotes.filter((q) => q.quote.ok).length,
          },
        ]),
      ),
      feeds: report.feeds,
    },
    null,
    2,
  ),
);
