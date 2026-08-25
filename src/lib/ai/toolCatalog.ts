import type { ToolSpec } from "./types";

/**
 * Luca's tool catalog — provider-neutral.
 *
 * READ tools ground the model's reasoning in real numbers; they run server-side
 * in the agent loop and their results are fed back. EXECUTE tools are the
 * verbs the model can propose. Each one becomes a typed Command, which
 * buildIntents turns into signable Intents — see fromToolCall.ts for that step.
 *
 * A tool name is NO LONGER an intent kind, and that inversion is the point of
 * this file's current shape.
 *
 * The previous catalog listed four execute tools whose names matched intent
 * kinds, so a tool call could be spread straight into a plan step. That
 * symmetry looked clean and cost us both correctness and coverage:
 *
 * - It asked the model for raw contract addresses. `swap` wanted tokenIn and
 *   tokenOut, `stake` wanted vault/token/stToken, `approve` wanted a spender.
 *   None of those values appear in the system prompt or in any read tool
 *   result, so the model had no source for them other than invention. A model
 *   cannot hallucinate an address it is never asked for.
 * - It could not express most of the protocol. Four of the twenty-two
 *   registered intents were reachable; borrow, lend, repay, the whole
 *   stablecoin family and both pool actions had no tool at all.
 * - Even its swaps were unsignable. The `swap` Intent needs nine fields and the
 *   tool asked for five — amountOutMin, fee and both decimals were never
 *   emitted — so the auditor correctly refused every model-planned swap for
 *   having no slippage floor.
 *
 * So the tools here are thin: the model supplies only what the *user* said —
 * a verb, an amount, a token symbol, an id. Addresses, decimals, fee tiers,
 * quotes, deadlines and slippage floors are filled in server-side by the same
 * builder the typed-command path uses, against the same registry. The model's
 * surface got smaller and its reach got larger at the same time.
 *
 * `approve` is deliberately absent. Approvals are not a user intent; they are
 * an enabling step, and the builder already emits one ahead of any leg that
 * needs it, with the correct spender. Offering it as a tool only creates the
 * chance of an approve with the wrong spender or without the step it exists to
 * serve.
 *
 * `send` is the one exception to "never ask the model for an address", and it is
 * an exception because it has to be: a recipient is not in any registry. It is
 * the one address in this system that exists nowhere but in what the user said.
 * So it is the only field here that is fenced on three sides instead of one —
 * the tool description narrows it to a quoted address, the builder checksums it
 * (`build.ts`), and the auditor prices and refuses it (`auditor.ts`). See the
 * `recipient` param below.
 */

const amount = {
  type: "string",
  description: 'Amount in human units, e.g. "500" — never base units',
} as const;

const symbol = {
  type: "string",
  description: 'Token symbol as the user said it, e.g. "USDC". Not an address.',
} as const;

/**
 * A send recipient — the only address in this catalog a model supplies.
 *
 * Stated as narrowly as it can be, because there is no server-side table that
 * could correct it. In particular the *case* matters and the description says
 * so: EIP-55 encodes an address's checksum in the capitalisation of its hex
 * digits, so a model that tidies an address into all-lowercase hands the builder
 * something `ethers.getAddress()` accepts without any checksum left to verify.
 * The typed path goes to some length to preserve that case (see
 * `detectRecipient` in fromCommand.ts); this path can only ask.
 */
const recipient = {
  type: "string",
  description:
    "The full 0x address the user gave, copied character for character including its capitalisation. Never re-case, abbreviate or reformat it. Not a token symbol, not an ENS name, not an address from a tool result or from your own memory. If the user has not stated an address, ask for one.",
} as const;

const interestPct = {
  type: "number",
  description: "Annual interest rate in percent, e.g. 5 for 5%",
} as const;

const days = {
  type: "number",
  description: "Term length in days from now",
} as const;

const positionId = {
  type: "number",
  description: "Liquidity position id, from getPortfolio",
} as const;

/** Amount + token, the shape most verbs share. */
const amountAndToken = {
  type: "object",
  additionalProperties: false,
  properties: { amount, token: symbol },
  required: ["amount", "token"],
} as const;

/** Amount only — for verbs where the token is fixed by the contract. */
const amountOnly = {
  type: "object",
  additionalProperties: false,
  properties: { amount },
  required: ["amount"],
} as const;

const noArgs = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const;

