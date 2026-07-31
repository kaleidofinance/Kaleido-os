import type { ToolSpec } from "./types";

/**
 * Luca's tool catalog — provider-neutral.
 *
 * EXECUTE tools become signable plan intents; their `name` is the intent
 * `kind`, so anything Luca proposes flows straight through fromChat →
 * PlanReview → resolver without a translation step. Keep these in lockstep
 * with src/lib/v2/intents: a tool here needs a resolver there to be signable.
 *
 * READ tools are how Luca reasons with real numbers instead of guessing —
 * quotes, positions, prices, and cross-protocol/-chain opportunities. They're
 * executed server-side in the agent loop and fed back to the model.
 *
 * Cross-protocol and multichain are first-class here: Luca can *plan* across
 * venues and chains (read + reason), and *execute* wherever a resolver exists.
 * As bridge/aggregator resolvers land, they become new EXECUTE entries — the
 * model surface grows without any provider or frontend change.
 */

const addr = { type: "string", description: "0x token address" } as const;
const amount = { type: "string", description: "Human amount, e.g. \"500\"" } as const;

export const TOOL_CATALOG: ToolSpec[] = [
  // ---- EXECUTE: mirror the intent registry ----------------------------
  {
    name: "swap",
    kind: "execute",
    description:
      "Swap one token for another on Kaleido's DEX. Use when the user wants to exchange tokens.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        tokenIn: addr,
        tokenOut: addr,
        amountIn: amount,
        symbolIn: { type: "string" },
        symbolOut: { type: "string" },
      },
      required: ["tokenIn", "tokenOut", "amountIn", "symbolIn", "symbolOut"],
    },
  },
  {
    name: "approve",
    kind: "execute",
    description:
      "Approve a contract to move an ERC-20 on the user's behalf. Precede any execute step that spends a token the contract can't yet move.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        token: addr,
        spender: addr,
        amount: amount,
        decimals: { type: "number" },
        symbol: { type: "string" },
      },
      required: ["token", "spender", "amount", "decimals", "symbol"],
    },
  },
  {
    name: "stake",
    kind: "execute",
    description: "Stake KLD into the vault to receive liquid stKLD.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        vault: addr,
        token: addr,
        stToken: addr,
        amount: amount,
        symbol: { type: "string" },
      },
      required: ["vault", "token", "stToken", "amount", "symbol"],
    },
  },
  {
    name: "grantAgentPermission",
    kind: "execute",
    description:
      "Grant a bounded, revocable on-chain permission so an agent can act within the user's limits. Only when the user explicitly asks to delegate.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        diamond: addr,
        agent: addr,
        maxNotionalPerAction: amount,
        maxNotionalPerEpoch: amount,
        epochDurationSec: { type: "number" },
        expiryUnix: { type: "number" },
        maxInterestBps: { type: "number" },
        minHealthFactorBps: { type: "number" },
        allowedActions: { type: "number", description: "Bitmask of allowed actions" },
        tokens: { type: "array", items: addr },
      },
      required: [
        "diamond",
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
        returnDate: { type: "number", description: "Unix timestamp of maturity" },
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
      "Open borrow/lend offers and pool rates on Kaleido, and comparable rates on external protocols where indexed, for a given asset. Use to find the best venue across protocols.",
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
];

/** Just the tool names whose calls become plan intents. */
export const EXECUTE_TOOLS = new Set(
  TOOL_CATALOG.filter((t) => t.kind === "execute").map((t) => t.name),
);
