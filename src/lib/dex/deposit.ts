import { ethers } from "ethers";
import { ErrorDecoder } from "ethers-decode-error";
import { describeFailure } from "@/lib/v2/txErrors";
import type { IToken } from "@/constants/types/dex";
import { mintMinimums } from "./liquidity";

/**
 * Adding liquidity to a pool, at either venue.
 *
 * Written for the Deposit button on every row of /pool, which is a different
 * problem from the /pool/new form even though it ends in the same two calls. That
 * form chooses a pair, a tier and a range and may be opening the pool; a row
 * already fixes all three, and the only open questions are how much and — for a
 * concentrated position — how wide. So the sequence is here rather than in either
 * component: approve, approve, floor the slippage, mint. /pool/new calls
 * `depositV3` too, which is the point. There were two live defects in that
 * sequence when it existed once (the missing tick inversion and the zero
 * slippage floor, both with regression notes in `liquidity.ts`), and a second
 * copy written for a modal would have been a second chance to reintroduce them
 * somewhere nobody was looking.
 *
 * V2 IS HERE EVEN THOUGH NOTHING LISTS ONE TODAY
 *
 * Measured 2026-08-29: `allPairsLength()` is 0 on all five deployed chains, so
 * every row in the pools table is V3 and `depositV2` will not run for anyone
 * today. It is written anyway, because the button is on a row and a row can be
 * either venue — `usePoolData` enumerates V2 pairs and will list one the moment
 * the factory has one, and a Deposit button that silently does nothing on those
 * rows is worse than no button. The router's own address was verified at the same
 * time: `v2Router.factory()` equals the registry's `v2Factory` on all five.
 *
 * Both functions wait for the receipt before returning. /pool/new used to toast
 * "Position created" on the *submission* and redirect to a positions list that
 * could not contain it yet; the transaction is the thing being reported, so the
 * report waits for it.
 */

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
];

/**
 * `stable` is last, and it only picks a fee for a pair the factory has to create
 * (5 bps if true, 30 if not — see `_addLiquidity` in KaleidoSwapRouter.sol). Every
 * caller here is depositing into a pair that already exists, so it is inert; it is
 * passed from the pool's own `feeBps` regardless, so that if this ever runs
 * against a pair that has just been removed the fee it would be recreated at is
 * the fee it had.
 */
export const V2_ROUTER_ABI = [
  "function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline, bool stable) external returns (uint256 amountA, uint256 amountB, uint256 liquidity)",
];

/**
 * Slippage tolerance applied to the minimum amounts of both venues. The same
 * 0.5% as SwapSettings' "Auto" (AUTO_SLIPPAGE_BPS), which is where /pool/new's
 * local copy of this constant came from before it moved here.
 */
export const SLIPPAGE_BPS = 50;

const BPS = BigInt(10_000);

/** A floor `bps` below a desired amount, in base units. */
const lessTolerance = (amount: bigint, bps: number) =>
  (amount * (BPS - BigInt(bps))) / BPS;

/** Twenty minutes, the deadline every other write in this app uses. */
export const deadlineIn20Minutes = () =>
  Math.floor(Date.now() / 1000) + 60 * 20;

/**
 * A number as a string the token's own `parseUnits` will accept.
 *
 * Trailing zeros go because a derived amount reads as noise with them
 * ("1.20000000"), and the fractional part is capped at the token's decimals
 * because `parseUnits` throws on a longer one — which, on a 6-decimal USDC, a
 * float ratio produces most of the time. Eight places is the display cap for
 * 18-decimal tokens: past that the digits are float error, not quantity.
 *
 * Two things it must not do, both of which look like rounding decisions and are
 * not. It must not strip zeros from a string with no decimal point — that turns
 * 100 into 1 — and a quantity smaller than the token can represent comes back
 * empty rather than "0", because a zero in the other box reads as an amount the
 * reader chose.
 */
export function trimAmount(value: number, decimals: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const fixed = value.toFixed(Math.min(decimals, 8));
  if (Number(fixed) === 0) return "";
  return fixed.includes(".")
    ? fixed.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")
    : fixed;
}

