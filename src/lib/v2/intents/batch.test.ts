/*
 * Checks on which steps get bundled into one signature. Run with `npm run test:batch`.
 *
 * Two properties, and they fail in opposite directions:
 *
 *   • THE PAIRING RULE decides what shares a wallet prompt. Too eager and a user
 *     approves an allowance to one contract while reading about an action on
 *     another — the failure is a granted approval nobody looked at. Too shy costs
 *     an extra prompt, which is nothing.
 *   • THE ENCODING has to match what the resolver would have sent. This is the one
 *     no runtime check catches: calldata that encodes cleanly and calls the wrong
 *     function, or the right function with a recipient that is not the user, is a
 *     transaction that succeeds and does the wrong thing. So every encoder is
 *     compared against the same ABI the resolver builds from, and the amounts are
 *     asserted as decoded numbers rather than eyeballed as hex.
 *
 * The wallet side (`useBatchCalls`) is not covered here — it is a React hook over
 * thirdweb's EIP-5792 surface, and what it does is gate on a capability and call
 * out. What is asserted here is everything that decides the bytes.
 */
import { ethers } from "ethers";

import {
  encodeBatch,
  isBatchable,
  pairsWith,
  planRuns,
  type BatchCall,
} from "./batch";
import type { Intent } from "./types";

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

const USER = "0x1111111111111111111111111111111111111111";
const ROUTER = "0x2222222222222222222222222222222222222222";
const USDC = "0x3333333333333333333333333333333333333333";
const WETH = "0x4444444444444444444444444444444444444444";
const DIAMOND = "0x5555555555555555555555555555555555555555";
const VAULT = "0x6666666666666666666666666666666666666666";

const approve = (spender: string, token = USDC): Intent => ({
  kind: "approve",
  token,
  spender,
  amount: "100",
  decimals: 6,
  symbol: "USDC",
});

const swap = (over: Partial<Extract<Intent, { kind: "swap" }>> = {}): Intent =>
  ({
    kind: "swap",
    tokenIn: USDC,
    tokenOut: WETH,
    amountIn: "100",
    amountOutMin: "0.02",
    fee: 3000,
    decimalsIn: 6,
    decimalsOut: 18,
    symbolIn: "USDC",
    symbolOut: "WETH",
    spender: ROUTER,
    ...over,
  }) as Intent;

/* The router ABI as definitions.ts declares it, so a decode here proves the two
   agree about the tuple as well as the selector. */
const ROUTER_IFACE = new ethers.Interface([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)",
]);
const ERC20_IFACE = new ethers.Interface([
  "function approve(address spender, uint256 amount) external returns (bool)",
]);
const PROTOCOL_IFACE = new ethers.Interface([
  "function depositCollateral(address token, uint256 amount) external payable",
  "function repayLoan(uint96 requestId, uint256 amount) external payable",
]);

const one = (i: Intent): BatchCall | null => {
  const calls = encodeBatch([i], [0], USER);
  return calls ? calls[0] : null;
};

console.log("\n— what may be bundled at all —");
{
  check("approve is", isBatchable("approve"));
  check("a swap is", isBatchable("swap"));
  check("depositCollateral is", isBatchable("depositCollateral"));
  /* The two intents types.ts documents as calling no Kaleido contract, so
     LibAgentPermission cannot scope them and the auditor's cap is the only bound.
     Those are exactly the prompts worth keeping. */
  check("a transfer is NOT", !isBatchable("transfer"));
  check("a bridge is NOT", !isBatchable("bridge"));
  /* Not a policy exclusion — its resolver conditionally sends a pool-initialising
     transaction first, so one intent can be two transactions. */
  check("mintPoolPosition is NOT", !isBatchable("mintPoolPosition"));
  check("grantAgentPermission is NOT", !isBatchable("grantAgentPermission"));
}

console.log("\n— the pairing rule —");
{
  check(
    "an approve pairs with the swap it authorises",
    pairsWith(approve(ROUTER), swap()),
  );
  /* THE SAFETY PROPERTY. Without the spender comparison a plan would bundle an
     allowance to one contract with an action on another, under one prompt. */
  check(
    "but NOT with a swap through a different router",
    !pairsWith(approve(ROUTER), swap({ spender: WETH })),
  );
  check(
    "checksum casing does not decide it",
    pairsWith(approve(ROUTER.toUpperCase().replace("0X", "0x")), swap()),
  );
  check(
    "an approve does not pair with an approve",
    !pairsWith(approve(ROUTER), approve(ROUTER)),
  );
  check(
    "and nothing pairs when the first step is not an approve",
    !pairsWith(swap(), swap()),
  );
  check(
    "an approve does not pair with a transfer",
    !pairsWith(approve(ROUTER), {
      kind: "transfer",
      token: USDC,
      to: ROUTER,
      amount: "1",
      decimals: 6,
      symbol: "USDC",
    }),
  );
}

