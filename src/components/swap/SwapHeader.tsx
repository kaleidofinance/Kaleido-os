import { useMemo } from "react";
import { usePoolData } from "@/hooks/dex/usePoolData";
import BaseHeader from "../shared/BaseHeader";

const SwapHeader = () => {
  const { pools, loading } = usePoolData();

  const swapStatsData = useMemo(() => {
    let totalTVL = 0;
    let totalVolume = 0;
    let activePools = 0;

    pools.forEach((pool) => {
      if (pool.liquidity) {
        totalTVL += pool.liquidity;
      }

      if (pool.volume24h) {
        totalVolume += pool.volume24h;
      }

      activePools++;
    });

    return {
      totalStakers: activePools,
      totalPooledKLD: totalTVL.toFixed(0),
      userKldDeposit: totalVolume.toFixed(0),
    };
  }, [pools]);

  return (
    <BaseHeader
      title="Trade Tokens Instantly"
      description="Swap between different tokens on the Abstract blockchain with low fees and fast execution."
      showStats={true}
      type="swap"
      statsMobileOnly={true}
      backgroundImage="/banners/swapheaderbg.png"
      backgroundOverlay={false}
      statsData={swapStatsData}
      loading={loading}
    />
  );
};

export default SwapHeader;
