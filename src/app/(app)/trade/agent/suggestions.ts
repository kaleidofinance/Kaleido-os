import type { IntentKind } from "@/lib/v2/intents/types";

/*
 * Product-specific starting points on the agent's empty card. Clicking one
 * *fills the prompt box* — it does not send. See fillPrompt in page.tsx for why.
 *
 * Its own module, and not for reuse: the page is the only importer. It is here so
 * that `suggestions.test.ts` can run the list through the real parser under plain
 * tsx, which page.tsx cannot offer it — importing the page pulls in React, a CSS
 * module and a dozen wallet hooks. The property being protected is narrow and
 * worth the file: a chip that reads well and parses to "unknown" is a button that
 * silently costs a model credit to fail.
 *
 * ── TWO THINGS THIS LIST NOW RESPECTS ─────────────────────────────────────────
 *
 * 1. The testnet toggle. Most of the surfaces below — the faucet, KLD, staking,
 *    the kfUSD stablecoin, lending — are not deployed on the Arc mainnet the app
 *    defaults to, so offering "claim from the faucet" or "stake 100 KLD" to a
 *    mainnet wallet is a chip that lands on something that isn't there. Each entry
 *    is tagged `testnetOnly`, and `computeSuggestions` drops those when the
 *    testnet toggle is off. What survives on mainnet is what Arc actually does:
 *    swap through the aggregator, wrap USDC, bridge out, read your own address.
 *
 * 2. What you did last. A first-time wallet sees the default order; a wallet that
 *    just swapped sees the natural next step (bridge it out) promoted, and the
 *    thing it just did demoted rather than offered again. The signal is the recent
 *    transaction kinds the page reads from the tx log — see `computeSuggestions`.
 *
 * ── THE INVARIANTS THAT DID NOT CHANGE ────────────────────────────────────────
 *
 * Because the text lands in an editable box the user then reads, the chip *is* the
 * request — clicking pastes exactly what the chip says. Every entry is a whole
 * request, not a bare verb ("show my address", never "receive"): a row of verbs is
 * the parser's keyword list leaking into the UI. And every entry parses to a
 * KNOWN command, asserted in suggestions.test.ts, because a chip that reaches the
 * model to fail is the exact button this file exists to prevent.
 *
 * Mint is the one entry whose label and box differ, and it is a grammar constraint
 * not a style choice: the parser binds mint's token as the *collateral*, so "mint
 * 500 kfUSD" resolves to kfUSD-as-collateral and the planner rejects it. "mint 500
 * USDC" is the phrasing that plans. The faucet asks for "everything" due rather
 * than a named asset, because which assets a faucet stocks differs per chain.
 */

/** One starting-point chip, with the metadata `computeSuggestions` ranks it by. */
interface Suggestion {
  /** The request, pasted verbatim on click and parsed as-is. */
  prompt: string;
  /**
   * True when the surface it opens is not on the Arc mainnet the app defaults to
   * (the faucet, KLD, staking, kfUSD, lending). Dropped when the testnet toggle is
   * off. False for what Arc does natively — swaps, wrapping, bridging, reads.
   */
  testnetOnly: boolean;
  /**
   * Its own action, so a wallet that just did this is not offered it straight
   * back. Absent for a read (a chip you can press twice without cost).
   */
  kind?: IntentKind;
  /**
   * Recent actions after which this is the natural next step, promoted when one of
   * them is what the wallet last did — swap, then bridge it somewhere.
   */
  follows?: IntentKind[];
}

/*
 * The pool. Order is the default ranking (what a first-time wallet sees), and the
 * mainnet-valid entries lead so that dropping the testnet ones leaves a sensible
 * list rather than a gap. Every prompt parses — the test proves it — against the
 * tokens the page passes from `chainTokens(chainId)`.
 */
const POOL: Suggestion[] = [
  /* ---- live on Arc mainnet (and on the testnets) ---- */
  { prompt: "swap 100 USDC to EURC", testnetOnly: false, kind: "swap", follows: ["bridge", "wrapNative"] },
  { prompt: "bridge 100 USDC to Base", testnetOnly: false, kind: "bridge", follows: ["swap", "aggregatorSwap", "wrapNative"] },
  { prompt: "swap 100 USDC to WUSDC", testnetOnly: false, kind: "wrapNative" },
  { prompt: "show my address", testnetOnly: false },
  /* ---- testnet-only surfaces (faucet, KLD, staking, kfUSD, lending) ---- */
  { prompt: "claim everything from the faucet", testnetOnly: true, kind: "claimTestTokens" },
  { prompt: "swap 500 USDC to KLD", testnetOnly: true, kind: "swap", follows: ["claimTestTokens"] },
  { prompt: "stake 100 KLD", testnetOnly: true, kind: "stake", follows: ["swap", "claimTestTokens"] },
  { prompt: "mint 500 USDC", testnetOnly: true, kind: "mintStable" },
  { prompt: "lend 1,000 USDC at 10% for 60 days", testnetOnly: true },
  { prompt: "borrow 500 USDC at 8% for 30 days", testnetOnly: true },
];

export interface SuggestionContext {
  /** From `useTestnetMode()`. False (mainnet) drops every `testnetOnly` entry. */
  showTestnets: boolean;
  /**
   * The wallet's recent transaction kinds, newest first, from the tx log. Empty
   * for a fresh wallet, which simply gets the default order.
   */
  recentKinds?: IntentKind[];
  /** How many chips to return. Defaults to a fuller row on testnet. */
  limit?: number;
}

/**
 * The chips to show, mode-gated and ranked by what the wallet last did.
 *
 * Pure and page-free so the test can exercise it directly. Ranking is a stable
 * reorder of the surviving pool: a chip is promoted when the wallet's last action
 * is one it naturally follows, and demoted when the wallet just did that exact
 * action — so "swap" is not the top chip for someone who just swapped. Ties keep
 * pool order, which is why the mainnet-valid entries are listed first.
 */
export function computeSuggestions(ctx: SuggestionContext): string[] {
  const { showTestnets, recentKinds = [], limit } = ctx;
  const cap = limit ?? (showTestnets ? 7 : 4);

  const pool = POOL.filter((s) => showTestnets || !s.testnetOnly);
  const last = recentKinds[0];
  const recent = new Set(recentKinds);

  const score = (s: Suggestion): number => {
    let n = 0;
    if (last && s.follows?.includes(last)) n += 2; // the natural next step
    if (s.kind && recent.has(s.kind)) n -= 1; // don't offer back what was just done
    return n;
  };

  return pool
    .map((s, i) => ({ s, i }))
    /* Stable: higher score first, original order within a score. */
    .sort((a, b) => score(b.s) - score(a.s) || a.i - b.i)
    .slice(0, cap)
    .map(({ s }) => s.prompt);
}