/**
 * The amount of the other leg that goes in beside this one.
 *
 * `ratio` is token1 per token0 *in the amounts a deposit consumes*, not the
 * market price — on V2 those coincide (the pair takes the reserve ratio), on V3
 * they do not: a range that sits above the market takes only token1, and one at
 * the market takes a mix that depends on how wide it is. Both callers pass a
 * ratio computed for their venue and this only does the arithmetic, so there is
 * one input-linking rule in the modal instead of two.
 *
 * Returns "" when the pairing is not defined — an empty box, which is the honest
 * display for "this range wants none of that token". A zero would look like a
 * quantity someone had entered.
 */
export function pairedAmount(args: {
  /** The amount the reader typed, human units. */
  value: string;
  /** Which leg they typed it into. */
  from: "0" | "1";
  /** token1 per token0, as consumed. */
  ratio: number | null;
  /** Decimals of the leg being filled in — the *other* one. */
  decimals: number;
}): string {
  const { value, from, ratio, decimals } = args;
  const typed = Number(value);
  if (!Number.isFinite(typed) || typed <= 0) return "";
  if (ratio === null || !Number.isFinite(ratio) || ratio <= 0) return "";
  return trimAmount(from === "0" ? typed * ratio : typed / ratio, decimals);
}

/**
 * token1 per token0 as a V2 pair will take it, from the reserves the row already
 * read. Null when the pair has no reserves to quote against — a pair can exist
 * with none, and `_addLiquidity` divides by `reserveA`.
 *
 * Float, not integer mulDiv. The router recomputes the counter-amount from its
 * own reserves and takes `min(desired, optimal)` on both legs, so a derived
 * amount a few ulps either side of exact costs nothing: it either matches or it
 * is quoted down. Float64 carries 15 significant digits, and the floor below is
 * 0.5%.
 */
export function reserveRatio(args: {
  reserve0: string | number;
  reserve1: string | number;
  decimals0: number;
  decimals1: number;
}): number | null {
  try {
    const r0 = Number(
      ethers.formatUnits(String(args.reserve0), args.decimals0),
    );
    const r1 = Number(
      ethers.formatUnits(String(args.reserve1), args.decimals1),
    );
    if (!(r0 > 0) || !(r1 > 0)) return null;
    return r1 / r0;
  } catch {
    return null;
  }
}

/** Approves `spender` for `needed` if the current allowance is short of it. */
async function ensureAllowance(args: {
  signer: ethers.Signer;
  owner: string;
  token: IToken;
  spender: string;
  needed: bigint;
}): Promise<void> {
  /* A pool's legs are ERC20s — a V2 pair holds WETH, never ETH — so this is
     defensive rather than a path anything takes. */
  if (args.token.isNative) return;
  const erc20 = new ethers.Contract(args.token.address, ERC20_ABI, args.signer);
  const current: bigint = await erc20.allowance(args.owner, args.spender);
  if (current >= args.needed) return;
  const tx = await erc20.approve(args.spender, args.needed);
  await tx.wait();
}

/** Parsed amounts, or the sentence to show instead. */
function parseBoth(args: {
  amount0: string;
  amount1: string;
  decimals0: number;
  decimals1: number;
}): { d0: bigint; d1: bigint } | { error: string } {
  try {
    return {
      d0: ethers.parseUnits(args.amount0, args.decimals0),
      d1: ethers.parseUnits(args.amount1, args.decimals1),
    };
  } catch {
    return {
      error: `Those amounts are more precise than the tokens are — ${args.decimals0} and ${args.decimals1} decimals.`,
    };
  }
}

/**
 * What `useV3PositionManager.mintPosition` is, from this module's side.
 *
 * Passed in rather than imported because it is a hook's callback: it builds its
 * own signer and resolves the position manager and factory from the *wallet's*
 * chain, and it owns the sort into the pool's frame. Typed structurally so the
 * hook's inferred `Promise<any>` satisfies it without a cast.
 */
export type MintPositionFn = (
  token0: string,
  token1: string,
  fee: number,
  tickLower: number,
  tickUpper: number,
  amount0Desired: string,
  amount1Desired: string,
  recipient: string,
  deadline: number,
  decimals0?: number,
  decimals1?: number,
  amount0Min?: string,
  amount1Min?: string,
) => Promise<{ wait?: () => Promise<unknown> } | null | undefined>;

/**
 * What `useV3Positions.increaseLiquidity` is, from this module's side.
 *
 * Passed in for the same reason `MintPositionFn` is — it is a hook's callback,
 * with its own signer and its own idea of which chain's position manager to talk
 * to — and shaped differently in one telling way: no recipient. An increase
 * credits the position, not an address, so there is nobody to name.
 */
