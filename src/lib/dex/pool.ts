import { ethers } from "ethers";
import { getContracts } from "@/constants/registry";
import { poolOrderInverted, tickToPrice } from "@/constants/utils/v3Math";

/**
 * Where a V3 pool's market currently sits, read from the factory that holds it.
 *
 * One reader for the three callers that need this fact: the Pool page's range
 * picker, the browser planner and the server planner. Same reason `book.ts` and
 * `readFaucetAssets` are shared — a range preset that resolves one way on
 * /pool/new and another way in the chat is worse than either being wrong alone,
 * because the two disagree about where the money goes.
 *
 * `chainId` is a parameter, and that is a fix rather than a tidy-up. The hook
 * this replaced (`usePoolV3.getCurrentTick`, now deleted) resolved its factory
 * from `READ_ONLY_CHAIN_ID` while the page that consumed it minted through
 * `useActiveWalletChain()` — so a wallet on BSC picked its ±10% band off
 * Sepolia's price and then opened the position on BSC at a range derived from
 * another chain's market. Nothing reverts when that happens; the position simply
 * opens out of range and earns nothing, which is the failure mode the pool
 * section of `intents/types.ts` was written to avoid.
 */

const FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
];

const POOL_ABI = [
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() external view returns (uint128)",
];

export interface PoolState {
  /** The pool contract. */
  address: string;
  /**
   * Current tick, negated into the caller's token order when the pair was named
   * against the pool's address sort. See `getCurrentTick`'s own note: negating
   * the tick inverts the price *and* re-scales the decimals in one step, so the
   * decimals must NOT also be swapped.
   */
  tick: number;
  /** token1 per token0, as the CALLER named them, in human units. */
  price: number;
  /** Raw uint128 in-range liquidity. A pool can exist with none. */
  liquidity: string;
}

/**
 * The pool for a pair and fee tier, or `null` when there isn't one.
 *
 * `null` covers three different things on purpose — no V3 factory on this chain,
 * no pool at this tier, and a failed read — because every caller does the same
 * thing with all three: it cannot price a range, so it either falls back to full
 * range or refuses. What no caller may do is treat it as a price of zero.
 */
export async function readPoolState(
  provider: ethers.Provider | ethers.Signer | null | undefined,
  chainId: number | undefined,
  tokenA: string,
  tokenB: string,
  fee: number,
  decimalsA: number,
  decimalsB: number,
): Promise<PoolState | null> {
  if (!provider || !ethers.isAddress(tokenA) || !ethers.isAddress(tokenB)) {
    return null;
  }
  try {
    const v3Factory = getContracts(chainId).v3Factory;
    if (!v3Factory) return null;

    const factory = new ethers.Contract(v3Factory, FACTORY_ABI, provider);
    // getPool sorts internally, so either order finds the same pool.
    const address: string = await factory.getPool(tokenA, tokenB, fee);
    if (!address || address === ethers.ZeroAddress) return null;

    const pool = new ethers.Contract(address, POOL_ABI, provider);
    const [slot0, liquidity] = await Promise.all([
      pool.slot0(),
      pool.liquidity(),
    ]);

    const inverted = poolOrderInverted(tokenA, tokenB);
    const tick = inverted ? -Number(slot0.tick) : Number(slot0.tick);
    if (!Number.isFinite(tick)) return null;

    return {
      address,
      tick,
      price: tickToPrice(tick, decimalsA, decimalsB),
      liquidity: BigInt(liquidity).toString(),
    };
  } catch {
    return null;
  }
}

/**
 * Every fee tier this app trades, with the pool it has for one pair.
 *
 * Concurrent for the reason `build.ts` quotes concurrently: three sequential
 * round trips to learn which tiers exist is three times the latency for the same
 * answer, and a tier with no pool costs one `getPool` call either way.
 */
export async function readPoolTiers(
  provider: ethers.Provider | ethers.Signer | null | undefined,
  chainId: number | undefined,
  tokenA: string,
  tokenB: string,
  fees: readonly number[],
  decimalsA: number,
  decimalsB: number,
): Promise<Map<number, PoolState>> {
  const found = new Map<number, PoolState>();
  const states = await Promise.all(
    fees.map((fee) =>
      readPoolState(provider, chainId, tokenA, tokenB, fee, decimalsA, decimalsB),
    ),
  );
  states.forEach((state, i) => {
    if (state) found.set(fees[i], state);
  });
  return found;
}
