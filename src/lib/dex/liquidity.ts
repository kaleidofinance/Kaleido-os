import { ethers } from "ethers";
import {
  TICK_SPACINGS,
  fullRangeTicks,
  getV3AmountRatio,
  invertTickRange,
  nearestUsableTick,
  poolOrderInverted,
  priceToTick,
  tickToPrice,
} from "@/constants/utils/v3Math";

/**
 * Everything a V3 mint or burn needs that isn't a chain read.
 *
 * Pure, and shared by the /pool/new form, /pool/positions, and the agent's
 * `provideLiquidity` and `removePosition` plans. The form had all of this inline, and lifting it out is the same move the
 * intent bus is built on: "a pricing or slippage fix lands once"
 * (fromToolCall.ts's header). Two of the three functions here exist because the
 * form got them wrong at some point — the range inversion and the slippage floor
 * both have their own regression notes in v3Math.ts and in the page — so a second
 * copy written for the agent would have been a second chance to get them wrong,
 * on a path where nobody is looking at a range chart while they do it.
 *
 * The frames matter here more than anywhere else in the app. Every function
 * below takes and returns the CALLER's token order unless its name says
 * otherwise; `sortMintParams` is the single crossing into the pool's
 * address-sorted frame, and it moves the ticks and the amounts together because
 * doing one without the other opens the position on the wrong side of the
 * market and nothing reverts to say so.
 */

/**
 * How a caller asked for a range.
 *
 * Not a raw tick pair, and that is the whole reason the agent can be trusted
 * with this at all. `intents/types.ts` refused to carry a mint for exactly one
 * reason — "a chat-typed range is a real correctness risk (wrong ticks silently
 * opens the position out of range, earning nothing)" — and a tick a model emits
 * is unauditable: there is no way to look at -73200 and know whether it is near
 * the market. A band is auditable, because the centre is read from the pool.
 */
export type RangeChoice =
  /** The widest range the tier accepts. Needs no price, so it works on a pool that doesn't exist yet. */
  | { kind: "full" }
  /** A symmetric band around the pool's live price. `pct` is a fraction: 0.1 is ±10%. */
  | { kind: "band"; pct: number }
  /** Explicit bounds, token1 per token0 in the caller's order. */
  | { kind: "prices"; minPrice: number; maxPrice: number };

export interface TickRange {
  tickLower: number;
  tickUpper: number;
  /** Human bounds for the range that was actually snapped to, for the review row. */
  lowerPrice: number;
  upperPrice: number;
}

/**
 * The fee tiers this DEX actually has, cheapest first.
 *
 * A deliberate subset of `TICK_SPACINGS`, which is the Uniswap library's table
 * and carries the 0.01% tier because the library does. The factory here has only
 * these three enabled and /pool/new offers exactly these three, so `spacingFor`
 * returning a spacing is not on its own evidence that a pool can exist at that
 * tier — a 100 would pass the spacing check, read as a pool that merely has not
 * been created yet, and revert inside the factory after two approvals had been
 * signed. Anything taking a fee from a caller checks against this list.
 *
 * Ascending order is load-bearing where a tie is broken by position: two pools
 * of equal depth is the stable-pair case, and the cheaper tier is the one to be
 * in.
 */
export const FEE_TIERS = [500, 3000, 10000] as const;

/** The tick spacing for a fee tier, or null for a tier this app doesn't trade. */
export function spacingFor(fee: number): number | null {
  return TICK_SPACINGS[fee] ?? null;
}

/** Whether a fee is one of the three tiers a pool can actually exist at here. */
export function isTradedTier(fee: number): boolean {
  return (FEE_TIERS as readonly number[]).includes(fee);
}

/**
 * The tick range a choice resolves to, snapped to the tier's spacing.
 *
 * `spot` is token1 per token0 in the caller's order, or null when the pool does
 * not exist yet. A band with no spot is refused rather than centred on a guess:
 * on an uninitialised pool the mint's own two amounts set the opening price, so
 * "±10% of the market" names a market that isn't there. Full range is the only
 * choice that means anything on a fresh pool, which is what
 * `useV3PositionManager.mintPosition` already says in prose ("a narrow first
 * position will open the pool somewhere the depositor didn't choose").
 *
 * Returns a sentence on failure, in the second person, because every caller
 * shows it to the user unchanged.
 */
