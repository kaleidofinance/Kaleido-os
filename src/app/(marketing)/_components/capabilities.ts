/**
 * The capability inventory — every tool the section names, with its real
 * parameter list.
 *
 * One module rather than a copy per consumer, because each of them makes the same
 * claim from it and a drift between them would put a tool name on screen that no
 * group lists. `traces.ts` reads `GROUPS` and `READS`, runs each `prompt` through
 * the real parser and each `example` through the real planner; `CapabilityTabs`
 * renders the traces that come back.
 *
 * `ALL_TOOLS` is the flat version, and its only consumer today is `ToolRibbon`,
 * which is no longer on the page — the card grid in `CapabilityTabs` became the
 * inventory, so the ribbon was saying all 29 names a second time. The component is
 * still on disk and this export is still gate-checked, so putting it back is one
 * line in page.tsx.
 *
 * EVERY NAME AND EVERY PARAMETER LIST HERE IS VERBATIM FROM
 * src/lib/ai/toolCatalog.ts, and that is the whole reason this section is worth
 * showing. The claim being made is not "the agent is powerful" — it is "here is
 * the exact surface, check it against the source". A name that does not exist in
 * the catalog, or a parameter list that has drifted from it, turns the section
 * from evidence into decoration. `params` is the tool's `required` array in
 * order; properties the catalog declares but does not require go in `optional`,
 * and there are exactly eight of those.
 *
 * How to re-verify after a catalog change, rather than trusting this comment:
 * `npx tsx src/app/(marketing)/_components/capabilities.test.ts` asserts every
 * name, every `required` list and every `optional` split against the catalog
 * itself, and builds all 23 examples through the real planner. It runs in the
 * gate, so a catalog change that invalidates this file fails there.
 */

export interface Tool {
  name: string;
  /** The catalog's `required` list, in order. Empty means the tool takes none. */
  params: readonly string[];
  /**
   * Properties the catalog declares but leaves out of `required`. Ten of them,
   * and none is an oversight in the catalog:
   *
   *   `repay.loanId` — "Only when the user has more than one open loan",
   *   because the server resolves a single open loan itself.
   *   `grantAgentPermission.maxInterestBps` — carried as 0 when absent and not
   *   audited; fromToolCall.ts:318 states this outright.
   *   `getMarkets.side` — an enum of borrow/lend; absent means both sides.
   *   `getBridgeRoute.address` — "improves quote accuracy", so a route can be
   *   quoted for a visitor with no wallet connected.
   *   `getSwapRoute.amount` — absent prices one unit, so "can I route ETH to
   *   KLD?" can be answered before a size is decided.
   *   `provideLiquidity.fee` — absent means "whichever tier already has a pool",
   *   which the builder resolves by reading all three.
   *   `provideLiquidity.bandPct`, `.minPrice`, `.maxPrice` — the three ways to
   *   ask for a range, and all three absent means full range. That default is
   *   the reason they are optional rather than one required `range`: full range
   *   is the only choice that is valid on every pool, including one that does
   *   not exist yet.
   *   `removePosition.percent` — absent closes the position, which is what the
   *   verb has always meant and what the typed grammar can express; a partial
   *   removal is the case only a declared argument can state unambiguously.
   *
   * Rendering any of them as required would misstate the API.
   */
  optional?: readonly string[];
  /**
   * What the user types to start this turn, exactly as they would type it.
   *
   * Not decoration — it is an input the product accepts. For every execute tool
   * except two, `traces.ts` runs this string through `parseCommand` and gets a
   * complete command back, which is the app's local path: no model call, and the
   * turn is tagged "Direct" in the transcript. So these must stay parseable.
   * capabilities.test.ts asserts that the plan the typed sentence builds is
   * step-for-step the plan the tool call builds, which is the whole claim the
   * animation makes — the two entry points agree.
   *
   * The two exceptions are the ones carrying a `reply`. Read tools carry a
   * question rather than a command, since a read is something the model decides
   * to call.
   */
  prompt: string;
  /**
   * Luca's line, authored — and only for the two tools whose turn cannot be built
   * from the typed grammar, where the app's own line comes from the model at
   * runtime and so cannot be computed here. Everywhere else this is absent and
   * the transcript shows `buildIntents`' own summary, which is verbatim what
   * agent/page.tsx:271 says on the local path.
   *
   * Keep it to one sentence, and keep it to what the steps below it already
   * commit to. It is the one line on this page a model would have written.
   */
  reply?: string;
  /**
   * One example call, in exactly the shape the model emits — the argument object
   * of a tool call. `traces.ts` feeds this to the real planner and renders
   * whatever steps come back, so this is the only authored part of a trace and
   * the steps below it are not.
   *
   * Two rules for editing these. They must satisfy the tool's own validation, or
   * the panel renders the builder's refusal instead of a plan; the gate check in
   * capabilities.test.ts fails loudly on that rather than letting it ship. And
   * they must be *plausible* numbers — this panel is read as a specimen of the
   * product, so a 1 wei swap or a 900% rate reads as a toy.
   *
   * Only execute tools carry one. A read signs nothing, so it has no steps to
   * show and `traces.ts` gives it the catalog's own description instead.
   */
  example?: Readonly<Record<string, unknown>>;
}

