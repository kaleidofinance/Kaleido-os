import s from "../pool.module.css";

/**
 * The verified tick on a pool this protocol's own deployer opened.
 *
 * It exists because the table cannot otherwise tell two pools apart that a reader
 * most needs to tell apart. `createPool` is permissionless and so is
 * `initialize` — anyone may open KLD/USDC at 0.05% and set its opening price to
 * whatever they like, and once they do, their pool and ours are the same pair at
 * the same tier in the same list, distinguishable only by an address nobody reads.
 * A visitor who picks the wrong one trades against a price somebody chose rather
 * than one an oracle set.
 *
 * WHAT IT CLAIMS, AND WHAT IT CAREFULLY DOES NOT
 *
 * That a run of ours created this pool and minted the first liquidity into it at
 * the diamond oracle's price. That is all, and the wording is deliberate:
 *
 *  - Not that we still hold that liquidity. Positions are NFTs and transferable.
 *  - Not that the price is still right. A seeded pool drifts with whoever trades
 *    it, and one of ours has: Sepolia's KLD/USDC sits at ~2.2x its seed price.
 *  - Not that the pool is deep, or safe, or endorsed. The row's own Liquidity
 *    column is the honest answer to the first of those and this badge is not a
 *    substitute for reading it.
 *
 * So the title says "opened and funded", not "verified pool" or "official price".
 * A badge that overstates itself is worse than no badge, because a reader trusts
 * it exactly once.
 *
 * ABSENCE IS NOT A NEGATIVE CLAIM
 *
 * No tick means "no deployment record for this address", which covers a pool a
 * stranger opened *and* one of ours whose record was never committed. That is why
 * there is no counterpart marking a pool as third-party: the evidence only ever
 * supports adding a tick, never withholding one. See `isSeededPool`.
 *
 * The label is off by default. In the pools table the tick sits on an identity
 * line that already carries a fee, a venue and a chain tag, and a fourth text run
 * there costs a wrap on narrow rows; the detail page has room for the word, and
 * that is the page where a reader is deciding rather than scanning.
 *
 * Imports the section stylesheet rather than taking a className, like `ChainTag`
 * and `PairIcon` beside it.
 */
export default function SeededTick({ label = false }: { label?: boolean }) {
  return (
    <span
      className={s.seededTick}
      title="Opened and funded by the Kaleido deployer at an oracle price. Not a claim about this pool's price or depth today."
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 16 16"
        role="img"
        aria-label="Opened by the Kaleido deployer"
      >
        <circle cx="8" cy="8" r="8" fill="currentColor" />
        {/* Knocked out in the card's own colour rather than white, so the tick
            reads as cut out of the badge in both themes — white on the light
            theme's brand green, near-black on the dark theme's. */}
        <path
          d="M4.5 8.4 6.8 10.7 11.5 5.7"
          fill="none"
          stroke="var(--k-card)"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {label ? "Kaleido-seeded" : null}
    </span>
  );
}
