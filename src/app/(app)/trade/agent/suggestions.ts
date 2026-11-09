import type { IntentKind } from "@/lib/v2/intents/types";

/**
 * Starting-point chips are a small reflection of the wallet, not a product
 * catalogue. They are shown inside the empty Luca transcript, so every chip
 * must be a complete read the parser can understand without inventing a token,
 * chain, amount, or testnet-only product.
 *
 * The old pool contained canned swaps, faucet claims, staking, minting, and
 * lending examples. That made a fresh wallet look like it had used those
 * products and leaked testnet actions into the mainnet composer. This module now
 * builds only from two live signals: symbols the wallet actually holds and
 * products/actions recorded in this wallet's transaction log.
 *
 * With no signal, the only suggestions are universal reads. Once activity or a
 * balance exists, the row becomes a useful follow-up to that real state.
 */

export interface SuggestionActivity {
  kind: IntentKind;
  title?: string;
  status?: "pending" | "confirmed" | "reverted";
}

export interface SuggestionContext {
  /** Recent wallet activity, newest first. */
  recentEntries?: readonly SuggestionActivity[];
  /** Kept for callers/tests that already have only the compact activity signal. */
  recentKinds?: readonly IntentKind[];
  /** Non-zero symbols measured from the connected wallet's live balances. */
  walletSymbols?: readonly string[];
  /** The maximum number of chips to render. Defaults to four. */
  limit?: number;
}

const UNIVERSAL = ["my portfolio", "show my address"];

const READABLE_ACTIVITY = new Set<IntentKind>([
  "swap",
  "swapMultiHop",
  "aggregatorSwap",
  "bridge",
  "stake",
  "requestStakeWithdrawal",
  "withdrawStake",
  "depositCollateral",
  "withdrawCollateral",
  "repayLoan",
  "createLendingRequest",
  "createLoanListing",
  "borrowFromListing",
  "fillRequest",
  "mintStable",
  "redeemStable",
  "lockStable",
  "requestStableWithdrawal",
  "completeStableWithdrawal",
  "claimStableYield",
  "compoundStableYield",
  "mintPoolPosition",
  "collectPoolFees",
  "increasePoolLiquidity",
  "decreasePoolLiquidity",
]);

function cleanSymbol(symbol: string): string | null {
  const value = symbol.trim().toUpperCase();
  return /^[A-Z][A-Z0-9]{1,11}$/.test(value) ? value : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** A live-balance read; no amount or destination is guessed. */
function balancePrompt(symbol: string): string {
  return `how much ${symbol} do I have`;
}

/**
 * The activity signal controls whether balance follow-ups are meaningful. It
 * never fabricates a follow-up trade from an old title or a testnet fixture.
 */
function activityScore(
  kind: IntentKind,
  recentEntries: readonly SuggestionActivity[],
): number {
  const index = recentEntries.findIndex(
    (entry) => entry.kind === kind && entry.status !== "reverted",
  );
  return index < 0 ? 0 : Math.max(1, 6 - index);
}

export function computeSuggestions(ctx: SuggestionContext): string[] {
  const entries =
    ctx.recentEntries ??
    (ctx.recentKinds ?? []).map((kind) => ({
      kind,
      status: "confirmed" as const,
    }));
  const symbols = unique(
    (ctx.walletSymbols ?? [])
      .map(cleanSymbol)
      .filter((symbol): symbol is string => Boolean(symbol)),
  );
  const cap = Math.max(1, Math.min(ctx.limit ?? 4, 6));
  const usedActivity = entries.some(
    (entry) => entry.status !== "reverted" && READABLE_ACTIVITY.has(entry.kind),
  );

  const candidates = [...symbols.slice(0, 3).map(balancePrompt), ...UNIVERSAL];

  /* A wallet with no recorded activity gets only the two universal reads. This
     boundary prevents testnet mode, mock data, and a static pool from surfacing
     faucet, stake, mint, lending, or arbitrary swap actions. */
  const relevant = usedActivity || symbols.length > 0 ? candidates : UNIVERSAL;
  return unique(relevant)
    .sort((a, b) => {
      const aIsBalance = a.startsWith("how much ");
      const bIsBalance = b.startsWith("how much ");
      if (aIsBalance !== bIsBalance) return aIsBalance ? -1 : 1;
      return 0;
    })
    .slice(0, cap);
}

/* Exported for focused tests and future ranking work without exposing a second
   UI concept in the page component. */
export const scoreSuggestionActivity = activityScore;
