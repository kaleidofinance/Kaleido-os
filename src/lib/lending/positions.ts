import { ethers } from "ethers";
import { getKaleidoContract } from "@/config/contracts";
import { readLendingAssets } from "@/lib/lending/assets";
import { decimalsForAddress, symbolForAddress } from "@/constants/tokens";

/**
 * The wallet's borrow-side position on ONE chain — collateral deposited, loans
 * taken, the market's health factor — read straight off that chain's diamond.
 *
 * The portfolio's borrowing figures came from useGetValueAndHealth, which read a
 * hardcoded four tokens on one pinned read-chain. This reads the chain's OWN
 * registered collateral set (so wrapped-native and anything else the diamond
 * accepts is counted, not just ETH/USDC/kfUSD/USDT) and is chain-parameterised,
 * so the portfolio can sweep every lending chain — the multichain model the book
 * and the forms already use.
 *
 * THE SCALING IS THE WHOLE RISK, so it lives in named pure helpers with a test
 * beside them: `getHealthFactor` returns a 1e18-scaled ratio with 2^256-1 as its
 * "no debt" sentinel, and `getUsdValue(token, 1, 0)` returns a token's unit price
 * at 1e18. A slip in either is a wrong number on a money screen, so `scaleHealth`
 * and `spotFromUsdValue` are asserted against known values in positions.test.ts.
 */

/** getHealthFactor's "no debt" answer: type(uint256).max. */
export const NO_DEBT_SENTINEL = (1n << 256n) - 1n;
/** getHealthFactor returns a 1e18-scaled ratio. */
const HEALTH_SCALE = 1e-18;
/** getUsdValue returns USD at 1e18. */
const USD_SCALE = 1e18;

/** A raw getHealthFactor result → a human ratio, or Infinity for no debt. */
export function scaleHealth(raw: bigint): number {
  if (raw === NO_DEBT_SENTINEL) return Infinity;
  return Number(raw.toString()) * HEALTH_SCALE;
}

/** A raw getUsdValue(token, 1, 0) result → the token's unit price in USD. */
export function spotFromUsdValue(raw: bigint): number {
  return Number(raw.toString()) / USD_SCALE;
}

/** A deposited-collateral row, priced by the diamond's own oracle. */
export interface CollateralRow {
  address: string;
  symbol: string;
  decimals: number;
  /** Deposited amount, human units. */
  amount: number;
  /** amount × spot, or null when the token has no price feed. */
  usd: number | null;
}

/** An outstanding loan the wallet is repaying. */
export interface DebtRow {
  requestId: number;
  address: string;
  symbol: string;
  decimals: number;
  /** Still owed, human units. */
  outstanding: number;
  interestBps: number;
  returnDate: number;
  /** outstanding × spot, or null when the token has no price feed. */
  usd: number | null;
}

export interface ChainBorrowPositions {
  chainId: number;
  collateral: CollateralRow[];
  /** Sum of the priced collateral rows; null only when a row could not be priced. */
  collateralUsd: number | null;
  debts: DebtRow[];
  /** Sum of the priced debt rows; null only when a row could not be priced. */
  debtUsd: number | null;
  /** Human health ratio, Infinity for no debt. Null when unread. */
  health: number | null;
}

/** A raw deposited amount + optional spot → a priced collateral row. */
export interface RawCollateral {
  address: string;
  symbol: string;
  decimals: number;
  rawAmount: bigint;
  /** null when getUsdValue reverted (no feed). */
  rawSpot: bigint | null;
}

/** A raw active-request tuple's fields + optional spot → a priced debt row. */
export interface RawDebt {
  requestId: number;
  address: string;
  symbol: string;
  decimals: number;
  rawOutstanding: bigint;
  interestBps: number;
  returnDate: number;
  rawSpot: bigint | null;
}

/**
 * The pure core: raw reads → priced rows and summed totals. No I/O, so the
 * scaling it applies is unit-testable against fixed inputs.
 *
 * A total is null ONLY when a row it should include could not be priced — a
 * present-but-unpriced holding makes the sum unknown, not short. An empty side
 * sums to 0 (measured), never null. Zero-amount rows are dropped.
 */
