import { ethers } from "ethers";
import { envVars } from "@/constants/envVars";
import {
  NATIVE_SENTINEL,
  declaredDecimals,
  declaredSymbol,
  findRegisteredLendingAsset,
  getContracts,
  isNativeSentinel,
  registeredLendingAssets,
  stableContracts,
  stakingContracts,
  type LendingSide,
} from "@/constants/registry";
import { symbolForAddress } from "@/constants/tokens";
import {
  FEE_TIERS,
  isTradedTier,
  mintMinimums,
  shareOfLiquidity,
  ticksForRange,
} from "@/lib/dex/liquidity";
import { tickToPrice } from "@/constants/utils/v3Math";
import type { PoolState } from "@/lib/dex/pool";
import {
  describeRoute,
  encodeV3Path,
  findBestRoute,
  intermediateTokens,
  poolSide,
} from "@/lib/dex/route";
import type { Intent } from "@/lib/v2/intents";
import type { Command, Slot } from "@/lib/v2/intents/fromCommand";
/* A value import, unlike the type above, and the only one in this file that
   costs nothing: fromCommand.ts is deliberately dependency-free. The set is
   shared rather than restated so the parser and this branch cannot disagree
   about what "everything" means. */
import { ALL_WORDS } from "@/lib/v2/intents/fromCommand";

/**
 * Turns a parsed Command into a signable plan. The only place intents are
 * shaped.
 *
 * This logic used to live inside useLocalPlanner, a "use client" hook, which
 * made it unreachable from /api/chat. The consequence was visible in the tool
 * catalog: rather than call this, the AI path asked the *model* for raw
 * contract addresses — `diamond`, `vault`, `spender`, `tokenIn` — none of which
 * are in its context. It had no option but to invent them, and the auditor
 * refused them. Four execute tools against a twenty-two-kind intent union, and
 * the four barely worked.
 *
 * So the seam moved rather than being duplicated. The rule useLocalPlanner was
 * written to enforce is the reason:
 *
 *   "the local path must not become a second implementation of trading logic.
 *   It quotes through the same getV3AmountOut the Swap page uses and emits the
 *   same [approve, swap] pair, so a pricing or slippage fix lands in one place.
 *   If this ever drifts from the manual pages, the chat becomes a liability
 *   rather than a shortcut."
 *
 * Server builders written *alongside* that hook would have been the third
 * implementation that warning is about. Instead both callers land here:
 * useLocalPlanner supplies browser-provider deps, /api/chat supplies
 * read-only-provider ones, and the intent shapes they produce are identical by
 * construction rather than by discipline.
 *
 * Chain reads arrive through `PlanDeps` instead of being performed here, which
 * keeps this module pure enough to test offline with no wallet and no network,
 * and keeps the two callers from having to know *which* reads a given command
 * needs — that decision belongs with the command handling, which is here.
 */

/**
 * Every fee tier this app will trade, in the order /pool/new lists them.
 *
 * The swap branch used to quote one hardcoded 3000 and refuse the pair when it
 * came back empty. That was measured wrong on the first chain it was tried
 * against: Sepolia's only V3 pool is USDT/USDe at 500, so the agent answered
 * "that pair may have no pool at the 0.3% fee tier" about a pool holding real
 * liquidity that it had simply not asked about — and the sentence was accurate,
 * which is what made it hard to see. The /pool page has offered all three tiers
 * the whole time.
 *
 * Kept in tier order rather than sorted by fee-as-cost, because cost is not what
 * decides this: a thin 500 pool can fill worse than a deep 3000 one, so the
 * winner is whichever tier actually quotes the most output for this exact
 * amountIn. Ordering only breaks a tie.
 *
 * Re-exported from dex/liquidity.ts rather than declared here, because the mint
 * branch below has to reject a tier the factory has no pool for and the swap
 * branch has to enumerate the same three. Two copies of this list is two chances
 * for one of them to gain a tier the DEX hasn't got.
 */

export interface PlanBuild {
  intents: Intent[];
  /** One line the chat shows above the plan, so the user sees our reading. */
  summary: string;
}

/**
 * A refusal that names the one thing that would fix it.
 *
 * Most refusals here are terminal: no staking on this chain, the faucet is out of
 * stock, you have no open loans. A few are not — they are objections to a single
 * value in an otherwise complete command, and the user's next message is almost
 * always the corrected value on its own ("use USDC").
 *
 * That reply used to reach the model. The command had parsed, so no Draft was
 * being held; "use USDC" then hit the grammar as a bare fragment with no verb, no
 * amount and no context, fell through as unknown, and cost a reasoning request to
 * answer a question the planner had just asked itself. Worse than the cost, the
 * model had none of the refusal's own knowledge — which side of the market was
 * being checked, what it accepts — so it re-derived an answer that the planner
 * might refuse again.
 *
 * `slot` is which value to re-ask about, and it is deliberately a `Slot` and not
 * a free-text hint: the caller resumes by clearing exactly that slot on the
 * reconstructed draft, so a value this union has no name for cannot be resumed
 * by accident. See `draftFromCommand` and `clearSlot` in fromCommand.ts, and the
 * `!built.ok` branch of the agent page.
 */
export interface PlanRetry {
  slot: Slot;
  /** Asked verbatim after the refusal, so the two read as one sentence. */
  prompt: string;
}

export type PlanResult =
  | { ok: true; build: PlanBuild }
  | { ok: false; error: string; retry?: PlanRetry };

export interface PlannerOptions {
  slippageBps: number;
  deadlineMin: number;
}

/**
 * The slice of a V3 position the planner needs.
 *
 * The tier and the tick pair are here because `increasePosition` cannot be
 * planned without them: adding to a position deposits at the ratio its OWN range
 * consumes at, so the slippage floor comes from `mintMinimums` over these ticks
 * and the pool this tier identifies. They cost nothing to carry — every producer
 * already reads them in the same `positions(tokenId)` call that returns the
 * liquidity, and both used to throw them away.
 *
 * They are required rather than optional on purpose. Optional would let a
 * producer omit them and have the increase branch refuse at runtime for a reason
 * that is really a wiring gap; required makes it a compile error at the one place
 * that could introduce it.
 */
export interface PoolPositionRef {
  tokenId: string;
  token0: string;
  token1: string;
  /** Raw uint128 liquidity, as the position manager stores it — not a token amount. */
  liquidity: string;
  /** The pool's tier in hundredths of a bip, e.g. 3000 for 0.3%. */
  fee: number;
  /** The position's own range, in the pool's `token0 < token1` frame. */
  tickLower: number;
  tickUpper: number;
}

/** The slice of an active loan the planner needs. */
export interface LoanRef {
  requestId: number;
  totalRepayment: string;
  totalRepaymentRaw: string;
  symbol: string;
  tokenAddress: string;
}

export interface MarketRow {
  tokenAddress: string;
  /**
   * Raw base-unit amount, as a decimal string.
   *
   * Values here run past 10^19, well beyond Number.MAX_SAFE_INTEGER, so this
   * must never be round-tripped through a JS number. Both implementations now
   * read the uint256 straight off the diamond via `readMarketRow` and stringify
   * the bigint, so nothing rounds it on the way in. It used to come from a
   * PostgREST response, where the same guarantee rested on the mirror
   * serialising a numeric column as a JSON string — true of PostgREST by
   * default, but unverifiable from here and unrecoverable if it ever changed,
   * because `res.json()` would have truncated the value before this code saw it.
   */
  amount: string;
}

export interface QuoteRequest {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  fee: number;
  decimalsIn: number;
  decimalsOut: number;
}

/**
 * A quote for a whole route, through two or more pools.
 *
 * Separate from `QuoteRequest` because the on-chain function is a different one:
 * `quoteExactInput(bytes,uint256)` walks each pool's ticks in sequence with the
 * real output of the previous hop as the next hop's input. That sequencing is why
 * this cannot be composed from two `QuoteRequest`s and multiplied — doing so
 * prices each hop as though it were the only trade in the pool, which overstates
 * the fill on exactly the thin pools where a route matters, and the number then
 * becomes `amountOutMin` on something the user signs.
 */
export interface PathQuoteRequest {
  /** Addresses in order, `fees.length + 1` of them. */
  tokens: string[];
  fees: number[];
  amountIn: string;
  /** Decimals of the first token. */
  decimalsIn: number;
  /** Decimals of the last token. */
  decimalsOut: number;
}

/**
 * A corridor to resolve into a signable bridge transaction.
 *
 * What buildIntents knows from the command: the destination, the asset, the
 * amount, and whether it is the source chain's native currency. The source
 * chain id and the user's address are injected by the deps closure — the same
 * shape the read deps follow — so this request stays free of wallet state.
 */
export interface BridgeRouteRequest {
  /** Destination as the user named it — a chain name, shortName or id. */
  toChain: string;
  /** Symbol of the asset leaving the wallet, e.g. "ETH". */
  asset: string;
  /** Human amount. */
  amount: string;
  decimals: number;
  /** True for the source chain's native currency, which needs no approve. */
  isNative: boolean;
  /**
   * The token contract this plan would approve, for the resolver's cross-check.
   *
   * Only meaningful for an ERC20 leg, and the reason it is here at all: the
   * provider resolves `asset` as a SYMBOL against its own list, which is a
   * second, independent resolution that can name a different contract than our
   * registry did (Sepolia's mintable mock USDC against Circle's, say). The
   * resolver refuses a route whose token is not the one we are about to
   * authorise, and it cannot make that comparison without this.
   */
  tokenAddress?: string;
}

/**
 * A resolved bridge, as the resolver returns it — the trusted origin of the
 * `bridge` Intent's `to`/`data`/`value`. Either a canonical portal call encoded
 * from a constant, or an aggregator's own calldata. See lib/bridge/route.ts.
 */
export interface BridgeRoute {
  to: string;
  data: string;
  /** Wei to attach, as a decimal string. "0" for an ERC20 leg. */
  value: string;
  toChainId: number;
  toChainName: string;
  /** "canonical" | "lifi" — how the auditor decides what to re-check. */
  provider: string;
  etaSeconds: number | null;
  /**
   * The router to approve, on an ERC20 leg only. Vetted by the resolver against
   * `isKnownBridgeSpender` and against `to`, so the builder can pair an approve
   * with it without re-deciding anything.
   */
  spender?: string;
  /** Set for a canonical deposit, which underruns estimateGas. */
  gasLimit?: string;
}

