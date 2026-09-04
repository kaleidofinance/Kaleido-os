/*
 * Checks on what an agent turn displays beside its prose. Run with
 * `npx tsx src/lib/v2/agentTurn.test.ts`.
 *
 * WHY THIS SUITE EXISTS. Two halves, failing in two different ways.
 *
 * The route is drawn from the plan the user is about to sign, so a formatting
 * slip here is a display that contradicts the transaction beneath it: a fee tier
 * off by a factor of a hundred says 30% where the pool charges 0.3%, and a "path"
 * joined across two unrelated swaps claims a hop nothing performs. Neither is
 * catchable by types — every field involved is a number or a string.
 *
 * The trace is built from the model's own tool calls, which makes it untrusted
 * input rendered into the transcript. The checks below are mostly about what it
 * refuses to print.
 */
import { swapRoute, feeLabel, routePath, traceFromChat } from "./agentTurn.ts";
import { TOOL_CATALOG } from "../ai/toolCatalog.ts";

let pass = 0;
let fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

/* Shaped like the swaps build.ts emits: symbols and human amounts, with `fee` in
   the pool's own hundredths-of-a-bip. */
const swap = (symbolIn, symbolOut, amountIn, amountOutMin, fee = 3000) => ({
  kind: "swap",
  tokenIn: `0x${symbolIn}`,
  tokenOut: `0x${symbolOut}`,
  amountIn,
  amountOutMin,
  fee,
  decimalsIn: 18,
  decimalsOut: 18,
  symbolIn,
  symbolOut,
  spender: "0xrouter",
});
const approve = (symbol) => ({
  kind: "approve",
  token: `0x${symbol}`,
  spender: "0xrouter",
  amount: "1",
  decimals: 18,
  symbol,
});

console.log("\n— a plan with no swap has no route —");
{
  check("undefined → null", swapRoute(undefined) === null);
  check("empty plan → null", swapRoute([]) === null);
  check(
    "a plan of approvals only → null",
    swapRoute([approve("USDC")]) === null,
  );
}

console.log("\n— one swap —");
{
  const r = swapRoute([approve("USDC"), swap("USDC", "KLD", "500", "16400")]);
  check("found", r !== null);
  check("one hop", r.hops.length === 1, JSON.stringify(r.hops));
  check(
    "the hop names both sides",
    r.hops[0].from === "USDC" && r.hops[0].to === "KLD",
  );
  check("the input is the first leg's", r.amountIn === "500");
  /* The floor, not a quote. It is what the router will refuse below, so the
     label beside it says "minimum" and this asserts it is that field. */
  check(
    "the output is the last leg's amountOutMin",
    r.minOut === "16400" && r.symbolOut === "KLD",
  );
  check("one hop is trivially a path", r.chained === true);
  check(
    "the path is in → out",
    routePath(r).join(">") === "USDC>KLD",
    routePath(r).join(">"),
  );
}

console.log("\n— several swaps that form one path —");
{
  const r = swapRoute([
    swap("USDC", "WETH", "500", "0.12"),
    approve("WETH"),
    swap("WETH", "KLD", "0.12", "16000", 500),
  ]);
  check("chained", r.chained === true);
  check(
    "the path runs end to end",
    routePath(r).join(">") === "USDC>WETH>KLD",
    routePath(r).join(">"),
  );
  /* The ends of the plan, not of either leg: what you put in is the first
     swap's input and what you are guaranteed is the last swap's floor. */
  check(
    "the ends come from opposite legs",
    r.amountIn === "500" && r.symbolIn === "USDC" && r.minOut === "16000",
  );
  check(
    "each hop keeps its own fee tier",
    r.hops[0].fee === 3000 && r.hops[1].fee === 500,
  );
}