console.log("\n— how a plan is split —");
{
  const runs = planRuns([approve(ROUTER), swap()]);
  check("approve+swap is one run", runs.length === 1, JSON.stringify(runs));
  check("and it is bundled", runs[0]?.bundled === true);
  check(
    "covering both steps in order",
    JSON.stringify(runs[0]?.steps) === "[0,1]",
  );

  const lone = planRuns([swap()]);
  check("a single step is one unbundled run", lone.length === 1 && !lone[0].bundled);

  /* Two pairs, not one run of four. A user signing one prompt should be
     authorising one coherent action, not an arbitrary-length list. */
  const two = planRuns([
    approve(ROUTER),
    swap(),
    approve(VAULT),
    { kind: "stake", vault: VAULT, token: USDC, stToken: WETH, amount: "5", symbol: "KLD" },
  ]);
  check("two pairs stay two runs", two.length === 2, JSON.stringify(two));
  check("both bundled", two.every((r) => r.bundled));

  /* Every intent appears exactly once, in order — the plan the user read is the
     plan that executes. Asserted over a mixed plan because an off-by-one in the
     skip would drop or repeat a step, and either is silent. */
  const mixed: Intent[] = [
    approve(ROUTER),
    swap(),
    {
      kind: "transfer",
      token: USDC,
      to: ROUTER,
      amount: "1",
      decimals: 6,
      symbol: "USDC",
    },
    approve(DIAMOND),
    {
      kind: "depositCollateral",
      diamond: DIAMOND,
      token: USDC,
      amount: "10",
      decimals: 6,
      symbol: "USDC",
    },
  ];
  const flat = planRuns(mixed).flatMap((r) => r.steps);
  check(
    "every step appears exactly once, in order",
    JSON.stringify(flat) === "[0,1,2,3,4]",
    JSON.stringify(flat),
  );
}

console.log("\n— the approve encoding —");
{
  const call = one(approve(ROUTER));
  check("goes to the token, not the spender", call?.to === USDC, call?.to);
  const decoded = ERC20_IFACE.decodeFunctionData("approve", call!.data);
  check("authorises the spender", decoded[0].toLowerCase() === ROUTER);
  check(
    "for the amount at the token's decimals",
    decoded[1] === 100_000_000n,
    String(decoded[1]),
  );
  check("carries no value", call?.value === undefined);
}

console.log("\n— the swap encoding —");
{
  const call = one(swap());
  check("goes to the router", call?.to === ROUTER);
  const [p] = ROUTER_IFACE.decodeFunctionData("exactInputSingle", call!.data);
  check("names the pair in order", p.tokenIn.toLowerCase() === USDC && p.tokenOut.toLowerCase() === WETH);
  check("carries the tier", p.fee === 3000n);
  /* THE RECIPIENT IS THE USER, not the module's sentinel. The encoders are pure
     so they cannot know the address; encodeBatch substitutes it. A substitution
     that silently failed would send the output to a placeholder. */
  check(
    "pays the user, not the sentinel",
    p.recipient.toLowerCase() === USER,
    p.recipient,
  );
  check("parses amountIn at the input's decimals", p.amountIn === 100_000_000n);
  check(
    "and the floor at the OUTPUT's decimals",
    p.amountOutMinimum === 20_000_000_000_000_000n,
    String(p.amountOutMinimum),
  );
  check("no price limit, matching the resolver", p.sqrtPriceLimitX96 === 0n);
  check(
    "the deadline is in the future",
    p.deadline > BigInt(Math.floor(Date.now() / 1000)),
  );
}