export function ticksForRange(
  choice: RangeChoice,
  spot: number | null,
  fee: number,
  decimals0: number,
  decimals1: number,
): TickRange | { error: string } {
  const spacing = spacingFor(fee);
  if (spacing === null) {
    return {
      error: `${fee / 10_000}% isn't a fee tier we trade. The tiers are 0.05%, 0.3% and 1%.`,
    };
  }

  const withPrices = (tickLower: number, tickUpper: number): TickRange => ({
    tickLower,
    tickUpper,
    lowerPrice: tickToPrice(tickLower, decimals0, decimals1),
    upperPrice: tickToPrice(tickUpper, decimals0, decimals1),
  });

  if (choice.kind === "full") {
    const { tickLower, tickUpper } = fullRangeTicks(spacing);
    return withPrices(tickLower, tickUpper);
  }

  let lo: number;
  let hi: number;
  if (choice.kind === "band") {
    if (!(choice.pct > 0) || choice.pct >= 1) {
      return {
        error:
          "A range band has to be between 0 and 100% of the current price. Ask for full range if you want no bounds.",
      };
    }
    if (spot === null || !Number.isFinite(spot) || spot <= 0) {
      return {
        error:
          "There's no pool for that pair and tier yet, so there's no market price to centre a range on. Opening the first position sets the price, so it has to be full range — or give me explicit min and max prices.",
      };
    }
    lo = spot * (1 - choice.pct);
    hi = spot * (1 + choice.pct);
  } else {
    lo = choice.minPrice;
    hi = choice.maxPrice;
  }

  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || hi <= lo) {
    return { error: "That range isn't a valid price band — the maximum has to be above the minimum, and both above zero." };
  }

  const rawLower = priceToTick(lo, decimals0, decimals1);
  const rawUpper = priceToTick(hi, decimals0, decimals1);
  const tickLower = nearestUsableTick(Math.min(rawLower, rawUpper), spacing);
  const tickUpper = nearestUsableTick(Math.max(rawLower, rawUpper), spacing);

  /*
   * Snapping can collapse a band to a single tick, and the mint then reverts
   * with nothing a user could act on. It is not a rare shape either: the 1%
   * tier's spacing is 200 ticks, about 2% of price, so any band under ±1% on
   * that tier lands both bounds on the same multiple.
   */
  if (tickUpper <= tickLower) {
    return {
      error: `That range is narrower than the ${fee / 10_000}% tier's tick spacing, so it would collapse to a single price. Widen it, or use a finer tier.`,
    };
  }

  return withPrices(tickLower, tickUpper);
}

export interface MintMinimums {
  amount0Min: string;
  amount1Min: string;
  /**
   * The ratio the range consumes at, for the summary line. `0` and `Infinity`
   * are the one-sided cases, which are legitimate and worth saying out loud.
   */
  ratio: number;
}

/**
 * The slippage floor for a mint, derived from what the range will actually take.
 *
 * Lifted from the /pool/new form, whose own comment explains why the obvious
 * version is wrong: the floor cannot come from the typed amounts, because the
 * pool takes `min(L(amount0), L(amount1))` and leaves the over-supplied side
 * alone. Flooring both at 99.5% of what was typed would revert nearly every
 * honest deposit. So the consumed ratio is computed first, the expected
 * consumption from it, and the tolerance applied to that.
 *
 * `NonfungiblePositionManager` checks `amount0 >= amount0Min && amount1 >=
 * amount1Min`. Passing zeroes — which this page did until it was fixed — accepts
 * any execution at all, so a sandwich can move the price, have the mint consume
 * the deposit at whatever ratio that price implies, and still succeed.
 *
 * `spot` null means the pool is about to be created, where the two amounts
 * themselves set the opening price. The floor still matters there: it is what
 * protects against someone front-running the initialize with a different price.
 */
export function mintMinimums(args: {
  amount0: string;
  amount1: string;
  decimals0: number;
  decimals1: number;
  tickLower: number;
  tickUpper: number;
  spot: number | null;
  slippageBps: number;
}): MintMinimums | { error: string } {
  const {
    amount0,
    amount1,
    decimals0,
    decimals1,
    tickLower,
    tickUpper,
    slippageBps,
  } = args;

  const h0 = Number(amount0);
  const h1 = Number(amount1);
  if (!Number.isFinite(h0) || !Number.isFinite(h1) || h0 <= 0 || h1 <= 0) {
    return {
      error:
        "Both sides of a new position need a positive amount — the pool takes a pair, and the amounts are what set or meet its price.",
    };
  }

  const lowerPrice = tickToPrice(tickLower, decimals0, decimals1);
  const upperPrice = tickToPrice(tickUpper, decimals0, decimals1);
  const spot = args.spot === null ? h1 / h0 : args.spot;

  const ratio = getV3AmountRatio(
    spot,
    lowerPrice,
    upperPrice,
    decimals0,
    decimals1,
  );
  if (Number.isNaN(ratio)) {
    return {
      error:
        "I couldn't work out what that range would consume at the current price, so I can't set a slippage floor for it. Without one the mint would accept any execution.",
    };
  }

  let desired0: bigint;
  let desired1: bigint;
  try {
    desired0 = ethers.parseUnits(amount0, decimals0);
    desired1 = ethers.parseUnits(amount1, decimals1);
  } catch {
    return {
      error: `Those amounts are more precise than the tokens are — ${decimals0} and ${decimals1} decimals.`,
    };
  }

  /* Rounded to the token's own decimals before parsing, because the ratio is a
     float and parseUnits rejects a fractional part longer than the token
     supports. Only ever used for the non-binding side, and clamped by the
     desired amount below, so float error cannot push a floor above what the pool
     can actually take. */
  const toBase = (human: number, decimals: number) =>
    Number.isFinite(human) && human > 0 && human < 1e21
      ? ethers.parseUnits(human.toFixed(decimals), decimals)
      : BigInt(0);
  const smaller = (a: bigint, b: bigint) => (a < b ? a : b);

  let expected0 = desired0;
  let expected1 = desired1;
  if (ratio === 0) {
    expected1 = BigInt(0); // price at or below the range — all token0
  } else if (!Number.isFinite(ratio)) {
    expected0 = BigInt(0); // price at or above the range — all token1
  } else if (h1 / h0 >= ratio) {
    // token0 binds; token1 is over-supplied and only partly consumed
    expected1 = smaller(desired1, toBase(h0 * ratio, decimals1));
  } else {
    expected0 = smaller(desired0, toBase(h1 / ratio, decimals0));
  }

  const withTolerance = (v: bigint) =>
    (v * BigInt(10_000 - slippageBps)) / BigInt(10_000);

  return {
    amount0Min: ethers.formatUnits(withTolerance(expected0), decimals0),
    amount1Min: ethers.formatUnits(withTolerance(expected1), decimals1),
    ratio,
  };
}

