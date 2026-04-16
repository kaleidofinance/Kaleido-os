import { useCallback, useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { useActiveAccount } from 'thirdweb/react';
import { ILiquidityPosition } from '@/constants/types/dex';
import { usePoolData } from './usePoolData';

const PAIR_ABI = [
  "function balanceOf(address) external view returns (uint256)",
  "function totalSupply() external view returns (uint256)",
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
];

export const useUserPoolData = () => {
  const activeAccount = useActiveAccount();
  const { pools, loading: poolsLoading } = usePoolData();
  const [userPositions, setUserPositions] = useState<ILiquidityPosition[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUserPositions = useCallback(async () => {
    if (!activeAccount?.address || pools.length === 0) {
      setUserPositions([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const provider = new ethers.BrowserProvider(window.ethereum);
      const userAddress = activeAccount.address;

      const positions: ILiquidityPosition[] = [];

      for (const pool of pools) {
        try {
          const pairContract = new ethers.Contract(pool.address, PAIR_ABI, provider);

          // Get user's LP token balance
          const lpBalance = await pairContract.balanceOf(userAddress);
          
          // Skip if user has no balance
          if (lpBalance === BigInt(0)) continue;

          // Get total supply and reserves
          const [totalSupply, reserves] = await Promise.all([
            pairContract.totalSupply(),
            pairContract.getReserves(),
          ]);

          // Calculate user's share of the pool
          const shareOfPool = Number(lpBalance) / Number(totalSupply);

          // Calculate token amounts
          const token0Amount = Number(reserves.reserve0) * shareOfPool;
          const token1Amount = Number(reserves.reserve1) * shareOfPool;

          const position: ILiquidityPosition = {
            pairAddress: pool.address as `0x${string}`,
            pair: pool,
            lpTokenBalance: Number(lpBalance),
            lpTokenBalanceFormatted: ethers.formatUnits(lpBalance, 18),
            shareOfPool: shareOfPool * 100, // Convert to percentage
            token0Amount,
            token1Amount,
            token0AmountFormatted: ethers.formatUnits(
              BigInt(Math.floor(token0Amount)),
              pool.token0?.decimals || 18
            ),
            token1AmountFormatted: ethers.formatUnits(
              BigInt(Math.floor(token1Amount)),
              pool.token1?.decimals || 18
            ),
            totalValue: 0, // TODO: Calculate USD value (needs token prices)
            unclaimedFees: 0, // TODO: Calculate from fee growth
          };

          positions.push(position);
        } catch (error) {
          console.error(`Error fetching position for pool ${pool.address}:`, error);
        }
      }

      setUserPositions(positions);
    } catch (error) {
      console.error('Error fetching user positions:', error);
    } finally {
      setLoading(false);
    }
  }, [activeAccount, pools]);

  useEffect(() => {
    if (!poolsLoading) {
      fetchUserPositions();
    }
  }, [poolsLoading, fetchUserPositions]);

  return {
    userPositions,
    loading: loading || poolsLoading,
    refetch: fetchUserPositions,
  };
};