/**
 * One asset the faucet lists, as the faucet itself reports it.
 *
 * Deliberately not an `IToken`. The faucet's assets are not in the token
 * registry — the mock USDT and USDe are in no chain's TOKENS list, and the mock
 * USDC is missing from two of the five — so a registry lookup would refuse by
 * name exactly the assets the faucet hands out. This type is what makes the
 * faucet its own source of truth about what it lists.
 */
export interface FaucetAssetRef {
  address: string;
  symbol: string;
  decimals: number;
  /** Payout per claim, base units. Raw for the same reason LoanRef's is. */
  amountRaw: string;
  /** The faucet's own balance, base units. A drip it can't cover isn't claimable. */
  stockRaw: string;
  /** Unix second before which this caller may not claim again. 0 means now. */
  nextClaimAt: number;
}

/**
 * The chain and network reads a plan may need, injected by the caller.
 *
 * All seven are lazy. A swap must not trigger a position enumeration, and a
 * fee collection must not trigger a quote — on the server each of those is a
 * real RPC round trip. `bridgeRoute` is the one that may leave the chain's own
 * RPC for an external provider, and only for a non-canonical corridor; a
 * canonical one resolves with no call at all.
 */
export interface PlanDeps {
  chainId?: number;
  /** Expected out, in human units. Null or throw both mean "no price". */
  quote(req: QuoteRequest): Promise<string | number | null>;
  /**
   * The same, for a route through two or more pools.
   *
   * Its own dep rather than an overload of `quote`, because an implementation can
   * legitimately have one and not the other: the marketing page's snapshot deps
   * hold recorded single-pool answers and no path quotes, and answering null there
   * is the honest result — it means the direct pool wins by default, which is
   * what those fixtures describe.
   */
  quotePath(req: PathQuoteRequest): Promise<string | number | null>;
  marketRow(
    kind: "listings" | "requests",
    id: number,
  ): Promise<MarketRow | null>;
  positions(): Promise<PoolPositionRef[]>;
  loans(): Promise<LoanRef[]>;
  /**
   * What the faucet lists, including assets it has paused.
   *
   * Empty is a valid answer and the only one an implementation with no faucet
   * can give; the branch that uses it turns that into a refusal rather than
   * inventing an asset to claim.
   */
  faucetAssets(): Promise<FaucetAssetRef[]>;
  /**
   * Where a pool's market currently sits, or null when there is no pool.
   *
   * `null` is load-bearing and must never be softened to a price of zero: the
   * mint branch reads it as "this pool does not exist yet", which forbids a band
   * (there is no market to centre on) and switches the transaction to
   * initialise-then-mint. A zero would centre a ±10% band on zero.
   *
   * Decimals are passed in because the price is returned in the CALLER's token
   * order, and that order is the one every other field of the mint is in.
   */
  poolState(
    tokenA: string,
    tokenB: string,
    fee: number,
    decimalsA: number,
    decimalsB: number,
  ): Promise<PoolState | null>;
  /**
   * Resolve a cross-chain corridor to a signable source-chain transaction, or
   * an error to refuse with. The one dep that may reach an external provider
   * (for a non-canonical corridor) rather than the chain's own RPC; a canonical
   * corridor is pure and makes no call. Native currency only in the MVP — see
   * the `bridge` branch below and lib/bridge/route.ts.
   */
  bridgeRoute(
    req: BridgeRouteRequest,
  ): Promise<BridgeRoute | { error: string }>;
}

/**
 * Resolves a P2P currency address to its symbol and decimals, or refuses.
 *
 * The legacy accept hook assumed "ETH or 6 decimals" for everything, which is
 * wrong for kfUSD — not repeated here.
 *
 * chainId-scoped because the currency list is: the same USDC symbol is a
 * different address on each of the five chains, so resolving an address against
 * a flat table could only ever be right on one of them.
 *
 * IT RETURNS NULL RATHER THAN A DEFAULT, and that is the point of it. Both
 * callers feed `decimals` into `formatUnits` on a raw amount read off the market
 * row and then into the approve and the fill — so an invented 6 against an
 * 18-decimal token puts "Lend 500000000000 USDC" in front of the user as the
 * sentence they confirm. It used to end `?? getTokenDecimals(chainId, address)`,
 * whose own docstring names this function as the one caller still guessing; the
 * lookup underneath is the same `declaredDecimals` used here, so the only thing
 * that call added was the `?? 6`. A market row naming a token this registry
 * cannot describe is a gap in the registry, not something to paper over inside a
 * summary.
 *
 * Symbol and decimals are looked up independently because they can fail
 * independently, and only the decimals gate a signature — a nameless token still
 * refuses here, since it would render as a bare address in the confirmation.
 */
function describeToken(
  chainId: number | undefined,
  address: string,
): { symbol: string; decimals: number } | null {
  const symbol = declaredSymbol(chainId, address);
  const decimals = declaredDecimals(chainId, address);
  if (!symbol || decimals === undefined) return null;
  return { symbol, decimals };
}

/**
 * The refusal for a market row whose token we cannot describe.
 *
 * Phrased as our gap because it is one: the row exists on-chain, so the token
 * was accepted by the facet when the listing was created. We simply have no
 * declared decimals for it, and cannot show an amount without them.
 */
const undescribable = (address: string): PlanResult => ({
  ok: false,
  error: `That market entry is denominated in a token this app doesn't have declared decimals for (${address.slice(0, 6)}…${address.slice(-4)}), so the amount can't be shown or signed for accurately. Use the Borrow page, which reads the token's own decimals on-chain.`,
});

/**
 * Display label for a position's token, on a given chain.
 *
 * Only ever used to build a summary line the user reads before signing, so a
 * truncated address is an acceptable answer. It must not be used to pick an
 * address to transact with.
 */
function symbolForPoolToken(
  chainId: number | undefined,
  address: string,
): string {
  return symbolForAddress(chainId, address);
}

const daysFromNow = (days: number) =>
  Math.floor(Date.now() / 1000) + Math.round(days * 86_400);

/**
 * Re-resolves a token against what this chain's lending market ACCEPTS.
 *
 * Two separate corrections live in this one call, and both are needed:
 *
 * First, the DEX and the P2P protocol disagree about native ETH: the DEX-side
 * token carries the swap-router sentinel (0xEeee…), while lending uses its own
 * sentinel, which is what ProtocolFacet expects. Passing the parser's token
 * straight through would send collateral to the wrong address and try to
 * ERC20-approve something that isn't a token. Symbols are the only stable key
 * across the two lists, so lending commands re-resolve here.
 *
 * Second — and this is the part that used to be wrong — the list resolved
 * against is the REGISTERED one, not `borrowCurrencies`. That list answers "what
 * does this app offer", which it derives from address existence in the registry;
 * it has never had anything to do with the per-chain owner transactions that
 * decide what the facet will not revert on. The two differ on every deployed
 * chain: kfUSD is offered on five and registered on none, USDT is offered on
 * five and loanable on two, and native is offered as a loan currency on five and
 * loanable on none — so `borrow 1 ETH` built cleanly and then reverted
 * `Protocol__TokenNotLoanable` at signing time. Refusing here costs the user one
 * sentence; the old behaviour cost them a wallet confirmation and a failed
 * transaction.
 *
 * `side` is not optional because there is no side-agnostic answer. Collateral
 * and loanable are different mappings checked by different functions, and on
 * Sepolia the difference is three tokens against one.
 */
const toLendingCurrency = findRegisteredLendingAsset;

const isLendingNative = (address: string) =>
  address.toLowerCase() === NATIVE_SENTINEL.lending.toLowerCase();

/**
 * The refusal for a token the market does not accept on the side being used.
 *
 * The "Supported" list is the registered set for that side, read per chain, so
 * the second attempt it invites can actually succeed. Naming what the app offers
 * here — which is what this did — sent the user straight into a revert: on
 * Sepolia it would answer "Supported: ETH, USDC, USDT, kfUSD" to `borrow kfUSD`
 * when the only loanable asset on that chain is USDC.
 *
 * A chain with no recorded registration gets a different sentence, because it is
 * a different situation and not the user's mistake: we do not know what it
 * accepts, and guessing from the address table is exactly the bug above. That
 * refusal is a bug in our deploy records, so it says how to clear it.
 */
const unsupported = (
  chainId: number | undefined,
  side: LendingSide,
  symbol: string,
): PlanResult => {
  const { known, assets, unnamed } = registeredLendingAssets(chainId, side);
  if (!known) {
    return {
      ok: false,
      error: `We haven't recorded which assets the lending market accepts on this chain, so ${symbol} can't be checked. Rather than guess and have the transaction revert, this is refused — use the Borrow page, which asks the contract directly.`,
    };
  }
  const noun = side === "loanable" ? "lend or borrow" : "use as collateral";
  const names = [...assets.map((a) => a.symbol), ...unnamed];
  /* Resumable only when there is something to switch to. With an empty market
     the answer to "which asset instead?" is none of them, and asking would
     invite a reply nothing could accept. */
  return names.length
    ? {
        ok: false,
        error: `The lending market on this chain doesn't accept ${symbol} to ${noun}. Accepted: ${names.join(", ")}.`,
        retry: {
          slot: "token",
          prompt: `Which of those do you want to ${noun} instead?`,
        },
      }
    : {
        ok: false,
        error: `The lending market on this chain has no assets registered yet, so there's nothing to ${noun}.`,
      };
};

/**
 * The exact collateral/output tokens the stablecoin contracts accept, on one
 * chain.
 *
 * Re-resolving by symbol here, rather than trusting the token the parser
 * matched, means "mint 500 kld" fails loudly instead of quoting a token the
 * stablecoin contracts were never told about.
 *
 * Keys are upper-cased because the lookup upper-cases. The version this moved
 * from keyed the third entry "USDe" and looked it up with .toUpperCase(), so
 * "USDE" never matched: mint, redeem and completeWithdrawal against USDe all
 * returned "isn't accepted as kfUSD collateral" for a collateral the contracts
 * do accept. Fixed in the move rather than carried across.
 *
 * Returns undefined for a collateral this chain has no address for, which
 * collapses two cases into the one answer that is true of both: whether the
 * symbol is not a collateral at all, or is one that has not been deployed here,
 * the contracts on this chain will not take it.
 */