console.log("\n— the selector is the resolver's —");
{
  /* A signature restated at a different width encodes the same 32-byte word
     behind a different selector, which a diamond rejects with FunctionNotFound —
     see the width notes in definitions.ts. Compared as selectors because that is
     the part a typo changes invisibly. */
  const cases: [string, Intent, ethers.Interface, string][] = [
    ["approve", approve(ROUTER), ERC20_IFACE, "approve"],
    ["exactInputSingle", swap(), ROUTER_IFACE, "exactInputSingle"],
    [
      "depositCollateral",
      {
        kind: "depositCollateral",
        diamond: DIAMOND,
        token: USDC,
        amount: "10",
        decimals: 6,
        symbol: "USDC",
      },
      PROTOCOL_IFACE,
      "depositCollateral",
    ],
    [
      "repayLoan (uint96, not uint256)",
      {
        kind: "repayLoan",
        diamond: DIAMOND,
        requestId: 7,
        amountRaw: "12345",
        amount: "0.012345",
        symbol: "USDC",
      },
      PROTOCOL_IFACE,
      "repayLoan",
    ],
  ];
  for (const [label, intent, iface, fn] of cases) {
    const call = one(intent);
    check(
      `${label} matches the resolver's ABI`,
      call?.data.slice(0, 10) === iface.getFunction(fn)!.selector,
      `${call?.data.slice(0, 10)} vs ${iface.getFunction(fn)!.selector}`,
    );
  }
}

console.log("\n— repayLoan uses the contract's own figure —");
{
  const call = one({
    kind: "repayLoan",
    diamond: DIAMOND,
    requestId: 7,
    /* Base units from the contract. Re-deriving this from the display string
       could round the loan short and leave it open. */
    amountRaw: "1000000000000000001",
    amount: "1.000000000000000001",
    symbol: "DAI",
  });
  const d = PROTOCOL_IFACE.decodeFunctionData("repayLoan", call!.data);
  check("the raw amount survives exactly", d[1] === 1000000000000000001n, String(d[1]));
}

console.log("\n— native legs fall out of the bundle —");
{
  /* Each returns null for a different reason, and all three end at the same
     place: the sequential path, which already handles them. */
  check("a native sell does not encode", one(swap({ nativeIn: true })) === null);
  check("nor a native buy", one(swap({ nativeOut: true })) === null);
  check(
    "nor native collateral",
    one({
      kind: "depositCollateral",
      diamond: DIAMOND,
      token: USDC,
      amount: "1",
      decimals: 18,
      symbol: "ETH",
      isNative: true,
    }) === null,
  );
  /* And a pair containing one is not a pair, so nothing half-bundles. */
  check(
    "so they do not pair either",
    !pairsWith(approve(ROUTER), swap({ nativeOut: true })),
  );
}

console.log("\n— a bundle is all or nothing —");
{
  const plan: Intent[] = [
    approve(ROUTER),
    {
      kind: "transfer",
      token: USDC,
      to: ROUTER,
      amount: "1",
      decimals: 6,
      symbol: "USDC",
    },
  ];
  /* Half of an approve-and-swap is an allowance granted for a swap that did not
     happen, so an unencodable member drops the whole run. */
  check("one unencodable step voids the batch", encodeBatch(plan, [0, 1], USER) === null);

  check(
    "a malformed amount voids it rather than throwing",
    encodeBatch([{ ...approve(ROUTER), amount: "not a number" } as Intent], [0], USER) ===
      null,
  );
}

console.log("\n— the multi-hop path is re-derived, not trusted —");
{
  const hops = [
    { tokenIn: USDC, tokenOut: WETH, symbolIn: "USDC", symbolOut: "WETH", fee: 3000 },
    { tokenIn: WETH, tokenOut: DIAMOND, symbolIn: "WETH", symbolOut: "KLD", fee: 500 },
  ] as const;
  const good = ethers.concat([
    USDC,
    ethers.toBeHex(3000, 3),
    WETH,
    ethers.toBeHex(500, 3),
    DIAMOND,
  ]);
  const route = (path: string): Intent =>
    ({
      kind: "swapMultiHop",
      hops,
      path,
      amountIn: "100",
      amountOutMin: "1",
      decimalsIn: 6,
      decimalsOut: 18,
      symbolIn: "USDC",
      symbolOut: "KLD",
      spender: ROUTER,
    }) as Intent;

  check("a path matching its hops encodes", one(route(good)) !== null);
  /* THE ONE THAT MATTERS. A path disagreeing with the hops means the row the user
     read described a different route than the calldata performs, and there is no
     revert for it — the swap succeeds, through pools nobody agreed to. Bundling
     must not become the way to get that signed. */
  const swapped = ethers.concat([
    WETH,
    ethers.toBeHex(3000, 3),
    USDC,
    ethers.toBeHex(500, 3),
    DIAMOND,
  ]);
  check("a path that disagrees with the hops does NOT", one(route(swapped)) === null);
  check("nor an empty one", one(route("0x")) === null);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
