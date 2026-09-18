import type { ITradingPair } from "@/constants/types/dex";

/** Keep a known-good snapshot when a bounded RPC sweep loses most of its rows. */
export function shouldAcceptPoolSnapshot(
  previous: readonly ITradingPair[] | null,
  next: readonly ITradingPair[],
): boolean {
  if (!previous || previous.length < 2) return next.length > 0;
  return next.length >= Math.ceil(previous.length * 0.5);
}
