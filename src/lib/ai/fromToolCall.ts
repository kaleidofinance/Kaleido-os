import { ethers } from "ethers";
import { getChainMeta } from "@/constants/chains";
import { envVars } from "@/constants/envVars";
import { toIToken } from "@/constants/tokens";
import {
  findBorrowCurrency,
  getContracts,
  resolveUserToken,
} from "@/constants/registry";
import type { IToken } from "@/constants/types/dex";
import type { RangeChoice } from "@/lib/dex/liquidity";
import {
  buildIntents,
  type PlanDeps,
  type PlannerOptions,
} from "@/lib/v2/intents/build";
import type { Command } from "@/lib/v2/intents/fromCommand";
import type { Intent } from "@/lib/v2/intents";
import { DECLARED_TOOLS, EXECUTE_TOOLS } from "./toolCatalog";
import type { PlanStep } from "./types";

/**
 * Turns the model's execute-tool calls into signable intents.
 *
 * This module is the seam that lets the tool catalog be thin. A tool call names
 * a verb and carries what the user actually said — an amount, a symbol, an id.
 * Everything else an Intent needs (contract addresses, decimals, fee tiers,
 * quotes, deadlines, slippage floors) is filled in here and in buildIntents,
 * from the registry and from chain reads, rather than being asked of a model
 * that has never been shown any of it.
 *
 * The builder it calls is the same one the typed-command path calls. That is
 * the whole design: "swap 500 USDC to KLD" typed into the box and the same
 * request reasoned into a swap tool call converge on one code path, so a
 * pricing or slippage fix lands once. A second server-side implementation of
 * trading logic would have been the exact drift useLocalPlanner's own header
 * warns about.
 *
 * One rule runs through every branch: this module never invents an address. It
 * either resolves one from the registry or passes the symbol through for the
 * builder to refuse by name. A refusal the user can read ("KLD isn't accepted
 * by the lending market") is worth more than a plan built on a plausible
 * guess.
 */

/** A verb the model asked for, plus its arguments. */
export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface BuiltPlan {
  /** Signable steps, in the order the model proposed them. */
  plan: PlanStep[];
  /**
   * Verbs that could not be built, as sentences. These are shown to the user
   * rather than swallowed: "I couldn't get a price for that pair" is an answer,
   * and a silently shorter plan is not.
   */
  errors: string[];
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const numOf = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseFloat(str(v));
  return Number.isFinite(n) ? n : null;
};

/**
 * An amount as a decimal string, or null.
 *
 * Accepts a number because models emit `500` as often as `"500"`, but converts
 * through String rather than trusting the JSON type — the Intent shape is a
 * string all the way to parseUnits.
 */
function amountOf(v: unknown): string | null {
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  const s = str(v).trim();
  if (!s) return null;
  return /^\d*\.?\d+$/.test(s) ? s : null;
}

/**
 * The DEX-side token for a symbol on this chain.
 *
 * Swap and send are the two verbs whose token address and decimals are used as
 * given — every lending and stablecoin branch in the builder re-resolves by
 * symbol against its own table, and a send has no protocol table to re-resolve
 * against at all. So this lookup has to succeed for both, and returning
 * undefined here is what stops an unknown ticker from reaching the quoter as a
 * malformed address.
 */
function dexToken(
  chainId: number | undefined,
  symbol: string,
): IToken | undefined {
  if (!symbol) return undefined;
  const entry = resolveUserToken(getChainMeta(chainId), symbol, "dex");
  return entry ? toIToken(entry) : undefined;
}

/**
 * A token to hand the builder for a lending or stablecoin verb.
 *
 * Resolved against the chain's borrow-currency list when possible, so the
 * address and decimals are real. When the symbol isn't in that table the symbol
 * is carried through on its own: the builder re-resolves every one of these
 * branches by symbol and answers with a specific refusal naming what it does
 * accept, which is a better message than anything this function could produce.
 * The empty address is never transacted with — it exists only to satisfy the
 * IToken shape on a path that discards it.
 */