export interface MintParams {
  token0: string;
  token1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  amount0: string;
  amount1: string;
  amount0Min: string;
  amount1Min: string;
  decimals0: number;
  decimals1: number;
}

/**
 * The same mint, expressed in the pool's address-sorted frame.
 *
 * Uniswap V3 only knows `token0 < token1`. Everything above this line is in the
 * caller's order — the order the amounts were typed in and the order the price
 * bounds are labelled with — so this is the one crossing, and it moves all seven
 * paired values at once.
 *
 * The tick inversion is the part that used to be missing while the six
 * reorderings around it were present (see `useV3PositionManager`): a pair named
 * in reverse address order minted the mirror image of the range asked for. The
 * mint succeeds; the position is simply in the wrong place, usually one-sided
 * and earning nothing. Ticks are rounded before inverting so the negation acts
 * on whole ticks.
 */
export function sortMintParams(p: MintParams): MintParams {
  const tickLower = Math.round(p.tickLower);
  const tickUpper = Math.round(p.tickUpper);
  if (!poolOrderInverted(p.token0, p.token1)) {
    return { ...p, tickLower, tickUpper };
  }
  const inverted = invertTickRange(tickLower, tickUpper);
  return {
    token0: p.token1,
    token1: p.token0,
    fee: p.fee,
    tickLower: inverted.tickLower,
    tickUpper: inverted.tickUpper,
    amount0: p.amount1,
    amount1: p.amount0,
    amount0Min: p.amount1Min,
    amount1Min: p.amount0Min,
    decimals0: p.decimals1,
    decimals1: p.decimals0,
  };
}

/**
 * The opening price for a pool that doesn't exist yet, as sqrtPriceX96.
 *
 * `sqrt((amount1 << 192) / amount0)`, in integer math throughout — the value
 * exceeds 2^96 and a float would lose the low bits that decide the opening tick.
 * Amounts are base units in the POOL's order, so call `sortMintParams` first.
 */
export function initialSqrtPriceX96(
  amount0Wei: bigint,
  amount1Wei: bigint,
): bigint {
  if (amount0Wei <= BigInt(0) || amount1Wei <= BigInt(0)) {
    throw new Error("Initial amounts required to initialize pool.");
  }
  const ratio = (amount1Wei << BigInt(192)) / amount0Wei;
  // Newton's method on integers; ratio is always positive here.
  if (ratio < BigInt(2)) return ratio;
  let x = ratio / BigInt(2) + BigInt(1);
  let y = (x + ratio / x) / BigInt(2);
  while (y < x) {
    x = y;
    y = (x + ratio / x) / BigInt(2);
  }
  return x;
}
/**
 * A share of a position's liquidity, in raw units.
 *
 * The burn side of this file, here for the reason the header gives. The page and
 * the agent's `removePosition` plan each had this arithmetic inline, and the
 * page's copy carried a comment asserting the two agreed. They did — but the
 * assertion was prose, so "remove 25%" typed at Luca and 25% clicked on
 * /pool/positions were one edit away from decreasing a position by different
 * amounts, which is the class of divergence this module was extracted to end.
 *
 * Hundredths of a percent, so 12.5% is exact rather than rounded to 13, and
 * integer arithmetic throughout — liquidity runs past 2^53, and a float turns a
 * uint128 into 1.2345678901234568e21.
 *
 * Truncation is the right direction: a rounded-down burn leaves a few units of
 * liquidity in the position, while a rounded-up one asks for more than is there
 * and reverts. 100 returns the input untouched rather than going through the
 * arithmetic, so "remove 100%" and "remove" are the identical transaction and
 * neither can leave dust behind.
 *
 * Floor division means a small enough position rounds a share to zero. Both
 * callers refuse that rather than sending it — a zero-liquidity
 * `decreaseLiquidity` succeeds and removes nothing.
 */
export function shareOfLiquidity(liquidity: string, percent: number): string {
  if (percent === 100) return liquidity;
  return String(
    (BigInt(liquidity) * BigInt(Math.round(percent * 100))) / 10_000n,
  );
}
