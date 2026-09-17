// Arc mainnet is DEX-first: no lending Diamond, and liquidity our own quoter
// cannot see. Two read tools lied about it to the model — checked offline here.
//
//   npm run test:readtools

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, got = "") => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${got ? " " + got : ""}`);
  }
};

const ADDR = "0x1111111111111111111111111111111111111111";

async function main() {
  const { runReadTool } = await import("./readTools.ts");
  const { quoteKyberSwap, hasKyberSwap } = await import("../swap/kyberswap.ts");

  console.log("\n— getPortfolio on a chain with no lending Diamond —");
  const pf = (await runReadTool("getPortfolio", { address: ADDR }, 5042)) as Record<string, unknown>;
  check("Arc degrades instead of erroring", pf.supported === false && !("error" in pf), JSON.stringify(pf).slice(0, 160));
  check("it names the chain", pf.chain === "Arc", String(pf.chain));
  check("the note says lending is not here, and what is", typeof pf.note === "string" && pf.note.includes("isn't deployed on Arc") && pf.note.includes("Swaps and bridging"), String(pf.note).slice(0, 160));
  check("holdings are pointed at getBalances", String(pf.note).includes("getBalances"));
  const unk = (await runReadTool("getPortfolio", { address: ADDR }, 424242)) as Record<string, unknown>;
  check("an unregistered chain is still an error", typeof unk.error === "string" && unk.error.includes("registry"), String(unk.error));
  const bad = (await runReadTool("getPortfolio", { address: "nope" }, 5042)) as Record<string, unknown>;
  check("a bad address is still refused first", typeof bad.error === "string" && bad.error.includes("address"));

  console.log("\n— the aggregator quote seam —");
  check("Arc has the aggregator", hasKyberSwap(5042));
  const base = { chainId: 5042, tokenIn: "0x3600000000000000000000000000000000000000", tokenOut: "0x0000000000000000000000000000000000000001", amountUnits: "1000000" };
  let url = "";
  const okFetch = (async (input: RequestInfo | URL) => {
    url = String(input);
    return new Response(JSON.stringify({ data: { routeSummary: { amountOut: "123456" } } }), { status: 200 });
  }) as typeof fetch;
  const q = await quoteKyberSwap({ ...base, fetchImpl: okFetch });
  check("a routes reply yields amountOut", q?.amountOut === "123456", JSON.stringify(q));
  check("it asked Arc's routes endpoint with the pair", url.includes("/arc/api/v1/routes") && url.includes("tokenIn=0x3600") && url.includes("amountIn=1000000"), url);
  const zero = (async () => new Response(JSON.stringify({ data: { routeSummary: { amountOut: "0" } } }), { status: 200 })) as typeof fetch;
  check("a zero amountOut is no route", (await quoteKyberSwap({ ...base, fetchImpl: zero })) === null);
  const notOk = (async () => new Response("nope", { status: 500 })) as typeof fetch;
  check("a non-ok reply is null, never a guess", (await quoteKyberSwap({ ...base, fetchImpl: notOk })) === null);
  const throws = (async () => { throw new Error("network"); }) as typeof fetch;
  check("a thrown fetch is null", (await quoteKyberSwap({ ...base, fetchImpl: throws })) === null);
  const mustNotFetch = (async () => { throw new Error("should not have fetched"); }) as typeof fetch;
  check("a chain without the aggregator is null without fetching", (await quoteKyberSwap({ ...base, chainId: 11155111, fetchImpl: mustNotFetch })) === null);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
