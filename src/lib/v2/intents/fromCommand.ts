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

/* Pool. Both act on an existing position by id — never a mint, which needs a
 * tick range the parser has no business inventing. */
export interface CollectFeesCommand {
  kind: "collectFees";
  positionId: number;
}
export interface RemovePositionCommand {
  kind: "removePosition";
  positionId: number;
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

export type Command =
  | SwapCommand
  | StakeCommand
  | ApproveCommand
  | SendCommand
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
  | ProvideLiquidityCommand
  | ClaimTestTokensCommand
  | HelpCommand
  | ReceiveCommand;

/** Kinds resolved immediately, with no slot to ever ask about. */
type ZeroSlotKind = "claimYield" | "compoundYield";

/**
 * Kinds that only ever arrive already complete, from a tool call.
 *
 * One member, and it is not a gap left for later. Opening a position needs two
 * tokens, two amounts, a fee tier and a range — six values against a `Slot` union
 * whose token slots are `tokenIn`/`tokenOut`/`token` and whose only amount is
 * `amount`, so the draft machinery cannot hold it half-specified without growing
 * a second amount and a second token that no other verb would use.
 *
 * Falling through to the model is the better path rather than the fallback one.
 * "add some liquidity to the USDT/USDe pool" reaches `provideLiquidity` in the
 * tool catalog, where the model collects both sides conversationally and calls
 * once with everything; a `VERBS` entry would instead take "provide 100 usdt"
 * into a Draft that can never be completed. Excluded here rather than given an
 * empty verb list so the omission is stated, not silent.
 */
type ToolOnlyKind = "provideLiquidity";

/** Kinds that carry slots, i.e. everything that can be half-specified. */
export type ActionKind = Exclude<
  Command["kind"],
  "help" | "receive" | ZeroSlotKind | ToolOnlyKind
>;

export type Slot =
  | "amount"
  | "tokenIn"
  | "tokenOut"
  | "token"
  | "recipient"
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
  interestPct?: number;
  days?: number;
  loanId?: number;
  /** Which row a command points at, e.g. listing 3, or position 42. */
  refTarget?: "listing" | "request" | "position";
  refId?: number;
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
 */
const VERBS: Record<ActionKind, string[]> = {
  swap: ["swap", "trade", "convert", "exchange", "sell"],
  stake: ["stake"],
  approve: ["approve", "allow"],
  /* No "pay". "pay back my loan" and "pay off my loan" are repayments, and a
     money verb with two readings is precisely what the note above says should
     fall through to the model rather than resolve to the closer guess. "send"
     and "transfer" have one reading each. */
  send: ["send", "transfer"],
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

/** Words separating the two sides of a swap. */
const SEPARATORS = ["to", "for", "into", "->", "→", ">"];

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
  rate: "What interest rate? (e.g. 8%)",
  days: "Over what term? (e.g. 30 days)",
  ref: "Which one? For example: listing 3, request 7, or position 42.",
};

function incomplete(draft: Draft, missing: Slot): ParseResult {
  return { status: "incomplete", draft, missing, prompt: PROMPTS[missing] };
}

/* ------------------------------------------------------------------ parse -- */

function normalise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s.,%>→-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function detectVerb(words: string[]): { kind: ActionKind; at: number } | null {
  for (let i = 0; i < words.length; i++) {
    for (const kind of Object.keys(VERBS) as ActionKind[]) {
      if (VERBS[kind].includes(words[i])) return { kind, at: i };
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
        : w === "request" || w === "requests"
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
     * The word immediately after it, and only that word. Loose phrasings
     * ("get me some usdt from the faucet") are left to the model, which has a
     * `token` parameter for exactly this and no positional guessing to do —
     * the same bargain the note on VERBS makes about near misses.
     */
    const next = words[faucetAt + 1];
    const symbol =
      next && /^[a-z][a-z0-9]{1,11}$/.test(next) && !FAUCET_FILLERS.has(next)
        ? next
        : undefined;
    return { status: "ok", command: { kind: "claimTestTokens", symbol } };
  }

  // Checked ahead of the slotted verbs: these take no argument at all, so
  // there's nothing for the draft machinery to do.
  for (const kind of Object.keys(ZERO_SLOT_VERBS) as ZeroSlotKind[]) {
    if (words.some((w) => ZERO_SLOT_VERBS[kind].includes(w))) {
      return { status: "ok", command: { kind } as Command };
    }
  }

  const verb = detectVerb(words);
  if (!verb) return { status: "unknown" };

  // Rate and term claim their numbers first so the amount can't be read off
  // either of them. An address can't be read as an amount (the "0x" stops
  // parseAmount cold), but it claims its position anyway so that stays true by
  // construction rather than by coincidence.
  const rate = detectRate(words);
  const duration = detectDuration(words);
  const ref = detectRef(words);
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
    return parseSwap(words, amount, mentions);
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
    });
  }

  if (verb.kind === "stake") {
    // Stake is KLD-only in the vault, so the token needs no disambiguation.
    if (!amount) return incomplete({ kind: "stake" }, "amount");
    return { status: "ok", command: { kind: "stake", amount: amount.amount } };
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
    if (!token) return incomplete({ kind: "completeWithdrawal" }, "token");
    return { status: "ok", command: { kind: "completeWithdrawal", token } };
  }

  // deposit, withdraw, approve, mint, redeem — all amount plus token.
  return completeDraft({
    kind: verb.kind,
    amount: amount?.amount,
    token: mentions[0]?.token,
  });
}

function parseSwap(
  words: string[],
  amount: { amount: string; index: number } | null,
  mentions: Mention[],
): ParseResult {
  const sepAt = words.findIndex((w) => SEPARATORS.includes(w));

  let tokenIn: IToken | undefined;
  let tokenOut: IToken | undefined;

  if (sepAt >= 0) {
    // "swap 500 usdc to kld" — the separator disambiguates the two sides even
    // when only one of them is named.
    tokenIn = mentions.find((m) => m.index < sepAt)?.token;
    tokenOut = mentions.find((m) => m.index > sepAt)?.token;
  } else if (mentions.length >= 2) {
    // "swap 500 usdc kld" — positional fallback.
    tokenIn = mentions[0].token;
    tokenOut = mentions[1].token;
  } else if (mentions.length === 1) {
    tokenIn = mentions[0].token;
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

/* --------------------------------------------------------- slot filling -- */

/**
 * Applies a bare reply ("kld", "500") to the slot a previous turn asked about.
 * This is the whole point of tracking drafts: a missing parameter costs one
 * cheap follow-up question instead of a model call.
 */
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
  } else {
    const token = findTokenMentions(words, tokens)[0]?.token;
    if (!token) return incomplete(draft, missing);
    if (missing === "tokenIn") next.tokenIn = token;
    else if (missing === "tokenOut") next.tokenOut = token;
    else next.token = token;
  }

  return completeDraft(next);
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
  // Deliberately elided rather than shown as a plausible full address: this
  // list is copy-pasteable, and a made-up 40-hex recipient that someone pastes
  // is an unrecoverable loss.
  "send 50 USDC to 0x…",
  "swap 500 USDC to KLD",
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