function symbolToken(chainId: number | undefined, symbol: string): IToken {
  const cur = findBorrowCurrency(chainId, symbol);
  return {
    address: cur?.address ?? "",
    name: symbol,
    symbol: cur?.symbol ?? symbol,
    decimals: cur?.decimals ?? 18,
    verified: Boolean(cur),
  };
}

/**
 * Maps one tool call to a typed Command.
 *
 * Returns a string when the call can't be expressed — a missing amount, an
 * unknown swap token, an id that isn't a number. Those are the model's
 * mistakes to hear about, not exceptions.
 */
function toCommand(
  call: ToolCall,
  chainId: number | undefined,
): Command | string {
  const a = call.args ?? {};

  switch (call.name) {
    case "swap": {
      const amount = amountOf(a.amount);
      if (!amount) return "swap: no amount given";
      const inSym = str(a.tokenIn);
      const outSym = str(a.tokenOut);
      const tokenIn = dexToken(chainId, inSym);
      const tokenOut = dexToken(chainId, outSym);
      if (!tokenIn)
        return `swap: I don't know a token called ${inSym || "(none)"} on this chain`;
      if (!tokenOut)
        return `swap: I don't know a token called ${outSym || "(none)"} on this chain`;
      return { kind: "swap", amount, tokenIn, tokenOut };
    }

    case "stake": {
      const amount = amountOf(a.amount);
      if (!amount) return "stake: no amount given";
      return { kind: "stake", amount };
    }

    case "send": {
      const amount = amountOf(a.amount);
      if (!amount) return "send: no amount given";
      const sym = str(a.token);
      /*
       * dexToken, not symbolToken. A send's token is used exactly as returned —
       * the builder has no protocol table to re-resolve it against, because
       * there is no protocol in the call — so symbolToken's `decimals ?? 18`
       * fallback would be deciding how much money leaves the wallet, and its
       * empty-string `address` would be handed to ethers.Contract as the token
       * to call. An unknown symbol has to fail by name here instead.
       */
      const token = dexToken(chainId, sym);
      if (!token)
        return `send: I don't know a token called ${sym || "(none)"} on this chain`;
      /*
       * Trimmed, and nothing else. No lowercasing, no getAddress: EIP-55 lives
       * in the case of the hex digits and build.ts's getAddress is the only
       * checksum test on this path, so re-casing here would disarm it. Only
       * surrounding whitespace is dropped, which is not part of an address.
       */
      const to = str(a.to).trim();
      if (!to) return "send: no recipient address given";
      return { kind: "send", amount, token, to };
    }

    case "bridge": {
      const amount = amountOf(a.amount);
      if (!amount) return "bridge: no amount given";
      const sym = str(a.asset || a.token);
      /*
       * dexToken, not symbolToken — the same reasoning as send. A bridge's asset
       * is used exactly as returned (native currency only in the MVP, enforced
       * in the builder), so symbolToken's `decimals ?? 18` fallback would be
       * deciding how much leaves the wallet, and its empty-string address would
       * reach the native-sentinel test as a non-match. An unknown symbol fails
       * by name here.
       */
      const token = dexToken(chainId, sym);
      if (!token)
        return `bridge: I don't know a token called ${sym || "(none)"} on this chain`;
      /*
       * The destination travels as text, exactly as it does from the typed path:
       * the builder's resolver matches it against the real chain registry, so a
       * chain this deployment doesn't know is refused there by name rather than
       * guessed at here.
       */
      const toChain = str(a.toChain || a.destinationChain).trim();
      if (!toChain) return "bridge: no destination chain given";
      return { kind: "bridge", amount, token, toChain };
    }

    case "deposit":
    case "withdraw":
    case "mint":
    case "redeem": {
      const amount = amountOf(a.amount);
      if (!amount) return `${call.name}: no amount given`;
      const token = str(a.token);
      if (!token) return `${call.name}: no token given`;
      return { kind: call.name, amount, token: symbolToken(chainId, token) };
    }

    case "borrow":
    case "lend": {
      const amount = amountOf(a.amount);
      if (!amount) return `${call.name}: no amount given`;
      const token = str(a.token);
      if (!token) return `${call.name}: no token given`;
      const interestPct = numOf(a.interestPct);
      const days = numOf(a.days);
      if (interestPct === null) return `${call.name}: no interest rate given`;
      if (days === null || days <= 0) return `${call.name}: no term given`;
      return {
        kind: call.name,
        amount,
        token: symbolToken(chainId, token),
        interestPct,
        days,
      };
    }

    case "takeListing": {
      const listingId = numOf(a.listingId);
      const amount = amountOf(a.amount);
      if (listingId === null) return "takeListing: no listing id";
      if (!amount) return "takeListing: no amount given";
      return { kind: "takeListing", listingId, amount };
    }

    case "fillRequest": {
      const requestId = numOf(a.requestId);
      if (requestId === null) return "fillRequest: no request id";
      return { kind: "fillRequest", requestId };
    }

    case "repay": {
      /* loanId is optional by design: with exactly one open loan the builder
         resolves it from a chain read, which is more reliable than a model
         recalling an id from an earlier tool result. */
      const loanId = numOf(a.loanId);
      return loanId === null ? { kind: "repay" } : { kind: "repay", loanId };
    }

    case "cancel": {
      const target = str(a.target);
      const id = numOf(a.id);
      if (target !== "listing" && target !== "request")
        return "cancel: target must be a listing or a request";
      if (id === null) return "cancel: no id given";
      return { kind: "cancel", target, id };
    }

    case "lock":
    case "unlock": {
      const amount = amountOf(a.amount);
      if (!amount) return `${call.name}: no amount given`;
      return { kind: call.name, amount };
    }

    case "completeWithdrawal": {
      const token = str(a.token);
      if (!token) return "completeWithdrawal: no payout token given";
      return { kind: "completeWithdrawal", token: symbolToken(chainId, token) };
    }

    case "claimYield":
      return { kind: "claimYield" };
    case "compoundYield":
      return { kind: "compoundYield" };

    case "collectFees":
    case "removePosition": {
      const positionId = numOf(a.positionId);
      if (positionId === null) return `${call.name}: no position id`;
      return { kind: call.name, positionId };
    }

    case "provideLiquidity": {
      /*
       * The only case here that builds a compound argument rather than passing
       * values through, and every part of that is deliberate.
       *
       * `dexToken`, not `symbolToken`: both addresses and both decimal scales are
       * used exactly as returned — they go into the approves, the tick maths and
       * the slippage floors — so symbolToken's `decimals ?? 18` fallback would be
       * setting how much money leaves the wallet, and its empty-string address
       * would be handed to ethers as a token to approve. Same reasoning as `send`.
       */
      const amount0 = amountOf(a.amount0);
      const amount1 = amountOf(a.amount1);
      const sym0 = str(a.token0);
      const sym1 = str(a.token1);
      const token0 = dexToken(chainId, sym0);
      const token1 = dexToken(chainId, sym1);
      if (!token0)
        return `provideLiquidity: I don't know a token called ${sym0 || "(none)"} on this chain`;
      if (!token1)
        return `provideLiquidity: I don't know a token called ${sym1 || "(none)"} on this chain`;
      if (!amount0)
        return `provideLiquidity: no amount given for ${token0.symbol}`;
      if (!amount1)
        return `provideLiquidity: no amount given for ${token1.symbol}`;

      /*
       * The range. A model may name a band or two prices; it may not name ticks,
       * and there is no argument here through which it could. "full" is the
       * default because it is the only choice that is always valid — it needs no
       * price, so it works on a pool that does not exist yet — and because a
       * missing range must not silently become a narrow one.
       *
       * `bandPct` arrives as a percentage, the unit the /pool page's own presets
       * are labelled in (±5%, ±10%), and is converted to the fraction
       * `RangeChoice` carries. Zero and negative are dropped here rather than
       * passed on: ticksForRange refuses them, but its message is about a band the
       * caller did not ask for.
       */
      const bandPct = numOf(a.bandPct);
      const minPrice = numOf(a.minPrice);
      const maxPrice = numOf(a.maxPrice);
      let range: RangeChoice;
      if (minPrice !== null && maxPrice !== null) {
        range = { kind: "prices", minPrice, maxPrice };
      } else if (minPrice !== null || maxPrice !== null) {
        return "provideLiquidity: a price range needs both a minimum and a maximum";
      } else if (bandPct !== null && bandPct > 0) {
        range = { kind: "band", pct: bandPct / 100 };
      } else {
        range = { kind: "full" };
      }

      /* Absent is a valid answer, not a mistake to report: the builder reads all
         three tiers and picks the one with a pool, and asks for a tier only when
         there is no pool at all — where the choice is permanent and genuinely the
         user's. A tier this DEX does not have is left for the builder to refuse by
         name, against `isTradedTier` rather than against a tick spacing — the
         0.01% tier has a spacing in the Uniswap library and no pool on this
         factory. */
      const feeBps = numOf(a.fee);
      return {
        kind: "provideLiquidity",
        amount0,
        token0,
        amount1,
        token1,
        ...(feeBps === null ? {} : { fee: feeBps }),
        range,
      };
    }

    case "claimTestTokens": {
      /*
       * The one token-carrying case that does not go through symbolToken.
       *
       * That helper resolves against the chain's borrow-currency list, and the
       * faucet's assets are not in it: the mock USDT and USDe are in no chain's
       * table and the mock USDC is missing from two of the five. Resolving here
       * would hand the builder `{address: "", decimals: 18}` for exactly the
       * assets the faucet exists to hand out, and 18 decimals for a 6-decimal
       * mock is the kind of default that prints a wrong number. So the symbol
       * travels as text and buildIntents matches it against the faucet's own
       * asset list, which is the only thing that knows.
       *
       * Absent is a valid answer, not a mistake to report: the builder resolves
       * it when the faucet lists one asset and names them when it lists more.
       */
      const token = str(a.token).trim();
      return token
        ? { kind: "claimTestTokens", symbol: token }
        : { kind: "claimTestTokens" };
    }

    default:
      return `${call.name} isn't something I can do`;
  }
}

