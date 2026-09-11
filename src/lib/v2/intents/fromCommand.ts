import type { IToken } from "@/constants/types/dex";
/* Type-only, so this module keeps the zero runtime dependencies its header
   claims — liquidity.ts imports ethers, and an erased import brings none of it. */
import type { RangeChoice } from "@/lib/dex/liquidity";

/**
 * Local command parser — the deterministic half of Luca.
 *
 * Counterpart to fromChat.ts. That one validates what a model proposed; this one
 * removes the model from the loop entirely for anything stated plainly enough to
 * execute. "swap 500 usdc to kld" is not a reasoning problem, and round-tripping
 * it through an LLM costs credits, latency, and a class of failure where the
 * model returns a *confident wrong number*. A grammar can only fail one way —
 * by not matching — and that failure is safe and legible.
 *
 * So the router runs local-first: parse here, and only escalate to a provider
 * when the input isn't a command at all ("what's my cheapest borrow?"). Missing
 * a single slot is not a reason to escalate either — we ask for it (see
 * `incomplete`), which is both cheaper and more predictable than inference.
 *
 * Pure and synchronous by design: no wallet, no network, no chain reads. It
 * turns text into a *typed command*, and the planner turns that into an Intent[]
 * once quotes are in hand. Keeping it pure is what makes it unit-testable.
 *
 * The token registry is a parameter rather than an import for two reasons: it
 * leaves this module with no runtime dependencies (so `node fromCommand.test.ts`
 * runs it directly, the same way accrual.test.ts works), and it stops the
 * grammar assuming one chain's token list, which it would have to unlearn the
 * moment swaps span chains.
 */

export interface SwapCommand {
  kind: "swap";
  amount: string;
  tokenIn: IToken;
  tokenOut: IToken;
}
export interface StakeCommand {
  kind: "stake";
  amount: string;
}
/**
 * The mirror of StakeCommand, and deliberately just as thin. The vault's unstake
 * is three transactions gated by a per-account cooldown, and which one applies
 * is a fact about chain state, not about the sentence — so this carries only
 * the amount and leaves the step to the planner, which reads the wallet's
 * cooldown (lib/staking/state.ts) and emits a request, a withdrawal, or a
 * refusal with the countdown. See the unstake branch in build.ts.
 */
export interface UnstakeCommand {
  kind: "unstake";
  amount: string;
}
export interface ApproveCommand {
  kind: "approve";
  amount: string;
  token: IToken;
}
/**
 * A plain wallet-to-wallet send — the counterpart to ReceiveCommand below, and
 * the only command in this grammar that ends in a call to no Kaleido contract.
 *
 * `to` keeps the case the user typed, which is not incidental. EIP-55 encodes an
 * address's checksum in the *case* of its hex digits, and normalise() lowercases
 * everything it touches. A lowercased address is a valid address with no
 * checksum left to verify — ethers.getAddress() accepts it without complaint —
 * so one mistyped digit would reach the signer unflagged and burn the funds.
 * See detectRecipient for how the case survives the parser.
 */
export interface SendCommand {
  kind: "send";
  amount: string;
  token: IToken;
  /** Recipient, `0x`-prefixed, case exactly as typed. */
  to: string;
}
/**
 * A cross-chain move — send's sibling, and the second command in this grammar
 * that ends in a call to no Kaleido contract.
 *
 * `toChain` is a free-text chain name, not an `IToken` and not resolved here.
 * Every token-carrying command matches against the `tokens` registry the caller
 * passes in; a chain has no such parameter, and resolving one would make this
 * module import a chain list and assume it — the exact coupling the header keeps
 * `tokens` a parameter to avoid. So the name travels untouched and the bridge
 * resolver (lib/bridge/route.ts) matches it against the real registry, refusing
 * an unknown one by name — the same contract the tool-call path's `toChain`
 * follows. Case is not load-bearing the way a recipient's is: the registry match
 * is case-insensitive, so unlike `to` above this need not survive normalise().
 */
export interface BridgeCommand {
  kind: "bridge";
  amount: string;
  token: IToken;
  /** Destination chain name, as typed (case-folded). Resolved downstream. */
  toChain: string;
}
export interface HelpCommand {
  kind: "help";
}
/**
 * Show the user their own deposit address.
 *
 * Sits beside `help` rather than in the VERBS table because it resolves to a
 * *panel*, not an Intent: there is no transaction, nothing to sign, and nothing
 * for the planner to build. It is the one command in this grammar that works
 * with no contract deployed anywhere.
 */
export interface ReceiveCommand {
  kind: "receive";
}
/**
 * Show the user what they hold.
 *
 * Beside `help` and `receive` for the same reason: it resolves to an *answer*,
 * not an Intent — there is nothing to sign and nothing for the planner to build.
 * The figures come from `usePortfolio` on the page, which is the hook /portfolio
 * itself renders, so the agent cannot quote a net value that page disagrees with.
 *
 * Worth saying why this is local at all, given the model has a `getPortfolio`
 * tool: that tool returns collateral and health only (see planDeps.ts), while the
 * hook stitches wallet balances, lending, borrowing, the stable vaults and LP
 * into one figure. So the local answer here is not a cheaper version of the
 * model's — it is the more complete one.
 */
export interface PortfolioCommand {
  kind: "portfolio";
}

/* The P2P family. Borrow and lend carry a rate and a term as well as an
 * amount, which is why the parser separates numbers by role rather than taking
 * them positionally. */
export interface BorrowCommand {
  kind: "borrow";
  amount: string;
  token: IToken;
  interestPct: number;
  days: number;
}
export interface LendCommand {
  kind: "lend";
  amount: string;
  token: IToken;
  interestPct: number;
  days: number;
}
export interface DepositCommand {
  kind: "deposit";
  amount: string;
  token: IToken;
}
export interface WithdrawCommand {
  kind: "withdraw";
  amount: string;
  token: IToken;
}
export interface RepayCommand {
  kind: "repay";
  /** Omitted when the user has exactly one open loan; the planner resolves it. */
  loanId?: number;
}
/** Draw against someone's listing. */
export interface TakeListingCommand {
  kind: "takeListing";
  listingId: number;
  amount: string;
}
/** Fund someone's borrow request. */
export interface FillRequestCommand {
  kind: "fillRequest";
  requestId: number;
}
/** Withdraw your own listing or request. */
export interface CancelCommand {
  kind: "cancel";
  target: "listing" | "request";
  id: number;
}

/* Stablecoin. Mint/redeem reuse the amount+token shape approve/deposit/
 * withdraw already use — "mint 500 usdc" and "deposit 500 usdc" are
 * structurally identical requests, just against a different contract. Lock and
 * unlock are amount-only, matching stake, because the app only ever locks
 * kfUSD and only ever unlocks kafUSD — there's nothing to disambiguate. */
export interface MintCommand {
  kind: "mint";
  amount: string;
  token: IToken;
}
export interface RedeemCommand {
  kind: "redeem";
  amount: string;
  token: IToken;
}
export interface LockCommand {
  kind: "lock";
  amount: string;
}
export interface UnlockCommand {
  kind: "unlock";
  amount: string;
}
export interface CompleteWithdrawalCommand {
  kind: "completeWithdrawal";
  token: IToken;
}
export interface ClaimYieldCommand {
  kind: "claimYield";
}
export interface CompoundYieldCommand {
  kind: "compoundYield";
}

/* Pool. All three act on an existing position by id — never a mint, which needs
 * a tick range the parser has no business inventing. */
export interface CollectFeesCommand {
  kind: "collectFees";
  positionId: number;
}
export interface RemovePositionCommand {
  kind: "removePosition";
  positionId: number;
  /**
   * How much of the position to withdraw, 1–100. Absent means all of it, which
   * is what the verb has always meant and what the Pool page's button does.
   *
   * NOT REACHABLE FROM THE GRAMMAR, deliberately, and this is the one field in
   * this file whose absence upstream is a decision rather than an omission.
   * "remove 50% of position 7" would have to tokenise a bare percentage, and
   * `detectRate` already owns that shape — it is how "lend at 6%" finds its
   * rate — so a percentage in a remove would be read as an interest rate by
   * whichever detector ran first. The tool carries it instead: a model that has
   * been told the argument exists can fill it unambiguously, and the local
   * grammar keeps meaning "all of it", which is the safe reading of a bare verb.
   */
  percent?: number;
}

/**
 * Add to a position that already exists.
 *
 * A second `ToolOnlyKind`, for `provideLiquidity`'s reason rather than a new one:
 * it carries two amounts and two tokens against a `Slot` union whose only amount
 * is `amount`, so a Draft cannot hold it half-specified. See ToolOnlyKind.
 *
 * `symbol0`/`symbol1` are bare words, not `IToken`s, and that is the difference
 * from `ProvideLiquidityCommand`. A mint's pair is whatever the caller names; an
 * increase's pair is already fixed by the position, so the builder's job is to
 * decide which of the position's two tokens each amount belongs to. It matches
 * the words against the pool's own `token0`/`token1` — read off the chain — which
 * means it also catches a symbol that names neither, by name, instead of
 * depositing the pair upside down.
 */
export interface IncreasePositionCommand {
  kind: "increasePosition";
  positionId: number;
  amount0: string;
  symbol0: string;
  amount1: string;
  symbol1: string;
}

/**
 * Open a new liquidity position.
 *
 * `range` is a *choice*, not a tick pair, and that distinction is what makes this
 * command safe to accept at all: a band's centre is read from the pool's own
 * slot0 by `lib/dex/liquidity.ts`, so nothing upstream of the builder ever names
 * a tick. See the pool section of intents/types.ts for the whole argument.
 *
 * `fee` is optional. Omitted means "whichever tier has a pool for this pair",
 * which the builder resolves by reading all three — the same shape as
 * RepayCommand's optional `loanId`, and for the same reason: a chain read is more
 * reliable than a caller recalling which tier exists.
 */
export interface ProvideLiquidityCommand {
  kind: "provideLiquidity";
  amount0: string;
  token0: IToken;
  amount1: string;
  token1: IToken;
  fee?: number;
  range: RangeChoice;
}

/**
 * Open the add-liquidity form, prefilled with whatever the sentence named.
 *
 * The counterpart to `ProvideLiquidityCommand` above, and the difference between
 * them is the whole reason this exists. That one is a *transaction*: two amounts,
 * a tier and a range, which is more than a `Draft` can hold half-specified (see
 * ToolOnlyKind) — so it stays tool-only, where the model can collect all of it in
 * one exchange. This one is a *handoff*. It builds nothing, signs nothing and
 * asks nothing; it points at /pool/new, which is the form that already collects
 * those four values, with both boxes visible and each deriving the other from the
 * range.
 *
 * Which is why every field is optional and none of them is ever asked for. The
 * form has its own pickers and its own defaults, so a bare "add liquidity" is a
 * complete request — it means "open that" — and a half-named pair is better
 * carried than interrogated. The alternative, four sequential slot questions to
 * assemble what one screen collects at once, is the version of this that would be
 * worse than the model rather than cheaper than it.
 *
 * Local because the sentence needs no reasoning: "add liquidity to KLD/USDC" is a
 * stated destination. It costs nothing, answers instantly and never reaches a
 * provider, which for the one product whose form is this good is the right trade.
 */
export interface OpenLiquidityCommand {
  kind: "openLiquidity";
  /** In the order named, not the pool's — /pool/new sorts its own pair. */
  token0?: IToken;
  token1?: IToken;
  /** A traded tier in bps, only when one was named as a percentage. */
  fee?: number;
}

/**
 * Claim a drip from the testnet faucet.
 *
 * `symbol` is a bare word, not an `IToken`, and that is the one thing about this
 * command worth reading twice. Every other token-carrying command here resolves
 * against the registry the caller passes in; the faucet's assets are not in it —
 * the mock USDT and USDe are in no chain's TOKENS list, and the mock USDC is
 * missing from two of the five. Resolving through the registry would therefore
 * refuse, by name, exactly the assets the faucet exists to hand out. The faucet
 * is its own authority on what it lists, so the word travels untouched and
 * buildIntents matches it against the faucet's own asset list.
 *
 * Omitted entirely when the user just said "faucet": the planner resolves it
 * when the faucet lists one asset and asks which otherwise, the same bargain
 * RepayCommand's optional `loanId` makes.
 */
export interface ClaimTestTokensCommand {
  kind: "claimTestTokens";
  /** Lowercased, as typed. Never a registry match — see above. */
  symbol?: string;
}

