import s from "./VerifiedBadge.module.css";

/**
 * Why a token is verified, phrased for the person checking it is not a clone.
 * An official stock token and a core asset are both verified but for reasons a
 * user weighs differently, so the badge says which.
 */
export function verifiedTitleFor(tags?: string[]): string {
  if (tags?.includes("stock"))
    return "Official Robinhood Stock Token — the canonical address, not a look-alike";
  if (tags?.includes("stablecoin")) return "Verified stablecoin";
  if (tags?.includes("wrapped-native"))
    return "Verified — the chain's canonical wrapped native";
  return "Verified — a canonical token on Kaleido's curated list";
}

/**
 * The trust checkmark for a token: this is the CANONICAL asset at this address,
 * not a look-alike. It is shown wherever a token is named for the user to choose
 * or confirm.
 *
 * Driven by `IToken.verified`, which the registry sets for its curated allow-list
 * — the official Robinhood Stock Tokens, the core assets (WETH, USDG), and the
 * canonical ERC20s each chain issues. A token that is tradable but NOT verified
 * (a long-tail launchpad token we route to but have not vouched for) carries no
 * badge: absence is the signal, the way Uniswap flags rather than decorates.
 *
 * The reason travels with it so the tooltip can be specific — an official stock
 * token and one we seeded a pool for are both verified but for different reasons,
 * and "why" is what a user checking for a scam clone actually wants.
 */
export default function VerifiedBadge({
  size = 14,
  title = "Verified — a canonical token from Kaleido's curated list",
}: {
  size?: number;
  title?: string;
}) {
  return (
    <span className={s.badge} title={title}>
      <span className={s.sr}>{title}</span>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" fill="var(--k-brand)" />
        <path
          d="M7.5 12.4l3 3 6-6.6"
          stroke="#fff"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </span>
  );
}