export interface Group {
  title: string;
  /** Short tab label — `title` is too long for a chip in three of eight cases. */
  tab: string;
  note: string;
  /** A verified in-app route; every one of these is a real page.tsx. */
  href: string;
  tools: readonly Tool[];
}

/**
 * The seven execute groups — 24 tools, which is the number in the section
 * heading. Keep that true: the heading is a count, and a count is the one kind
 * of copy that a reader can falsify by scrolling.
 *
 * `READS` is deliberately not in here. A read tool is not an action the agent
 * executes, and folding the seven of them in would make the heading wrong by
 * seven.
 */
export const GROUPS: readonly Group[] = [
  {
    title: "Trade",
    tab: "Trade",
    note: "Concentrated-liquidity swaps, priced server-side.",
    href: "/trade/swap",
    tools: [
      {
        name: "swap",
        params: ["amount", "tokenIn", "tokenOut"],
        prompt: "swap 1000 USDC to WETH",
        /*
         * USDC in, not ETH, and it is no longer a gap that decides this — a
         * native `tokenIn` builds and signs now: build.ts's swap branch spreads
         * its approve the way the four lending branches do, and the `swap`
         * Intent carries `isNative` through to a resolver that passes `value`.
         * The reason to keep an ERC20 pair here is that it is the trace with
         * more in it. A native swap is two steps shorter — no approve at all —
         * so ETH → USDC would show the panel a one-step plan and hide the thing
         * the panel is for. This example is the wrapped leg on purpose.
         */
        example: { amount: "1000", tokenIn: "USDC", tokenOut: "WETH" },
      },
    ],
  },
  {
    title: "Move funds",
    tab: "Send",
    /* Neither tool here touches a Kaleido contract: a send goes wallet to
       wallet, a bridge to a canonical portal or an aggregator router. A send
       builds end to end with nothing deployed — see the OFFLINE deps in
       LivePlanner — while a bridge resolves its route through PlanDeps the way a
       swap resolves a price, so with no provider reachable its offline form is an
       honest stop rather than a plan. */
    note: "Wallet to wallet, or across chains — no Kaleido contract touched.",
    href: "/portfolio",
    tools: [
      {
        name: "send",
        params: ["amount", "token", "to"],
        /* The full address, in the prompt as well as the example: a truncated
           one does not parse — it is 40 hex digits or it is not an address —
           and the send renderer refuses to abbreviate a recipient anywhere. */
        prompt: "send 250 USDC to 0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
        example: {
          amount: "250",
          token: "USDC",
          to: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
        },
      },
      /* Native currency only for now, and the example is a real canonical
         corridor: Sepolia → Base Sepolia deposits through the L1StandardBridge,
         which the trace fixture resolves with no network call. A non-native
         asset would need an approve to the router the auditor's approve rule
         rejects, so the builder refuses it by name — see the bridge Intent's
         native-only note in intents/types.ts. */
      {
        name: "bridge",
        params: ["amount", "asset", "toChain"],
        prompt: "bridge 0.05 ETH to Base Sepolia",
        example: { amount: "0.05", asset: "ETH", toChain: "Base Sepolia" },
      },
    ],
  },
  {
    title: "Borrow and lend",
    tab: "Borrow & lend",
    note: "Post at your own rate, or take theirs.",
    href: "/borrow",
    tools: [
      {
        name: "borrow",
        params: ["amount", "token", "interestPct", "days"],
        prompt: "borrow 5000 USDC at 7.5% for 30 days",
        example: {
          amount: "5000",
          token: "USDC",
          interestPct: 7.5,
          days: 30,
        },
      },
      {
        name: "lend",
        params: ["amount", "token", "interestPct", "days"],
        prompt: "lend 10000 USDC at 6% for 60 days",
        example: { amount: "10000", token: "USDC", interestPct: 6, days: 60 },
      },
      {
        name: "takeListing",
        params: ["listingId", "amount"],
        prompt: "take 2500 from listing 42",
        example: { listingId: 42, amount: "2500" },
      },
      {
        name: "fillRequest",
        params: ["requestId"],
        prompt: "fill request 17",
        example: { requestId: 17 },
      },
      /* No arguments, deliberately: the trace is the proof that the server
         resolves the single open loan itself rather than making the model
         guess an id. The fixture in traces.ts supplies exactly one loan. */
      {
        name: "repay",
        params: [],
        optional: ["loanId"],
        prompt: "repay",
        example: {},
      },
      {
        name: "cancel",
        params: ["target", "id"],
        prompt: "cancel listing 42",
        example: { target: "listing", id: 42 },
      },
      {
        name: "deposit",
        params: ["amount", "token"],
        prompt: "deposit 3 ETH",
        example: { amount: "3", token: "ETH" },
      },
      {
        name: "withdraw",
        params: ["amount", "token"],
        prompt: "withdraw 1 ETH",
        example: { amount: "1", token: "ETH" },
      },
    ],
  },
  {
    title: "Stablecoin",
    tab: "Stablecoin",
    note: "kfUSD against USDC, USDT or USDe, plus the vault.",
    href: "/stable",
    tools: [
      {
        name: "mint",
        params: ["amount", "token"],
        prompt: "mint 5000 USDC",
        example: { amount: "5000", token: "USDC" },
      },
      {
        name: "redeem",
        params: ["amount", "token"],
        prompt: "redeem 5000 USDC",
        example: { amount: "5000", token: "USDC" },
      },
      {
        name: "lock",
        params: ["amount"],
        prompt: "lock 5000",
        example: { amount: "5000" },
      },
      {
        name: "unlock",
        params: ["amount"],
        prompt: "unlock 2500",
        example: { amount: "2500" },
      },
      {
        name: "completeWithdrawal",
        params: ["token"],
        /*
         * This carried an authored `reply` and a note calling it one of the two
         * turns that genuinely need the model. Both are gone, and the reason is
         * worth keeping because it was a real prediction that came true.
         *
         * fromCommand.ts:763 resolves the payout token as
         * `mentions[0]?.token ?? findToken("kfusd", tokens)`, and kfUSD was in no
         * chain's token list: `ownTokens` reads its address from the deployment
         * record at call time and nothing was deployed, so a bare "complete my
         * vault withdrawal" came back asking which token and the app answered it
         * by paying for a model. The stablecoin is deployed on all five testnets
         * now, so the same sentence closes on the grammar and this turn is
         * Direct — one fewer model call in the product, not just on this page.
         *
         * Nothing here declares that. `traces.ts` measures which path served the
         * turn, and capabilities.test.ts asserts which tools come back on which,
         * so the panel followed the deployment on its own.
         */
        prompt: "complete my vault withdrawal",
        /*
         * kfUSD, and USDC here would be a bug the panel displays. The vault
         * releases kfUSD, so build.ts refuses a collateral payout by name
         * ("the yield vault pays out in kfUSD, not USDC") rather than building
         * a call that reverts. Correct behaviour, wrong thing to put on a
         * landing page.
         */
        example: { token: "kfUSD" },
      },
      {
        name: "claimYield",
        params: [],
        prompt: "claim yield",
        example: {},
      },
      {
        name: "compoundYield",
        params: [],
        prompt: "compound yield",
        example: {},
      },
    ],
  },
  {
    title: "Liquidity",
    tab: "Liquidity",
    note: "Open a position, add to it, collect what it earned, or close part of it.",
    href: "/pool",
    tools: [
      {
        name: "provideLiquidity",
        /* Four, in the catalog's order. The other four declared properties are
           the range and the tier — see `optional`, and the prompt below for why
           none of them is a tick. */
        params: ["token0", "amount0", "token1", "amount1"],
        optional: ["fee", "bandPct", "minPrice", "maxPrice"],
        /*
         * The second model turn on the page, and the reason is the same shape as
         * the grant's: six values against a grammar whose only amount slot is
         * `amount`. fromCommand.ts names it a `ToolOnlyKind` outright rather than
         * leaving an empty verb list, because "add 2000 usdc" would otherwise open
         * a Draft that can never be completed.
         *
         * What the trace under this is actually showing, and the only reason a
         * chat-driven mint is defensible at all: the user says how *wide*, and the
         * server reads where. There is no tick in the tool call — the ±10% is
         * centred on the pool's own live price and snapped to the tier's spacing
         * server-side, so a range the model got wrong is a range that is merely
         * wider or narrower than asked, not one sitting outside the market earning
         * nothing. A tick a model emitted would be unauditable: nothing about
         * -73200 tells a reader whether it is near the price.
         */
        prompt:
          "add 1 WETH and 2000 USDC to the WETH/USDC pool, keep it within ±10% of the price",
        reply:
          "Two approvals and the mint. I centred the range on the pool's current price and snapped it to the 0.3% tier's spacing — the bounds below are the ones you'll actually be earning between.",
        example: {
          /*
           * WETH first, and it is the pair's *legibility* rather than the pool's
           * order that decides this. Both orders mint the identical position —
           * `sortMintParams` crosses into the pool's address-sorted frame and takes
           * the ticks with it — but every price the panel prints is token1 per
           * token0 as named here. USDC first renders the range as
           * "0.000489 – 0.000600 WETH per USDC", which is the same band written in
           * the unit nobody quotes ETH in. This way it reads in dollars.
           */
          token0: "WETH",
          amount0: "1",
          token1: "USDC",
          amount1: "2000",
          /* Named, so the trace shows a tier that was chosen rather than
             resolved: omitting `fee` sends the builder to read all three pools
             and prefer the deepest, which is the right default and a worse
             specimen — the panel would print a tier with no visible cause. */
          fee: 3000,
          /* A percentage, not a fraction: the catalog says "10 means ±10%", and
             fromToolCall divides by 100 on the way to the RangeChoice.
             The pair of amounts is chosen against what this band actually
             consumes, which is not what the spot price implies. Measured: ±10% of
             1834.61 snaps to 1655.79–2018.32, and a range that wide takes 1968
             USDC per WETH rather than 1834.61 — so 1 and 2000 leaves USDC very
             slightly over-supplied and the minimums land at 0.995 WETH and
             1958.17 USDC. That is the honest specimen: the floor comes from what
             the range will take, not from what was typed, which is the whole
             reason mintMinimums exists. */
          bandPct: 10,
        },
      },
      {
        name: "increasePosition",
        /* Five, and the four that provideLiquidity has and this does not are the
           tier and the three range arguments. They are absent rather than
           optional: increaseLiquidity takes a tokenId and two amounts, and reads
           the pair, the tier and the bounds out of storage. An argument for a
           range here would be one the contract ignores. */
        params: ["positionId", "token0", "amount0", "token1", "amount1"],
        /*
         * The third and last model turn on the page. Same cause as
         * provideLiquidity's — five values against a grammar whose only amount
         * slot is `amount` — so fromCommand.ts names it the second
         * `ToolOnlyKind` rather than leaving a verb list that cannot be filled.
         *
         * The prompt names the tokens in the order a person would say them,
         * which is the *opposite* of the pool's own order, and that is the point
         * of the row: the position is the authority on which leg is which. The
         * builder matches each named symbol against the position's own token0
         * and token1 and refuses if it cannot place both, so naming them
         * backwards cannot deposit them backwards. Nothing else in this panel
         * has that property — every other pair example is order-sensitive.
         */
        prompt: "add 0.5 WETH and 1000 USDC to position 48211",
        reply:
          "Two approvals and the increase. The pool, the 0.3% tier and the range are the position's own — this adds to what's already there and doesn't move the bounds, so the floors below come from the range you already have.",
        example: {
          positionId: "48211",
          /*
           * WETH, not ETH, and the builder is what decides that rather than the
           * panel's taste: an increase refuses a native name and answers with
           * the wrapped symbol to retry with, exactly as the mint does. A
           * position holds WETH, and someone asking to add ETH is quite likely
           * holding only ETH — aliasing the word would sign two approvals and
           * then revert for want of a WETH balance.
           *
           * The amounts are half the mint example's at the same ratio, and the
           * ratio is the measured one rather than spot: this position's ticks
           * are derived from that example's ±10% band, so it takes ~1968 USDC
           * per WETH, and 0.5 against 1000 leaves USDC very slightly
           * over-supplied exactly as 1 against 2000 does. The floors the panel
           * prints come from what the range will take.
           */
          token0: "WETH",
          amount0: "0.5",
          token1: "USDC",
          amount1: "1000",
        },
      },
      {
        name: "collectFees",
        params: ["positionId"],
        prompt: "collect fees position 48211",
        example: { positionId: "48211" },
      },
      {
        name: "removePosition",
        params: ["positionId"],
        optional: ["percent"],
        /* No percentage in the prompt, and it is the grammar rather than the
           example that decides that: `detectRate` owns bare percentage tokens —
           "lend at 6%" is how a rate is found — so "remove 50% of position
           48211" would have its 50% read as an interest rate. This prompt is
           the sentence the typed path actually parses; the partial case is
           reachable only as a declared argument, which is why `percent` is
           optional here and absent from the prompt. */
        prompt: "remove liquidity position 48211",
        example: { positionId: "48211" },
      },
    ],
  },
  {
    /* "No advertised APY" is a copy rule on this page rather than modesty: the
       yield is the exchange rate moving, and the app quotes no rate for it. */
    title: "Staking",
    tab: "Stake",
    note: "KLD in, liquid stKLD out. No advertised APY.",
    href: "/stake",
    tools: [
      {
        name: "stake",
        params: ["amount"],
        prompt: "stake 1200 KLD",
        example: { amount: "1200" },
      },
    ],
  },
  {
    /*
     * The nine declared parameters are the point of this tab, not a wall of
     * arguments to be trimmed. "Bounded on chain" is the claim, and a per-action
     * cap, a per-epoch cap, an epoch length, an expiry, an interest ceiling, a
     * health floor, an action bitmask and a token allowlist are what bounds it.
     * Cut the list to three and the claim becomes unverifiable.
     *
     * One thing this must never be allowed to imply: the mandate does not scope
     * a `send`. It scopes protocol actions. Do not widen the wording.
     */
    title: "Delegation",
    tab: "Delegation",
    note: "Bounded on chain, and only if you ask.",
    href: "/portfolio",
    tools: [
      {
        name: "grantAgentPermission",
        /* Eight, in the catalog's order. `maxInterestBps` is the ninth declared
           property and is deliberately not here — see `optional` below. */
        params: [
          "agent",
          "maxNotionalPerAction",
          "maxNotionalPerEpoch",
          "epochDurationSec",
          "expiryUnix",
          "minHealthFactorBps",
          "allowedActions",
          "tokens",
        ],
        optional: ["maxInterestBps"],
        /*
         * The other model turn, and the stricter of the two: `provideLiquidity`
         * is excluded from the grammar by name, whereas fromCommand.ts has no
         * verb for a permission grant at all, so there is nothing to type into
         * the command box that reaches this tool. Eight
         * bounds is also more than a one-line grammar should be asked to carry —
         * a mistyped bitmask is a mandate that permits the wrong action. So the
         * user says what they want in their own words and the model fills the
         * eight arguments, which the trace below then shows in full.
         */
        prompt:
          "let the agent manage my USDC — 5,000 a trade, 25,000 a day, and stop if my health factor drops under 1.5",
        reply:
          "One transaction, and every bound you named is on it: $5,000 per action, $25,000 per day, USDC only, a 1.5 health floor, and revocable whenever you like.",
        example: {
          agent: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
          maxNotionalPerAction: "5000",
          maxNotionalPerEpoch: "25000",
          epochDurationSec: 86400,
          /*
           * A fixed far-future stamp rather than "now + 90 days". Nothing in the
           * grant path validates expiry — fromToolCall.ts carries it through as
           * given — and the renderer does not print it, so the only thing a
           * computed value would buy is a trace that changes on every rebuild.
           */
          expiryUnix: 2000000000,
          maxInterestBps: 900,
          minHealthFactorBps: 15000,
          /* A number, not a list of verb names: the catalog types this as
             "Bitmask of allowed actions", and `numOf` on an array yields 0 —
             a mandate permitting nothing. 6 is two bits set. */
          allowedActions: 6,
          tokens: ["USDC"],
        },
      },
    ],
  },
];