/**
 * A resting order: a limit order or a recurring buy, which are one struct apart.
 *
 * KaleidoOrders (#60) settles both. The difference is only the cadence:
 * `fills = 1, everyDays = 0` is a limit order; `fills = 8, everyDays = 7` is a
 * recurring buy. The grammar produces this; buildIntents resolves it against the
 * chain — the orders address, both tokens' decimals, and the `minOut` the price
 * implies — because none of those are things a sentence carries.
 *
 * PRICE IS THE HARD PART, and it is carried unresolved on purpose. `price` is
 * the number the user typed, and `basis` says which ratio it is, because English
 * does not: "buy 100 KLD at 0.02 USDC" prices the OUTPUT (0.02 USDC per KLD
 * bought), while "sell 100 KLD at 0.02 USDC" prices the INPUT. Inverting it here
 * would bake a guess into a decimal string that `minOutFor` then parses exactly —
 * so the guess is named instead, and buildIntents does the arithmetic with the
 * tested helper the limit page uses.
 *
 * `amount` is ALWAYS the input — what you spend per fill. KaleidoOrders commits
 * a fixed input and a `minOut` floor; it has no exact-output order, so "buy 100
 * KLD at a price" (a fixed OUTPUT) is not a thing the contract can sign and is
 * left to the model tool, which can convert and explain. The grammar takes the
 * input-framed order — "sell 500 KLD at 0.05 USDC", "dca 50 USDC into KLD" —
 * where `minOutFor` applies with no inversion and the arithmetic is exact.
 */
export interface PlaceOrderCommand {
  kind: "placeOrder";
  /** The token spent per fill. */
  tokenIn: IToken;
  /** The token received per fill. */
  tokenOut: IToken;
  /** The human amount spent per fill, in `tokenIn`. */
  amount: string;
  /** The limit price as typed, read according to `basis`. Absolute only. */
  price: string;
  /** `outPerIn` when the price is quote-per-output (a buy), else `inPerOut`. */
  basis: "outPerIn" | "inPerOut";
  /** Days between fills. 0 is a one-time limit order. */
  everyDays: number;
  /** How many times it may fill. 1 for a limit order. */
  fills: number;
  /** Days until the order stops being fillable. */
  expiryDays: number;
}

/**
 * Cancel every resting order the wallet has signed on this chain.
 *
 * Only the all-at-once form is grammar. Cancelling ONE order needs its whole
 * signed struct, which lives in the order store and not in any sentence — so
 * "cancel my KLD order" is left to the model tool (getOrders finds the struct;
 * see the follow-up PR), and this covers "cancel all my orders", the panic form,
 * which needs nothing but the wallet.
 */
export interface CancelOrdersCommand {
  kind: "cancelOrders";
}

export type Command =
  | SwapCommand
  | StakeCommand
  | UnstakeCommand
  | ApproveCommand
  | SendCommand
  | BridgeCommand
  | BorrowCommand
  | LendCommand
  | DepositCommand
  | WithdrawCommand
  | RepayCommand
  | TakeListingCommand
  | FillRequestCommand
  | CancelCommand
  | MintCommand
  | RedeemCommand
  | LockCommand
  | UnlockCommand
  | CompleteWithdrawalCommand
  | ClaimYieldCommand
  | CompoundYieldCommand
  | CollectFeesCommand
  | RemovePositionCommand
  | IncreasePositionCommand
  | ProvideLiquidityCommand
  | PlaceOrderCommand
  | CancelOrdersCommand
  | OpenLiquidityCommand
  | ClaimTestTokensCommand
  | HelpCommand
  | ReceiveCommand
  | PortfolioCommand;

/** Kinds resolved immediately, with no slot to ever ask about. */
type ZeroSlotKind = "claimYield" | "compoundYield";

/**
 * Kinds that carry only optional detail, so they are never half-specified.
 *
 * `openLiquidity` names up to a pair and a tier and is complete without any of
 * them — the form it opens owns every one of those choices. Excluded here rather
 * than given a `Slot`, because there is no question to ask: the answer to "which
 * pair?" is a picker on the next screen.
 */
type HandoffKind = "openLiquidity";

/**
 * Kinds that only ever arrive already complete, from a tool call.
 *
 * Two members, and neither is a gap left for later. Both carry two amounts and
 * two tokens against a `Slot` union whose token slots are
 * `tokenIn`/`tokenOut`/`token` and whose only amount is `amount`, so the draft
 * machinery cannot hold either half-specified without growing a second amount and
 * a second token that no other verb would use.
 *
 * Falling through to the model is the better path rather than the fallback one.
 * "add 300 KLD and 10 USDC to the KLD/USDC pool at 0.3%" reaches
 * `provideLiquidity` in the tool catalog, where the model collects both sides
 * conversationally and calls once with everything; a `VERBS` entry would instead
 * take "provide 100 usdt" into a Draft that can never be completed.
 * `increasePosition` is the same shape with the pair already fixed by the
 * position — "add 500 USDC and 0.3 ETH to position 48211" is four values and an
 * id.
 *
 * WHAT THIS IS NOT AN ARGUMENT FOR. It says the *transaction* cannot be
 * assembled here, and nothing about the request. "add liquidity to KLD/USDC"
 * names no amounts at all, so there is no draft to fail to complete — it is a
 * destination, and `openLiquidity` above takes it to the form that collects the
 * rest. The two coexist by amount: a sentence with the numbers in it is a plan
 * the model can build, a sentence without them is a screen this grammar can
 * open. See detectOpenLiquidity for where the line is drawn.
 *
 * Excluded here rather than given empty verb lists so the omission is stated,
 * not silent.
 */
type ToolOnlyKind = "provideLiquidity" | "increasePosition";

/**
 * Kinds parsed whole or not at all, by a dedicated detector rather than the
 * verb table, and with no generic slot to ask about.
 *
 * A resting order is a swap sentence carrying a price and maybe a cadence, so
 * it is recognised by `parseOrder` before the verb dispatch (a bare "sell 500
 * KLD" is still a swap). It resolves only when fully specified - pair, amount
 * and price all present - and otherwise falls through to the model, which can
 * collect a missing price conversationally and handles the output-framed buy
 * the contract cannot sign. So there is no half-order to hold in a Draft, which
 * is why these are excluded here rather than given a `price` slot: the slot
 * machinery exists to ASK, and this grammar does not ask about an order, it
 * either reads one or declines it. `cancelOrders` is the all-at-once cancel,
 * which needs nothing to complete.
 */
type SpecialParsedKind = "placeOrder" | "cancelOrders";

/** Kinds that carry slots, i.e. everything that can be half-specified. */
export type ActionKind = Exclude<
  Command["kind"],
  "help" | "receive" | "portfolio" | ZeroSlotKind | ToolOnlyKind | HandoffKind
  | SpecialParsedKind
>;

export type Slot =
  | "amount"
  | "tokenIn"
  | "tokenOut"
  | "token"
  | "recipient"
  | "toChain"
  | "rate"
  | "days"
  | "ref";

/** A command mid-collection. Survives across turns while slots get filled. */
export interface Draft {
  kind: ActionKind;
  amount?: string;
  tokenIn?: IToken;
  tokenOut?: IToken;
  token?: IToken;
  /** Send recipient. Case-sensitive — see SendCommand. */
  to?: string;
  /** Bridge destination chain name, as typed. Resolved downstream. */
  toChain?: string;
  interestPct?: number;
  days?: number;
  loanId?: number;
  /** Which row a command points at, e.g. listing 3, or position 42. */
  refTarget?: "listing" | "request" | "position";
  refId?: number;
  /**
   * A symbol the sentence nearly named. Offered, never applied: the draft
   * still has the empty slot, and this is only what the question quotes and
   * what "yes" answers. See `findNearMiss` and `fillSlot`.
   */
  suggest?: { token: IToken; typed: string };
}

export type ParseResult =
  | { status: "ok"; command: Command }
  /** Understood the verb, still missing a slot. Ask, don't guess, don't escalate. */
  | { status: "incomplete"; draft: Draft; missing: Slot; prompt: string }
  /** Not a command. This is the only case that should reach a model. */
  | { status: "unknown" };

/* ------------------------------------------------------------------ verbs -- */

/**
 * Verb synonyms. Deliberately a fixed list rather than fuzzy matching: a near
 * miss on a money verb should fall through to the model, not resolve to the
 * closest guess.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * Four words people do type, each absent for its own reason, written down so the
 * next reader does not have to decide whether they were forgotten:
 *
 * - "add liquidity" — a verb entry would take "provide 100 usdt" into a Draft
 *   that can never be completed, because `provideLiquidity` needs two amounts and
 *   `Slot` has one. The sentence is not unhandled, though: it is claimed ahead of
 *   verb detection by `detectOpenLiquidity`, which opens the form rather than
 *   building the transaction. A *priced* request — both amounts named — still
 *   falls to the model and its tool. See ToolOnlyKind.
 * - "unstake" — CLOSED. It sat here for a while because the vault's unstake is
 *   three cooldown-gated transactions and a verb that built a Draft the planner
 *   could not plan would fail after the user had answered a question about it.
 *   It has a verb now because the planner can choose the step: it reads the
 *   wallet's cooldown state (lib/staking/state.ts) and emits the one that
 *   applies. "withdraw my stake" still reads as a collateral withdrawal — the
 *   `withdraw` verb wins that sentence — which is the remaining seam.
 * - "wrap" / "unwrap" — no intent exists, so the model's answer (which can send
 *   the user to the right control) beats a local dead end.
 * - "pay" — see `send` below. Two readings, one of them a repayment.
 *
 * Wrap/unwrap is a gap in the *protocol* surface, not in this grammar, and
 * closing it starts with an intent, a builder and an auditor rule — the same
 * three things unstake needed. Liquidity was never one of those: the intent, the
 * builder and the rule all exist, and the form does too — which is what made the
 * handoff the cheaper half to close first.
 */
const VERBS: Record<ActionKind, string[]> = {
  /* "buy" (and its degen synonyms below) is here rather than absent, and these
     are the verbs in this list that change what the sentence means — see
     parseSwap, which inverts the sides for them. "sell my KLD" spends KLD; "buy
     KLD" receives it. The set that inverts is BUY_WORDS. */
  swap: [
    "swap", "trade", "convert", "exchange", "sell", "buy", "purchase",
    /* Degen synonyms, so Luca reads the room a trader types in and not only the
       textbook verb. Two directions, kept straight below in BUY_WORDS: "dump"
       and "unload" spend the token you name (like "sell"); "ape", "cop", "grab"
       and "snag" receive it (like "buy"). "flip" and "yeet" read forward like
       "swap"/"convert" — spend the first token named — so they stay out of
       BUY_WORDS. None collides with a token symbol on any of the five chains, and
       the buy-side ones are safe even when a phrasing is genuinely ambiguous —
       parseSwap's guard asks which token to spend rather than guessing a trade. */
    "dump", "unload", "ape", "cop", "grab", "snag", "flip", "yeet",
  ],
  stake: ["stake"],
  /* One word, matched whole, so "unstake" never reads as the `stake` verb with
     a prefix — VERBS matches words, not substrings. */
  unstake: ["unstake"],
  approve: ["approve", "allow"],
  /* No "pay". "pay back my loan" and "pay off my loan" are repayments, and a
     money verb with two readings is precisely what the note above says should
     fall through to the model rather than resolve to the closer guess. "send"
     and "transfer" have one reading each. */
  send: ["send", "transfer"],
  /* One reading, like send. "bridge" as a money verb means exactly one thing —
     move value to another chain — so it resolves locally rather than falling
     through to the model the way a two-reading verb would. */
  bridge: ["bridge"],
  borrow: ["borrow"],
  lend: ["lend", "supply", "offer"],
  deposit: ["deposit", "collateralise", "collateralize"],
  withdraw: ["withdraw"],
  repay: ["repay", "payback"],
  takeListing: ["take", "draw"],
  fillRequest: ["fill", "fund"],
  cancel: ["cancel"],
  mint: ["mint"],
  redeem: ["redeem"],
  lock: ["lock"],
  unlock: ["unlock"],
  completeWithdrawal: ["complete"],
  collectFees: ["collect"],
  removePosition: ["remove"],
  /* One word, and a noun rather than a verb, because there is no verb anyone
     uses for this — "faucet", "faucet usdt" and "use the faucet" all read the
     same way. It carries one optional slot but never becomes a Draft: see the
     branch in parseCommand. */
  claimTestTokens: ["faucet"],
};

/** Verbs with no slots at all — resolved without touching the draft machinery. */
const ZERO_SLOT_VERBS: Record<ZeroSlotKind, string[]> = {
  claimYield: ["claim"],
  compoundYield: ["compound"],
};

/**
 * Words that follow "faucet" without naming an asset.
 *
 * Ticker-shaped, so the pattern alone lets them through, and each one would
 * otherwise produce "the faucet doesn't list please" — a refusal about a word
 * the user never meant as a token. Deliberately short: this is not an attempt at
 * English, only at the handful of fillers that actually trail the noun.
 */
const FAUCET_FILLERS = new Set([
  "me",
  "us",
  "please",
  "now",
  "token",
  "tokens",
  "drip",
]);

/**
 * Words that mean "every asset that's due" where a faucet ticker would go.
 *
 * Lives here rather than in build.ts, which is where it used to and where it is
 * acted on, because the parser now needs it too: it is the one non-ticker word
 * the faucet branch will accept from anywhere in the sentence, so "claim
 * everything from the faucet" resolves the same way "faucet all" does. Two
 * copies of the set would have drifted the first time a fourth word was added,
 * and the direction of the import is the safe one — build.ts already depends on
 * this module, and this module has no runtime dependencies for it to acquire.
 *
 * Small on purpose. It is only ever consulted after a real symbol match has
 * failed, so the cost of a missing word is the existing refusal that names the
 * asset list — never a wrong transaction.
 */
export const ALL_WORDS = new Set(["all", "everything", "every"]);

