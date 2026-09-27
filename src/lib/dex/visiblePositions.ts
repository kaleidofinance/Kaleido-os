/**
 * Which V3 positions the Positions page lists.
 *
 * A position NFT outlives its liquidity. Removing 100% is two writes —
 * `decreaseLiquidity`, then `collect` — and when the second one never lands
 * (rejected in the wallet, reverted, tab closed) the withdrawn tokens and every
 * fee earned sit on the NFT as `tokensOwed`, with liquidity 0. The page used to
 * list only liquidity > 0, so exactly those positions vanished together with
 * their Collect button, while the Portfolio still showed the fees as "Ready to
 * claim". A closed position stays listed while it holds anything a `collect`
 * would pay; once it's swept, it drops off.
 */

export interface PositionFees {
  liquidity: string;
  tokensOwed0: string;
  tokensOwed1: string;
  /** The live figure (feeGrowth); null when the pool's reads failed. */
  uncollectedFees0?: string | null;
  uncollectedFees1?: string | null;
}

const big = (v: string | null | undefined): bigint => {
  try {
    return v ? BigInt(v) : 0n;
  } catch {
    return 0n;
  }
};

/** What a `collect` would pay, per token — the live figure, else the checkpoint. */
export function owedAmounts(p: PositionFees): [bigint, bigint] {
  return [
    big(p.uncollectedFees0 ?? p.tokensOwed0),
    big(p.uncollectedFees1 ?? p.tokensOwed1),
  ];
}

export function isClosed(p: PositionFees): boolean {
  return big(p.liquidity) === 0n;
}

/** Liquidity gone, but something is still owed to the owner. */
export function isClosedWithFees(p: PositionFees): boolean {
  const [a, b] = owedAmounts(p);
  return isClosed(p) && (a > 0n || b > 0n);
}

/** Open positions first (in their order), then closed ones still owed tokens. */
export function positionsToShow<T extends PositionFees>(positions: T[]): T[] {
  return [
    ...positions.filter((p) => !isClosed(p)),
    ...positions.filter(isClosedWithFees),
  ];
}
