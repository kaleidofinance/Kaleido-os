// Read-only public RPC preflight. No signer, private keys, or send methods.
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
const require = createRequire(import.meta.url);
const { Interface, formatEther, keccak256 } = require("ethers");
const wallet = "0x0Ce7f8Aeaad60b9E19ACBe9803518182adC351Bc";
async function rpc(url, method, params = []) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const out = await res.json();
  if (out.error) throw new Error(out.error.message);
  return out.result;
}
async function attempt(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: String(e.message).slice(0, 240) };
  }
}
const erc = new Interface([
  "function symbol() view returns(string)",
  "function decimals() view returns(uint8)",
]);
const loupe = new Interface([
  "function facets() view returns(tuple(address facetAddress,bytes4[] functionSelectors)[])",
  "function owner() view returns(address)",
]);
async function call(url, address, abi, fn) {
  return abi.decodeFunctionResult(
    fn,
    await rpc(url, "eth_call", [
      { to: address, data: abi.encodeFunctionData(fn) },
      "latest",
    ]),
  );
}
async function probe(url, expected) {
  const chain = await rpc(url, "eth_chainId");
  if (Number(BigInt(chain)) !== expected)
    throw new Error(`wrong chain ${chain}`);
  const block = await rpc(url, "eth_blockNumber");
  return {
    url,
    chainId: expected,
    block,
    blockTime: (await rpc(url, "eth_getBlockByNumber", [block, false]))
      .timestamp,
  };
}
const report = {
  checkedAt: new Date().toISOString(),
  wallet,
  bsc: {},
  arc: {},
};
for (const url of [
  "https://bsc-rpc.publicnode.com",
  "https://bsc-dataseed.bnbchain.org",
]) {
  const result = await attempt(() => probe(url, 56));
  report.bsc[url] = result;
  if (!result.ok) continue;
  report.bsc.balance = await attempt(async () =>
    formatEther(await rpc(url, "eth_getBalance", [wallet, "latest"])),
  );
  report.bsc.gasPriceWei = await attempt(() => rpc(url, "eth_gasPrice"));
  report.bsc.tokens = {};
  for (const [name, address] of Object.entries({
    WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    USDT: "0x55d398326f99059fF775485246999027B3197955",
    BTCB: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
  })) {
    report.bsc.tokens[name] = await attempt(async () => ({
      address,
      codeBytes:
        ((await rpc(url, "eth_getCode", [address, "latest"])).length - 2) / 2,
      symbol: (await call(url, address, erc, "symbol"))[0],
      decimals: Number((await call(url, address, erc, "decimals"))[0]),
    }));
  }
  const agg = new Interface([
    "function description() view returns(string)",
    "function decimals() view returns(uint8)",
    "function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)",
  ]);
  report.bsc.feeds = {};
  for (const [name, address] of Object.entries({
    BNB: "0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE",
    BTC: "0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf",
    USDC: "0x51597f405303C4377E36123cBc172b13269EA163",
    USDT: "0xB97Ad0E74fa7d920791E90258A6E2085088b4320",
  })) {
    report.bsc.feeds[name] = await attempt(async () => {
      const rd = await call(url, address, agg, "latestRoundData");
      return {
        address,
        description: (await call(url, address, agg, "description"))[0],
        decimals: Number((await call(url, address, agg, "decimals"))[0]),
        round: rd[0].toString(),
        answer: rd[1].toString(),
        updatedAt: Number(rd[3]),
        answeredInRound: rd[4].toString(),
        observedAgeSeconds: Math.floor(Date.now() / 1000) - Number(rd[3]),
      };
    });
  }
  report.bsc.kyberRouter = await attempt(async () => {
    const address = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5";
    const code = await rpc(url, "eth_getCode", [address, "latest"]);
    return {
      address,
      codeBytes: (code.length - 2) / 2,
      codeHash: keccak256(code),
    };
  });
  report.bsc.kyberQuote = await attempt(async () => {
    const qs = new URLSearchParams({
      tokenIn: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      tokenOut: "0x55d398326f99059fF775485246999027B3197955",
      amountIn: "10000000000000000",
    });
    const res = await fetch(
      "https://aggregator-api.kyberswap.com/bsc/api/v1/routes?" + qs,
      { signal: AbortSignal.timeout(15000) },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const q = await res.json();
    if (!q.data?.routeSummary) throw new Error(JSON.stringify(q).slice(0, 200));
    const route = q.data.routeSummary;
    return {
      inputBNB: "0.01",
      amountOut: route.amountOut,
      amountInUsd: route.amountInUsd,
      amountOutUsd: route.amountOutUsd,
      routerAddress: q.data.routerAddress,
      venues: [...new Set(route.route.flat().map((p) => p.exchange))],
      executionSimulated: false,
    };
  });
  break;
}
for (const url of [
  "https://rpc.mainnet.arc.io",
  "https://arc-rpc.publicnode.com",
]) {
  report.arc[url] = await attempt(() => probe(url, 5042));
  if (!report.arc[url].ok) continue;
  const diamond = "0xE4e7f16DB22e6bb2E505fbC504d7B2B4B995A6E3";
  report.arc.owner = await attempt(
    async () => (await call(url, diamond, loupe, "owner"))[0],
  );
  report.arc.settings = {};
  for (const [fn, type] of Object.entries({
    getPythPriceOracle: "address",
    getBPS: "uint256",
    getLiquidityBPS: "uint256",
    getPriceMaxAge: "uint256",
    getPriceMaxConfBps: "uint256",
    getAllCollateralToken: "address[]",
    getLoanableAssets: "address[]",
  })) {
    const abi = new Interface([`function ${fn}() view returns(${type})`]);
    report.arc.settings[fn] = await attempt(async () => {
      const value = (await call(url, diamond, abi, fn))[0];
      return typeof value === "bigint"
        ? value.toString()
        : Array.isArray(value)
          ? [...value]
          : value;
    });
  }
  report.arc.facets = await attempt(async () =>
    (await call(url, diamond, loupe, "facets"))[0].map((f) => ({
      address: f.facetAddress,
      selectors: [...f.functionSelectors],
    })),
  );
  report.arc.contracts = {};
  for (const [name, address] of Object.entries({
    diamond,
    orders: "0x83CA08cd25a663f0a66bda93E5f3c67D382C9856",
    oracle: "0x5027ACF31cEf802d6A89D170691Fa256e079D39B",
    factory: "0xbB74f2319494461B2591F8fbF126654Dd4c2a649",
    router: "0x98D4f47b6F06d30527b61ea3d68656f7Da9B442E",
    manager: "0x55879358eC7eDA609f2264b0348D1915ee8307e1",
    quoter: "0x898e9774b58d23d2EFEF3eb940782d9Ee1a03fa3",
  })) {
    report.arc.contracts[name] = await attempt(async () => {
      const code = await rpc(url, "eth_getCode", [address, "latest"]);
      return {
        address,
        codeBytes: (code.length - 2) / 2,
        codeHash: keccak256(code),
      };
    });
  }
  break;
}
await writeFile(
  new URL("../docs/product/BSC_PREFLIGHT.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
