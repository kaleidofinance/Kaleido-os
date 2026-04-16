"use client"

import BaseHeader from "../shared/BaseHeader"
import { useActiveAccount } from "thirdweb/react"
import useGetValueAndHealth from "@/hooks/useGetValueAndHealth"

const StakeHeader = () => {
  const activeAccount = useActiveAccount()
  const { totalStakers, totalPooledKLD, userKldDeposit, totalShares } = useGetValueAndHealth()
  
  // APR is 2% (from image)
  const apr = 2.0
  
  return (
    <BaseHeader
      title="Stake & Earn KLD."
      description="Unlock the power and Maximize your KLD holdings. Participate in secure staking and earn rewards. Simple, efficient, and rewarding."
      showStats={true}
      backgroundImage="/banners/stakeheaderbg.png"
      backgroundOverlay={false}
      statsData={{
        totalStakers,
        totalPooledKLD,
        userKldDeposit, // Your Stake (KLD) - from hook
        fees24h: totalShares,
        farms: apr // Current APY
      }}
    />
  )
}

export default StakeHeader