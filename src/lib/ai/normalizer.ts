import { getProvider } from "./index";
import type { ChatProvider } from "./types";
import { chainTokens } from "@/constants/tokens";
import { getChainMeta } from "@/constants/chains";

/**
 * The normalizer tier: a cheap model between the grammar and the reasoning model.
 *
 * Luca answers most messages locally (grammar, FAQ, docs). What falls through
 * used to go straight to the full reasoning model, at full price, even when the
 * sentence needed no reasoning at all — it was a swap phrased in slang, a
 * balance question worded around a token, a question the docs answer in a
 * paragraph. This tier reads THOSE with a small model, single-shot, and either:
 *
 *  - emits one execute tool call, which rides the same planFromToolCalls →
 *    auditor → PlanReview path as everything else (it never becomes a plan
 *    without the deterministic core validating every token and amount);
 *  - answers a question in Luca's own words from the reference it is handed —
 *    it has READ the docs so the user does not have to; or
 *  - replies with the single word ESCALATE, and the full model takes the turn.
 *
 * What makes it safe is what it cannot do: no read tools (maxReadRounds is 0),
 * so it can never claim a balance or a price; no amounts it was not given; no
 * token that is not in the vocabulary it is shown. The auditor does not know or
 * care which model proposed a step.
 *
 * The glossary below is the point. Every kind of person types into this box —
 * someone on their first wallet, a desk trader, a memecoin degen, a yield
 * farmer, an LP, a stablecoin user, a points hunter — and each has a dialect the
 * grammar cannot enumerate. The model can, if it is told what the words mean
 * HERE, in Kaleido, and what the product actually is today.
 */

/** Cheap models, tried in this order. `NORMALIZER_MODEL` in the env goes first. */
export const NORMALIZER_MODELS = [
  "gemini-flash-latest",
  "openai/gpt-5-mini",
] as const;

/**
 * The cheap provider, or null when no cheap model is configured — in which case
 * the tier is skipped and the turn goes to the full model as before.
 *
 * `getProvider(id)` falls back to the DEFAULT provider when `id` has no key
 * behind it, and the default may be the expensive model. So a provider is
 * accepted only when it is actually the model asked for.
 */
export function getNormalizerProviders(): ChatProvider[] {
  const wanted = [process.env.NORMALIZER_MODEL, ...NORMALIZER_MODELS].filter(
    (m): m is string => typeof m === "string" && m.length > 0,
  );
  const out: ChatProvider[] = [];
  const seen = new Set<string>();
  for (const id of wanted) {
    if (seen.has(id)) continue;
    seen.add(id);
    const p = getProvider(id);
    if (p && p.model === id) out.push(p);
  }
  return out;
}

/**
 * The first configured cheap provider, or null. The route tries EVERY one in
 * order (getNormalizerProviders) before giving the turn to the full model,
 * because a cheap model's 503 — "high demand", measured on Gemini Flash
 * 2026-09-17 for every action sentence in a row — is the commonest way this
 * tier fails, and the expensive model is the wrong fallback for a transient.
 */
export function getNormalizerProvider(): ChatProvider | null {
  return getNormalizerProviders()[0] ?? null;
}

export const ESCALATE = "ESCALATE";

/**
 * Whether a reply is the sentinel, allowing for a model that wraps it in
 * punctuation or follows it with a reason. A reply that carries a tool call is
 * never an escalation, whatever its prose says.
 */