const HELP_WORDS = ["help", "commands", "what can you do", "how do i use"];

/**
 * Phrases that open the receive panel. Matched as a *leading* phrase only, the
 * same way HELP_WORDS is, and that restriction is the whole design.
 *
 * "receive" is ordinary trading English — "how much KLD will I receive", "the
 * token you receive" — so the `words.some(...)` scan that ZERO_SLOT_VERBS uses
 * would hijack genuine questions before they ever reached the FAQ or the model.
 * A command has to be *stated*, and a stated command leads with its verb.
 *
 * "deposit address" earns its place here despite `deposit` being a lending verb
 * (see VERBS below), because this list is checked ahead of verb detection.
 * Without it, asking for a deposit address parses as collateral and Luca
 * replies "how much?". "deposit 500 USDC" is unaffected: it does not lead with
 * the phrase.
 */
const RECEIVE_PHRASES = [
  "receive",
  "deposit address",
  "my address",
  "my wallet address",
  "wallet address",
  "show my address",
  "qr",
  "qr code",
];

/**
 * Phrases that resolve to a portfolio read.
 *
 * Matched anywhere in the sentence, unlike RECEIVE_PHRASES — and the thing that
 * makes that safe is *where* the check runs, not how the list is written. It sits
 * after verb detection has already failed, so a request naming any action at all
 * has been claimed by that action before it can get here. "sell my balance of
 * KLD" is a swap; "what's my balance" is this. The rule is one sentence: a
 * request that names no action, and names the user's own holdings, is a read.
 *
 * Possessive on purpose. Bare "balance" and bare "positions" are ordinary trading
 * English — "the balance after the swap", "positions go out of range" — and they
 * arrive inside questions the FAQ answers better ("why is my balance 0" is a
 * funding question, not a portfolio one, and it is question-shaped so it never
 * reaches this file). The three bare nouns below are matched by equality instead,
 * because as a whole request they mean only one thing.
 */
const PORTFOLIO_PHRASES = [
  "my balance",
  "my portfolio",
  "my position",
  "my holdings",
  "my net worth",
  "my assets",
  "my funds",
  "what do i have",
  "what do i own",
  "what am i holding",
  "how much do i have",
  "how much have i got",
  /* "do I have any KLD", "do I have any positions" — the same question asked as a
     yes/no. Safe for the same reason the rest are: nothing here states an action,
     and anything that does was claimed by its verb before this ran. */
  "do i have any",
];

/** Whole requests that mean this and nothing else. Compared, not searched. */
const PORTFOLIO_ALONE = [
  "balance",
  "balances",
  "portfolio",
  "positions",
  "holdings",
  "net worth",
];

/**
 * The one family that reaches this check and must not be answered by it.
 *
 * "add liquidity to my portfolio" names no verb in the table below and would
 * otherwise land on the read — a request to *do* something, answered with a
 * balance sheet. Anything naming liquidity or a pool keeps its path onward.
 *
 * Still a veto now that `detectOpenLiquidity` claims most of this family, and the
 * remainder is exactly why it stays: that detector needs an opening word as well
 * as the noun, so "how much liquidity do I have" passes straight through it — and
 * without this set it would land here instead, on a read that answers a fair
 * question about pools with a wallet balance. The cost is stated rather than
 * hidden: that sentence reaches the model and spends a reasoning request. It is
 * the right direction to fail in, because the model can answer it and a wrong
 * local answer about someone's positions cannot be taken back by the reader.
 */
const PORTFOLIO_VETO = new Set(["liquidity", "lp", "pool", "pools"]);

/**
 * Words that make a sentence an ACTION even though the verb table does not know
 * them, so the portfolio read must not claim it.
 *
 * The read runs last, on the reasoning that anything stating an action was
 * already claimed by its verb. That held until a tester typed "move 30% of my
 * portfolio to the best yield" and got a balance card: "move" is not a `swap`
 * or a `send`, so detectVerb returned null and the read swallowed a request to
 * MOVE funds. These are the movement verbs the grammar has no intent for - they
 * need the model (a percentage of a live balance, a venue chosen by yield), so
 * the read declines and the sentence carries on rather than being mis-answered
 * as a balance sheet. None of them appears in a plain "what do I have".
 */
const PORTFOLIO_ACTION_VETO = new Set([
  "move", "put", "shift", "allocate", "rebalance", "deploy", "invest", "rotate",
]);

/* ------------------------------------------------------- open liquidity -- */

/**
 * Nouns that make a sentence about a liquidity position rather than a balance.
 *
 * Shares its members with PORTFOLIO_VETO above, which is not a coincidence worth
 * de-duplicating: that set exists to stop these words reaching a *read*, and this
 * one to route them to a *screen*. The same four words, for two reasons that
 * could diverge — a fifth noun worth opening the form for is not automatically a
 * fifth noun worth withholding a balance sheet from.
 */
const LIQUIDITY_NOUNS = new Set(["liquidity", "lp", "pool", "pools"]);

/**
 * Words that make it a request to *open* one.
 *
 * The noun alone is not enough and never was — "swap 100 KLD in the KLD/USDC
 * pool" is a swap, "what is a liquidity pool" is a question — so a match needs
 * one word from each set. That pairing is the whole safety property here, and it
 * is what keeps this detector from swallowing the sentences PORTFOLIO_VETO
 * protects.
 *
 * "lp" is in both sets deliberately, which does make the pairing vacuous for that
 * one word. It earns it by having no second reading: nobody types "lp" to mean
 * anything but providing liquidity, so "lp into KLD/USDC" is as stated a request
 * as this grammar ever sees. "remove my lp" is not a counter-example — the
 * removal guard below claims it first.
 *
 * "deposit" and "supply" are here despite being lending verbs, and this detector
 * running ahead of `detectVerb` is what lets them be: "deposit into the KLD/USDC
 * pool" is not collateral. LENDING_NOUNS is the other half of that bargain.
 */
const OPEN_WORDS = new Set([
  "add",
  "provide",
  "open",
  "create",
  "new",
  "start",
  "make",
  "seed",
  "supply",
  "deposit",
  "put",
  "lp",
]);

/**
 * Words that mean the opposite, or mean an existing position.
 *
 * "remove liquidity", "withdraw from the pool", "collect fees on my LP" are all
 * `removePosition`/`collectFees` requests that contain a liquidity noun, and
 * several contain an opening word too ("take out", "close out"). Falling through
 * hands them to the verb table, which already resolves them properly against a
 * position id — the one place this detector must not be greedy, because sending
 * someone to a *deposit* form when they asked to withdraw is not a near miss.
 */
const CLOSING_WORDS = new Set([
  "remove",
  "withdraw",
  "exit",
  "close",
  "pull",
  "collect",
  "unwind",
  "decrease",
  "reduce",
  "burn",
  "redeem",
]);

/**
 * Words that make "pool" mean the lending book instead.
 *
 * "deposit USDC into the lending pool" pairs an opening word with a liquidity
 * noun and means collateral, so without this it would open the wrong form. The
 * list is the vocabulary of the other product, not an attempt at English.
 */
const LENDING_NOUNS = new Set([
  "collateral",
  "collateralise",
  "collateralize",
  "borrow",
  "borrowing",
  "loan",
  "loans",
  "lending",
  "debt",
  "health",
]);

/**
 * The three traded tiers, as the percentages people say them in.
 *
 * Both spellings of each, because "0.3%" and "0.30%" are the same tier and a
 * reader who types the second should not silently get the default. Anything else
 * is ignored rather than refused: an unrecognised tier means the form opens on
 * its own picker, which is a working outcome, where an error about a fee would
 * block a request that never needed to name one.
 */
const FEE_TIER_BY_PERCENT: Record<string, number> = {
  "0.05": 500,
  "0.050": 500,
  "0.3": 3000,
  "0.30": 3000,
  "1": 10_000,
  "1.0": 10_000,
  "1.00": 10_000,
};

/**
 * "add liquidity to KLD/USDC" → the form, prefilled. See OpenLiquidityCommand.
 *
 * Runs ahead of `detectVerb` so the lending verbs in OPEN_WORDS cannot claim
 * these sentences first, and after `detectRef` so a position reference can veto
 * it: "add 500 USDC to position 42" is an increase, which is the model's, and
 * pointing that at a blank new-position form would lose the position the sentence
 * named.
 *
 * `priced` is the other veto and the more interesting one. A number anywhere in
 * the sentence means it is a transaction rather than a destination, and the
 * model's `provideLiquidity` tool can build it in full — where this branch would
 * open a form with no amount field to carry it into, silently dropping a figure
 * the user typed. So the line between the two paths is arithmetic: name a number
 * and it is a plan, name none and it is a screen. "0.3%" is not a number by this
 * test, because parseAmount rejects the trailing sign — which is what lets a tier
 * be named without turning the request into a priced one.
 */
function detectOpenLiquidity(
  words: string[],
  ctx: { hasPositionRef: boolean; priced: boolean },
): { fee?: number } | null {
  if (ctx.hasPositionRef || ctx.priced) return null;
  if (!words.some((w) => LIQUIDITY_NOUNS.has(w))) return null;
  if (!words.some((w) => OPEN_WORDS.has(w))) return null;
  if (words.some((w) => CLOSING_WORDS.has(w) || LENDING_NOUNS.has(w))) {
    return null;
  }

  /* A tier only when it was written as a percentage. The bare "3000" that names
     the same tier in the tool catalog is a number here, and a number in this
     sentence is far more likely to be an amount. */
  for (const word of words) {
    if (!word.endsWith("%")) continue;
    const tier = FEE_TIER_BY_PERCENT[word.slice(0, -1)];
    if (tier !== undefined) return { fee: tier };
  }
  return {};
}

/** Words separating the two sides of a swap. */
const SEPARATORS = ["to", "for", "into", "->", "→", ">"];

/**
 * The verbs that name the token being *received* rather than the one being spent.
 *
 * Every other word in `VERBS.swap` reads left to right — "swap USDC for KLD",
 * "sell KLD for USDC" — and these read right to left. "for" appears in both
 * lists below with opposite meanings for exactly that reason: `swap A for B`
 * spends A, `buy A for B` spends B. Getting that backwards is not a near miss,
 * it is the opposite trade, which is why this is a flag through parseSwap and not
 * more entries in the verb table.
 *
 * The degen synonyms sit here too: "ape into KLD", "cop KLD", "grab KLD", "snag
 * KLD" all name what comes back, the same right-to-left reading as "buy". Where
 * such a phrasing is ambiguous — "ape 500 USDC into KLD" reads forward — parseSwap
 * refuses to guess and asks which token to spend, so a synonym can never invert a
 * trade behind the user's back.
 */
const BUY_WORDS = new Set(["buy", "purchase", "ape", "cop", "grab", "snag"]);

/** Separators that run backwards under a buy: "buy KLD with 500 USDC". */
const BUY_SEPARATORS = ["with", "using", "for", "->", "→", ">"];

/**
 * …and the one that still runs forwards: "buy 500 USDC of KLD" spends the USDC.
 *
 * Checked only after the backward list, and only under a buy, so "of" has no
 * effect on any other sentence in the grammar.
 */
const BUY_FORWARD_SEPARATORS = ["of"];

/* ---------------------------------------------------------------- amounts -- */

/**
 * Accepts 500, 1,000, 0.5, 1k, 2.5m. Returns a canonical decimal string so the
 * value handed to ethers.parseUnits never carries a separator or suffix.
 *
 * Deliberately string arithmetic, with no `Number` anywhere in it. Money typed
 * as text is exact and a double is not: `Number("0.1").toFixed(18)` is
 * "0.100000000000000006" and `Number("0.3").toFixed(18)` is
 * "0.299999999999999989", so routing through a float turns "send 0.1 USDC" into
 * a quantity USDC cannot express — refused by the builder's precision check with
 * a message about a number the user never typed — and every 18-decimal amount
 * into one that is a few wei off what was asked for and reads as noise on the
 * confirmation row.
 *
 * So the k/m suffix moves the decimal point by three or six places rather than
 * multiplying, which is also why the exponent-notation hazard the previous
 * implementation's comment named is gone rather than merely deferred: a value at
 * or above 1e21 is where `toFixed` starts returning "1e+21", and there is no
 * float here to hand one back.
 */
function parseAmount(raw: string): string | null {
  const m = raw.match(/^([\d,]*\.?\d+)\s*([km])?$/i);
  if (!m) return null;

  const digits = m[1].replace(/,/g, "");
  const dot = digits.indexOf(".");
  let whole = dot === -1 ? digits : digits.slice(0, dot);
  let frac = dot === -1 ? "" : digits.slice(dot + 1);

  const shift =
    m[2]?.toLowerCase() === "k" ? 3 : m[2]?.toLowerCase() === "m" ? 6 : 0;
  if (shift) {
    /* Pad first: "2.5m" has one fractional digit and needs six, and borrowing
       from a fraction that has run out is what a multiply would have hidden. */
    const padded = frac.padEnd(shift, "0");
    whole += padded.slice(0, shift);
    frac = padded.slice(shift);
  }

  whole = whole.replace(/^0+/, "");
  frac = frac.replace(/0+$/, "");
  // Zero in any spelling — "0", "0.0", "0.000k" — is not an amount.
  if (!whole && !frac) return null;
  return frac ? `${whole || "0"}.${frac}` : whole;
}