/**
 * Delegation, built directly rather than through a Command.
 *
 * It is the one execute tool with no counterpart in the typed grammar — you
 * cannot type a permission grant into the command box — so there is no shared
 * builder branch to route through. The diamond address comes from the server's
 * own config and never from the model: an agent grant points at whatever
 * contract it names, and that is the last field in this system worth letting a
 * model choose.
 *
 * Token symbols are resolved to addresses, and unknown ones are dropped rather
 * than passed through as text. An allowlist entry that isn't an address is not
 * a restriction the contract can enforce.
 *
 * The diamond is resolved per chain from the registry, with the env var as a
 * fallback for a chain DEPLOYMENTS does not carry. Getting this wrong here is the
 * worst version of the mistake in this file: a grant names the contract that will
 * hold a standing, bounded authority over the user's funds, so pointing it at
 * another chain's address either grants nothing (address holds no code) or, on a
 * chain where something does live there, grants authority over a contract the
 * user never agreed to.
 */
function grantIntent(
  args: Record<string, unknown>,
  chainId: number | undefined,
): Intent | string {
  const diamond =
    getContracts(chainId).diamond ?? envVars.lendbitDiamondAddress;
  if (!diamond || !ethers.isAddress(diamond))
    return "I can't set up a delegation — no permission contract is configured on this deployment.";

  const agent = str(args.agent);
  if (!ethers.isAddress(agent))
    return "grantAgentPermission: the agent address isn't valid";

  const rawTokens = Array.isArray(args.tokens) ? args.tokens : [];
  const tokens: string[] = [];
  for (const t of rawTokens) {
    const sym = str(t);
    if (ethers.isAddress(sym)) {
      tokens.push(sym);
      continue;
    }
    const resolved = dexToken(chainId, sym) ?? findBorrowCurrency(chainId, sym);
    if (resolved?.address) tokens.push(resolved.address);
  }
  if (tokens.length === 0)
    return "grantAgentPermission: none of those tokens are ones I recognise, so the grant would have an empty allowlist";

  return {
    kind: "grantAgentPermission",
    diamond,
    agent,
    maxNotionalPerAction: str(args.maxNotionalPerAction) || "0",
    maxNotionalPerEpoch: str(args.maxNotionalPerEpoch) || "0",
    epochDurationSec: numOf(args.epochDurationSec) ?? 0,
    expiryUnix: numOf(args.expiryUnix) ?? 0,
    /* Not in the tool's required list and not audited, so a missing value is
       carried as 0 rather than guessed at. The auditor blocks the fields that
       do bound risk — expiry, health floor, per-action notional. */
    maxInterestBps: numOf(args.maxInterestBps) ?? 0,
    minHealthFactorBps: numOf(args.minHealthFactorBps) ?? 0,
    allowedActions: numOf(args.allowedActions) ?? 0,
    tokens,
  };
}