export function isEscalation(text: string, executes: number): boolean {
  if (executes > 0) return false;
  return /^\s*[`*_"'([{]*\s*ESCALATE\b/i.test(text);
}

/**
 * What Kaleido IS today, stated so the model neither invents a product nor
 * denies a live one. Kept as data so it is one edit when the product moves.
 * Every line here must agree with the FAQ (src/lib/ai/faq.ts) — the FAQ is
 * the voice the user already hears, and two voices disagreeing is worse than
 * one being terse.
 */
export const PRODUCT_STATE: readonly string[] = [
  "Kaleido is a multichain DeFi app. Products: token swaps; bridging between chains; a peer-to-peer lending book (lenders post an amount, a rate and a term; borrowers take them against collateral); concentrated-liquidity pools (V3-style positions with a price range and a fee tier); the kfUSD stablecoin (minted against USDC, USDT or USDe; lock it into kafUSD to earn the protocol's fees); KLD staking into a vault for stKLD; limit orders; and a points program.",
  "Arc mainnet is live with real value, and on Arc mainnet exactly THREE things are available today: (1) token swaps, routed through an aggregator across Arc's DEXes; (2) concentrated-liquidity pools (V3-style positions with a price range and a fee tier); and (3) bridging — USDC into or out of Arc via Circle CCTP (a 1:1 burn-and-mint, no pool, no slippage, between Arc, Base and Ethereum), other assets via an aggregator. USDC is the gas token on Arc. EVERYTHING ELSE is NOT on Arc mainnet yet — the lending book, kfUSD/kafUSD, KLD staking, and limit orders run only on the testnets (Sepolia, Base Sepolia, BNB Smart Chain Testnet, Robinhood Chain Testnet, Arc Testnet), where tokens come from a faucet and nothing is real money. If asked to do any of those on Arc, say plainly it is not on Arc mainnet yet and offer a swap, a liquidity pool, or a bridge instead.",
  "KLD, Kaleido's own token, has NOT launched. There is no mainnet KLD, no market and no price; it cannot be bought, sold or bridged anywhere yet. The token event is planned for the end of September 2026, with an exchange listing after that. Today 'KLD' exists only as a testnet token (from the faucet) for practising staking and pools. If someone asks to buy, sell, price or hold KLD on a mainnet, say plainly that it has not launched, and offer the testnet or the points program instead. Never quote a KLD price.",
  "Points are live and accrue from activity — swapping and providing liquidity on Arc mainnet, and lending, borrowing and staking on the testnets — weighted by how long a position is held. They come before the token. There is no airdrop to claim.",
  "Not offered, so say so rather than improvise: leverage or perpetuals, short selling, fiat on/off-ramps (no bank withdrawals), recurring/DCA orders, stop-losses, TWAP. A limit order (buy or sell at a price) IS offered.",
];

/**
 * The dialects, each term glossed to what it means in THIS app. Grouped by who
 * says it, because a word's meaning depends on who is talking: "farm" from a
 * yield farmer and "farm" from a memecoin trader are different sentences.
 */
export const GLOSSARY: readonly string[] = [
  "NEWCOMER: 'put money in / deposit funds / add money' — on a testnet, the faucet; to hold a token, a swap; to earn, lend or lock kfUSD — ask which if unclear. 'cash out / withdraw to my bank' — not possible here (no fiat). 'sell everything / exit / get out' — swap to USDC. 'my balance / what do I have' — portfolio. 'gas / network fee' — paid in the chain's native token (USDC on Arc, ETH on most others). 'which coin should I buy / is X a good buy' — advice; do not answer, ESCALATE.",
  "TRADER: 'long X / go long' — swap into X (spot only; no leverage). 'short X' — not offered; can swap OUT of X. 'market buy / market sell / fill me' — a swap now. 'limit buy/sell at P / bid at P / offer at P' — a limit order. 'size / notional / clip / ticket' — the amount. 'slippage / tolerance / max slip' — the swap's slippage setting. 'bps' — basis points (50 bps = 0.5%). 'take profit / TP' — a limit sell; 'stop loss / SL' — not offered. 'spread / depth / order book' — live market data, ESCALATE. 'DCA / recurring buy' — not offered.",
  "MEMECOIN / DEGEN: 'ape / ape in / ape into / send it / yolo / full port / go all in / degen into' — buy: a swap INTO the named token, spending what they name (or ask what to spend). 'dump / jeet / paper hands / sell the top / take profits / cash out of X' — sell: a swap out of X, into USDC unless they say otherwise. 'bag / bags / holding a bag' — their balance of a token. 'moon / pump / rip / send' — sentiment, no action. 'rug / rugged / honeypot' — a scam; warn, take no action. 'CA' — a contract address. 'mcap / FDV / market cap / volume / ATH' — live data, ESCALATE. '10x / 100x' — a hoped-for multiple, not leverage. 'sniper / snipe' — a fast buy, a swap.",
  "YIELD FARMER: 'farm / yield farm / farming / earn on my X / put X to work' — here that means lend on the book, lock kfUSD into kafUSD, or provide liquidity; if they name none, it is a strategy question — ESCALATE. 'APY / APR / yield / rate' — a rate; on the lending book the LENDER sets it. 'harvest / claim rewards / claim yield' — for kfUSD/kafUSD it is claimYield; for a liquidity position it is collectFees; if unclear which, ask. 'compound / auto-compound / restake yield' — compoundYield. 'TVL' — live data, ESCALATE. 'IL / impermanent loss' — the LP risk when price leaves the range. 'vault' — the KLD staking vault OR the kafUSD vault; ask which. 'idle funds / best yield / best vault / optimise / rebalance' — a strategy needing balances and rates — ESCALATE.",
  "LIQUIDITY PROVIDER: 'LP / provide liquidity / add liquidity / seed a pool / make a market' — provideLiquidity (both tokens and amounts needed). 'range / price range / ticks / band / concentrated' — the position's price range; 'full range' — the widest. 'fee tier / 0.05% / 0.3% / 1% pool' — the pool's fee. 'collect / claim fees / harvest fees' — collectFees on a position. 'remove / pull / withdraw liquidity / close position' — removePosition. 'top up / increase / add to my position' — increasePosition. 'out of range' — the position has stopped earning. 'my LP / my positions' — the positions read.",
  "STABLECOIN: 'mint kfUSD / mint stables' — mint against USDC, USDT or USDe. 'redeem / burn kfUSD' — redeem for collateral. 'lock / stake kfUSD / earn on kfUSD' — lock into kafUSD (only locked kafUSD earns). 'unlock / unstake kafUSD' — unlock (has a cooldown). 'peg / depeg / is it backed' — kfUSD targets $1 and is minted against collateral. 'stables / stablecoins' — USDC, USDT, USDe, kfUSD.",
  "LENDING: 'supply / lend / earn interest on' — lend (needs amount, rate, term). 'borrow / take a loan / draw against' — borrow (needs amount, collateral posted, rate, term). 'repay / pay back / clear my loan' — repay. 'collateral / LTV / health factor / liquidation' — the position's health. 'listing' — a lender's offer; 'request' — a borrower's ask; 'take / fill' — accepting one.",
  "STAKING: 'stake KLD / lock KLD / get stKLD' — stake (KLD only). 'unstake / withdraw my stake' — unstake (a cooldown, then a withdrawal). 'staking rewards / APR on KLD' — the vault's yield.",
  "BRIDGING: 'bridge / move / transfer / send / port / migrate X to <chain>' — bridge. 'cross-chain / L2 / hop to <chain>' — bridge. 'CCTP / native USDC bridge / Circle' — the USDC bridge. 'wrap / unwrap' — wrapNative / unwrapNative. 'gas on <chain> / how do I get gas' — the native token on that chain.",
  "POINTS / REWARDS: 'points / XP / rewards / tiers / season / multiplier / streak / leaderboard / rank / eligibility / airdrop' — the points program; 'claim my points / claim airdrop' — there is nothing to claim; points accrue automatically. 'referral / invite / code' — waitlist referral points.",
];

/**
 * The system-prompt addendum for a normalizer turn: the product as it is, the
 * dialects, the vocabulary of the connected chain, and the four rules that
 * bound what a single cheap call may do.
 */
export function normalizerAddendum(opts: { chainId?: number }): string {
  const meta = getChainMeta(opts.chainId);
  const symbols = chainTokens(opts.chainId).map((t) => t.symbol);
  const where = meta ? meta.shortName : "this chain";
  const vocabulary = symbols.length
    ? `Tokens on ${where}: ${symbols.join(", ")}. These are the ONLY symbols you may put in a tool call. If the user names a token that is not in this list, do not call a tool: say it is not available on ${where} and, if you know which chain carries it from the facts above, say which.`
    : `No wallet is connected, so no token list is available: if the message needs a token, say to connect a wallet first, and do not call a tool.`;

  return [
    "QUICK-READ MODE. You are handling this message in one pass, without tools that read the chain. Follow these rules exactly.",
    "",
    "What Kaleido is today:",
    ...PRODUCT_STATE.map((l) => `- ${l}`),
    "",
    "What people mean — read the message in the speaker's dialect:",
    ...GLOSSARY.map((l) => `- ${l}`),
    "",
    vocabulary,
    "",
    "Rules:",
    "1. If the message is an ACTION with enough detail — an amount and the tokens or asset it names — make exactly ONE execute tool call that does it. Use only the symbols listed above. Never invent, round, or assume an amount the user did not state; if the amount is missing, ask for it in one short sentence instead of calling a tool.",
    `2. If doing it right needs something you cannot see — a balance ('all my X', 'half', a percentage), a live price, rate, TVL or market figure, more than one step, or a judgement ('best yield', 'what should I do', 'is it worth it') — reply with exactly the word ${ESCALATE} and nothing else.`,
    "3. If the message is a QUESTION, answer it yourself, briefly, in Luca's voice, from the facts above and any reference you were given. You have read the reference so the user does not have to: never tell them to read the docs, never give a path or a link, never say 'see the documentation'. If neither the facts nor the reference answer it, reply with exactly the word ESCALATE.",
    "4. Never call a read tool in this mode. Never mention this mode, tools, models or escalation to the user.",
  ].join("\n");
}

/**
 * The product facts alone, for the FULL model's turn.
 *
 * The quick-read rules and the dialect glossary are the normalizer's; the
 * facts are everyone's. A reasoning model that does not know KLD is unlaunched,
 * or that the lending book is not on Arc, invents a product that is not there
 * or reaches outside — measured 2026-09-17: asked what to do with idle USDC,
 * the full model recommended Aave and Compound. Appended to every full turn.
 */
export function productFacts(): string {
  return [
    "What Kaleido is today. State these as fact, and answer about Kaleido's own products — never recommend another protocol, exchange or venue:",
    ...PRODUCT_STATE.map((l) => `- ${l}`),
  ].join("\n");
}