/* ----------------------------------------------------------------- tokens -- */

function findToken(word: string, tokens: IToken[]): IToken | undefined {
  const w = word.toLowerCase();
  return tokens.find(
    (t) => t.symbol.toLowerCase() === w || t.name.toLowerCase() === w,
  );
}

interface Mention {
  token: IToken;
  index: number;
}

/** Longest token name in the registry, in words. Bounds the phrase window. */
const MAX_NAME_WORDS = 3;

/**
 * Scans left to right taking the longest match at each position, so a
 * multi-word name ("USD Coin") wins over a shorter prefix and over the bare
 * word that follows it. Single-word scanning silently failed on every token
 * whose name has a space in it.
 */
function findTokenMentions(words: string[], tokens: IToken[]): Mention[] {
  const out: Mention[] = [];
  let i = 0;
  while (i < words.length) {
    let hit: { token: IToken; length: number } | null = null;

    for (
      let len = Math.min(MAX_NAME_WORDS, words.length - i);
      len >= 1;
      len--
    ) {
      const token = findToken(words.slice(i, i + len).join(" "), tokens);
      if (token) {
        hit = { token, length: len };
        break;
      }
    }

    if (hit) {
      out.push({ token: hit.token, index: i });
      i += hit.length;
    } else {
      i++;
    }
  }
  return out;
}

/* ----------------------------------------------------------------- prompts -- */

const PROMPTS: Record<Slot, string> = {
  amount: "How much?",
  tokenIn: "Which token do you want to spend?",
  tokenOut: "Which token do you want to receive?",
  token: "Which token?",
  recipient: "Which address should it go to? (0x…)",
  toChain: "Which chain should it go to? (e.g. Base Sepolia)",
  rate: "What interest rate? (e.g. 8%)",
  days: "Over what term? (e.g. 30 days)",
  ref: "Which one? For example: listing 3, request 7, or position 42.",
};

/**
 * Asks for the one slot that is missing.
 *
 * When the draft carries a near miss and the missing slot is the token slot it
 * belongs to, the question names the guess instead of asking the generic one.
 * That is the whole saving: "did you mean USDC?" is answerable with "yes",
 * which `fillSlot` reads locally, where the generic re-ask sends people back to
 * retyping a sentence that the model then has to parse.
 *
 * A suggestion never survives onto a non-token question. It would be quoting a
 * symbol at someone who was asked for an amount, and worse, "yes" would then
 * have a meaning it was never offered.
 */
function incomplete(draft: Draft, missing: Slot): ParseResult {
  const naming =
    missing === "tokenIn" || missing === "tokenOut" || missing === "token";

  if (draft.suggest && naming) {
    return {
      status: "incomplete",
      draft,
      missing,
      prompt: `I don't know "${draft.suggest.typed}" — did you mean ${draft.suggest.token.symbol}?`,
    };
  }

  return {
    status: "incomplete",
    draft: draft.suggest ? { ...draft, suggest: undefined } : draft,
    missing,
    prompt: PROMPTS[missing],
  };
}

/* ------------------------------------------------------------------ parse -- */

function normalise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s.,%>→-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Words that make "fund" mean the user's own balance rather than someone's row.
 *
 * "fund" is fillRequest's verb and also the plain English for putting money into
 * your own wallet. So "fund my wallet" was answered "Which one? For example:
 * listing 3, request 7…" — the parser asking a confident question about a
 * marketplace the user never mentioned. Not a wrong transaction, but a wrong
 * question, and it shadowed the funding answer the FAQ already had.
 *
 * The discriminator is whose thing is named: a fill always points at someone
 * else's row, so a self-word directly after the verb, with no row referenced
 * anywhere, means this sentence is about the user's own balance. Both conditions
 * are needed — "fund my request 7" names a row and still fills it, and "fund 500
 * USDC" is a fill missing its row, which is worth asking about.
 *
 * Declining is all this does. There is nothing to build here either: on a testnet
 * the answer is the faucet, and the faucet needs an asset this sentence does not
 * name. Falling through reaches the FAQ, which has the two-step funding answer
 * and a chip that builds the claim.
 */
const SELF_WORDS = new Set(["my", "me", "mine", "our", "us", "myself"]);

function detectVerb(
  words: string[],
  ctx: { hasRef: boolean },
): { kind: ActionKind; at: number } | null {
  for (let i = 0; i < words.length; i++) {
    for (const kind of Object.keys(VERBS) as ActionKind[]) {
      if (!VERBS[kind].includes(words[i])) continue;
      // See SELF_WORDS.
      if (
        words[i] === "fund" &&
        !ctx.hasRef &&
        SELF_WORDS.has(words[i + 1] ?? "")
      ) {
        continue;
      }
      return { kind, at: i };
    }
  }
  return null;
}

/**
 * First parseable amount, skipping positions already claimed by another role.
 *
 * "borrow 500 usdc at 8% for 30 days" contains three numbers. Rate and term are
 * extracted first and their indices excluded here, so the amount can't be read
 * off the interest rate — which would be a silent, expensive mistake.
 */
function detectAmount(
  words: string[],
  claimed: Set<number> = new Set(),
): { amount: string; index: number } | null {
  for (let i = 0; i < words.length; i++) {
    if (claimed.has(i)) continue;
    const amount = parseAmount(words[i]);
    if (amount) return { amount, index: i };
  }
  return null;
}

/* -------------------------------------------------------------- recipient -- */

/*
 * A 40-hex-digit address at the start of a word.
 *
 * Not anchored at the end, because normalise() keeps `.` and `,` — they belong
 * to amounts like "1,000.50" — so a trailing comma or full stop stays glued to
 * the address. The lookahead is what makes that safe to allow: a *longer* hex
 * run matches nothing at all rather than being truncated to its first 40 digits,
 * which would send to a different address than the one typed.
 */
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/;

/**
 * The same pattern for reading the address out of the raw text.
 *
 * The prefix is case-insensitive here where the word-side pattern's is not: the
 * word has already been lowercased, the raw text has not, and some tools emit
 * `0X`. Only the prefix is folded, and only to `0x`, which is checksum-neutral —
 * EIP-55 hashes the 40 hex digits alone, and ethers requires the prefix in
 * lowercase. Do not extend this to the digits; their case *is* the checksum.
 */
const ADDRESS_IN_TEXT = /0[xX][0-9a-fA-F]{40}(?![0-9a-fA-F])/;

/** How many addresses were typed. Two is an ambiguity, not a recipient list. */
function countAddresses(words: string[]): number {
  return words.filter((w) => ADDRESS_RE.test(w)).length;
}

/**
 * The recipient of a send, with its case intact.
 *
 * The lowercased word array locates it; the value comes back out of the raw
 * text. That split is the entire point — see SendCommand: reading the recipient
 * off `words` would hand downstream an address whose checksum has already been
 * erased, and there is no later stage that can recover it.
 *
 * Taking the first match from each side stays aligned because normalise()
 * neither reorders nor merges words, and every character of an address is a word
 * character, so an address in the text is always exactly one word.
 */
function detectRecipient(
  words: string[],
  text: string,
): { to: string; index: number } | null {
  const index = words.findIndex((w) => ADDRESS_RE.test(w));
  if (index === -1) return null;
  const cased = text.match(ADDRESS_IN_TEXT);
  return cased ? { to: `0x${cased[0].slice(2)}`, index } : null;
}

/** Percent-suffixed ("8%") or introduced by "at"/"apr"/"interest". */
function detectRate(
  words: string[],
): { pct: number; claimed: number[] } | null {
  for (let i = 0; i < words.length; i++) {
    const pctMatch = words[i].match(/^(\d+(?:\.\d+)?)%$/);
    if (pctMatch) return { pct: Number(pctMatch[1]), claimed: [i] };

    if (["at", "apr", "interest", "rate"].includes(words[i]) && words[i + 1]) {
      const bare = words[i + 1].match(/^(\d+(?:\.\d+)?)%?$/);
      if (bare) return { pct: Number(bare[1]), claimed: [i + 1] };
    }
  }
  return null;
}

/**
 * Row reference: "listing 3", "request #7", "offer 12", "position 42".
 *
 * Its number is claimed like a rate or a term, so "borrow 500 from listing 3"
 * can't read the amount off the listing id. Requiring the noun is what lets
 * "remove" and "collect" stay unambiguous too — "remove 42" alone could be
 * almost anything, but "remove position 42" cannot.
 */
function detectRef(words: string[]): {
  target: "listing" | "request" | "position";
  id: number;
  claimed: number[];
} | null {
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const target =
      w === "listing" || w === "listings" || w === "offer"
        ? ("listing" as const)
        : /* "borrower"/"borrowers" fund a borrow REQUEST - a tester funded one
             with "fund borrower 7" and got asked which request, because only the
             mechanism word ("request") was recognised, not the person the request
             belongs to. Filling a request IS funding its borrower. */
          w === "request" ||
            w === "requests" ||
            w === "borrower" ||
            w === "borrowers"
          ? ("request" as const)
          : w === "position" || w === "positions"
            ? ("position" as const)
            : null;
    if (!target) continue;

    // Accept the id on either side: "listing 3" and "3 listing" both read.
    for (const j of [i + 1, i - 1]) {
      const id = words[j]?.match(/^#?(\d+)$/);
      if (id) return { target, id: Number(id[1]), claimed: [i, j] };
    }
    return { target, id: NaN, claimed: [i] };
  }
  return null;
}

const DAY_UNITS: Record<string, number> = {
  day: 1,
  days: 1,
  week: 7,
  weeks: 7,
  month: 30,
  months: 30,
  year: 365,
  years: 365,
};


/* Words that mark a swap sentence as a resting order rather than a spot trade. */
const ORDER_MARKERS = ["limit", "resting", "gtc"];

/* A recurring cadence. Present means v1 declines to the model - a schedule needs
   a fill count the grammar does not yet read, and the model handles it. */
const RECURRING = /\b(every|each|daily|weekly|monthly|recurring|dca|repeat)\b/;

/**
 * A resting limit order, or the all-at-once cancel. Everything else returns null
 * and the sentence carries on to the normal parser and the model backstop.
 *
 * SCOPE, STATED SO THE GAP IS NOT MISTAKEN FOR A BUG. Only the SELL-framed,
 * single-fill, absolutely-priced order resolves here:
 *
 *   "limit sell 500 KLD at 0.05 USDC"     -> sell 500 KLD, floor 25 USDC
 *   "sell 500 KLD for USDC at 0.05"       -> same
 *
 * because that is the shape KaleidoOrders signs and the arithmetic has no
 * inversion: the amount is the input, the price is output-per-input, minOut is
 * their product. A buy names the OUTPUT ("buy 100 KLD"), which the contract has
 * no exact-output order for; a recurring order needs a fill count; a relative
 * price ("5% below market") needs a live quote. All three fall through to the
 * model tool, which converts, counts and reads the market - see the follow-up.
 *
 * `cancelOrders` is the panic cancel: "cancel all my orders". Cancelling ONE
 * order needs its signed struct, which lives in the store, so a single-order
 * cancel also falls through.
 */
function parseOrder(raw: string, tokens: IToken[]): ParseResult | null {
  const words = normalise(raw);
  const lower = raw.toLowerCase();

  /* Cancel-all. Requires a plural/collective marker so "cancel order 5" and
     "cancel my listing" are NOT swept in - those are the ref-cancel the verb
     table already handles. */
  const cancels = words.includes("cancel");
  const collective = words.some((w) => ["all", "every", "everything"].includes(w));
  /* Singular "order" counts only with a collective word — "cancel every order"
     is the panic form, while "cancel order 5" is a ref the verb table owns. */
  const ordersNoun = collective
    ? /\border(s)?\b/.test(lower)
    : /\bmy orders\b/.test(lower);
  if (cancels && (collective || /\bmy orders\b/.test(lower)) && ordersNoun) {
    return { status: "ok", command: { kind: "cancelOrders" } };
  }

  /* Place. A sell verb AND a price marker is the minimum signal - "sell 500 KLD"
     alone is a spot swap, and only "at <price>" makes it resting. */
  const isSell = words.some((w) => ["sell", "dump", "unload"].includes(w));
  const isLimit = words.some((w) => ORDER_MARKERS.includes(w));
  const priceAt = words.findIndex((w) => w === "at" || w === "@");
  if (!(isSell || isLimit) || priceAt < 0) return null;

  /* Anything v1 cannot price correctly is handed on rather than half-read. */
  if (RECURRING.test(lower)) return null;
  if (words.some((w) => BUY_WORDS.has(w))) return null;

  const price = words.slice(priceAt + 1).map(parseAmount).find(Boolean) ?? null;
  if (!price) return null;

  const priceIdx = words.findIndex(
    (w, i) => i > priceAt && parseAmount(w) !== null,
  );
  /* The amount is a parseable number that is NOT the price. */
  const amount = detectAmount(words, new Set([priceIdx]));
  const mentions = findTokenMentions(words, tokens);
  if (!amount || mentions.length < 2) return null;

  /* The sold token sits with the amount; the received token is the other. A
     price quote token ("at 0.05 USDC") names the received side and confirms it. */
  const tokenIn = mentions.find((m) => m.index > amount.index)?.token ?? mentions[0].token;
  const tokenOut = mentions.find(
    (m) => m.token.address.toLowerCase() !== tokenIn.address.toLowerCase(),
  )?.token;
  if (!tokenOut) return null;

  return {
    status: "ok",
    command: {
      kind: "placeOrder",
      tokenIn,
      tokenOut,
      amount: amount.amount,
      price,
      /* The price is quote-per-base, and the base is what is sold. So it is
         output-per-input: minOutFor multiplies, never inverts. */
      basis: "outPerIn",
      everyDays: 0,
      fills: 1,
      expiryDays: 30,
    },
  };
}