/**
 * Builds every execute call in a turn into one plan.
 *
 * Sequential rather than parallel: each verb may issue chain reads, and the
 * plan's order is the order the model proposed, which for an approve-then-swap
 * pair is load-bearing.
 *
 * A name that is in no part of the catalog is reported rather than skipped, and
 * the distinction matters more than it looks. /api/chat returns the model's prose
 * next to the plan and tells the user "I couldn't prepare some of that" from
 * `errors` — so a verb dropped in silence is prose describing a step that is not
 * in the plan the user is about to sign. It has not been reachable from that
 * route, because both provider adapters partition tool calls on `EXECUTE_TOOLS`
 * and an unrecognised name lands in `reads`, where `runReadTool` answers by name.
 * That is a property of the adapters, not of this function, and this function is
 * exported to three callers.
 *
 * A DECLARED read tool passed in here is still skipped without comment. That is
 * the caller handing over the wrong half of its own split, not a hallucination,
 * and `traces.ts` relies on it: it walks the whole catalog and lets the ones with
 * no plan fall through to their authored reply.
 */
export async function planFromToolCalls(
  calls: ToolCall[],
  chainId: number | undefined,
  deps: PlanDeps,
  opts: PlannerOptions,
): Promise<BuiltPlan> {
  const plan: PlanStep[] = [];
  const errors: string[] = [];

  for (const call of calls) {
    if (!EXECUTE_TOOLS.has(call.name)) {
      if (!DECLARED_TOOLS.has(call.name))
        errors.push(
          `${call.name} isn't something I can do. Nothing was added to the plan for it.`,
        );
      continue;
    }

    if (call.name === "grantAgentPermission") {
      const intent = grantIntent(call.args ?? {}, chainId);
      if (typeof intent === "string") errors.push(intent);
      else plan.push(intent as unknown as PlanStep);
      continue;
    }

    const command = toCommand(call, chainId);
    if (typeof command === "string") {
      errors.push(command);
      continue;
    }

    const built = await buildIntents(command, opts, deps);
    if (!built.ok) {
      /* "help" and "receive" are panel commands the builder signals through
         the same error channel. Neither is reachable from a tool call, but
         they would read as gibberish if one ever were. */
      if (built.error !== "help" && built.error !== "receive")
        errors.push(built.error);
      continue;
    }
    plan.push(...(built.build.intents as unknown as PlanStep[]));
  }

  return { plan, errors };
}
