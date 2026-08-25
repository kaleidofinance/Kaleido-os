/**
 * Amount redaction, shared by the browser and the push sender.
 *
 * Lives in its own module — not in deliver.ts — because deliver.ts is a client
 * module and /api/push/send needs this on the server. Importing a `"use client"`
 * module from a route handler drags a client boundary somewhere it does not
 * belong.
 *
 * WHY THIS EXISTS AT ALL. Web-push payloads are encrypted end-to-end to the
 * subscriber, so an amount is safe in transit. The exposure is physical: the
 * notification body renders on a lock screen, in a café, to whoever is behind
 * you. This app already declines to publish USD position sizes anywhere public
 * because a list of who holds what is a target list; a lock screen is the same
 * disclosure with a smaller audience and a more specific victim.
 *
 * Deliberately blunt. It over-redacts — a term length like "30 days" survives,
 * but "1.4" health factor becomes "—" if it happens to be followed by a ticker.
 * Losing a number from a toast costs a tap to open the app. Leaking one costs
 * more.
 */

/** Replaces currency-looking numbers with an em dash. */
export function redactAmounts(text: string): string {
  return text
    .replace(/\$\s?[\d,]+(?:\.\d+)?/g, "$—")
    .replace(
      /\b[\d,]+(?:\.\d+)?\s?(USDC|USDT|kfUSD|USD|DAI|WETH|ETH|KLD|BTC)\b/gi,
      "— $1",
    );
}
