"use client";

import { useCallback } from "react";
import { ethers } from "ethers";
import { readOnlyProvider } from "@/config/provider";
import { KALEIDOSWAP_V3_FACTORY } from "@/constants/utils/addresses";
import { tickToPrice } from "@/constants/utils/v3Math";

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
  /** Current tick + price(token1/token0) for a token0/token1/fee pool. Null if the pool doesn't exist yet. */
  const getCurrentTick = useCallback(
    async (
      token0: string,
      token1: string,
      fee: number,
      decimals0: number,
      decimals1: number,
    ): Promise<{ tick: number; price: number } | null> => {
      try {
        const factory = new ethers.Contract(
          KALEIDOSWAP_V3_FACTORY,
          FACTORY_ABI,
          readOnlyProvider,
        );
        const poolAddr: string = await factory.getPool(token0, token1, fee);
        if (!poolAddr || poolAddr === ethers.ZeroAddress) return null;

        const pool = new ethers.Contract(poolAddr, POOL_ABI, readOnlyProvider);
        const slot0 = await pool.slot0();
        const tick = Number(slot0.tick);
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