/**
 * The read half, as the eighth tab under a divider in the strip.
 *
 * Separate from `GROUPS` because it is a different kind of claim — everything
 * above sends a transaction, these only look — and the tab strip marks the line
 * rather than hiding it. It stays in the same panel because "it checks before it
 * proposes" is a capability, not a footnote to the seven.
 *
 * Their `prompt`s are questions, not commands, and that is the honest framing:
 * no read is reachable from the typed grammar. A read happens because the model
 * decided it needed a number before it could answer, so the trace shows the
 * question, the call it makes, and what that call returns — and stops there. It
 * does not invent the answer, because the answer depends on a wallet and a live
 * market that this page has neither of.
 */
export const READS: Group = {
  title: "Reads before it acts",
  tab: "Reads",
  note: "Seven read tools, so a proposal arrives with numbers.",
  href: "/portfolio",
  tools: [
    {
      name: "getPortfolio",
      params: ["address"],
      prompt: "what am I holding?",
    },
    {
      name: "getMarkets",
      params: ["asset"],
      optional: ["side"],
      prompt: "who's lending USDC right now, and at what rate?",
    },
    {
      name: "getQuote",
      params: ["amount", "interestBps", "returnDate"],
      /* Phrased without a command verb on purpose. "if I borrow 5,000 USDC at
         8%…" would be picked up by the parser as a borrow and never reach a
         read at all, which would make this row quietly wrong about its own
         entry point. */
      prompt: "how much interest on 5,000 USDC at 8% over 30 days?",
    },
    { name: "getPrice", params: ["asset"], prompt: "what's ETH worth today?" },
    {
      name: "getSwapRoute",
      params: ["tokenIn", "tokenOut"],
      optional: ["amount"],
      /* A question about a pair with no direct pool, which is the case this tool
         exists for: KLD is seeded against USDC and nothing else, so the answer
         runs ETH → USDC → KLD and could not be given at all before this. Phrased
         as a question for the same reason as getQuote above — "swap 0.1 ETH for
         KLD" is parsed as a swap and never reaches a read. */
      prompt: "can I get KLD with my ETH?",
    },
    {
      name: "getChains",
      params: ["address", "asset"],
      prompt: "where is my USDC?",
    },
    {
      name: "getBridgeRoute",
      params: ["fromChain", "toChain", "asset", "amount"],
      optional: ["address"],
      prompt: "what would moving 1,000 USDC from Base to Arbitrum cost me?",
    },
  ],
};