function stableToken(
  chainId: number | undefined,
  symbol: string,
): { address: string; decimals: number } | undefined {
  const s = stableContracts(chainId);
  const table: Record<
    string,
    { address: string | undefined; decimals: number }
  > = {
    USDC: { address: s.USDC, decimals: 6 },
    USDT: { address: s.USDT, decimals: 6 },
    USDE: { address: s.USDe, decimals: 18 },
  };
  const hit = table[symbol.toUpperCase()];
  return hit?.address
    ? { address: hit.address, decimals: hit.decimals }
    : undefined;
}

const unsupportedCollateral = (
  chainId: number | undefined,
  symbol: string,
): PlanResult => {
  const s = stableContracts(chainId);
  const accepted = [
    s.USDC && "USDC",
    s.USDT && "USDT",
    s.USDe && "USDe",
  ].filter(Boolean);
  return accepted.length
    ? {
        ok: false,
        error: `${symbol} isn't accepted as kfUSD collateral. Supported: ${accepted.join(", ")}.`,
        // Same bargain as `unsupported`: the amount and the verb were both
        // stated and only the collateral was wrong, so re-asking one slot is
        // cheaper for the user than re-typing the sentence.
        retry: { slot: "token", prompt: "Which of those do you want to use?" },
      }
    : {
        ok: false,
        error: `kfUSD collateral isn't available on this chain yet.`,
      };
};

/**
 * A stablecoin contract this chain hasn't deployed.
 *
 * Separate from unsupportedCollateral, which is about the *collateral* the user
 * named. This one is about our own contracts being absent, which is not the
 * user's mistake and should not be phrased as one.
 */
const stableUnavailable = (what: string): PlanResult => ({
  ok: false,
  error: `${what} isn't deployed on this chain yet.`,
});