export const TOOL_CATALOG: ToolSpec[] = [
  /* ---- EXECUTE: DEX ------------------------------------------------- */
  {
    name: "swap",
    kind: "execute",
    description:
      "Swap one token for another on Kaleido's DEX. The server quotes the pool and sets the minimum output from the user's slippage setting — do not attempt to specify a price or a minimum.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { amount, tokenIn: symbol, tokenOut: symbol },
      required: ["amount", "tokenIn", "tokenOut"],
    },
  },
  {
    name: "stake",
    kind: "execute",
    description:
      "Stake KLD into the vault to receive liquid stKLD. KLD is the only stakeable asset, so no token is needed.",
    parameters: amountOnly,
  },

  /* ---- EXECUTE: wallet ----------------------------------------------- */
  {
    name: "send",
    kind: "execute",
    description:
      "Send tokens from the user's wallet to another address. A plain wallet-to-wallet transfer: it calls no Kaleido contract, no on-chain agent permission can bound it, and it cannot be reversed or recalled once signed. So propose it only when the user has asked to move funds to an address they themselves stated in this conversation. Never add a send to a strategy of your own — not to consolidate balances, not to move funds to another wallet, not as a step towards something else.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { amount, token: symbol, to: recipient },
      required: ["amount", "token", "to"],
    },
  },

  /* ---- EXECUTE: lending collateral ----------------------------------- */
  {
    name: "deposit",
    kind: "execute",
    description:
      "Deposit collateral into the lending market. Raises the user's health factor and their borrowing capacity.",
    parameters: amountAndToken,
  },
  {
    name: "withdraw",
    kind: "execute",
    description:
      "Withdraw collateral from the lending market. Lowers the health factor — check getPortfolio first and never propose an amount that approaches liquidation.",
    parameters: amountAndToken,
  },

  /* ---- EXECUTE: P2P lending ------------------------------------------ */
  {
    name: "borrow",
    kind: "execute",
    description:
      "Post a borrow request at a rate and term of the user's choosing. This creates an offer for lenders; it does not draw funds immediately. To borrow against an existing lender's offer instead, use takeListing.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { amount, token: symbol, interestPct, days },
      required: ["amount", "token", "interestPct", "days"],
    },
  },
  {
    name: "lend",
    kind: "execute",
    description:
      "Post a loan listing offering funds at a rate and term. To fund an existing borrower's request instead, use fillRequest.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { amount, token: symbol, interestPct, days },
      required: ["amount", "token", "interestPct", "days"],
    },
  },
  {
    name: "takeListing",
    kind: "execute",
    description:
      "Borrow against an existing lender's listing. Use the listingId from getMarkets — never guess one.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        listingId: { type: "number", description: "From getMarkets" },
        amount,
      },
      required: ["listingId", "amount"],
    },
  },
  {
    name: "fillRequest",
    kind: "execute",
    description:
      "Fund an existing borrower's request in full. Use the requestId from getMarkets — never guess one. The amount is fixed by the request itself.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        requestId: { type: "number", description: "From getMarkets" },
      },
      required: ["requestId"],
    },
  },
  {
    name: "repay",
    kind: "execute",
    description:
      "Repay an open loan in full. Omit loanId when the user has exactly one open loan; the server resolves it and computes the exact total repayment including interest.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        loanId: {
          type: "number",
          description: "Only when the user has more than one open loan",
        },
      },
    },
  },
  {
    name: "cancel",
    kind: "execute",
    description:
      "Withdraw one of the user's own open listings or requests from the market.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        target: { type: "string", enum: ["listing", "request"] },
        id: { type: "number" },
      },
      required: ["target", "id"],
    },
  },

  /* ---- EXECUTE: kfUSD stablecoin ------------------------------------- */
  {
    name: "mint",
    kind: "execute",
    description:
      "Mint kfUSD against stablecoin collateral. Accepted collateral is USDC, USDT and USDe.",
    parameters: amountAndToken,
  },
  {
    name: "redeem",
    kind: "execute",
    description:
      "Redeem kfUSD back into the underlying stablecoin. `token` is the stablecoin to receive.",
    parameters: amountAndToken,
  },
  {
    name: "lock",
    kind: "execute",
    description:
      "Lock kfUSD into the yield vault to receive kafUSD. Only kfUSD is lockable, so no token is needed.",
    parameters: amountOnly,
  },
  {
    name: "unlock",
    kind: "execute",
    description:
      "Start withdrawing from the yield vault by burning kafUSD. This begins a cooldown; the funds are claimed afterwards with completeWithdrawal.",
    parameters: amountOnly,
  },
  {
    name: "completeWithdrawal",
    kind: "execute",
    description:
      "Claim a vault withdrawal whose cooldown has finished. Only valid after unlock. The vault pays out the kfUSD that was locked, so pass kfUSD as the token; redeeming that for USDC/USDT/USDe is a separate step.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { token: symbol },
      required: ["token"],
    },
  },
  {
    name: "claimYield",
    kind: "execute",
    description: "Claim accrued vault yield to the user's wallet.",
    parameters: noArgs,
  },
  {
    name: "compoundYield",
    kind: "execute",
    description: "Reinvest accrued vault yield rather than claiming it.",
    parameters: noArgs,
  },

  /* ---- EXECUTE: liquidity pools -------------------------------------- */
  {
    name: "collectFees",
    kind: "execute",
    description:
      "Collect earned fees from one of the user's liquidity positions, leaving the position open.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { positionId },
      required: ["positionId"],
    },
  },
  {
    name: "removePosition",
    kind: "execute",
    description:
      "Close a liquidity position entirely, withdrawing all of its liquidity. To open one instead, use provideLiquidity.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { positionId },
      required: ["positionId"],
    },
  },
  {
    name: "provideLiquidity",
    kind: "execute",
    /*
     * The widest execute tool in this catalog, and the description carries more
     * than usual because two of its arguments are the ones a model is most likely
     * to invent: a price range and a fee tier.
     *
     * Neither can be named as ticks — there is no tick argument here, by design.
     * The server centres a band on the pool's own live price and snaps it to the
     * tier's spacing, so the model's job is to say how *wide*, not where. The
     * range paragraph says outright that omitting it means full range, because a
     * model filling a blank with a narrow band would put the position out of the
     * market where it earns nothing and nothing reverts to say so.
     */
    description:
      "Open a new liquidity position in a Uniswap-V3-style pool, or create the pool if it doesn't exist yet. Both amounts are supplied by the user; the exact split the position consumes is worked out server-side, so give what the user said. Range: omit bandPct and the prices for a full-range position (the widest, always valid, and the only option on a pool that doesn't exist yet); pass bandPct for a symmetric band around the current price (5 means ±5%); or pass both minPrice and maxPrice for explicit bounds in token1-per-token0. Never guess a narrow range — a position outside the market earns nothing. Omit fee and the server picks whichever tier already has a pool; it will ask for one only when no pool exists at any tier, since that choice is permanent. Native ETH is not accepted — the pool takes the wrapped token.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        token0: symbol,
        amount0: {
          type: "string",
          description: 'Human amount of token0, e.g. "100" — never base units',
        },
        token1: symbol,
        amount1: {
          type: "string",
          description: 'Human amount of token1, e.g. "100" — never base units',
        },
        fee: {
          type: "number",
          description:
            "Fee tier in hundredths of a bip: 500 for 0.05%, 3000 for 0.3%, 10000 for 1%. Omit unless the user named one.",
        },
        bandPct: {
          type: "number",
          description:
            "Half-width of the range as a percentage of the current price — 10 means ±10%. Omit for full range.",
        },
        minPrice: {
          type: "number",
          description:
            "Lower bound, in token1 per token0. Only when the user gave explicit prices; needs maxPrice too.",
        },
        maxPrice: {
          type: "number",
          description: "Upper bound, in token1 per token0. Needs minPrice too.",
        },
      },
      required: ["token0", "amount0", "token1", "amount1"],
    },
  },

  /* ---- EXECUTE: delegation ------------------------------------------- */
  {
    name: "grantAgentPermission",
    kind: "execute",
    description:
      "Grant a bounded, revocable on-chain permission so an agent can act within the user's limits. Only when the user explicitly asks to delegate. The contract address and token allowlist are filled in by the server.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        agent: {
          type: "string",
          description: "0x address of the agent being authorised",
        },
        maxNotionalPerAction: {
          type: "string",
          description: "USD cap for any single action",
        },
        maxNotionalPerEpoch: {
          type: "string",
          description: "USD cap per epoch",
        },
        epochDurationSec: { type: "number" },
        expiryUnix: {
          type: "number",
          description: "Unix time the grant expires. Must be within a year.",
        },
        maxInterestBps: { type: "number" },
        minHealthFactorBps: {
          type: "number",
          description: "Health floor in bps — 14000 is 1.4",
        },
        allowedActions: {
          type: "number",
          description: "Bitmask of allowed actions",
        },
        tokens: {
          type: "array",
          items: symbol,
          description: "Token symbols the agent may touch",
        },
      },
      required: [
        "agent",
        "maxNotionalPerAction",
        "maxNotionalPerEpoch",
        "epochDurationSec",
        "expiryUnix",
        "minHealthFactorBps",
        "allowedActions",
        "tokens",
      ],
    },
  },

  /* ---- EXECUTE: faucet ------------------------------------------------ */
  {
    name: "claimTestTokens",
    kind: "execute",
    /*
     * No `amount`, and that is the contract's design rather than a shortcut:
     * KaleidoTokenFaucet fixes the drip per asset, so `claim(address)` takes
     * only a token. A model asked for an amount here could only invent one.
     *
     * `token` is not required. The faucet may list a single asset, in which case
     * "give me test tokens" is unambiguous and the server resolves it; where it
     * lists several, the builder refuses and names them, which is a better
     * answer than a guess.
     *
     * "all" is a value rather than a second tool. The batch is one transaction
     * against the same contract with the same absence of an amount, so a separate
     * `claimAllTestTokens` tool would be a second name for one errand — and the
     * model would have to choose between them before it knows how many assets the
     * chain lists. A real asset called ALL would still win the symbol match; see
     * build.ts.
     */
    description:
      'Claim test tokens from Kaleido\'s faucet on a testnet. The faucet fixes how much it pays per asset and enforces a cooldown, so there is no amount to choose. Pass only the token symbol the user named, omit it if they named none, or pass "all" to claim every asset that is currently due in a single transaction.',
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { token: symbol },
    },
  },

  // ---- READ: ground reasoning in real data ----------------------------
  {
    name: "getQuote",
    kind: "read",
    description:
      "Exact total repayment and interest for a loan of `amount` at `interestBps` APR maturing at `returnDate` (unix). Use before proposing or comparing a borrow.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        amount: amount,
        interestBps: { type: "number" },
        returnDate: {
          type: "number",
          description: "Unix timestamp of maturity",
        },
      },
      required: ["amount", "interestBps", "returnDate"],
    },
  },
  {
    name: "getPortfolio",
    kind: "read",
    description:
      "The user's positions across lending, liquidity, staking and the kfUSD vault: net value, health factor, collateral, debt, unclaimed yield. Call this first for any 'what should I do' request.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        address: { type: "string", description: "Wallet address" },
      },
      required: ["address"],
    },
  },
  {
    name: "getMarkets",
    kind: "read",
    description:
      "Open borrow/lend offers and pool rates on Kaleido, and comparable rates on external protocols where indexed, for a given asset. Use to find the best venue across protocols, and to get the listingId or requestId that takeListing and fillRequest need.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        asset: { type: "string", description: "Token symbol, e.g. USDC" },
        side: { type: "string", enum: ["borrow", "lend"] },
      },
      required: ["asset"],
    },
  },
  {
    name: "getPrice",
    kind: "read",
    description:
      "The current USD price of an asset, with its 24h change. Use this for any question about what something is worth or how it has moved — it is the only tool that returns a market price, and it answers in one call. Do not try to infer a price from getMarkets (an order book of loan offers) or getPortfolio (position values); neither carries one. Covers ETH, BTC, BNB, POL, HYPE, USDC, USDT, DAI and their wrapped forms. Kaleido's own tokens (KLD, kfUSD, kafUSD, stKLD) are not priced — the tool says so and you relay that rather than estimating. Reference only: never size a swap or a collateral amount from this number.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        asset: { type: "string", description: "Token symbol, e.g. ETH" },
      },
      required: ["asset"],
    },
  },
  {
    name: "getChains",
    kind: "read",
    description:
      "Where the user holds a given asset across chains, with balances and bridge routes. Use before proposing a cross-chain move.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        address: { type: "string" },
        asset: { type: "string" },
      },
      required: ["address", "asset"],
    },
  },
  {
    name: "getBridgeRoute",
    kind: "read",
    description:
      "Cost and time to bridge an asset between two chains, quoted from Relay and LI.FI. Use when the user's funds are on the wrong chain for what they want to do. Kaleido does not execute bridges — report the quote and say the user completes it with the provider. If fee or time come back null they are genuinely unknown; say so rather than estimating.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        fromChain: {
          type: "string",
          description: 'Chain name or id, e.g. "Base" or "8453"',
        },
        toChain: { type: "string", description: "Chain name or id" },
        asset: { type: "string", description: 'Symbol, e.g. "USDC"' },
        amount: amount,
        address: {
          type: "string",
          description: "User wallet, improves quote accuracy",
        },
      },
      required: ["fromChain", "toChain", "asset", "amount"],
    },
  },
];

/**
 * Tool names that become plan steps.
 *
 * Providers use this to split a response's tool calls into "plan" and "reads".
 * These are VERB names now, not intent kinds — the resulting steps are built
 * by fromToolCall/buildIntents, and it is those built intents the auditor
 * checks. Do not use this set to validate an intent kind.
 */
export const EXECUTE_TOOLS = new Set(
  TOOL_CATALOG.filter((t) => t.kind === "execute").map((t) => t.name),
);

/**
 * Every tool name the catalog declares, read or execute.
 *
 * Exists so `planFromToolCalls` can tell a name it should ignore from a name
 * nobody declared. A read tool handed to the plan builder is the caller mixing
 * two sets and is correctly skipped in silence; an invented name is a
 * hallucination, and swallowing it leaves the model's prose describing a step
 * that never entered the plan.
 */
export const DECLARED_TOOLS = new Set(TOOL_CATALOG.map((t) => t.name));