/** Every tab, execute first, reads last — the order the strip renders. */
export const ALL_GROUPS: readonly Group[] = [...GROUPS, READS];

/**
 * Catalog tools this page deliberately does not inventory.
 *
 * The header above says every name here is verbatim from the catalog and that
 * the claim being made is "here is the exact surface, check it against the
 * source". This list is the honest form of the one exception, rather than a
 * quietly missing row: `claimTestTokens` is an internal errand — it hands out
 * mock assets on a testnet faucet so the protocol can be exercised — and it is
 * not a product alongside Trade, Borrow and Liquidity. The same reasoning put
 * /faucet behind the wallet menu instead of in the nav.
 *
 * The consequence is that EXECUTE_COUNT understates the agent by one, which is
 * the safe direction for a number on a landing page: the tabs below name
 * everything they claim to, and the agent does one thing more.
 *
 * capabilities.test.ts subtracts this from both directions of its coverage check
 * AND asserts every name in it is still an execute tool in the catalog, so a tool
 * that is renamed or removed fails the gate rather than lingering here.
 */
export const INTERNAL_TOOLS: readonly string[] = ["claimTestTokens"];

/** 23. Derived, so the heading's number cannot drift from the data. */
export const EXECUTE_COUNT = GROUPS.reduce((n, g) => n + g.tools.length, 0);

/**
 * All 29 names in one flat list.
 *
 * Order is the groups' order rather than alphabetical, so it reads as the same
 * inventory the card grid walks through. `ToolRibbon` is its only reader and is
 * currently off the page; see the note at the top of this file.
 */
export const ALL_TOOLS: readonly string[] = ALL_GROUPS.flatMap((g) =>
  g.tools.map((t) => t.name),
);
