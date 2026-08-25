"use client";

import { useCallback } from "react";
import { ethers } from "ethers";
import { READ_ONLY_CHAIN_ID, readOnlyProvider } from "@/config/provider";
import { getContracts } from "@/constants/registry";
import { tickToPrice, poolOrderInverted } from "@/constants/utils/v3Math";

const FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
];
const POOL_ABI = [
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
];

/**
 * Bridge hook for Pool — the current tick/price read useV3Positions doesn't
 * provide. Positions carry tickLower/tickUpper but not where the market
 * currently sits, which is what a range visualization needs.
 */
export function usePoolV3() {
  /**
   * Current tick and price for a pool, quoted in the caller's own token order.
   *
   * `slot0.tick` is always in the pool's address-sorted frame, so a caller
   * naming the pair the other way round used to get the reciprocal of the price
   * it asked for, scaled by the wrong power of ten on top of that. Negating the
   * tick fixes both at once: the decimals already arrive in the caller's order,
   * and `1.0001^-t * 10^(d0-d1)` is exactly the inverse of the pool's price. So
   * don't swap the decimals as well — that would undo half of it again.
   *
   * "price" therefore always means `token1` per `token0` as the *caller* named
   * them. Pass the pair already sorted (as a position's own token0/token1 is)
   * and nothing is inverted.
   *
   * Null when the pool doesn't exist yet.
   */
  const getCurrentTick = useCallback(
    async (
      token0: string,
      token1: string,
      fee: number,
      decimals0: number,
      decimals1: number,
    ): Promise<{ tick: number; price: number } | null> => {
      try {
        /* Read chain, matching readOnlyProvider: the /pool range view describes
           one chain's pools regardless of the connected wallet, so the factory is
           this chain's, resolved from the registry rather than a fixed address. */
        const v3Factory = getContracts(READ_ONLY_CHAIN_ID).v3Factory;
        if (!v3Factory) return null;
        const factory = new ethers.Contract(
          v3Factory,
          FACTORY_ABI,
          readOnlyProvider,
        );
        // getPool sorts internally, so either order finds the same pool.
        const poolAddr: string = await factory.getPool(token0, token1, fee);
        if (!poolAddr || poolAddr === ethers.ZeroAddress) return null;

        const pool = new ethers.Contract(poolAddr, POOL_ABI, readOnlyProvider);
        const slot0 = await pool.slot0();
        const inverted = poolOrderInverted(token0, token1);
        const tick = inverted ? -Number(slot0.tick) : Number(slot0.tick);
        return { tick, price: tickToPrice(tick, decimals0, decimals1) };
      } catch (err) {
        console.error("[usePoolV3.getCurrentTick]", err);
        return null;
      }
    },
    [],
  );

  return { getCurrentTick };
}

export default usePoolV3;
