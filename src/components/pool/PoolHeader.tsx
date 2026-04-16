import BaseHeader from "../shared/BaseHeader"

import { usePoolData } from "@/hooks/dex/usePoolData"
import { useMemo } from "react"

const PoolHeader = () => {
  const { pools, loading } = usePoolData();

  const poolStatsData = useMemo(() => {
     let totalTVL = 0;
     let totalVolume = 0;
     let totalFees = 0;
     let activePools = 0;

     pools.forEach(pool => {
         // Sum up stats
         if (pool.liquidity) {
             totalTVL += pool.liquidity;
         }
         
         if (pool.volume24h) {
            totalVolume += pool.volume24h;
         }

         if (pool.fees24h) {
            totalFees += pool.fees24h;
         }
         
         activePools++;
     });

     return {
        totalStakers: activePools,
        totalPooledKLD: totalTVL.toFixed(0),
        userKldDeposit: totalVolume.toFixed(0), 
        fees24h: totalFees.toFixed(0),
        farms: 10 // Flag for Pool Labels in BaseHeader
     };
  }, [pools]);

  return (
    <BaseHeader
      title="Liquidity Pools & Farms"
      description="Provide liquidity, Stake LPs to earn yields rewards with multipliers"
      showStats={true}
      type="pool"
      backgroundImage="/banners/poolheaderbg.png"
      backgroundOverlay={false}
      statsData={poolStatsData}
      loading={loading}
    />
  )
}

export default PoolHeader