console.log("\n— one swapMultiHop is one path —");
{
  /* The routed swap: one intent, one signature, several pools. It used to fall
     out of `swapRoute` entirely — the filter took `kind === "swap"` only — so the
     one plan shape whose route the user most needs to see rendered with no route
     strip at all. */
  const r = swapRoute([
    approve("WETH"),
    {
      kind: "swapMultiHop",
      hops: [
        {
          tokenIn: "0xWETH",
          tokenOut: "0xUSDC",
          symbolIn: "WETH",
          symbolOut: "USDC",
          fee: 3000,
        },
        {
          tokenIn: "0xUSDC",
          tokenOut: "0xKLD",
          symbolIn: "USDC",
          symbolOut: "KLD",
          fee: 500,
        },
      ],
      path: "0xdeadbeef",
      amountIn: "0.5",
      amountOutMin: "16000",
      decimalsIn: 18,
      decimalsOut: 18,
      symbolIn: "WETH",
      symbolOut: "KLD",
      spender: "0xrouter",
    },
  ]);
  check("found", r !== null);
  check("one hop per pool, not per intent", r.hops.length === 2);
  check(
    "the path runs end to end",
    routePath(r).join(">") === "WETH>USDC>KLD",
    routePath(r).join(">"),
  );
  check("it is a path", r.chained === true);
  check(
    "each pool keeps its own tier",
    r.hops[0].fee === 3000 && r.hops[1].fee === 500,
  );
  /* The ends are the intent's own, because `exactInput` has exactly one input
     and one floor for the whole route — there is no per-leg figure to report. */
  check(
    "the ends are the whole route's",
    r.amountIn === "0.5" && r.symbolIn === "WETH" && r.minOut === "16000",
  );
}

console.log("\n— two swaps that are not a path —");
{
  /* The model can propose this: sell two positions in one plan. Drawing it as
     USDC → KLD → stKLD would invent a hop from KLD to KLD that nothing does. */
  const r = swapRoute([
    swap("USDC", "KLD", "500", "16400"),
    swap("USDT", "stKLD", "200", "6500"),
  ]);
  check("not chained", r.chained === false);
  check("both legs are kept", r.hops.length === 2);
  /* Each leg carries its own numbers, which is what lets the display label them
     separately instead of printing a summary that pairs the first input with the
     last output. */
  check(
    "each leg keeps its own amounts",
    r.hops[0].amountIn === "500" &&
      r.hops[0].minOut === "16400" &&
      r.hops[1].amountIn === "200" &&
      r.hops[1].minOut === "6500",
    JSON.stringify(r.hops),
  );
}

console.log("\n— fee tiers —");
{
  check("500 → 0.05%", feeLabel(500) === "0.05%", feeLabel(500));
  check("3000 → 0.3%", feeLabel(3000) === "0.3%", feeLabel(3000));
  check("10000 → 1%", feeLabel(10000) === "1%", feeLabel(10000));
  /* Not a tier any pool here uses, but the arithmetic has to hold below the
     three known values or a new tier would print as "0%". */
  check("100 → 0.01%", feeLabel(100) === "0.01%", feeLabel(100));
}

console.log("\n— the trace, on a reply with nothing to trace —");
{
  check("no data → no lines", traceFromChat(null).length === 0);
  check(
    "no context → no lines",
    traceFromChat({ response: "hi" }).length === 0,
  );
  check(
    "reads that is not an array → no lines",
    traceFromChat({ context: { reads: "getPortfolio" } }).length === 0,
  );
}

console.log("\n— the trace names what was read —");
{
  /* Argument names are the ones the tool catalogue declares as required —
     `asset` for getPrice, `amount` for getQuote. An earlier version of this
     suite asserted `tokenIn`/`symbol`, which no tool sends, so it passed while
     every real turn printed the argument-free fallback. */
  const lines = traceFromChat({
    context: {
      reads: [
        { name: "getPortfolio", args: { address: "0xabc" } },
        {
          name: "getQuote",
          args: { amount: "500", interestBps: 800, returnDate: 1 },
        },
        { name: "getPrice", args: { asset: "KLD" } },
      ],
      plan: [{ kind: "approve" }, { kind: "swap" }],
      audit: { ok: true },
    },
  });
  check(
    "one line per read plus the outcome",
    lines.length === 4,
    lines.join(" | "),
  );
  check(
    "the portfolio read is in words",
    lines[0] === "Checked your lending position",
    lines[0],
  );
  check(
    "the quote is a loan, not a swap",
    lines[1] === "Worked out the repayment on 500",
    lines[1],
  );
  check(
    "the price names the asset",
    lines[2] === "Checked the KLD price",
    lines[2],
  );
  check(
    "the outcome counts the steps",
    lines[3] === "Built 2 steps to sign",
    lines[3],
  );
}