export function aggregateBorrow(
  chainId: number,
  rawCollateral: RawCollateral[],
  rawDebts: RawDebt[],
  healthRaw: bigint | null,
): ChainBorrowPositions {
  const collateral: CollateralRow[] = [];
  let collateralUsd: number | null = 0;
  for (const c of rawCollateral) {
    const amount = Number(ethers.formatUnits(c.rawAmount, c.decimals));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const usd =
      c.rawSpot === null ? null : amount * spotFromUsdValue(c.rawSpot);
    if (usd === null) collateralUsd = null;
    else if (collateralUsd !== null) collateralUsd += usd;
    collateral.push({
      address: c.address,
      symbol: c.symbol,
      decimals: c.decimals,
      amount,
      usd,
    });
  }

  const debts: DebtRow[] = [];
  let debtUsd: number | null = 0;
  for (const d of rawDebts) {
    const outstanding = Number(ethers.formatUnits(d.rawOutstanding, d.decimals));
    if (!Number.isFinite(outstanding) || outstanding <= 0) continue;
    const usd =
      d.rawSpot === null ? null : outstanding * spotFromUsdValue(d.rawSpot);
    if (usd === null) debtUsd = null;
    else if (debtUsd !== null) debtUsd += usd;
    debts.push({
      requestId: d.requestId,
      address: d.address,
      symbol: d.symbol,
      decimals: d.decimals,
      outstanding,
      interestBps: d.interestBps,
      returnDate: d.returnDate,
      usd,
    });
  }

  return {
    chainId,
    collateral,
    collateralUsd,
    debts,
    debtUsd,
    health: healthRaw === null ? null : scaleHealth(healthRaw),
  };
}

/**
 * Read the wallet's borrow position on one chain. Fails soft to an empty
 * position (never throws): a chain with no diamond, a dead endpoint or a token
 * with no feed each contributes nothing rather than emptying the sweep.
 */
export async function readBorrowPositions(
  provider: ethers.Provider,
  chainId: number,
  user: string,
): Promise<ChainBorrowPositions> {
  const empty: ChainBorrowPositions = {
    chainId,
    collateral: [],
    collateralUsd: 0,
    debts: [],
    debtUsd: 0,
    health: null,
  };

  let diamond: ethers.Contract;
  try {
    diamond = getKaleidoContract(provider, chainId) as unknown as ethers.Contract;
  } catch {
    return empty;
  }

  /* The chain's own registered collateral set — not a hardcoded four. */
  let collateralTokens: { address: string; symbol: string; decimals: number }[] =
    [];
  try {
    const sets = await readLendingAssets(provider, chainId);
    collateralTokens = sets.collateral.map((a) => ({
      address: a.address,
      symbol: a.symbol,
      decimals: a.decimals,
    }));
  } catch {
    collateralTokens = [];
  }

  const usdValue = async (token: string): Promise<bigint | null> => {
    try {
      return (await diamond.getUsdValue(token, 1, 0)) as bigint;
    } catch {
      return null;
    }
  };

  const readCollateral = async (): Promise<RawCollateral[]> =>
    Promise.all(
      collateralTokens.map(async (t) => {
        let rawAmount = 0n;
        try {
          rawAmount = (await diamond.gets_addressToCollateralDeposited(
            user,
            t.address,
          )) as bigint;
        } catch {
          rawAmount = 0n;
        }
        const rawSpot = rawAmount > 0n ? await usdValue(t.address) : null;
        return { ...t, rawAmount, rawSpot };
      }),
    );

  const readDebts = async (): Promise<RawDebt[]> => {
    let rows: unknown[];
    try {
      rows = (await diamond.getUserActiveRequests(user)) as unknown[];
    } catch {
      return [];
    }
    const out: RawDebt[] = [];
    for (const row of rows) {
      const r = row as Record<number, unknown>;
      const rawOutstanding = BigInt((r[5] as bigint | number | string) ?? 0);
      if (rawOutstanding <= 0n) continue;
      const address = String(r[8]);
      out.push({
        requestId: Number(r[1]),
        address,
        symbol: symbolForAddress(chainId, address),
        decimals: decimalsForAddress(chainId, address) ?? 18,
        rawOutstanding,
        interestBps: Number(r[4]),
        returnDate: Number(r[6]),
        rawSpot: await usdValue(address),
      });
    }
    return out;
  };

  const readHealth = async (): Promise<bigint | null> => {
    try {
      return (await diamond.getHealthFactor(user)) as bigint;
    } catch {
      return null;
    }
  };

  const [rawCollateral, rawDebts, healthRaw] = await Promise.all([
    readCollateral(),
    readDebts(),
    readHealth(),
  ]);

  return aggregateBorrow(chainId, rawCollateral, rawDebts, healthRaw);
}