export type IncreaseLiquidityFn = (
  tokenId: string,
  amount0Desired: string,
  amount1Desired: string,
  decimals0: number,
  decimals1: number,
  amount0Min: string,
  amount1Min: string,
  deadline: number,
) => Promise<{ wait?: () => Promise<unknown> } | null | undefined>;

/**
 * Mints a concentrated position into a pool that exists, or opens one that does
 * not.
 *
 * `readSpot` rather than a price: the floor is derived from the price the mint is
 * about to meet, not the one a range preset was centred on minutes ago, and the
 * read has to go through the caller's own provider for the caller's own chain.
 * Null from it means the pool does not exist yet, which `mintMinimums` handles —
 * the two amounts set the opening price there, and the floor is what stops
 * someone front-running the initialize with a different one.
 */
export async function depositV3(args: {
  signer: ethers.Signer;
  owner: string;
  positionManager: string;
  token0: IToken;
  token1: IToken;
  fee: number;
  amount0: string;
  amount1: string;
  tickLower: number;
  tickUpper: number;
  readSpot: () => Promise<number | null>;
  slippageBps?: number;
  deadline?: number;
  mint: MintPositionFn;
}): Promise<{ error: string } | null> {
  const parsed = parseBoth({
    amount0: args.amount0,
    amount1: args.amount1,
    decimals0: args.token0.decimals,
    decimals1: args.token1.decimals,
  });
  if ("error" in parsed) return parsed;

  for (const [token, needed] of [
    [args.token0, parsed.d0],
    [args.token1, parsed.d1],
  ] as const) {
    await ensureAllowance({
      signer: args.signer,
      owner: args.owner,
      token,
      spender: args.positionManager,
      needed,
    });
  }

  const spot = await args.readSpot();
  const floors = mintMinimums({
    amount0: args.amount0,
    amount1: args.amount1,
    decimals0: args.token0.decimals,
    decimals1: args.token1.decimals,
    tickLower: args.tickLower,
    tickUpper: args.tickUpper,
    spot,
    slippageBps: args.slippageBps ?? SLIPPAGE_BPS,
  });
  if ("error" in floors) return floors;

  const tx = await args.mint(
    args.token0.address,
    args.token1.address,
    args.fee,
    args.tickLower,
    args.tickUpper,
    args.amount0,
    args.amount1,
    args.owner,
    args.deadline ?? deadlineIn20Minutes(),
    args.token0.decimals,
    args.token1.decimals,
    floors.amount0Min,
    floors.amount1Min,
  );
  if (tx?.wait) await tx.wait();
  return null;
}

/**
 * Adds to a concentrated position that already exists.
 *
 * Everything a mint has to decide, this one reads: `increaseLiquidity` takes a
 * tokenId and two amounts, and the position manager loads the pair, the tier and
 * the range out of storage. So there is no tier argument, no range argument, and
 * no sort — THE AMOUNTS MUST ARRIVE IN THE POSITION'S OWN token0/token1 ORDER,
 * which is what `positions(tokenId)` returns them as. Handing this the caller's
 * order does not revert; it deposits the pair inverted.
 *
 * The one place it deliberately disagrees with `depositV3`: a null `readSpot` is
 * refused here rather than handled. Null means "no pool" to a mint, which is a
 * real case it opens — but a position cannot exist without its pool, so null here
 * is a failed read, and `mintMinimums` answers a null spot by deriving the ratio
 * from the caller's own amounts. A floor that agrees with whatever was typed is
 * not a floor.
 */