export async function buildIntents(
  command: Command,
  opts: PlannerOptions,
  deps: PlanDeps,
): Promise<PlanResult> {
  const { chainId } = deps;

  /* This chain's addresses, resolved once. Every field is `string | undefined`
     — a chain that has not deployed a contract returns undefined rather than a
     stale address from some other chain — so each branch below guards the ones
     it needs and returns a plan error naming what is missing. That guard is the
     whole point of the chain-scoped registry: the alternative is passing
     `undefined` into ethers as an address, which fails much later and much
     less legibly. */
  const contracts = getContracts(chainId);
  const stables = stableContracts(chainId);

  if (command.kind === "help") {
    return { ok: false, error: "help" };
  }

  /*
   * Receive resolves to a panel, and the agent page short-circuits it before
   * ever reaching here — this guard exists so the union narrows and so the
   * planner never has to answer "what transaction is an address?". There
   * isn't one: receiving is the single thing in this grammar that needs no
   * contract, no signature and no chain call.
   */
  if (command.kind === "receive") {
    return { ok: false, error: "receive" };
  }

  /*
   * Same shape as receive: a portfolio is an answer, not a transaction. The agent
   * page short-circuits it against the hooks it already holds — the planner has
   * no address book and no price feed of its own, and asking it for "the
   * transaction that is a balance sheet" has no answer either.
   */
  if (command.kind === "portfolio") {
    return { ok: false, error: "portfolio" };
  }

  /*
   * Same shape again: opening the add-liquidity form is a navigation, not a
   * transaction. The agent page short-circuits it before reaching here, and this
   * guard narrows the union — asking this module for "the transaction that is a
   * screen" has no answer, and the transaction that screen goes on to build is
   * `provideLiquidity`, which arrives as its own command with the amounts in it.
   */
  if (command.kind === "openLiquidity") {
    return { ok: false, error: "openLiquidity" };
  }

  if (command.kind === "swap") {
    const { amount, tokenIn, tokenOut } = command;

    /* Before quoting, not after: a chain with no router cannot fill this order
       however good the price is, and the quote is a network round trip. */
    const router = contracts.v3Router;
    if (!router) {
      return {
        ok: false,
        error: "Swapping isn't available on this chain yet.",
      };
    }

    /*
     * The chain's own currency becomes its wrapped form before anything is
     * quoted, and the flags remember which end it was.
     *
     * THIS IS WHAT MAKES A NATIVE SWAP POSSIBLE AT ALL, and its absence is why
     * `swap 0.1 ETH for KLD` could not work on any chain: the sentinel went
     * straight into the quoter (an `eth_call` to an address with no code, which
     * comes back as a revert and reads as "no pool") and into an `approve` step
     * (`allowance()` on the same non-address, which throws mid-plan, after the
     * user has already agreed to sign). Neither failure mentions ETH.
     *
     * Substituted BEFORE `findBestRoute` rather than after, for two reasons. The
     * quote has to price the pools the transaction will really touch, and
     * `intermediateTokens` excludes whatever sits at either end — so a WETH end
     * has to be a WETH end by the time that exclusion runs, or the search wastes
     * nine quotes on WETH→WETH→X and can return a route that doubles back.
     */
    const sell = poolSide(chainId, tokenIn);
    const buy = poolSide(chainId, tokenOut);
    if (!sell || !buy) {
      /* Ours to fix, not the user's: a chain with a router always has a wrapped
         native (the periphery takes it as a constructor argument), so reaching
         here means our own records are short of one. */
      return {
        ok: false,
        error: `Selling ${(!sell ? tokenIn : tokenOut).symbol} means routing through its wrapped form, and we haven't recorded one on this chain. The pools hold the wrapped token, so there's nothing to route through until that's fixed.`,
      };
    }
    if (sell.token.address.toLowerCase() === buy.token.address.toLowerCase()) {
      return {
        ok: false,
        error:
          sell.native !== buy.native
            ? `${tokenIn.symbol} and ${tokenOut.symbol} are the same asset — one is the wrapped form of the other, held one for one. There's no pool between them, and wrapping isn't part of the swap path.`
            : `${tokenIn.symbol} and ${tokenOut.symbol} are the same token, so there's nothing to swap.`,
      };
    }

    /*
     * Every direct tier AND every two-hop route through this chain's quote
     * assets, quoted concurrently, best fill wins.
     *
     * This used to quote the three direct tiers and nothing else, and refuse
     * whenever all three came back empty — which is a true statement about the
     * direct pair and a false one about the DEX. KLD is seeded against USDC and
     * against nothing else, so "swap ETH for KLD" had no direct pool on any tier
     * and was refused, while ETH→USDC→KLD was sitting there with liquidity in
     * both legs. `findBestRoute` holds the search, shared with the Swap page so
     * the card and the chat cannot route the same request differently.
     */
    const path = await findBestRoute(
      chainId,
      sell.token,
      buy.token,
      amount,
      (tokens, fees, amountIn, decimalsIn, decimalsOut) =>
        tokens.length === 2
          ? deps.quote({
              tokenIn: tokens[0],
              tokenOut: tokens[1],
              amountIn,
              fee: fees[0],
              decimalsIn,
              decimalsOut,
            })
          : deps.quotePath({
              tokens,
              fees,
              amountIn,
              decimalsIn,
              decimalsOut,
            }),
    );

    if (!path) {
      return {
        ok: false,
        error:
          `I couldn't get a price for ${tokenIn.symbol} to ${tokenOut.symbol}. ` +
          `There's no pool for that pair at any of the tiers we trade ` +
          `(${FEE_TIERS.map((f) => `${f / 10_000}%`).join(", ")}), and no route ` +
          `through ${
            intermediateTokens(chainId)
              .map((t) => t.symbol)
              .join(" or ") || "another token"
          } either.`,
      };
    }

    const out = path.amountOut;

    // Mirrors the Swap page: trim to the token's precision, but never past
    // 6dp, so the string stays inside parseUnits' tolerance.
    const minOut = (out * (1 - opts.slippageBps / 10000)).toFixed(
      buy.token.decimals > 6 ? 6 : buy.token.decimals,
    );

    /* The approve is the same either way: one router, the whole input amount,
       whichever entry point spends it.

       Absent entirely when the user is paying with the chain's own currency —
       value needs no allowance, and there is no contract to ask for one. This
       used to be emitted unconditionally, which is the second half of why a
       native swap could not work: the plan's first step called `allowance()` on
       the 0xEeee… sentinel and threw. */
    const approve: Intent | null = sell.native
      ? null
      : {
          kind: "approve",
          token: sell.token.address,
          spender: router,
          amount,
          decimals: sell.token.decimals,
          symbol: sell.token.symbol,
        };

    /*
     * One hop is a `swap`; more is a `swapMultiHop`. Not a stylistic split —
     * they are two different router functions with two different calldata
     * shapes, and a one-hop `exactInput` gives up the per-pool price limit that
     * `exactInputSingle` carries for nothing in return.
     */
    const trade: Intent =
      path.hops.length === 1
        ? {
            kind: "swap",
            /* The wrapped addresses, with the user's symbols beside them — the
               calldata has to name a token that exists, the confirmation row has
               to name the asset leaving the wallet. See poolSide(). */
            tokenIn: sell.token.address,
            tokenOut: buy.token.address,
            amountIn: amount,
            amountOutMin: minOut,
            /* The tier the winning quote came from, never a fixed default:
               `amountOutMin` above was derived from this pool's price, so routing
               the swap through a different one applies a floor computed against
               liquidity it will not touch. */
            fee: path.fees[0],
            decimalsIn: sell.token.decimals,
            decimalsOut: buy.token.decimals,
            symbolIn: sell.token.symbol,
            symbolOut: buy.token.symbol,
            /* The same `router` the approve above authorises, deliberately the
               one variable rather than two lookups — see the note on `spender`
               in types.ts. If these ever disagree the approve grants an
               allowance to a contract that never spends it and the swap reverts
               for want of one. */
            spender: router,
            deadlineMin: opts.deadlineMin,
            nativeIn: sell.native,
            nativeOut: buy.native,
          }
        : {
            kind: "swapMultiHop",
            hops: path.hops.map((h) => ({
              tokenIn: h.tokenIn,
              tokenOut: h.tokenOut,
              symbolIn: h.symbolIn,
              symbolOut: h.symbolOut,
              fee: h.fee,
            })),
            /* Encoded from the same hops the row is rendered from, so the
               auditor's re-encode compares like with like. */
            path: encodeV3Path(path.tokens, path.fees),
            amountIn: amount,
            amountOutMin: minOut,
            decimalsIn: sell.token.decimals,
            decimalsOut: buy.token.decimals,
            symbolIn: sell.token.symbol,
            symbolOut: buy.token.symbol,
            spender: router,
            deadlineMin: opts.deadlineMin,
            nativeIn: sell.native,
            nativeOut: buy.native,
          };

    return {
      ok: true,
      build: {
        summary: `Swap ${amount} ${sell.token.symbol} for about ${out} ${buy.token.symbol}, ${describeRoute(path)}.`,
        intents: approve ? [approve, trade] : [trade],
      },
    };
  }

  if (command.kind === "stake") {
    /* All three addresses come from the plan's chain, together. The vault used
       to come from `envVars.vaultAddress` — one env var for every chain, and
       unset — while the token and receipt were Abstract-testnet literals, so a
       stake plan on any chain named contracts from another one. */
    const staking = stakingContracts(chainId);
    if (!staking.supported) {
      return {
        ok: false,
        error: "Staking isn't available on this chain yet.",
      };
    }
    return {
      ok: true,
      build: {
        summary: `Stake ${command.amount} KLD for stKLD.`,
        intents: [
          {
            kind: "approve",
            token: staking.kld!,
            spender: staking.kldVault!,
            amount: command.amount,
            decimals: 18,
            symbol: "KLD",
          },
          {
            kind: "stake",
            vault: staking.kldVault!,
            token: staking.kld!,
            stToken: staking.stKLD!,
            amount: command.amount,
            symbol: "KLD",
          },
        ],
      },
    };
  }

  if (command.kind === "approve") {
    /* "Approve X for trading" means approving the router, so a chain without
       one has nothing to approve to. Guarded rather than reusing the swap
       branch's `router`, which is scoped to that block. */
    if (!contracts.v3Router) {
      return {
        ok: false,
        error: "Trading isn't available on this chain yet.",
      };
    }
    return {
      ok: true,
      build: {
        summary: `Approve ${command.amount} ${command.token.symbol} for trading.`,
        intents: [
          {
            kind: "approve",
            token: command.token.address,
            spender: contracts.v3Router,
            amount: command.amount,
            decimals: command.token.decimals,
            symbol: command.token.symbol,
          },
        ],
      },
    };
  }

  /* ---------------------------------------------------------------- send -- */
  /*
   * Placed above the lending section because it needs none of it: no diamond,
   * no currency re-resolution, no approve. It is the one command that leaves
   * Kaleido's contracts entirely.
   */
  if (command.kind === "send") {
    const { amount, token, to } = command;

    let recipient: string;
    try {
      recipient = ethers.getAddress(to);
    } catch {
      /*
       * Two distinct failures land here, and the wording has to cover both.
       * The typed path already guaranteed the 0x-and-40-hex shape, so a throw
       * there can only be a checksum mismatch — which is the failure this
       * check exists for, and the reason fromCommand goes out of its way to
       * preserve the case of what the user typed. The tool-call path reaches
       * this builder too, and a model can produce an address of any shape.
       */
      return {
        ok: false,
        error: `${to} isn't a valid recipient address. Copy it again from your wallet or an explorer — one wrong character is unrecoverable once it's sent.`,
      };
    }

    // Decimals come from the token the parser matched, never a default: a
    // 6-decimal token parsed as 18 sends a millionth of what was asked for.
    if (!isParsableAmount(amount, token.decimals)) {
      return {
        ok: false,
        error: `${amount} is more precision than ${token.symbol} has — it holds ${token.decimals} decimal places.`,
      };
    }

    /*
     * Either sentinel means native, which is deliberate rather than sloppy.
     * Registry rule 3: a sentinel is a *protocol* convention, and a
     * wallet-to-wallet send is not a protocol call, so neither 0xEeee… (DEX)
     * nor ADDRESS_1 (lending) is "the" native address for this transaction.
     * Which one arrives depends on the vocabulary the parser matched against
     * (chainTokens defaults to "dex"), and the resolver ignores the field
     * entirely once this flag is set.
     */
    const isNative =
      isNativeSentinel(token.address, "dex") ||
      isNativeSentinel(token.address, "lending");

    return {
      ok: true,
      build: {
        // The full address, not a truncation — see the transfer renderer in
        // definitions.ts for why abbreviating this one is unsafe.
        summary: `Send ${amount} ${token.symbol} to ${recipient}.`,
        intents: [
          {
            kind: "transfer",
            token: token.address,
            to: recipient,
            amount,
            decimals: token.decimals,
            symbol: token.symbol,
            isNative,
          },
        ],
      },
    };
  }

  /* -------------------------------------------------------------- bridge -- */
  /*
   * Directly below send because it is the second command that leaves Kaleido's
   * contracts entirely, and for the same reasons: no diamond and no currency
   * re-resolution. The wallet signs a source-chain transaction to a portal or an
   * aggregator router.
   *
   * One step for native currency, two for a token. A native bridge carries the
   * amount as `value` and has nothing to pre-authorise; an ERC20 has to approve
   * the router first, which is the pair this used to refuse outright — the
   * approve auditor trusted only Kaleido contracts as spenders, and a bridge
   * router is not one. It now recognises one vetted router
   * (`isKnownBridgeSpender`), so the pair is auditable and the refusal is gone.
   *
   * The spender is NOT chosen here. It arrives on the route, having been checked
   * by the resolver against that same allowlist AND against the address the
   * transaction calls — so this pairs an approve with a router it did not pick,
   * exactly as `to`/`data`/`value` are used and never decided here. That is the
   * whole security posture of a transaction the diamond cannot scope with
   * LibAgentPermission: the auditor re-checks a canonical `to` against the table
   * it was built from, re-checks the spender against the same allowlist, and
   * prices the notional against the per-action cap.
   */
  if (command.kind === "bridge") {
    const { amount, token, toChain } = command;

    // A bridge is defined by the chain it leaves. Without one there is no
    // corridor to resolve and no `fromChainId` for the Intent, so refuse here
    // rather than resolve against an undefined source.
    if (chainId === undefined) {
      return {
        ok: false,
        error: "Connect a wallet on the chain you want to bridge from first.",
      };
    }

    if (!isParsableAmount(amount, token.decimals)) {
      return {
        ok: false,
        error: `${amount} is more precision than ${token.symbol} has — it holds ${token.decimals} decimal places.`,
      };
    }

    // Same either-sentinel test as send: native is a wallet fact here, not a
    // protocol convention, so both the DEX and lending sentinels count.
    const isNative =
      isNativeSentinel(token.address, "dex") ||
      isNativeSentinel(token.address, "lending");

    const route = await deps.bridgeRoute({
      toChain,
      asset: token.symbol,
      amount,
      decimals: token.decimals,
      isNative,
      tokenAddress: token.address,
    });
    if ("error" in route) {
      return { ok: false, error: route.error };
    }

    /* A token leg with no spender cannot be signed: the router would have no
       allowance and the transaction would revert. The resolver only omits it for
       a native route, so this is the shape check that keeps the two in step
       rather than a case anyone expects to hit. */
    if (!isNative && !route.spender) {
      return {
        ok: false,
        error: `That ${token.symbol} route came back without a router to approve, so there's nothing safe to sign. Nothing was sent.`,
      };
    }

    return {
      ok: true,
      build: {
        summary: `Bridge ${amount} ${token.symbol} to ${route.toChainName}.`,
        intents: [
          ...(isNative
            ? []
            : ([
                {
                  kind: "approve",
                  token: token.address,
                  spender: route.spender!,
                  amount,
                  decimals: token.decimals,
                  symbol: token.symbol,
                },
              ] as Intent[])),
          {
            kind: "bridge",
            to: route.to,
            data: route.data,
            value: route.value,
            token: token.address,
            amount,
            decimals: token.decimals,
            symbol: token.symbol,
            fromChainId: chainId,
            toChainId: route.toChainId,
            toChainName: route.toChainName,
            provider: route.provider,
            etaSeconds: route.etaSeconds,
            isNative,
            ...(route.spender ? { spender: route.spender } : {}),
            ...(route.gasLimit ? { gasLimit: route.gasLimit } : {}),
          },
        ],
      },
    };
  }

  /* -------------------------------------------------------- faucet -- */

  /*
   * Above the diamond guard below, not with the other claims further down.
   *
   * Everything past that guard is unreachable on a chain with no lending
   * diamond — which is exactly the freshly-deployed chain a faucet exists to
   * serve. Filed here it refuses for its own reasons or not at all.
   */
  if (command.kind === "claimTestTokens") {
    const faucet = contracts.faucet;
    if (!faucet) {
      return {
        ok: false,
        error: "There's no test-token faucet on this chain.",
      };
    }

    const assets = await deps.faucetAssets();
    if (assets.length === 0) {
      /* Two causes, one signal: a faucet with nothing listed, and a read that
         failed (every implementation degrades to [] rather than throwing, so
         that a chain call falling over is a refusal here and not a 500 in the
         caller). The wording covers both rather than asserting the first. */
      return {
        ok: false,
        error: "Couldn't read anything to claim from the faucet on this chain.",
      };
    }

    const wanted = command.symbol?.trim();
    const listed = assets.map((a) => a.symbol).join(", ");

    /* Address as well as ticker, because the model may name either. Neither is
       trusted: both are only lookup keys into the list the faucet just gave us,
       so an address that isn't in it resolves to nothing rather than to a
       transfer. */
    const match = wanted
      ? assets.find(
          (a) =>
            a.symbol.toLowerCase() === wanted.toLowerCase() ||
            a.address.toLowerCase() === wanted.toLowerCase(),
        )
      : assets.length === 1
        ? assets[0]
        : undefined;

    /*
     * "faucet all" — everything claimable, in one transaction.
     *
     * Handled here rather than as a token that fails to resolve, because "all" is
     * ticker-shaped: fromCommand's positional grab accepts it exactly as it would
     * accept "usdc", and without this it would become "The faucet doesn't hand out
     * all." Checked *after* the symbol match so a faucet that ever lists an asset
     * actually called ALL still hands out that asset — a real listing outranks a
     * keyword.
     *
     * The list is filtered here rather than left to the contract even though
     * `claimMany` skips unavailable members anyway. The plan has to state what it
     * will do before it is signed, and "claim 6 assets" that pays 2 is a plan that
     * described someone else's wallet.
     */
    if (!match && wanted && ALL_WORDS.has(wanted.toLowerCase())) {
      const now = Math.floor(Date.now() / 1000);
      const due = assets.filter(
        (a) =>
          BigInt(a.amountRaw) > 0n &&
          BigInt(a.stockRaw) >= BigInt(a.amountRaw) &&
          a.nextClaimAt <= now,
      );

      if (due.length === 0) {
        return {
          ok: false,
          error: `Nothing on the faucet is claimable right now — every asset it lists (${listed}) is either on cooldown, paused, or out of stock.`,
        };
      }

      /* One asset goes through the single-asset kind. `claimMany` would work, but
         `claim` reverts with the specific reason where the batch reverts with
         NothingClaimable, and with one asset there is nothing for the vaguer error
         to be summarising. */
      if (due.length === 1) {
        const only = due[0];
        const amount = ethers.formatUnits(
          BigInt(only.amountRaw),
          only.decimals,
        );
        return {
          ok: true,
          build: {
            summary: `Claim ${amount} ${only.symbol} from the testnet faucet — the only asset due right now.`,
            intents: [
              {
                kind: "claimTestTokens",
                faucet,
                token: only.address,
                amount,
                symbol: only.symbol,
              },
            ],
          },
        };
      }

      const payouts = due.map(
        (a) =>
          `${ethers.formatUnits(BigInt(a.amountRaw), a.decimals)} ${a.symbol}`,
      );
      return {
        ok: true,
        build: {
          summary: `Claim ${due.length} assets from the testnet faucet in one transaction: ${payouts.join(", ")}.`,
          intents: [
            {
              kind: "claimAllTestTokens",
              faucet,
              tokens: due.map((a) => a.address),
              payouts,
            },
          ],
        },
      };
    }

    if (!match) {
      return {
        ok: false,
        error: wanted
          ? `The faucet doesn't hand out ${wanted}. It lists ${listed}.`
          : `The faucet lists ${listed} — say which one you want, or "all" for everything that's due.`,
      };
    }

    /* Listed with a zero drip is the contract's own way of pausing an asset
       (see Faucet.sol), which is why it reaches here at all instead of being
       filtered out of assetInfo: a dropped asset would be indistinguishable
       from one the faucet never had. */
    const drip = BigInt(match.amountRaw);
    if (drip === 0n) {
      return {
        ok: false,
        error: `${match.symbol} claims are paused on the faucet right now.`,
      };
    }
    if (BigInt(match.stockRaw) < drip) {
      return {
        ok: false,
        error: `The faucet is out of ${match.symbol} — it can't cover a claim.`,
      };
    }

    /* Refused here rather than left to revert, because the wait is the one
       faucet failure a user can act on. Only as good as the address the caller
       passed to faucetAssets: an implementation that reads for the zero address
       reports no cooldown, and the contract still enforces it. */
    const now = Math.floor(Date.now() / 1000);
    if (match.nextClaimAt > now) {
      const secs = match.nextClaimAt - now;
      const left =
        secs >= 3600
          ? `${Math.ceil(secs / 3600)}h`
          : secs >= 60
            ? `${Math.ceil(secs / 60)} min`
            : `${secs}s`;
      return {
        ok: false,
        error: `You've claimed ${match.symbol} recently. The faucet will hand out more in about ${left}.`,
      };
    }

    const amount = ethers.formatUnits(drip, match.decimals);
    return {
      ok: true,
      build: {
        summary: `Claim ${amount} ${match.symbol} from the testnet faucet.`,
        intents: [
          {
            kind: "claimTestTokens",
            faucet,
            token: match.address,
            amount,
            symbol: match.symbol,
          },
        ],
      },
    };
  }

  /* ------------------------------------------------------- lending -- */

  /* The diamond for the chain this command targets, from the registry, falling
     back to the env var only where the registry has none.

     The order is the whole point and it used to be env-var only. `NEXT_PUBLIC_
     KALEIDO_DIAMOND_ADDRESS` is ONE address for every chain — it currently holds
     Sepolia's — while the five deployed testnets have five distinct diamonds. So
     every lending, stablecoin and delegation intent was built against Sepolia's
     diamond regardless of where the wallet was, and once the auditor started
     pinning the registry's diamond per chain the two disagreed: measured across
     the five, `deposit` and `withdraw` were BLOCKED on four with "diamond is not
     the diamond this app deploys against" — the builder naming one chain's
     contract and the auditor the correct one.

     Fixing it here rather than relaxing the pin, because the pin was right. A
     deposit sent to another chain's diamond address is not a rejected plan, it is
     an approve granting allowance to an address holding no code plus a call that
     reverts if anything is there at all.

     The env-var fallback is kept for a chain absent from DEPLOYMENTS, where a
     single configured address is strictly better than refusing outright. */
  const diamond =
    getContracts(chainId).diamond ?? envVars.lendbitDiamondAddress;
  if (!diamond) {
    return { ok: false, error: "The protocol address isn't configured." };
  }

  if (command.kind === "deposit") {
    const { amount } = command;
    /* Collateral side: depositCollateral is gated on `_isTokenAllowed`, i.e.
       `s_priceFeeds[token] != 0`. */
    const cur = toLendingCurrency(chainId, "collateral", command.token.symbol);
    if (!cur) return unsupported(chainId, "collateral", command.token.symbol);
    const isNative = isLendingNative(cur.address);
    return {
      ok: true,
      build: {
        summary: `Deposit ${amount} ${cur.symbol} as collateral.`,
        intents: [
          // Native collateral is sent as value, so there is nothing to
          // approve. Emitting an approve for it would revert.
          ...(isNative
            ? []
            : ([
                {
                  kind: "approve",
                  token: cur.address,
                  spender: diamond,
                  amount,
                  decimals: cur.decimals,
                  symbol: cur.symbol,
                },
              ] as Intent[])),
          {
            kind: "depositCollateral",
            diamond,
            token: cur.address,
            amount,
            decimals: cur.decimals,
            symbol: cur.symbol,
            isNative,
          },
        ],
      },
    };
  }

  if (command.kind === "withdraw") {
    const { amount } = command;
    /* Same gate as deposit — withdrawCollateral carries `_isTokenAllowed` too,
       so a token whose feed was removed cannot be withdrawn either. */
    const cur = toLendingCurrency(chainId, "collateral", command.token.symbol);
    if (!cur) return unsupported(chainId, "collateral", command.token.symbol);
    return {
      ok: true,
      build: {
        summary: `Withdraw ${amount} ${cur.symbol} of collateral.`,
        intents: [
          {
            kind: "withdrawCollateral",
            diamond,
            token: cur.address,
            amount,
            decimals: cur.decimals,
            symbol: cur.symbol,
          },
        ],
      },
    };
  }

  if (command.kind === "borrow") {
    const { amount, interestPct, days } = command;
    /* createLendingRequest is gated on `s_isLoanable`, not on the collateral
       allowlist — a token can be depositable and not borrowable. */
    const cur = toLendingCurrency(chainId, "loanable", command.token.symbol);
    if (!cur) return unsupported(chainId, "loanable", command.token.symbol);
    return {
      ok: true,
      build: {
        summary: `Post a request to borrow ${amount} ${cur.symbol} at ${interestPct}% for ${days} days. It fills when a lender takes it.`,
        intents: [
          {
            kind: "createLendingRequest",
            diamond,
            token: cur.address,
            amount,
            decimals: cur.decimals,
            symbol: cur.symbol,
            interestPct,
            returnDate: daysFromNow(days),
          },
        ],
      },
    };
  }

  if (command.kind === "lend") {
    const { amount, interestPct, days } = command;
    /* createLoanListing shares createLendingRequest's `s_isLoanable` gate. */
    const cur = toLendingCurrency(chainId, "loanable", command.token.symbol);
    if (!cur) return unsupported(chainId, "loanable", command.token.symbol);
    const token = cur;
    const isNative = isLendingNative(cur.address);
    return {
      ok: true,
      build: {
        // min and max are set to the full amount, so the listing is drawn in
        // one piece. Partial draws are a real feature of the contract, but
        // picking a split here would be inventing policy the user didn't
        // state; the Borrow page is where that gets chosen deliberately.
        summary: `Offer ${amount} ${token.symbol} to lend at ${interestPct}% for ${days} days, drawn in one piece.`,
        intents: [
          // Kept although it is unreachable on all five deployed chains: the
          // native sentinel is registered collateral everywhere and loanable
          // nowhere, so the guard above refuses `lend ETH` before this runs.
          // That is on-chain state one owner transaction changes, not an
          // invariant, and createLoanListing does take native value — so
          // deleting the branch would break the day it is registered.
          ...(isNative
            ? []
            : ([
                {
                  kind: "approve",
                  token: token.address,
                  spender: diamond,
                  amount,
                  decimals: token.decimals,
                  symbol: token.symbol,
                },
              ] as Intent[])),
          {
            kind: "createLoanListing",
            diamond,
            token: token.address,
            amount,
            minAmount: amount,
            maxAmount: amount,
            decimals: token.decimals,
            symbol: token.symbol,
            interestPct,
            returnDate: daysFromNow(days),
            isNative,
          },
        ],
      },
    };
  }

  if (command.kind === "cancel") {
    // Only an id is needed, so this is exact with no market data.
    return {
      ok: true,
      build: {
        summary:
          command.target === "listing"
            ? `Cancel your listing #${command.id}.`
            : `Cancel your borrow request #${command.id}.`,
        intents: [
          command.target === "listing"
            ? { kind: "closeListing", diamond, listingId: command.id }
            : { kind: "closeRequest", diamond, requestId: command.id },
        ],
      },
    };
  }

  if (command.kind === "takeListing") {
    const row = await deps.marketRow("listings", command.listingId);
    if (!row) {
      return {
        ok: false,
        error: `I can't find an open listing #${command.listingId}.`,
      };
    }
    const described = describeToken(chainId, row.tokenAddress);
    if (!described) return undescribable(row.tokenAddress);
    const { symbol, decimals } = described;
    return {
      ok: true,
      build: {
        summary: `Borrow ${command.amount} ${symbol} from listing #${command.listingId}.`,
        intents: [
          {
            kind: "borrowFromListing",
            diamond,
            listingId: command.listingId,
            amount: command.amount,
            decimals,
            symbol,
          },
        ],
      },
    };
  }

  if (command.kind === "fillRequest") {
    const row = await deps.marketRow("requests", command.requestId);
    if (!row) {
      return {
        ok: false,
        error: `I can't find an open request #${command.requestId}.`,
      };
    }
    const described = describeToken(chainId, row.tokenAddress);
    if (!described) return undescribable(row.tokenAddress);
    const { symbol, decimals } = described;
    const isNative = isLendingNative(row.tokenAddress);
    const amount = ethers.formatUnits(BigInt(row.amount), decimals);
    return {
      ok: true,
      build: {
        summary: `Lend ${amount} ${symbol} to request #${command.requestId}.`,
        intents: [
          // The lender approves the diamond to pull the principal; native
          // ETH skips this and rides along as value on serviceRequest.
          ...(isNative
            ? []
            : ([
                {
                  kind: "approve",
                  token: row.tokenAddress,
                  spender: diamond,
                  amount,
                  decimals,
                  symbol,
                },
              ] as Intent[])),
          {
            kind: "fillRequest",
            diamond,
            requestId: command.requestId,
            token: row.tokenAddress,
            amount,
            decimals,
            symbol,
            isNative,
          },
        ],
      },
    };
  }

  /* ------------------------------------------------------ stablecoin -- */

  if (command.kind === "mint") {
    const cur = stableToken(chainId, command.token.symbol);
    if (!cur) return unsupportedCollateral(chainId, command.token.symbol);
    if (!stables.kfUSD) return stableUnavailable("kfUSD");
    return {
      ok: true,
      build: {
        summary: `Mint ${command.amount} kfUSD, backed by ${command.amount} ${command.token.symbol}.`,
        intents: [
          {
            kind: "approve",
            token: cur.address,
            spender: stables.kfUSD,
            amount: command.amount,
            decimals: cur.decimals,
            symbol: command.token.symbol,
          },
          {
            kind: "mintStable",
            kfUSD: stables.kfUSD,
            collateralToken: cur.address,
            collateralAmount: command.amount,
            collateralDecimals: cur.decimals,
            collateralSymbol: command.token.symbol,
          },
        ],
      },
    };
  }

  if (command.kind === "redeem") {
    const cur = stableToken(chainId, command.token.symbol);
    if (!cur) return unsupportedCollateral(chainId, command.token.symbol);
    if (!stables.kfUSD) return stableUnavailable("kfUSD");
    return {
      ok: true,
      build: {
        summary: `Redeem ${command.amount} kfUSD for ${command.token.symbol}.`,
        intents: [
          // kfUSD approving itself: the contract transferFroms the caller's
          // own balance before burning it, so the allowance target is the
          // kfUSD contract, matching useStablecoin.ts's redeemKfUSD exactly.
          {
            kind: "approve",
            token: stables.kfUSD,
            spender: stables.kfUSD,
            amount: command.amount,
            decimals: 18,
            symbol: "kfUSD",
          },
          {
            kind: "redeemStable",
            kfUSD: stables.kfUSD,
            amount: command.amount,
            outputToken: cur.address,
            outputSymbol: command.token.symbol,
          },
        ],
      },
    };
  }

  if (command.kind === "lock") {
    if (!stables.kfUSD) return stableUnavailable("kfUSD");
    if (!stables.kafUSD) return stableUnavailable("The kfUSD yield vault");
    return {
      ok: true,
      build: {
        summary: `Lock ${command.amount} kfUSD in the yield vault for kafUSD.`,
        intents: [
          {
            kind: "approve",
            token: stables.kfUSD,
            spender: stables.kafUSD,
            amount: command.amount,
            decimals: 18,
            symbol: "kfUSD",
          },
          {
            kind: "lockStable",
            kafUSD: stables.kafUSD,
            kfUSD: stables.kfUSD,
            amount: command.amount,
          },
        ],
      },
    };
  }

  if (command.kind === "unlock") {
    if (!stables.kafUSD) return stableUnavailable("The kfUSD yield vault");
    if (!stables.kfUSD) return stableUnavailable("kfUSD");
    return {
      ok: true,
      build: {
        summary: `Request withdrawal of ${command.amount} kafUSD. This starts the cooldown; it doesn't pay out yet.`,
        intents: [
          {
            kind: "requestStableWithdrawal",
            kafUSD: stables.kafUSD,
            kfUSD: stables.kfUSD,
            amount: command.amount,
          },
        ],
      },
    };
  }

  if (command.kind === "completeWithdrawal") {
    /*
     * The vault releases what was locked, and `lock` only ever locks kfUSD, so
     * kfUSD is the only payout that can succeed: completeWithdrawal draws on
     * assetLockBalances[user][asset] (kafUSD.sol:185) and every other balance
     * there is zero. stableToken holds the three *mint* collaterals and not
     * kfUSD, so this branch could previously build nothing but a reverting
     * transaction — after the cooldown had already run its full seven days.
     */
    const symbol = command.token.symbol.toUpperCase();
    if (symbol !== "KFUSD") {
      return {
        ok: false,
        error: `The yield vault pays out in kfUSD, not ${command.token.symbol}. Complete the withdrawal, then redeem that kfUSD for ${command.token.symbol}.`,
      };
    }
    if (!stables.kafUSD) return stableUnavailable("The kfUSD yield vault");
    if (!stables.kfUSD) return stableUnavailable("kfUSD");
    return {
      ok: true,
      build: {
        summary: "Complete your vault withdrawal, paid out in kfUSD.",
        intents: [
          {
            kind: "completeStableWithdrawal",
            kafUSD: stables.kafUSD,
            outputToken: stables.kfUSD,
            outputSymbol: "kfUSD",
          },
        ],
      },
    };
  }

  if (command.kind === "claimYield") {
    // Matches the Earn page's own Claim button exactly: it claims kfUSD
    // yield specifically, not a generic "ALL" the live UI doesn't expose.
    if (!stables.YieldTreasury) return stableUnavailable("The yield treasury");
    if (!stables.kfUSD) return stableUnavailable("kfUSD");
    return {
      ok: true,
      build: {
        summary: "Claim accrued kfUSD yield.",
        intents: [
          {
            kind: "claimStableYield",
            yieldTreasury: stables.YieldTreasury,
            asset: stables.kfUSD,
            assetSymbol: "kfUSD",
          },
        ],
      },
    };
  }

  if (command.kind === "compoundYield") {
    if (!stables.YieldTreasury) return stableUnavailable("The yield treasury");
    if (!stables.kfUSD) return stableUnavailable("kfUSD");
    return {
      ok: true,
      build: {
        summary:
          "Claim kfUSD yield and leave it ready to lock back into the vault.",
        intents: [
          {
            kind: "compoundStableYield",
            yieldTreasury: stables.YieldTreasury,
            kfUSD: stables.kfUSD,
          },
        ],
      },
    };
  }

  /* --------------------------------------------------------- pool -- */
  /* -------------------------------------------------- provide liquidity -- */
  /*
   * The one pool action that spends, and the only branch here that both reads a
   * market and can create the market it reads. Three things it does that no other
   * branch does, each of them the reason the mint used to be off-limits to a
   * planner:
   *
   *   1. The range is derived, never carried. `range` arrives as a *choice* — full,
   *      a ±band, or explicit prices — and `ticksForRange` turns it into ticks
   *      using the pool's own live price as the centre. Nothing upstream of here
   *      names a tick, so there is no tick for a caller to get wrong.
   *   2. The fee tier can be resolved from the chain. Omitted means "whichever
   *      tier has a pool", read across all three at once for the reason the swap
   *      branch quotes concurrently. With no pool at any tier the tier becomes a
   *      real decision — it is what the pool will charge forever — so it is asked
   *      for rather than defaulted.
   *   3. It refuses native currency by name. `NonfungiblePositionManager` reverts
   *      when native value arrives beside a WETH leg, which is why the Pool page
   *      wraps first; half-supporting it here would produce a plan that always
   *      reverts at signing.
   */
  if (command.kind === "provideLiquidity") {
    /* Bound before the reads, like the swap branch's router: a chain with no
       position manager cannot mint whatever the pool looks like, and the local
       const is what narrows `string | undefined` across the awaits below. */
    const positionManager = contracts.v3PositionManager;
    if (!positionManager) {
      return {
        ok: false,
        error: "Liquidity positions aren't available on this chain yet.",
      };
    }

    const { token0, token1, amount0, amount1, range } = command;

    if (token0.address.toLowerCase() === token1.address.toLowerCase()) {
      return {
        ok: false,
        error: `A pool needs two different tokens — both sides of that are ${token0.symbol}.`,
      };
    }

    /* Native is refused rather than wrapped for us. Wrapping is a transaction of
       its own with its own confirmation, and silently inserting one would mean the
       user signs a deposit into WETH they never asked for. Named, so the retry can
       succeed: the wrapped token is what the mint takes. */
    const wrappedSymbol = contracts.wrappedNative
      ? symbolForAddress(chainId, contracts.wrappedNative)
      : "the wrapped native token";
    for (const t of [token0, token1]) {
      if (isNativeSentinel(t.address, "dex")) {
        return {
          ok: false,
          error: `A liquidity position can't take native ${t.symbol} — the position manager reverts when native value arrives beside a wrapped leg. Wrap it to ${wrappedSymbol} first, then add liquidity with that.`,
        };
      }
    }

    const readState = (fee: number) =>
      deps
        .poolState(
          token0.address,
          token1.address,
          fee,
          token0.decimals,
          token1.decimals,
        )
        .catch(() => null);

    let fee: number;
    let state: PoolState | null;
    if (command.fee !== undefined) {
      /* Checked against FEE_TIERS and not against `spacingFor`, which is the
         looser gate and would let 100 through: TICK_SPACINGS carries the 0.01%
         tier because the library does, but the factory only has 500, 3000 and
         10000 enabled and /pool/new offers exactly those three. A 100 would read
         as a pool that merely does not exist yet, take the create-and-initialise
         path, and revert inside the factory on a tier it has no spacing for —
         after two approvals had already been signed. */
      if (!isTradedTier(command.fee)) {
        return {
          ok: false,
          error: `${command.fee / 10_000}% isn't a fee tier this DEX has. The tiers are ${FEE_TIERS.map((f) => `${f / 10_000}%`).join(", ")}.`,
        };
      }
      fee = command.fee;
      state = await readState(fee);
    } else {
      const tiers = await Promise.all(FEE_TIERS.map(readState));
      /* Deepest pool wins, and `>` keeps FEE_TIERS order as the tie-break — the
         same rule the swap branch uses, for the same reason: two pools with equal
         depth are the stable-pair case, where the cheaper tier is the one to be
         in. Liquidity is compared as a BigInt because a uint128 does not survive
         a float. A plain loop rather than forEach so the narrowing below survives:
         TypeScript does not track assignments made inside a callback, and `best`
         would read as `null` at the check. */
      let best: { fee: number; state: PoolState } | null = null;
      for (let i = 0; i < tiers.length; i += 1) {
        const s = tiers[i];
        if (!s) continue;
        if (!best || BigInt(s.liquidity) > BigInt(best.state.liquidity))
          best = { fee: FEE_TIERS[i], state: s };
      }
      if (!best) {
        return {
          ok: false,
          error: `There's no ${token0.symbol}/${token1.symbol} pool yet, so adding liquidity would create one — and that sets the fee it charges permanently. Tell me which tier: 0.05% for stable pairs, 0.3% for most pairs, or 1% for volatile ones.`,
        };
      }
      fee = best.fee;
      state = best.state;
    }

    /* A pool that exists and reports no price has run to the far end of its
       range: a swap took everything on one side and clamped instead of
       reverting, so its tick is where the number line ends, not a market.
       Refused here rather than folded into the `spot: null` case below, because
       null there means "this pool is about to be created" and mintMinimums would
       take the floor from the two amounts typed - which is signing a mint into a
       clamp with a floor derived from the clamp. /pool/new still allows it, with
       bounds typed by hand and the state named on screen; a plan has nobody
       reading a chart. */
    if (state && state.price === null) {
      return {
        ok: false,
        error: `The ${token0.symbol}/${token1.symbol} ${fee / 10_000}% pool has run to the far end of its price range: a trade took everything on one side of it, so there is no price I can set a slippage floor against. Add to it from the pool page instead, where you set the bounds yourself.`,
      };
    }

    /* null price, not zero. A pool that does not exist has no market, and the two
       amounts below will set its opening price — which is exactly why a band is
       refused in that case rather than centred on something. */
    const spot = state ? state.price : null;

    const ticks = ticksForRange(
      range,
      spot,
      fee,
      token0.decimals,
      token1.decimals,
    );
    if ("error" in ticks) return { ok: false, error: ticks.error };

    const floors = mintMinimums({
      amount0,
      amount1,
      decimals0: token0.decimals,
      decimals1: token1.decimals,
      tickLower: ticks.tickLower,
      tickUpper: ticks.tickUpper,
      spot,
      slippageBps: opts.slippageBps,
    });
    if ("error" in floors) return { ok: false, error: floors.error };

    const pair = `${token0.symbol}/${token1.symbol}`;
    const priced = (n: number) =>
      n >= 1000 ? n.toFixed(2) : n.toPrecision(6).replace(/\.?0+$/, "");
    const where = state
      ? `between ${priced(ticks.lowerPrice)} and ${priced(ticks.upperPrice)} ${token1.symbol} per ${token0.symbol}`
      : `across the full range, opening the pool at ${priced(Number(amount1) / Number(amount0))} ${token1.symbol} per ${token0.symbol}`;

    return {
      ok: true,
      build: {
        summary: state
          ? `Add ${amount0} ${token0.symbol} and ${amount1} ${token1.symbol} to the ${pair} ${fee / 10_000}% pool, ${where}.`
          : `Create the ${pair} ${fee / 10_000}% pool with ${amount0} ${token0.symbol} and ${amount1} ${token1.symbol}, ${where}.`,
        intents: [
          /* Two approves, because two tokens leave the wallet. Both authorise the
             position manager and not the router — a mint is not a swap, and an
             allowance to the wrong periphery contract reverts for want of one. */
          {
            kind: "approve",
            token: token0.address,
            spender: positionManager,
            amount: amount0,
            decimals: token0.decimals,
            symbol: token0.symbol,
          },
          {
            kind: "approve",
            token: token1.address,
            spender: positionManager,
            amount: amount1,
            decimals: token1.decimals,
            symbol: token1.symbol,
          },
          {
            kind: "mintPoolPosition",
            positionManager,
            token0: token0.address,
            token1: token1.address,
            decimals0: token0.decimals,
            decimals1: token1.decimals,
            symbol0: token0.symbol,
            symbol1: token1.symbol,
            fee,
            tickLower: ticks.tickLower,
            tickUpper: ticks.tickUpper,
            amount0,
            amount1,
            amount0Min: floors.amount0Min,
            amount1Min: floors.amount1Min,
            lowerPrice: ticks.lowerPrice,
            upperPrice: ticks.upperPrice,
            /* What we read a moment ago, for the confirmation row. The resolver
               re-reads the factory before signing rather than trusting it: a pool
               created by somebody else in between makes this stale in the
               direction that matters, because initialising an existing pool
               reverts. */
            createsPool: state === null,
            deadlineMin: opts.deadlineMin,
          },
        ],
      },
    };
  }

  /**
   * Adding to a position that already exists.
   *
   * The shape of this branch is set by one fact: the position, not the caller,
   * owns every decision a mint has to make. The pair, the tier and the range are
   * in storage, so there is no tier to pick, no range to derive and no factory to
   * check — and no `createsPool` case, because a position cannot exist without its
   * pool. What is left is deciding which of the position's two tokens each amount
   * belongs to, and setting a floor.
   *
   * IT MATCHES BY SYMBOL AGAINST THE POSITION, not by resolving the caller's words
   * through the token registry. The position's own `token0`/`token1` came off the
   * chain and are the authority on what this pool holds; the registry is a second
   * opinion that can only agree or be wrong. Matching against the position also
   * makes the failure legible — "that position holds USDC and WETH" names the two
   * tokens the caller can retry with, which "I don't know a token called X" does
   * not.
   *
   * The amounts come out of here in the POOL's order rather than the caller's,
   * which is the opposite of `provideLiquidity` and the reason
   * `increasePoolLiquidity`'s resolver does no sorting. See that kind in types.ts.
   */
  if (command.kind === "increasePosition") {
    const positionManager = contracts.v3PositionManager;
    if (!positionManager) {
      return {
        ok: false,
        error: "Liquidity positions aren't available on this chain yet.",
      };
    }

    const positions = await deps.positions();
    const pos = positions.find((p) => p.tokenId === String(command.positionId));
    if (!pos) {
      return {
        ok: false,
        error: `I can't find position #${command.positionId} in your wallet.`,
      };
    }

    /* Decimals are the hard requirement, not the symbol: they size what leaves
       the wallet, and a wrong scale is off by a factor of 10^12 on a 6-against-18
       pair. Refused rather than defaulted, the same bargain `undescribable`
       makes for a market row. */
    const dec0 = declaredDecimals(chainId, pos.token0);
    const dec1 = declaredDecimals(chainId, pos.token1);
    if (dec0 === undefined || dec1 === undefined) {
      return {
        ok: false,
        error: `Position #${pos.tokenId} holds a token this app has no declared decimals for, so I can't size a deposit into it accurately. Use the Positions page, which reads the token's own decimals on-chain.`,
      };
    }
    const sym0 = symbolForPoolToken(chainId, pos.token0);
    const sym1 = symbolForPoolToken(chainId, pos.token1);
    const pairLabel = `${sym0}/${sym1}`;

    /* Which word names which side.
     *
     * An exact symbol match — and a native name is refused rather than aliased
     * onto the wrapped leg. The mint branch above refuses native for a reason
     * that survives into an increase: what a position takes is the wrapped
     * token, and someone who asks to add ETH is quite likely holding only ETH.
     * Aliasing the word would build two approvals and a deposit that reverts
     * inside the periphery's `pay()` for want of a WETH balance, after the
     * approvals had been signed. Refusing names the wrapped token and the amount
     * to retry with, so the second attempt succeeds. One rule in both
     * directions: native value never enters a V3 position through here.
     *
     * The native test is guarded on the address really being this chain's
     * wrapped native rather than on the letter W, so an unrelated token whose
     * symbol happens to start with one cannot produce a wrap-it-first message
     * about a token that wraps nothing. */
    const wrapped = contracts.wrappedNative?.toLowerCase();
    const word = (w: string) => w.trim().toLowerCase();
    const names = (w: string, symbol: string) =>
      word(w) !== "" && word(w) === symbol.toLowerCase();
    const namesWrapped = (w: string, symbol: string, address: string) =>
      wrapped !== undefined &&
      address.toLowerCase() === wrapped &&
      word(w) !== "" &&
      `w${word(w)}` === symbol.toLowerCase();

    const sides = [
      { amount: command.amount0, word: command.symbol0 },
      { amount: command.amount1, word: command.symbol1 },
    ];

    for (const leg of [
      { symbol: sym0, address: pos.token0 },
      { symbol: sym1, address: pos.token1 },
    ]) {
      const asNative = sides.find((s) =>
        namesWrapped(s.word, leg.symbol, leg.address),
      );
      if (asNative) {
        return {
          ok: false,
          error: `Position #${pos.tokenId} holds ${leg.symbol}, not native ${word(asNative.word).toUpperCase()} — the position manager takes the wrapped token. Wrap it first, then add ${asNative.amount} ${leg.symbol}.`,
        };
      }
    }

    const forSide = (symbol: string) =>
      sides.find((s) => names(s.word, symbol));
    const side0 = forSide(sym0);
    const side1 = forSide(sym1);

    if (!side0 || !side1 || side0 === side1) {
      return {
        ok: false,
        error: `Position #${pos.tokenId} is a ${pairLabel} position, so it takes one amount of ${sym0} and one of ${sym1} — I was given ${command.symbol0 || "(nothing)"} and ${command.symbol1 || "(nothing)"}.`,
      };
    }

    /* The floor's inputs, and the one read this branch makes. `poolState` returns
       the price in the order the tokens were passed, which here is the pool's own
       order — so `state.price` needs no inversion.

       Null is refused rather than passed through as `spot: null`. mintMinimums
       reads a null spot as "this pool is about to be created" and derives the
       ratio from the two amounts themselves, which for an increase means taking
       the floor from what the caller typed instead of from the market — exactly
       the hole that function exists to close. A position whose pool cannot be
       read is a failed read, not a new pool - and a pool pinned at the far end
       of its own range is neither, so it is refused on the same grounds. */
    const state = await deps
      .poolState(pos.token0, pos.token1, pos.fee, dec0, dec1)
      .catch(() => null);
    if (!state || state.price === null) {
      return {
        ok: false,
        error: state
          ? `The ${pairLabel} ${pos.fee / 10_000}% pool has run to the far end of its price range: a trade took everything on one side of it, so there is no price left to set a slippage floor against. Adding here would be filled at that clamp.`
          : `I couldn't read the ${pairLabel} ${pos.fee / 10_000}% pool's current price, so I can't set a slippage floor for the deposit. Without one it would be accepted at any price.`,
      };
    }

    const floors = mintMinimums({
      amount0: side0.amount,
      amount1: side1.amount,
      decimals0: dec0,
      decimals1: dec1,
      /* The position's own range. Nothing here is chosen — adding to a position
         cannot move its bounds, so these are read, not derived. */
      tickLower: pos.tickLower,
      tickUpper: pos.tickUpper,
      spot: state.price,
      slippageBps: opts.slippageBps,
    });
    if ("error" in floors) return { ok: false, error: floors.error };

    const priced = (n: number) =>
      n >= 1000 ? n.toFixed(2) : n.toPrecision(6).replace(/\.?0+$/, "");
    const lowerPrice = tickToPrice(pos.tickLower, dec0, dec1);
    const upperPrice = tickToPrice(pos.tickUpper, dec0, dec1);

    return {
      ok: true,
      build: {
        summary: `Add ${side0.amount} ${sym0} and ${side1.amount} ${sym1} to ${pairLabel} #${pos.tokenId}, which earns between ${priced(lowerPrice)} and ${priced(upperPrice)} ${sym1} per ${sym0}.`,
        intents: [
          /* Two approves to the position manager, for the mint branch's reason:
             two tokens leave the wallet, and an allowance to the router would
             revert here for want of one. */
          {
            kind: "approve",
            token: pos.token0,
            spender: positionManager,
            amount: side0.amount,
            decimals: dec0,
            symbol: sym0,
          },
          {
            kind: "approve",
            token: pos.token1,
            spender: positionManager,
            amount: side1.amount,
            decimals: dec1,
            symbol: sym1,
          },
          {
            kind: "increasePoolLiquidity",
            positionManager,
            tokenId: pos.tokenId,
            token0: pos.token0,
            token1: pos.token1,
            decimals0: dec0,
            decimals1: dec1,
            symbol0: sym0,
            symbol1: sym1,
            amount0: side0.amount,
            amount1: side1.amount,
            amount0Min: floors.amount0Min,
            amount1Min: floors.amount1Min,
            fee: pos.fee,
            lowerPrice,
            upperPrice,
            pairLabel,
            deadlineMin: opts.deadlineMin,
          },
        ],
      },
    };
  }

  if (command.kind === "collectFees" || command.kind === "removePosition") {
    /* Bound to a local before the positions fetch, for both of the reasons the
       swap branch does it: there is no point paying for a network round trip on
       a chain that has no position manager to send the result to, and a local
       const is what narrows `string | undefined` to `string` for the three
       intents below — a property access would not survive the `await`. */
    const positionManager = contracts.v3PositionManager;
    if (!positionManager) {
      return {
        ok: false,
        error: "Liquidity positions aren't available on this chain yet.",
      };
    }

    const positions = await deps.positions();
    const pos = positions.find((p) => p.tokenId === String(command.positionId));
    if (!pos) {
      return {
        ok: false,
        error: `I can't find position #${command.positionId} in your wallet.`,
      };
    }
    const pairLabel = `${symbolForPoolToken(chainId, pos.token0)}/${symbolForPoolToken(chainId, pos.token1)}`;

    if (command.kind === "collectFees") {
      return {
        ok: true,
        build: {
          summary: `Collect fees on ${pairLabel} #${pos.tokenId}.`,
          intents: [
            {
              kind: "collectPoolFees",
              positionManager,
              tokenId: pos.tokenId,
              pairLabel,
            },
          ],
        },
      };
    }

    // removePosition: decreaseLiquidity, then collect — two intents, matching
    // how every other multi-step flow in this bus is modelled, so the user
    // reviews and signs each leg rather than one resolver silently sending two
    // transactions.
    //
    // The whole position unless a percentage was named. The share arithmetic and
    // the reasons for its rounding live in `shareOfLiquidity`, which
    // /pool/positions calls too — so a percentage typed at Luca and the same one
    // clicked on that page burn the identical amount, enforced by the call rather
    // than asserted by a comment on each copy.
    const percent = command.percent;
    if (percent !== undefined && (percent <= 0 || percent > 100)) {
      return {
        ok: false,
        error: `${percent}% isn't a share of a position — give something between 1 and 100.`,
      };
    }
    const liquidity =
      percent === undefined
        ? pos.liquidity
        : shareOfLiquidity(pos.liquidity, percent);
    if (BigInt(liquidity) <= 0n) {
      return {
        ok: false,
        error: `${percent}% of ${pairLabel} #${pos.tokenId} rounds to nothing — the position is too small to split that finely.`,
      };
    }
    const share =
      percent === undefined || percent === 100
        ? "all liquidity"
        : `${percent}% of the liquidity`;

    return {
      ok: true,
      build: {
        summary: `Remove ${share} from ${pairLabel} #${pos.tokenId}, then collect what's owed.`,
        intents: [
          {
            kind: "decreasePoolLiquidity",
            positionManager,
            tokenId: pos.tokenId,
            liquidity,
            pairLabel,
            /* Dropped at 100 as well as when absent, so a full removal is one
               intent shape however it was asked for. Carrying `percent: 100`
               would make the render say "100% of the liquidity" under a summary
               that says "all liquidity" — two statements of one fact, free to
               disagree, in the two lines a user actually reads before signing. */
            ...(percent === undefined || percent === 100 ? {} : { percent }),
          },
          {
            kind: "collectPoolFees",
            positionManager,
            tokenId: pos.tokenId,
            pairLabel,
          },
        ],
      },
    };
  }

  // repay
  const loans = await deps.loans();
  if (loans.length === 0) {
    return { ok: false, error: "You have no open loans to repay." };
  }

  const target = command.loanId
    ? loans.find((l) => l.requestId === command.loanId)
    : loans.length === 1
      ? loans[0]
      : undefined;

  if (!target) {
    return command.loanId
      ? {
          ok: false,
          error: `I can't find an open loan #${command.loanId}.`,
        }
      : {
          ok: false,
          error: `You have ${loans.length} open loans. Say which one, e.g. "repay ${loans[0].requestId}". Open: ${loans.map((l) => `#${l.requestId} (${l.totalRepayment} ${l.symbol})`).join(", ")}.`,
        };
  }

  const isNative = isLendingNative(target.tokenAddress);
  /* Decimals for the approve leg only, resolved from the loan's own token
     ADDRESS rather than its symbol, and refused rather than defaulted.
     `repayLoan` itself is ungated on-chain and sends `totalRepaymentRaw`, so
     nothing below needs a scale except the allowance.

     This was `toLendingCurrency(chainId, target.symbol)?.decimals ?? 18` — two
     defects in one line. The symbol lookup went through the offered currency
     list, which on Arc contains no entry for the registered WUSDC at all and
     two conflicting entries named USDC, so a loan in the token that chain
     actually lends resolved to nothing and took the default. And the default was
     18 against tokens that are overwhelmingly 6: it would have approved
     1,000,000× the intended allowance on a USDC loan — an over-approval to our
     own diamond, but still an allowance the user never agreed to. Rule 2 in
     constants/registry.ts: decimals are declared data, never inferred.

     Only checked on the ERC20 branch: a native repayment emits no approve, so
     refusing it for want of decimals it never uses would block a repayment the
     contract would accept — and blocking a repayment is the one refusal in this
     file that can cost the user their collateral. */
  const repayDecimals = declaredDecimals(chainId, target.tokenAddress);
  if (!isNative && repayDecimals === undefined) {
    return {
      ok: false,
      error: `Loan #${target.requestId} is denominated in a token this app doesn't have declared decimals for (${target.tokenAddress.slice(0, 6)}…${target.tokenAddress.slice(-4)}), so the approval amount can't be computed safely. Repay it from the Borrow page, which reads the token's decimals on-chain.`,
    };
  }
  return {
    ok: true,
    build: {
      summary: `Repay loan #${target.requestId} in full: ${target.totalRepayment} ${target.symbol}.`,
      intents: [
        ...(isNative
          ? []
          : ([
              {
                kind: "approve",
                token: target.tokenAddress,
                spender: diamond,
                amount: target.totalRepayment,
                decimals: repayDecimals,
                symbol: target.symbol,
              },
            ] as Intent[])),
        {
          kind: "repayLoan",
          diamond,
          requestId: target.requestId,
          amountRaw: target.totalRepaymentRaw,
          amount: target.totalRepayment,
          symbol: target.symbol,
          isNative,
        },
      ],
    },
  };
}

/*
 * Deliberately no value ceiling in this module.
 *
 * `maxPerAction` and `allowedActions` exist for *delegated* execution: the
 * grantAgentPermission flow lets Luca sign on the user's behalf, so the
 * on-chain AgentPermissionFacet needs a notional cap it can enforce without a
 * human present. A typed command is the opposite situation. The user wrote the
 * amount and signs it themselves in PlanReview, exactly as they would on the
 * Swap page — which caps nothing. Applying an agent ceiling here would restrict
 * someone from spending their own funds and make the chat inconsistent with the
 * form for no gain in safety, since the signature is the real gate.
 *
 * Now that /api/chat shares this builder, the distinction matters more rather
 * than less: a cap enforced here would silently apply to typed commands too.
 * Caps belong to the model path alone, which is why they live in ai/auditor.ts
 * and run on what this module returns.
 */

/** Guards against a malformed amount reaching ethers.parseUnits. */
export function isParsableAmount(amount: string, decimals: number): boolean {
  try {
    ethers.parseUnits(amount, decimals);
    return true;
  } catch {
    return false;
  }
}