console.log("\n— reads that would otherwise read alike —");
{
  /* Measured on a live turn: the model calls getChains once per asset and
     getBridgeRoute once per source chain. Labels that named neither produced
     "Checked which chains are live" three times in a row. */
  const lines = traceFromChat({
    context: {
      reads: [
        { name: "getChains", args: { address: "0xabc", asset: "USDC" } },
        { name: "getChains", args: { address: "0xabc", asset: "USDT" } },
        {
          name: "getBridgeRoute",
          args: {
            fromChain: "Base",
            toChain: "Ethereum Sepolia",
            asset: "USDC",
            amount: "276",
          },
        },
        {
          name: "getBridgeRoute",
          args: {
            fromChain: "Arc Testnet",
            toChain: "Ethereum Sepolia",
            asset: "USDC",
            amount: "4170",
          },
        },
      ],
    },
  });
  check("each read gets its own line", lines.length === 4, lines.join(" | "));
  check(
    "getChains names the asset",
    lines[0] === "Found your USDC across chains" &&
      lines[1] === "Found your USDT across chains",
    lines.slice(0, 2).join(" | "),
  );
  check(
    "a route names both ends",
    lines[2] === "Looked for the Base → Ethereum Sepolia route" &&
      lines[3] === "Looked for the Arc Testnet → Ethereum Sepolia route",
    lines.slice(2).join(" | "),
  );
  check(
    "no line needs an a/an it cannot get right",
    lines.every((l) => !/\ba [AEIOU]/.test(l)),
    lines.join(" | "),
  );
}

console.log("\n— a repeated call collapses —");
{
  const same = { name: "getPrice", args: { asset: "ETH" } };
  const lines = traceFromChat({
    context: { reads: [same, same, same, { name: "getPortfolio", args: {} }] },
  });
  check(
    "three identical reads become one counted line",
    lines.length === 2 && lines[0] === "Checked the ETH price ×3",
    lines.join(" | "),
  );
  check(
    "a following different read is untouched",
    lines[1] === "Checked your lending position",
    lines[1],
  );

  /* Only consecutive repeats collapse, so the trace keeps the order the reads
     happened in rather than grouping them. */
  const split = traceFromChat({
    context: {
      reads: [same, { name: "getPortfolio", args: {} }, same],
    },
  });
  check(
    "a repeat that is not adjacent stays separate",
    split.length === 3 && split.every((l) => !l.includes("×")),
    split.join(" | "),
  );
}

console.log("\n— the trace refuses what it cannot vouch for —");
{
  const lines = traceFromChat({
    context: {
      reads: [
        null,
        "getPortfolio",
        { name: 42 },
        { name: "" },
        { name: "drop tables; getPortfolio" },
        { name: "getSomethingNew", args: null },
        {
          name: "getQuote",
          args: { amount: "x".repeat(400), interestBps: 800 },
        },
      ],
    },
  });
  /* Only the last two survive: an unrecognised tool is named as itself, and a
     recognised one whose argument is not a short plain string falls back to the
     label that interpolates nothing. */
  check("junk entries are dropped", lines.length === 2, lines.join(" | "));
  check(
    "an unknown tool is named, not guessed at",
    lines[0] === "Called getSomethingNew",
    lines[0],
  );
  check(
    "an unusable argument degrades the label",
    lines[1] === "Worked out the loan repayment",
    lines[1],
  );
}

console.log("\n— every read tool says something in words —");
{
  /* "Called getBalances" reached the screen this way: getBalances arrived in the
     tool catalogue without a matching entry in READ_LABELS, so the fold showed the
     user an internal tool name. Asserting the property rather than the one label,
     because a read tool is added in a different file from the one that names it
     and the next one would go the same way silently. */
  const reads = TOOL_CATALOG.filter((t) => t.kind === "read").map(
    (t) => t.name,
  );
  check(
    "the catalog still has read tools",
    reads.length > 0,
    `${reads.length}`,
  );
  const named = reads.filter((name) =>
    traceFromChat({ context: { reads: [{ name, args: {} }] } })[0]?.startsWith(
      "Called ",
    ),
  );
  check(
    "no read tool falls through to its own name",
    named.length === 0,
    named.join(", "),
  );
}

console.log("\n— the outcome line —");
{
  const one = traceFromChat({ context: { plan: [{ kind: "swap" }] } });
  check("one step is singular", one[0] === "Built 1 step to sign", one[0]);

  /* A refused plan comes back as `plan: []` with `audit.ok === false`, and the
     two are different answers — the trace must not report "built nothing". */
  const blocked = traceFromChat({
    context: { plan: [], audit: { ok: false, blocked: ["over cap"] } },
  });
  check(
    "a refusal says so",
    blocked.length === 1 && blocked[0].startsWith("Auditor refused"),
    blocked.join(" | "),
  );

  const chat = traceFromChat({ context: { plan: [], audit: { ok: true } } });
  check(
    "a plain answer has no outcome line",
    chat.length === 0,
    chat.join(" | "),
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