/** "30 days", "2 weeks", "1 month". Normalised to whole days. */
function detectDuration(
  words: string[],
): { days: number; claimed: number[] } | null {
  for (let i = 0; i < words.length; i++) {
    const unit = DAY_UNITS[words[i]];
    if (!unit) continue;
    const prev = words[i - 1]?.match(/^(\d+(?:\.\d+)?)$/);
    if (!prev) continue;
    const days = Math.round(Number(prev[1]) * unit);
    if (days > 0) return { days, claimed: [i - 1, i] };
  }
  return null;
}

const MODEL_ONLY =
  /\b(every (day|week|month|hour|\d+ (days|weeks|months|hours))|daily|weekly|monthly|recurring|dca|limit (order|buy|sell)|at a price of|when (the )?price|(?<!in )orders?|grant|permission|mandate|delegat(e|ion|ed))\b/i;

export function parseCommand(text: string, tokens: IToken[]): ParseResult {
  const raw = text.trim();
  if (!raw) return { status: "unknown" };

  if (
    HELP_WORDS.some(
      (h) => raw.toLowerCase() === h || raw.toLowerCase().startsWith(h),
    )
  ) {
    return { status: "ok", command: { kind: "help" } };
  }

  /*
   * Receive, checked ahead of verb detection so "deposit address" lands here and
   * not on the lending `deposit` verb.
   *
   * The boundary test is deliberate rather than HELP_WORDS' bare `startsWith`:
   * requiring the phrase to end the string or be followed by a space keeps
   * "received 500 USDC from Alice" out, which a prefix match would have claimed.
   */
  const lower = raw.toLowerCase();

  /*
   * Sentences this grammar cannot read correctly, declined outright so they reach
   * the model rather than being half-read into the wrong transaction.
   *
   * Found by routing the product's own example prompts: "buy 50 KLD every week
   * with USDC" parsed as a one-off SWAP, "place a limit order to buy 100 KLD at
   * 0.02 USDC" as a swap missing its input, and "grant the agent permission to
   * lend up to 5000 USDC" as a LEND missing its rate. Each is a plan the user
   * did not describe - the recurring buy is the dangerous one, since it builds
   * a single swap that looks reasonable right up to the signature. Limit and
   * recurring orders have intents (KaleidoOrders, #60) but no grammar yet;
   * delegation is granted from the settings panel. Until a verb exists for
   * them, "unknown" is the honest answer and the model's tools are the path.
   *
   * `(?<!in )order` keeps "in order to" out of it.
   */
  /* Resting orders, before the model backstop declines them. Returns null for
     everything it does not handle, so the backstop still catches those. */
  const order = parseOrder(raw, tokens);
  if (order) return order;

  if (MODEL_ONLY.test(lower)) return { status: "unknown" };
  if (
    RECEIVE_PHRASES.some(
      (p) => lower === p || lower.startsWith(`${p} `) || lower === `${p}?`,
    )
  ) {
    return { status: "ok", command: { kind: "receive" } };
  }

  const words = normalise(raw);

  /*
   * The faucet, checked ahead of the zero-slot verbs for one specific reason:
   * "claim usdt from the faucet" contains "claim", and ZERO_SLOT_VERBS scans the
   * whole sentence, so without this it would resolve to claimYield and plan a
   * kfUSD yield claim — the wrong product, from a sentence that names this one.
   *
   * Scanning the whole sentence is safe here where it would not be for
   * "receive": "faucet" is not ordinary trading English, and no other command in
   * this grammar has any reason to mention one.
   */
  const faucetAt = words.findIndex((w) => VERBS.claimTestTokens.includes(w));
  if (faucetAt !== -1) {
    /*
     * The word immediately after it — the shape the help list teaches, and the
     * one that works for an asset this chain's registry has never heard of.
     * Ticker-shaped and not a filler, so "faucet please" doesn't come back as
     * "the faucet doesn't hand out please".
     */
    const next = words[faucetAt + 1];
    const adjacent =
      next && /^[a-z][a-z0-9]{1,11}$/.test(next) && !FAUCET_FILLERS.has(next)
        ? next
        : undefined;

    /*
     * Then, only if that found nothing, the rest of the sentence — but not by
     * position.
     *
     * "claim USDC from the faucet" is what people actually type, and reading
     * only the word after the noun left it with no asset named, so the planner
     * answered "the faucet lists USDC, USDT, USDe — say which one you want" to
     * a sentence that had just said USDC. That is the one refusal here that
     * makes the agent look like it cannot read.
     *
     * The fallback still does no guessing, which is what the note this replaces
     * was protecting. A word is only taken if it resolves against the token
     * registry the caller passed in, or is literally one of the three batch
     * words — so there is no stopword list, no attempt at English, and a
     * sentence full of prose contributes nothing. A registry match is preferred
     * over a batch word so "claim all my USDC from the faucet" claims USDC
     * rather than everything.
     *
     * Deliberately narrower than `adjacent`: an asset the faucet lists but this
     * chain's registry does not carry — which is the reason FaucetAssetRef
     * exists at all, see build.ts — can only be named the adjacent way. That is
     * a phrasing gap, not a wrong transaction, and it is the direction to fail
     * in.
     */
    const loose =
      findTokenMentions(words, tokens)[0]?.token.symbol ??
      words.find((w) => ALL_WORDS.has(w));

    return {
      status: "ok",
      command: { kind: "claimTestTokens", symbol: adjacent ?? loose },
    };
  }

  // Checked ahead of the slotted verbs: these take no argument at all, so
  // there's nothing for the draft machinery to do.
  for (const kind of Object.keys(ZERO_SLOT_VERBS) as ZeroSlotKind[]) {
    if (words.some((w) => ZERO_SLOT_VERBS[kind].includes(w))) {
      return { status: "ok", command: { kind } as Command };
    }
  }

  /* Ahead of the verb because the "fund" guard consults it: a marketplace fill
     always points at a row, so whether one is named changes what the verb means. */
  const ref = detectRef(words);

  /*
   * The add-liquidity handoff, ahead of verb detection for the same reason
   * RECEIVE_PHRASES is: two of its opening words ("deposit", "supply") are
   * lending verbs, and the verb table would claim "deposit into the KLD/USDC
   * pool" as collateral before this branch ever saw it. See detectOpenLiquidity
   * for the pairing rule and the four vetoes that keep it from being greedy.
   *
   * The pair travels as `IToken`s from the caller's own registry, which is what
   * makes the prefill safe to hand to a URL: the agent page resolves against
   * `chainTokens(chainId)` and /pool/new offers exactly `chainTokens(chainId)`,
   * so a token matched here is a token that page can select. Order is as named,
   * not sorted — the form sorts its own pair.
   */
  const open = detectOpenLiquidity(words, {
    hasPositionRef: ref?.target === "position",
    priced: words.some((w) => parseAmount(w) !== null),
  });
  if (open) {
    const pair = findTokenMentions(words, tokens);
    return {
      status: "ok",
      command: {
        kind: "openLiquidity",
        ...(pair[0] ? { token0: pair[0].token } : {}),
        ...(pair[1] ? { token1: pair[1].token } : {}),
        ...(open.fee !== undefined ? { fee: open.fee } : {}),
      },
    };
  }

  const verb = detectVerb(words, { hasRef: Boolean(ref) });
  if (!verb) {
    /*
     * Nothing to do, so it may be something to read. Deliberately the last thing
     * tried before giving up: see PORTFOLIO_PHRASES for why this position is the
     * safety property rather than the phrase list.
     */
    const bare = words.join(" ");
    if (
      !words.some((w) => PORTFOLIO_VETO.has(w)) &&
      !words.some((w) => PORTFOLIO_ACTION_VETO.has(w)) &&
      (PORTFOLIO_ALONE.includes(bare) ||
        PORTFOLIO_PHRASES.some((p) => lower.includes(p)))
    ) {
      return { status: "ok", command: { kind: "portfolio" } };
    }
    return { status: "unknown" };
  }

  // Rate and term claim their numbers first so the amount can't be read off
  // either of them. An address can't be read as an amount (the "0x" stops
  // parseAmount cold), but it claims its position anyway so that stays true by
  // construction rather than by coincidence.
  const rate = detectRate(words);
  const duration = detectDuration(words);
  const recipient = detectRecipient(words, raw);
  const claimed = new Set([
    ...(rate?.claimed ?? []),
    ...(duration?.claimed ?? []),
    ...(ref?.claimed ?? []),
    ...(recipient ? [recipient.index] : []),
  ]);

  const amount = detectAmount(words, claimed);
  const mentions = findTokenMentions(words, tokens);

  if (verb.kind === "collectFees" || verb.kind === "removePosition") {
    // Always a position reference, never a marketplace one — "remove" here
    // never means cancelling a listing.
    if (!ref || ref.target !== "position" || !Number.isFinite(ref.id)) {
      return incomplete({ kind: verb.kind }, "ref");
    }
    return {
      status: "ok",
      command: { kind: verb.kind, positionId: ref.id },
    };
  }

  /*
   * "deposit USDC on yield" is not a collateral deposit, though the verb table
   * reads "deposit" as one. A tester typed exactly that and got a lending
   * collateral deposit - the wrong product, and one that earns nothing and
   * locks the funds against a loan. The yield product is minting kfUSD and
   * locking it into kafUSD, or lending on the book, or providing liquidity -
   * three different transactions, and which one "on yield" means is genuinely
   * ambiguous. So the grammar declines rather than guessing a transaction, and
   * the sentence falls to the FAQ, which lays out the options. A collateral
   * deposit never mentions yield, so this cannot swallow a real one.
   */
  if (
    verb.kind === "deposit" &&
    words.some((w) => w === "yield" || w === "yields" || w === "apy" || w === "earn")
  ) {
    return { status: "unknown" };
  }

  // A marketplace reference changes what a verb means: "borrow 500 usdc at 8%
  // for 30 days" posts a new request, while "borrow 500 from listing 3" draws
  // against an existing one. The noun is the disambiguator, so it's checked
  // before the generic borrow/lend branch. A "position" reference is excluded
  // here on purpose — collectFees/removePosition already claimed it above, so
  // one reaching this far means the wrong noun was paired with this verb
  // ("borrow from position 42"), not a marketplace row to act on.
  const marketRef = ref && ref.target !== "position" ? ref : null;

  if (verb.kind === "cancel" || marketRef) {
    const refDraft: Draft = {
      kind:
        verb.kind === "cancel"
          ? "cancel"
          : marketRef?.target === "request"
            ? "fillRequest"
            : "takeListing",
      amount: amount?.amount,
      refTarget: marketRef?.target,
      refId:
        marketRef && Number.isFinite(marketRef.id) ? marketRef.id : undefined,
    };

    // "cancel" with no noun can't be resolved: cancelling the wrong side of the
    // book is not recoverable, so it asks rather than assuming.
    if (verb.kind === "cancel" && !refDraft.refTarget) {
      return incomplete(refDraft, "ref");
    }
    return completeDraft(refDraft);
  }

  if (verb.kind === "swap") {
    return parseSwap(words, amount, mentions, tokens);
  }

  if (verb.kind === "bridge") {
    return parseBridge(words, amount, mentions, tokens);
  }

  if (verb.kind === "send") {
    /*
     * Two addresses is contradictory, not under-specified: there is no such
     * thing as one send with two destinations. So it gets the same answer as a
     * swap between identical tokens — start over, rather than ask for a slot
     * that is already filled with the wrong thing.
     */
    if (countAddresses(words) > 1) return { status: "unknown" };

    return completeDraft({
      kind: "send",
      amount: amount?.amount,
      token: mentions[0]?.token,
      to: recipient?.to,
      ...suggestion(words, mentions, tokens),
    });
  }

  if (verb.kind === "stake") {
    // Stake is KLD-only in the vault, so the token needs no disambiguation.
    if (!amount) return incomplete({ kind: "stake" }, "amount");
    return { status: "ok", command: { kind: "stake", amount: amount.amount } };
  }

  if (verb.kind === "unstake") {
    /* Same shape as stake, for the same reason: the vault holds one token. The
       amount is asked for even when the step that ends up built is a request
       (which takes none), because the sentence should carry what the user
       wants back — it is what the withdrawal will need once the cooldown ends,
       and asking then would mean asking twice. */
    if (!amount) return incomplete({ kind: "unstake" }, "amount");
    return {
      status: "ok",
      command: { kind: "unstake", amount: amount.amount },
    };
  }

  if (verb.kind === "repay") {
    // A bare "repay" is valid: the planner resolves it when exactly one loan is
    // open, and asks which otherwise. Only a number here names the loan.
    const id = amount ? Number(amount.amount) : undefined;
    return {
      status: "ok",
      command: {
        kind: "repay",
        loanId: Number.isInteger(id) && (id as number) > 0 ? id : undefined,
      },
    };
  }

  if (verb.kind === "borrow" || verb.kind === "lend") {
    return completeDraft({
      kind: verb.kind,
      amount: amount?.amount,
      token: mentions[0]?.token,
      interestPct: rate?.pct,
      days: duration?.days,
      ...suggestion(words, mentions, tokens),
    });
  }

  if (verb.kind === "lock" || verb.kind === "unlock") {
    // Amount only: the app locks only kfUSD and unlocks only kafUSD, so there's
    // no token to disambiguate.
    if (!amount) return incomplete({ kind: verb.kind }, "amount");
    return {
      status: "ok",
      command: { kind: verb.kind, amount: amount.amount },
    };
  }

  if (verb.kind === "completeWithdrawal") {
    /*
     * No amount: the call pays out whatever the finished cooldown recorded.
     * And no real choice of token either — the vault releases what was locked,
     * and only kfUSD is lockable — so an unnamed token resolves to kfUSD
     * rather than asking a question whose only correct answer is forced. Any
     * other token still parses; buildIntents refuses it there, with an
     * explanation of what to do instead, rather than here with a bare re-ask.
     */
    const token = mentions[0]?.token ?? findToken("kfusd", tokens);
    if (!token) {
      return incomplete(
        { kind: "completeWithdrawal", ...suggestion(words, mentions, tokens) },
        "token",
      );
    }
    return { status: "ok", command: { kind: "completeWithdrawal", token } };
  }

  // deposit, withdraw, approve, mint, redeem — all amount plus token.
  return completeDraft({
    kind: verb.kind,
    amount: amount?.amount,
    token: mentions[0]?.token,
    ...suggestion(words, mentions, tokens),
  });
}

