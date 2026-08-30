import type {
  StableStats,
  TokenBalance,
  UserRewards,
  WithdrawalInfo,
} from "@/hooks/useStablecoin";

/**
 * Demo kfUSD / kafUSD figures.
 *
 * EVERY FIELD HERE IS A PRE-FORMATTED STRING, because that is what the hook
 * publishes — the formatting happens in `setStats` (useStablecoin.ts:588) and the
 * pages render the result verbatim. So the fixtures carry the punctuation too:
 * currency figures keep their "$" and thousands separators, and the ratio and
 * APY are bare numbers with no "%" — the suffix belongs to the view, and two
 * call sites once rendered "100%%" by appending their own to a string that
 * already had one.
 *
 * `backingRatio` follows from the other two: 2,541,352.71 / 2,481,904.55 × 100
 * = 102.3953, and the hook takes `.toFixed(2)`. Anyone checking the peg header
 * against the two totals beneath it will find the arithmetic holds.
 *
 * Balances are `formatUnits` output, hence the trailing ".0" on round values —
 * a fixture reading "1250" would be a shape the hook never emits.
 *
 * Nothing here is a write. `mintKfUSD`, `redeemKfUSD`, `requestWithdrawal` and
 * `completeWithdrawal` all stay on the real contract path.
 */

/**
 * The demo supply, as the hook publishes it: grouped, and with no "$" because it
 * is a token count.
 *
 * Its own export so `mock/market.ts` can read the figure without going through
 * `StableStats`, where the field is `string | null` for the runtime hook's sake —
 * a failed read is unknown, not zero. A fixture reading through the nullable type
 * would need a guard, and every available guard lies: `?? "0"` reintroduces the
 * confident zero the null exists to prevent, and a throw makes a bad fixture a
 * build failure. A plain `string` const has neither problem, and the two still
 * cannot drift, because the object below reads it too.
 */
export const MOCK_KFUSD_SUPPLY = "2,481,904.55";

export const MOCK_STABLE_STATS: StableStats = {
  tvl: "$2,530,118.40",
  totalStableDeposited: "$2,541,352.71",
  // No "$": the supply is a token count, not a dollar amount.
  kfUSDSupply: MOCK_KFUSD_SUPPLY,
  backingRatio: "102.40",
  totalYieldAPY: "7.42",
  // 5 bps and 10 bps, as the contract's basis points divided by 100.
  mintFee: "0.05",
  redeemFee: "0.1",
};

export const MOCK_STABLE_BALANCES: TokenBalance = {
  USDC: "8420.512",
  USDT: "1250.0",
  USDe: "620.44",
  kfUSD: "14204.82",
  // Matches the kafUSD row in ./portfolio, which values it 1:1 in dollars.
  kafUSD: "12480.11",
};

/**
 * An open withdrawal request, mid-notice.
 *
 * This is the state the page has the most to say about: it must show the amount
 * that will come out, the time left, and a completeWithdrawal button that is
 * still disabled. `isReady: false` carries that last part — the page used to
 * decide legality by matching `unlockTime` against the literal "Ready", which is
 * why the flag exists.
 *
 * `lockedAmount` is the kfUSD actually locked, and it is what bounds the
 * withdrawal — kafUSD is a transferable ERC20, so a holder's balance can exceed
 * what they locked, and requesting against the balance queues something that can
 * never complete.
 */
export const MOCK_STABLE_WITHDRAWAL: WithdrawalInfo = {
  hasWithdrawal: true,
  unlockTime: "3d 4h 12m",
  pendingAmount: "4200.0",
  isReady: false,
  lockedAmount: "12480.11",
};

/**
 * Claimable vault yield.
 *
 * `totalRewards` is the "$X.XX" string `usePortfolio` parses for its unclaimed
 * figure, so the same 246.31 appears in ./portfolio. The breakdown amounts show
 * up to 6 decimals and the USD values 2, matching the hook's own toLocaleString
 * bounds; the USDe row is deliberately even to show both paths.
 */
export const MOCK_STABLE_REWARDS: UserRewards = {
  totalRewards: "$246.31",
  breakdown: [
    { symbol: "USDC", amount: "184.204512", valueUSD: "$184.20" },
    { symbol: "USDe", amount: "62.11", valueUSD: "$62.11" },
  ],
};

/**
 * Collateral sitting idle in the kfUSD contract, un-deployed to the vault.
 *
 * Three tokens only — this is a distinct, narrower shape than `TokenBalance`,
 * and the zero on USDT is real: idle means "not yet routed", and one asset being
 * fully deployed while others wait is the normal condition.
 */
export const MOCK_STABLE_IDLE: { USDC: string; USDT: string; USDe: string } = {
  USDC: "1204.5",
  USDT: "0.0",
  USDe: "318.22",
};