export async function increaseV3(args: {
  signer: ethers.Signer;
  owner: string;
  positionManager: string;
  tokenId: string;
  /** The position's token0 and token1, in that order — not the caller's. */
  token0: IToken;
  token1: IToken;
  amount0: string;
  amount1: string;
  /** The position's own bounds, read from `positions(tokenId)`. */
  tickLower: number;
  tickUpper: number;
  readSpot: () => Promise<number | null>;
  slippageBps?: number;
  deadline?: number;
  increase: IncreaseLiquidityFn;
}): Promise<{ error: string } | null> {
  const parsed = parseBoth({
    amount0: args.amount0,
    amount1: args.amount1,
    decimals0: args.token0.decimals,
    decimals1: args.token1.decimals,
  });
  if ("error" in parsed) return parsed;

  const spot = await args.readSpot();
  if (spot === null) {
    return {
      error:
        "Couldn't read the pool's current price, so there is no slippage floor to set. Without one the deposit would be accepted at any price.",
    };
  }

  const floors = mintMinimums({
    amount0: args.amount0,
    amount1: args.amount1,
    decimals0: args.token0.decimals,
    decimals1: args.token1.decimals,
    tickLower: args.tickLower,
    tickUpper: args.tickUpper,
    spot,
    slippageBps: args.slippageBps ?? SLIPPAGE_BPS,
  });
  if ("error" in floors) return floors;

  /* Approvals after the floor, not before, for the reason /pool/new learned the
     hard way: a refusal that arrives after two signed approvals has cost the user
     two transactions to be told no. Everything that can fail without the chain
     fails first. */
  for (const [token, needed] of [
    [args.token0, parsed.d0],
    [args.token1, parsed.d1],
  ] as const) {
    await ensureAllowance({
      signer: args.signer,
      owner: args.owner,
      token,
      spender: args.positionManager,
      needed,
    });
  }

  const tx = await args.increase(
    args.tokenId,
    args.amount0,
    args.amount1,
    args.token0.decimals,
    args.token1.decimals,
    floors.amount0Min,
    floors.amount1Min,
    args.deadline ?? deadlineIn20Minutes(),
  );
  if (tx?.wait) await tx.wait();
  return null;
}

/**
 * Adds to a V2 pair, in the pair's own token order.
 *
 * No ratio math beyond the tolerance floor: `_addLiquidity` quotes the optimal
 * counter-amount from the live reserves and takes `min(desired, optimal)` on
 * each leg, so the only thing this has to get right is that neither minimum is
 * above what the pool will actually take. Both are 0.5% under the desired
 * amounts, which is the standard shape — the amounts themselves were derived
 * from the same reserves by `reserveRatio`, so the binding side is whichever one
 * the reserves moved against between the read and the block.
 */
export async function depositV2(args: {
  signer: ethers.Signer;
  owner: string;
  router: string;
  token0: IToken;
  token1: IToken;
  amount0: string;
  amount1: string;
  /** The pair's fee in bps of 10000, only used if the pair has to be recreated. */
  feeBps: number | null;
  slippageBps?: number;
  deadline?: number;
}): Promise<{ error: string } | null> {
  const parsed = parseBoth({
    amount0: args.amount0,
    amount1: args.amount1,
    decimals0: args.token0.decimals,
    decimals1: args.token1.decimals,
  });
  if ("error" in parsed) return parsed;

  for (const [token, needed] of [
    [args.token0, parsed.d0],
    [args.token1, parsed.d1],
  ] as const) {
    await ensureAllowance({
      signer: args.signer,
      owner: args.owner,
      token,
      spender: args.router,
      needed,
    });
  }

  const bps = args.slippageBps ?? SLIPPAGE_BPS;
  const router = new ethers.Contract(args.router, V2_ROUTER_ABI, args.signer);
  const tx = await router.addLiquidity(
    args.token0.address,
    args.token1.address,
    parsed.d0,
    parsed.d1,
    lessTolerance(parsed.d0, bps),
    lessTolerance(parsed.d1, bps),
    args.owner,
    BigInt(args.deadline ?? deadlineIn20Minutes()),
    args.feeBps === 5,
  );
  await tx.wait();
  return null;
}

/* One decoder for both venues. Neither the position manager nor the router
   declares custom errors — they revert with `require` strings — so it is built
   without an ABI and the strings come back through the decoder's own `reason`.
   The ABI argument to `describeFailure` still matters: `parseRevert` refuses an
   undefined one outright, and without it a plain `require` would be reported as
   an unrecognised selector. */
const decoder = ErrorDecoder.create();

/**
 * What to tell the reader when a deposit throws.
 *
 * Both callers used to say "Couldn't create the position" for everything, which
 * covers a declined signature, an empty gas tank and a genuine revert with one
 * sentence — and the first of those is the common case, where the reader knows
 * exactly what happened and is being told the app is broken.
 */
export async function depositFailure(
  error: unknown,
  abi: ethers.InterfaceAbi = V2_ROUTER_ABI,
): Promise<string> {
  return describeFailure(await decoder.decode(error), error, abi);
}