/* ------------------------------------------------------------- near misses -- */

/**
 * Shorthands that are not typos, and that distance could never resolve.
 *
 * "eth" is one edit from WETH and one from ETH; "btc" is one from BTCB and two
 * from both WBTC and cbBTC. The ranking cannot say which one a person meant,
 * and a list can. Each entry names its candidates in preference order, and the
 * first one this chain actually has wins.
 *
 * Consulted ONLY once a token slot is known to be unresolved, never while
 * scanning a sentence: several of these words also name chains in the registry
 * ("Ether", "Ethereum" and "BNB" are all chain or currency names there), and a
 * bridge destination must never start reading as a token.
 *
 * "usd" is deliberately absent, and so is "stable". Both sit one edit from
 * USDC, USDT and USDe at once, so they say only that the person meant a
 * dollar, and the honest question there is the plain "which token?".
 */
const TOKEN_ALIASES: Record<string, string[]> = {
  eth: ["WETH", "ETH"],
  ether: ["WETH", "ETH"],
  ethereum: ["WETH", "ETH"],
  btc: ["WBTC", "BTCB", "cbBTC", "cirBTC"],
  bitcoin: ["WBTC", "BTCB", "cbBTC", "cirBTC"],
  wrappedbtc: ["WBTC"],
  tether: ["USDT"],
  ethena: ["USDe"],
  susde: ["USDe"],
  kaleido: ["KLD"],
  kaleidotoken: ["KLD"],
  stakedkld: ["stKLD"],
  euro: ["EURC"],
  eur: ["EURC"],
  hyperliquid: ["HYPE"],
  matic: ["POL", "WPOL"],
  usdcoin: ["USDC"],
  kaleidousd: ["kfUSD"],
};

/**
 * Lowercased with the punctuation dropped, so "st-kld", "kf usd" and "USD.C"
 * all fold onto the symbol they were aiming at.
 */
function squash(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Optimal string alignment distance — Levenshtein plus one extra move, the
 * transposition of two adjacent letters.
 *
 * That extra move is the whole reason this is not plain Levenshtein. "udsc"
 * for USDC is the single most common way a symbol comes out wrong, and
 * Levenshtein scores that swap as two edits: the same distance as a word
 * sharing only half its letters. One move is what it actually was.
 */
function editDistance(a: string, b: string): number {
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    rows.push(new Array<number>(b.length + 1).fill(0));
    rows[i][0] = i;
  }
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, rows[i - 2][j - 2] + 1);
      }
      rows[i][j] = best;
    }
  }
  return rows[a.length][b.length];
}

/**
 * How far a word may sit from a symbol, measured against the shorter of the
 * two. Short symbols get almost no room on purpose: KLD and POL are three
 * letters, and at a tolerance of two, "old", "cold" and "sold" all become
 * token names.
 */
function tolerance(span: number): number {
  if (span <= 3) return 1;
  if (span <= 5) return 2;
  return 3;
}

/**
 * Words the grammar already knows, which are therefore never misspelled
 * tokens however close they happen to land. "rate" is two edits from DAI and
 * it is the word that carries an interest rate; "sold" is two from POL.
 *
 * Built from the parser's own vocabulary rather than retyped, so a verb added
 * later is excluded here on the day it is added, plus a short list of ordinary
 * English the parser has no table for.
 */
const NEVER_A_TOKEN = new Set<string>([
  ...Object.values(VERBS).flat(),
  ...Object.values(ZERO_SLOT_VERBS).flat(),
  ...SEPARATORS,
  ...BUY_WORDS,
  ...BUY_SEPARATORS,
  ...BUY_FORWARD_SEPARATORS,
  ...SELF_WORDS,
  ...ORDER_MARKERS,
  ...FAUCET_FILLERS,
  ...LENDING_NOUNS,
  ...LIQUIDITY_NOUNS,
  ...OPEN_WORDS,
  ...CLOSING_WORDS,
  ...PORTFOLIO_VETO,
  ...PORTFOLIO_ACTION_VETO,
  "the", "a", "an", "and", "or", "of", "in", "on", "at", "is", "it", "as",
  "all", "any", "some", "half", "rest", "more", "less", "most", "best",
  "rate", "rates", "apy", "apr", "yield", "yields", "interest", "term",
  "day", "days", "week", "weeks", "month", "months", "year", "years",
  "wallet", "balance", "balances", "account", "address", "chain", "network",
  "price", "prices", "value", "worth", "total", "each", "every", "per",
  "please", "now", "then", "that", "this", "them", "those", "these",
  "type", "date", "safe", "same", "want", "need", "make", "take", "back",
  "cost", "code", "cold", "sold", "old", "hold", "held", "sell", "sale",
  "much", "many", "over", "under", "into", "out", "off", "up", "down",
]);

/** A word that was probably a symbol, and where in the sentence it sat. */
export interface NearMiss {
  token: IToken;
  /** The word as it was typed, for quoting back in the question. */
  typed: string;
  /** Its position, so a swap can tell which side of the trade it was on. */
  index: number;
}

/** Every distinct symbol this chain has; the first token wins per symbol. */
function bySymbol(tokens: IToken[]): Map<string, IToken> {
  const out = new Map<string, IToken>();
  for (const t of tokens) {
    const key = squash(t.symbol);
    if (!out.has(key)) out.set(key, t);
  }
  return out;
}

/**
 * The one symbol a word was probably meant to be, or nothing.
 *
 * Nothing is the common answer, and that is the point. A tie is not a near
 * miss: USDC, USDT and USDe are each one edit from the others, so a word that
 * lands one edit from all three has not identified anything, and choosing
 * between them is a coin flip with someone's money on it.
 */
function nearestToken(word: string, tokens: IToken[]): IToken | null {
  const w = squash(word);
  if (w.length < 2) return null;

  const symbols = bySymbol(tokens);

  const alias = TOKEN_ALIASES[w];
  if (alias) {
    for (const symbol of alias) {
      const hit = symbols.get(squash(symbol));
      if (hit) return hit;
    }
  }

  let best: IToken | null = null;
  let bestDistance = Infinity;
  let tied = false;

  for (const [symbol, token] of symbols) {
    const d = editDistance(w, symbol);
    if (d > tolerance(Math.min(w.length, symbol.length))) continue;
    if (d < bestDistance) {
      best = token;
      bestDistance = d;
      tied = false;
    } else if (d === bestDistance && token.symbol !== best?.symbol) {
      tied = true;
    }
  }

  return tied ? null : best;
}

/**
 * Scans a sentence for one word that was meant to be a token and came out
 * wrong.
 *
 * Only ever consulted when a token slot could not be filled, so the cost of
 * looking is paid on sentences that were already going to end in a question.
 * What changes is which question: "Which token do you want to spend?" becomes
 * a named guess, which is answerable with one word, by the same local
 * machinery that asked, and so never reaches a model.
 *
 * Two-word windows are scanned as well as single words, because a symbol
 * broken by a space ("kf usd", "st kld") is the same mistake as a symbol
 * broken by a letter.
 */
function findNearMiss(
  words: string[],
  mentions: Mention[],
  tokens: IToken[],
): NearMiss | null {
  // Letters already spoken for by a token this sentence names outright.
  const spoken = new Set<string>();
  for (const m of mentions) {
    for (const part of (m.token.symbol + " " + m.token.name).split(" ")) {
      if (part) spoken.add(squash(part));
    }
  }

  let best: NearMiss | null = null;
  let bestDistance = Infinity;

  for (let i = 0; i < words.length; i++) {
    for (let len = Math.min(2, words.length - i); len >= 1; len--) {
      const window = words.slice(i, i + len);
      if (window.some((p) => NEVER_A_TOKEN.has(p))) continue;

      const typed = window.join(" ");
      const w = squash(typed);
      // Amounts, ids and addresses all carry digits; no symbol here does.
      if (w.length < 2 || /[0-9]/.test(w)) continue;
      if (spoken.has(w)) continue;
      if (findToken(typed, tokens)) continue;

      const token = nearestToken(typed, tokens);
      if (!token) continue;
      const d = editDistance(w, squash(token.symbol));
      if (d < bestDistance) {
        best = { token, typed, index: i };
        bestDistance = d;
      }
    }
  }

  return best;
}

/** Attaches a near miss to a draft, so `incomplete` can quote it back. */
function suggestion(
  words: string[],
  mentions: Mention[],
  tokens: IToken[],
): { suggest?: { token: IToken; typed: string } } {
  const near = findNearMiss(words, mentions, tokens);
  return near ? { suggest: { token: near.token, typed: near.typed } } : {};
}

const AFFIRMATIVE = new Set([
  "y", "ye", "yes", "yeah", "yep", "yup", "yea", "correct", "right", "sure",
  "ok", "okay", "confirm", "confirmed", "exactly", "indeed", "please",
]);

const NEGATIVE = new Set([
  "n", "no", "nope", "nah", "wrong", "incorrect", "neither", "never",
]);

/**
 * "yes" is a complete answer to "did you mean USDC?", and has to be read as
 * one — otherwise the confirmation of a guess the parser made itself is the
 * thing that finally reaches a model.
 *
 * Capped at four words so a full restatement ("yes, swap 100 USDC for KLD") is
 * parsed as the sentence it is rather than collapsed into a bare confirm.
 */
function isAffirmative(words: string[]): boolean {
  return (
    words.length > 0 &&
    words.length <= 4 &&
    words.some((w) => AFFIRMATIVE.has(w)) &&
    !words.some((w) => NEGATIVE.has(w))
  );
}

function isNegative(words: string[]): boolean {
  return (
    words.some((w) => NEGATIVE.has(w)) &&
    !words.some((w) => AFFIRMATIVE.has(w))
  );
}


function parseSwap(
  words: string[],
  amount: { amount: string; index: number } | null,
  mentions: Mention[],
  tokens: IToken[],
): ParseResult {
  /*
   * A purchase is the same transaction read from the other end, and every branch
   * below has to know which end it is being read from. See BUY_WORDS.
   */
  const buying = words.some((w) => BUY_WORDS.has(w));
  const backAt = buying
    ? words.findIndex((w) => BUY_SEPARATORS.includes(w))
    : -1;
  const fwdAt = buying
    ? words.findIndex((w) => BUY_FORWARD_SEPARATORS.includes(w))
    : words.findIndex((w) => SEPARATORS.includes(w));
  const sepAt = backAt >= 0 ? backAt : fwdAt;
  /** True when the separator we found puts the spent token on its right. */
  const inverted = backAt >= 0;

  /*
   * A misspelled symbol is not only a missing token — it occupies a POSITION,
   * and dropping it silently slides the tokens that are left onto the wrong
   * sides. "swap 100 usdcc to KLD" with the first word thrown away reads as a
   * sentence naming one token, and the positional fallback below would then
   * spend the KLD. So the near miss is carried through the side logic as a
   * provisional mention and taken back out afterwards, leaving its own side
   * empty and its own question asked.
   */
  const near = findNearMiss(words, mentions, tokens);
  const placed = near
    ? [...mentions, { token: near.token, index: near.index }].sort(
        (a, b) => a.index - b.index,
      )
    : mentions;

  let tokenIn: IToken | undefined;
  let tokenOut: IToken | undefined;

  if (sepAt >= 0) {
    // "swap 500 usdc to kld" — the separator disambiguates the two sides even
    // when only one of them is named. "buy kld with 500 usdc" is the same
    // sentence with the sides swapped, which is all `inverted` does.
    const before = placed.find((m) => m.index < sepAt)?.token;
    const after = placed.find((m) => m.index > sepAt)?.token;
    tokenIn = inverted ? after : before;
    tokenOut = inverted ? before : after;
  } else if (buying) {
    /*
     * No separator, so there is no second side to read — and the positional
     * fallback below is not available here, because the two orders a purchase
     * comes in ("buy KLD USDC" vs "buy 500 USDC KLD") mean opposite trades. One
     * named token is the thing being bought; the token to spend gets asked for.
     */
    tokenOut = placed[0]?.token;
  } else if (placed.length >= 2) {
    // "swap 500 usdc kld" — positional fallback.
    tokenIn = placed[0].token;
    tokenOut = placed[1].token;
  } else if (placed.length === 1) {
    tokenIn = placed[0].token;
  }

  /*
   * The provisional mention comes back out here. Whichever side it landed on
   * is the side that gets asked about, and it is asked about by name — the
   * tokens the sentence did spell correctly keep their sides, and the amount
   * keeps its meaning, so answering takes one word.
   */
  if (near) {
    const suggest = { token: near.token, typed: near.typed };
    if (tokenIn === near.token) {
      return incomplete(
        { kind: "swap", amount: amount?.amount, tokenOut, suggest },
        "tokenIn",
      );
    }
    if (tokenOut === near.token) {
      // Same rule as the drop below: a purchase states what comes back, so its
      // number must not survive into the side that gets spent.
      const keep = buying && !tokenIn ? undefined : amount?.amount;
      return incomplete(
        { kind: "swap", amount: keep, tokenIn, suggest },
        "tokenOut",
      );
    }
  }

  /*
   * "buy 100 KLD" names an amount of the token being RECEIVED, and there is no
   * exact-output swap in this app — the intent takes an input amount, so keeping
   * the 100 would spend 100 of whatever token the user names next. That is the
   * inverted trade this whole flag exists to prevent, so the number is dropped
   * and the reply says so rather than quietly re-using it. An explicitly spent
   * side ("buy KLD with 100 USDC") never reaches here: it has a tokenIn.
   */
  if (buying && amount && !tokenIn) {
    const target = tokenOut ? ` ${tokenOut.symbol}` : "";
    return {
      status: "incomplete",
      draft: { kind: "swap", ...(tokenOut ? { tokenOut } : {}) },
      missing: "tokenIn",
      prompt: `I price a swap by what you spend, not by what comes back, so I've dropped the ${amount.amount}${target}. Which token do you want to spend?`,
    };
  }

  const draft: Draft = {
    kind: "swap",
    amount: amount?.amount,
    tokenIn,
    tokenOut,
  };

  if (!tokenIn) return incomplete(draft, "tokenIn");
  if (!tokenOut) return incomplete(draft, "tokenOut");
  if (tokenIn.address.toLowerCase() === tokenOut.address.toLowerCase()) {
    // Not an incomplete draft — it's contradictory, so restart rather than
    // ask for a slot that's already filled.
    return { status: "unknown" };
  }
  if (!amount) return incomplete(draft, "amount");

  return {
    status: "ok",
    command: { kind: "swap", amount: amount.amount, tokenIn, tokenOut },
  };
}

/**
 * "bridge 0.05 ETH to Base Sepolia" — send's cross-chain sibling.
 *
 * Structurally a swap with a chain where the second token would be: the
 * separator splits the asset from the destination, and the asset is taken from
 * before it so a token name inside the destination phrase can't be mistaken for
 * the thing being moved (the same guard parseSwap uses for tokenIn/tokenOut).
 *
 * The destination is the free text after the separator, taken as a string — not
 * matched against anything here. See BridgeCommand: resolving a chain name is
 * the resolver's job, so this captures the phrase and lets buildIntents refuse
 * an unknown one by name. Without a separator it still collects the asset and
 * asks for the chain, rather than guessing a destination out of trailing words.
 */
function parseBridge(
  words: string[],
  amount: { amount: string; index: number } | null,
  mentions: Mention[],
  tokens: IToken[],
): ParseResult {
  const sepAt = words.findIndex((w) => SEPARATORS.includes(w));
  const dest =
    sepAt >= 0
      ? words
          .slice(sepAt + 1)
          .join(" ")
          .trim()
      : "";
  const token =
    sepAt >= 0
      ? mentions.find((m) => m.index < sepAt)?.token
      : mentions[0]?.token;

  return completeDraft({
    kind: "bridge",
    amount: amount?.amount,
    token,
    toChain: dest || undefined,
    // Only the words before the separator. Everything after it is the
    // destination, and a chain name must never be read back as a token.
    ...suggestion(sepAt >= 0 ? words.slice(0, sepAt) : words, mentions, tokens),
  });
}

/* --------------------------------------------------------- slot filling -- */

/**
 * Applies a bare reply ("kld", "500") to the slot a previous turn asked about.
 * This is the whole point of tracking drafts: a missing parameter costs one
 * cheap follow-up question instead of a model call.
 */
/**
 * A sentence that continues the last one, rather than starting a new one.
 *
 * "swap 10 USDC to USDT" then "now the same to USDR" is one thought in two
 * messages, and until now only the MODEL could follow it: `fillSlot` resumes a
 * draft the agent ITSELF asked about, and a completed command left nothing
 * behind, so the second sentence arrived as an unparseable fragment and cost a
 * reasoning request. This reads it against the command that just succeeded.
 *
 * ── Four rules, and each exists because breaking it produces a wrong trade ──
 *
 * 1. A SENTENCE WITH ITS OWN VERB IS NOT A FOLLOW-UP. "now stake it" is a fresh
 *    instruction and belongs to the grammar; reading it as a modified swap
 *    would keep the previous verb and quietly change the action. Declined here,
 *    and the caller has already tried the parser anyway.
 *
 * 2. DIRECTION IS READ, NEVER ASSUMED. This is the same trap `buy` set (see
 *    BUY_WORDS): for a swap, a lone token could plausibly mean either side, and
 *    guessing wrong inverts the trade. So "to/into/for X" sets the output,
 *    "from/with X" sets the input, and a bare single token is the OUTPUT —
 *    which is what "now to USDR", "same for USDR" and "USDR instead" all mean.
 *    Two tokens name both sides in the order they appear.
 *
 * 3. SOMETHING MUST ACTUALLY BE NAMED. If the sentence substitutes nothing —
 *    "ok", "thanks", "do it" — this is not a follow-up and returns `unknown`.
 *    Repeating the previous command because the user said "ok" would build a
 *    second identical transaction.
 *
 * 4. WHAT IS NOT NAMED IS CARRIED, INCLUDING THE AMOUNT. "same amount" and
 *    "the same" are therefore not special cases: the amount survives unless the
 *    sentence gives a new one. They are recognised only so the phrases do not
 *    read as unnamed slots under rule 3.
 *
 * A recipient is deliberately never carried into a NEW recipient by inference —
 * `detectRecipient` requires a literal address, so "send it to Bob" cannot
 * resolve to anybody. Changing who gets paid is not a thing to infer.
 */
const SAME_PHRASES = ["same", "the same", "same amount", "same size", "again"];

export function parseFollowUp(
  text: string,
  tokens: IToken[],
  last: Command,
): ParseResult {
  const raw = text.trim();
  if (!raw) return { status: "unknown" };

  const lower = raw.toLowerCase();
  /* The same sentences parseCommand refuses. A follow-up must not be the way a
     recurring buy or a delegation grant gets built after all. */
  if (MODEL_ONLY.test(lower)) return { status: "unknown" };

  const words = normalise(raw);
  if (detectVerb(words, { hasRef: detectRef(words) !== null })) {
    return { status: "unknown" };
  }

  const draft = draftFromCommand(last);
  if (!draft) return { status: "unknown" };

  const next: Draft = { ...draft };
  let named = false;

  const amount = detectAmount(words);
  if (amount) {
    next.amount = amount.amount;
    named = true;
  } else if (SAME_PHRASES.some((s) => lower === s || lower.includes(s))) {
    /* Rule 4: nothing to copy — the amount is already in the draft. This only
       records that the sentence said something, so it is not refused as empty. */
    named = true;
  }

  /*
   * A destination this registry cannot name aborts the follow-up.
   *
   * The failure it prevents was silent and produced the WRONG TRADE: after
   * "swap 10 USDC to USDT", the reply "now the same to USDR" resolved no token
   * (USDR is on no chain here - the registry has USDe), so nothing was
   * substituted while `same` still counted as naming something under rule 3,
   * and the carry-over rebuilt the USDT swap. The user names one destination
   * and is handed a plan for another, which is the one outcome this file's
   * whole design is against. A token named after a directional preposition
   * must therefore resolve, or the sentence is not a follow-up this grammar
   * can read and the model gets it.
   */
  const DIRECTIONAL = new Set(["to", "into", "for", "from", "with", "using"]);
  const mentions = findTokenMentions(words, tokens);
  const covered = new Set(mentions.map((m) => m.index));
  for (let w = 0; w < words.length - 1; w++) {
    if (!DIRECTIONAL.has(words[w])) continue;
    const target = w + 1;
    if (covered.has(target)) continue;
    /* A number after "for" is a duration or a size, not a token: "for 30". */
    if (parseAmount(words[target]) !== null) continue;
    return { status: "unknown" };
  }
  if (mentions.length > 0) {
    named = true;
    if (next.kind === "swap") {
      /* Rule 2. The word before the token decides the side. */
      const sideOf = (m: Mention): "in" | "out" | null => {
        const before = words[m.index - 1];
        if (before === "to" || before === "into" || before === "for") return "out";
        if (before === "from" || before === "with" || before === "using") return "in";
        return null;
      };
      if (mentions.length === 1) {
        const side = sideOf(mentions[0]);
        if (side === "in") next.tokenIn = mentions[0].token;
        else next.tokenOut = mentions[0].token;
      } else {
        const ins = mentions.filter((m) => sideOf(m) === "in");
        const outs = mentions.filter((m) => sideOf(m) === "out");
        next.tokenIn = (ins[0] ?? mentions[0]).token;
        next.tokenOut = (outs[0] ?? mentions[1]).token;
      }
    } else if ("tokenIn" in next || "tokenOut" in next) {
      next.tokenIn = mentions[0].token;
      if (mentions[1]) next.tokenOut = mentions[1].token;
    } else {
      next.token = mentions[0].token;
    }
  }

  if (!named) return { status: "unknown" };
  return completeDraft(next);
}


export function fillSlot(
  draft: Draft,
  missing: Slot,
  reply: string,
  tokens: IToken[],
): ParseResult {
  const words = normalise(reply);
  const next: Draft = { ...draft };

  if (missing === "amount") {
    const amount = detectAmount(words);
    if (!amount) return incomplete(draft, "amount");
    next.amount = amount.amount;
  } else if (missing === "rate") {
    // A bare "8" is a rate here: the question established the units, so it
    // doesn't need the percent sign the free-form parser requires.
    const rate = detectRate(words) ?? detectRate([...words, "%"]);
    const bare = words[0]?.match(/^(\d+(?:\.\d+)?)%?$/);
    if (!rate && !bare) return incomplete(draft, "rate");
    next.interestPct = rate ? rate.pct : Number(bare![1]);
  } else if (missing === "days") {
    const duration = detectDuration(words);
    const bare = words[0]?.match(/^(\d+)$/);
    if (!duration && !bare) return incomplete(draft, "days");
    next.days = duration ? duration.days : Number(bare![1]);
  } else if (missing === "ref") {
    const ref = detectRef(words);
    if (ref) {
      next.refTarget = ref.target;
      if (Number.isFinite(ref.id)) next.refId = ref.id;
    } else {
      // A bare number answers only when the side is already known, since an id
      // alone doesn't say whether it's a listing or a request.
      const bare = words[0]?.match(/^#?(\d+)$/);
      if (!bare || !next.refTarget) return incomplete(draft, "ref");
      next.refId = Number(bare[1]);
    }
    if (next.refId === undefined) return incomplete(next, "ref");
  } else if (missing === "recipient") {
    // Read from `reply`, not `words`: the answer to "which address?" is the one
    // bare reply that carries a checksum, and normalise() has already dropped
    // the case that encodes it.
    const answered = detectRecipient(words, reply);
    if (!answered || countAddresses(words) > 1) {
      return incomplete(draft, "recipient");
    }
    next.to = answered.to;
  } else if (missing === "toChain") {
    // A chain name, not a token or a number: take the whole reply. The resolver
    // matches it against the registry, so a wrong name comes back as a named
    // refusal rather than being guessed here. `reply`, not `words`: no need to
    // strip punctuation from "Base Sepolia", and the raw form reads better if
    // it has to be echoed back.
    const answer = reply.trim();
    if (!answer) return incomplete(draft, "toChain");
    next.toChain = answer;
  } else {
    let token = findTokenMentions(words, tokens)[0]?.token;

    if (!token && draft.suggest) {
      /*
       * The question was "did you mean USDC?", so a bare "yes" is the whole
       * answer and has to be read as one. Without this the confirmation of a
       * guess the parser made itself would be the thing that finally reached a
       * model — the sentence it was confirming never did.
       */
      if (isAffirmative(words)) token = draft.suggest.token;
      // "no" withdraws the guess rather than repeating it, so the next
      // question is the plain one and "yes" stops meaning anything.
      else if (isNegative(words)) {
        return incomplete({ ...next, suggest: undefined }, missing);
      }
    }

    if (!token) {
      // The answer can be a near miss too — "usdcc" typed twice is still
      // "usdcc", and the second one deserves the same named question.
      const near = findNearMiss(words, [], tokens);
      return incomplete(
        {
          ...next,
          suggest: near ? { token: near.token, typed: near.typed } : undefined,
        },
        missing,
      );
    }

    next.suggest = undefined;
    if (missing === "tokenIn") next.tokenIn = token;
    else if (missing === "tokenOut") next.tokenOut = token;
    else next.token = token;
  }

  return completeDraft(next);
}

/**
 * Turns a finished Command back into the Draft it came from.
 *
 * The inverse of `completeDraft`, and it exists for one situation: the planner
 * refused a command that parsed perfectly. "lend 1000 USDT at 8% for 30 days" is
 * a complete sentence; whether this chain's lending market accepts USDT is not
 * something a grammar can know, so the refusal arrives one layer down, after the
 * Draft that produced the Command has been thrown away. Reconstructing it is
 * what lets the follow-up — "use USDC" — be answered by the same local machinery
 * that asked, instead of falling through to the model as an unparseable
 * fragment. See `retry` in intents/build.ts.
 *
 * Returns null for the kinds that carry no slots (`help`, `receive`,
 * `portfolio`, the yield verbs) and for the two tool-only kinds —
 * `provideLiquidity` and `increasePosition` — the same exclusions `ActionKind`
 * makes, checked here at runtime because a Command arrives from the parser, from
 * a tool call, or from a test.
 *
 * `claimTestTokens` returns a draft with no asset in it, deliberately: the
 * faucet's `symbol` is a bare word matched against the faucet's own list rather
 * than a registry token (see ClaimTestTokensCommand), and `Draft` has nowhere to
 * put it. A faucet refusal is therefore not resumable this way, which costs
 * nothing — "faucet USDC" is one short line the parser reads directly.
 */
export function draftFromCommand(command: Command): Draft | null {
  switch (command.kind) {
    case "help":
    case "receive":
    case "portfolio":
    case "claimYield":
    case "compoundYield":
    case "provideLiquidity":
    case "increasePosition":
    /* Nothing to collect. Every field it carries is optional and the form owns
       the rest — see OpenLiquidityCommand. */
    case "openLiquidity":
      return null;
    case "swap":
      return {
        kind: "swap",
        amount: command.amount,
        tokenIn: command.tokenIn,
        tokenOut: command.tokenOut,
      };
    case "stake":
    case "unstake":
    case "lock":
    case "unlock":
      return { kind: command.kind, amount: command.amount };
    case "send":
      return {
        kind: "send",
        amount: command.amount,
        token: command.token,
        to: command.to,
      };
    case "bridge":
      return {
        kind: "bridge",
        amount: command.amount,
        token: command.token,
        toChain: command.toChain,
      };
    case "borrow":
    case "lend":
      return {
        kind: command.kind,
        amount: command.amount,
        token: command.token,
        interestPct: command.interestPct,
        days: command.days,
      };
    case "repay":
      return { kind: "repay", loanId: command.loanId };
    case "takeListing":
      return {
        kind: "takeListing",
        amount: command.amount,
        refTarget: "listing",
        refId: command.listingId,
      };
    case "fillRequest":
      return {
        kind: "fillRequest",
        refTarget: "request",
        refId: command.requestId,
      };
    case "cancel":
      return {
        kind: "cancel",
        refTarget: command.target,
        refId: command.id,
      };
    case "collectFees":
      return {
        kind: command.kind,
        refTarget: "position",
        refId: command.positionId,
      };
    case "removePosition":
      /*
       * Not resumable once a percentage was named, and that is a safety choice
       * rather than a limitation worth working around. `Draft` has nowhere to put
       * `percent` — see RemovePositionCommand for why it is not a slot — so a
       * reconstructed draft would drop it, and `completeDraft` would then rebuild
       * "remove 25% of position 7" as "remove position 7". Silently withdrawing
       * four times what was asked for is a worse outcome than making the user
       * retype one short sentence, so the refusal stays terminal. Without a
       * percentage there is nothing to lose and it resumes as before.
       */
      if (command.percent !== undefined) return null;
      return {
        kind: command.kind,
        refTarget: "position",
        refId: command.positionId,
      };
    case "completeWithdrawal":
      return { kind: "completeWithdrawal", token: command.token };
    /* Parsed whole by parseOrder or not at all, so there is never a partial
       order to re-draft here. Explicit rather than folded into the default,
       which reads .amount and .token off a shape these do not have. */
    case "placeOrder":
    case "cancelOrders":
      return null;
    case "claimTestTokens":
      return { kind: "claimTestTokens" };
    default:
      // approve, deposit, withdraw, mint, redeem — amount plus token.
      return {
        kind: command.kind,
        amount: command.amount,
        token: command.token,
      };
  }
}

/**
 * A draft with one slot emptied, ready to be asked about again.
 *
 * Pairs with `draftFromCommand` above: a refusal names the slot it objects to,
 * and this is what makes the draft incomplete in exactly that place so
 * `fillSlot` can accept an answer for it. Every other slot survives, which is
 * the whole point — being told USDT is not accepted should not also cost you the
 * amount, the rate and the term you already stated.
 */
export function clearSlot(draft: Draft, slot: Slot): Draft {
  const next: Draft = { ...draft };
  // A guess from an earlier turn must not be what the next "yes" agrees to.
  next.suggest = undefined;
  if (slot === "amount") next.amount = undefined;
  else if (slot === "tokenIn") next.tokenIn = undefined;
  else if (slot === "tokenOut") next.tokenOut = undefined;
  else if (slot === "token") next.token = undefined;
  else if (slot === "recipient") next.to = undefined;
  else if (slot === "toChain") next.toChain = undefined;
  else if (slot === "rate") next.interestPct = undefined;
  else if (slot === "days") next.days = undefined;
  else if (slot === "ref") {
    next.refTarget = undefined;
    next.refId = undefined;
  }
  return next;
}

/** Promotes a draft to a command once every slot it needs is present. */
export function completeDraft(draft: Draft): ParseResult {
  if (draft.kind === "swap") {
    if (!draft.tokenIn) return incomplete(draft, "tokenIn");
    if (!draft.tokenOut) return incomplete(draft, "tokenOut");
    if (
      draft.tokenIn.address.toLowerCase() ===
      draft.tokenOut.address.toLowerCase()
    ) {
      return { status: "unknown" };
    }
    if (!draft.amount) return incomplete(draft, "amount");
    return {
      status: "ok",
      command: {
        kind: "swap",
        amount: draft.amount,
        tokenIn: draft.tokenIn,
        tokenOut: draft.tokenOut,
      },
    };
  }

  if (draft.kind === "stake") {
    if (!draft.amount) return incomplete(draft, "amount");
    return { status: "ok", command: { kind: "stake", amount: draft.amount } };
  }

  if (draft.kind === "repay") {
    return { status: "ok", command: { kind: "repay", loanId: draft.loanId } };
  }

  if (draft.kind === "cancel") {
    // "position" can reach here too — a pending cancel's "which one?" can be
    // answered with "position 42" via fillSlot, bypassing the check at the
    // parse site. Positions are removed, not cancelled; treat it the same as
    // no answer rather than let it through to an invalid CancelCommand.
    if (!draft.refTarget || draft.refTarget === "position") {
      return incomplete(
        { ...draft, refTarget: undefined, refId: undefined },
        "ref",
      );
    }
    if (draft.refId === undefined) return incomplete(draft, "ref");
    return {
      status: "ok",
      command: { kind: "cancel", target: draft.refTarget, id: draft.refId },
    };
  }

  if (draft.kind === "takeListing") {
    if (draft.refId === undefined) return incomplete(draft, "ref");
    if (!draft.amount) return incomplete(draft, "amount");
    return {
      status: "ok",
      command: {
        kind: "takeListing",
        listingId: draft.refId,
        amount: draft.amount,
      },
    };
  }

  if (draft.kind === "collectFees" || draft.kind === "removePosition") {
    if (draft.refId === undefined) return incomplete(draft, "ref");
    return {
      status: "ok",
      command: { kind: draft.kind, positionId: draft.refId },
    };
  }

  if (draft.kind === "fillRequest") {
    if (draft.refId === undefined) return incomplete(draft, "ref");
    return {
      status: "ok",
      command: { kind: "fillRequest", requestId: draft.refId },
    };
  }

  if (draft.kind === "borrow" || draft.kind === "lend") {
    if (!draft.token) return incomplete(draft, "token");
    if (!draft.amount) return incomplete(draft, "amount");
    if (draft.interestPct === undefined) return incomplete(draft, "rate");
    if (draft.days === undefined) return incomplete(draft, "days");
    return {
      status: "ok",
      command: {
        kind: draft.kind,
        amount: draft.amount,
        token: draft.token,
        interestPct: draft.interestPct,
        days: draft.days,
      },
    };
  }

  if (draft.kind === "lock" || draft.kind === "unlock") {
    if (!draft.amount) return incomplete(draft, "amount");
    return {
      status: "ok",
      command: { kind: draft.kind, amount: draft.amount },
    };
  }

  if (draft.kind === "completeWithdrawal") {
    if (!draft.token) return incomplete(draft, "token");
    return {
      status: "ok",
      command: { kind: "completeWithdrawal", token: draft.token },
    };
  }

  if (draft.kind === "send") {
    if (!draft.token) return incomplete(draft, "token");
    if (!draft.amount) return incomplete(draft, "amount");
    /* Asked last on purpose. The address is the one slot with no forgiving
       failure mode, so it gets answered against a question that already names
       the exact amount and token it will move. */
    if (!draft.to) return incomplete(draft, "recipient");
    return {
      status: "ok",
      command: {
        kind: "send",
        amount: draft.amount,
        token: draft.token,
        to: draft.to,
      },
    };
  }

  if (draft.kind === "bridge") {
    if (!draft.token) return incomplete(draft, "token");
    if (!draft.amount) return incomplete(draft, "amount");
    /* Destination last, mirroring send's recipient: it is the slot the resolver
       can still reject, so it is answered against a question that already names
       the amount and asset. */
    if (!draft.toChain) return incomplete(draft, "toChain");
    return {
      status: "ok",
      command: {
        kind: "bridge",
        amount: draft.amount,
        token: draft.token,
        toChain: draft.toChain,
      },
    };
  }

  if (draft.kind === "claimTestTokens") {
    /* Unreachable through parseCommand, which returns this kind directly and
       never builds a draft for it. It exists so that if one is ever constructed
       — fillSlot and completeDraft are both exported — it cannot fall through to
       the amount-plus-token tail below and ask for an amount the faucet ignores. */
    return { status: "ok", command: { kind: "claimTestTokens" } };
  }

  // approve, deposit, withdraw, mint, redeem
  if (!draft.token) return incomplete(draft, "token");
  if (!draft.amount) return incomplete(draft, "amount");
  return {
    status: "ok",
    command: { kind: draft.kind, amount: draft.amount, token: draft.token },
  };
}

/** Shown when the parser is the only thing available, or on `help`. */
export const COMMAND_HELP = [
  "receive",
  /* Beside receive because it is the other answer that needs no contract and no
     signature — and first among the reads because it is what someone checks
     before and after everything else on this list. */
  "my portfolio",
  /* The faucet, second, because on a testnet it is what makes every line below
     it possible — an empty wallet cannot swap. Terse forms to match the rest of
     this list, and both of them, because they are the two shapes: one asset by
     ticker, or everything that is due. Natural sentences work too — "claim USDC
     from the faucet" — but this list is reference, and reference is where the
     shortest form that works belongs. */
  "faucet USDC",
  "faucet all",
  // Deliberately elided rather than shown as a plausible full address: this
  // list is copy-pasteable, and a made-up 40-hex recipient that someone pastes
  // is an unrecoverable loss.
  "send 50 USDC to 0x…",
  "bridge 0.05 ETH to Base Sepolia",
  "swap 500 USDC to KLD",
  /* The purchase form, shown with the spent side named. "buy KLD" works too and
     asks two questions; this is the shape that resolves in one line, which is
     what a reference list is for. */
  "buy KLD with 500 USDC",
  "stake 100",
  "deposit 500 USDC",
  "withdraw 200 USDC",
  "borrow 500 USDC at 8% for 30 days",
  "lend 1000 USDC at 10% for 60 days",
  "repay",
  "cancel listing 3",
  "cancel request 7",
  "mint 500 USDC",
  "redeem 500 kfUSD",
  "lock 500",
  "unlock 200",
  "complete withdrawal to USDC",
  "claim yield",
  "compound yield",
  "collect fees position 42",
  "remove liquidity position 42",
].join("\n");
