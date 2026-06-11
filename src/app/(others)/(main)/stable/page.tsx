"use client";

import React, { useState } from "react";
import CombinedStats from "@/components/stable/CombinedStats";
import MintRedeem from "@/components/stable/MintRedeem";
import LockWithdraw from "@/components/stable/LockWithdraw";
import { useStablecoin } from "@/hooks/useStablecoin";
import { Shield, DollarSign, Clock } from "lucide-react";

export default function StablePage() {
  const [activeTab, setActiveTab] = useState<"mint" | "redeem" | "lock" | "withdraw">("mint");
  const { balances, withdrawalInfo, userRewards, claimYield, claimAndCompound } = useStablecoin();

  // Calculate user vault stats
  const userVaultStats = React.useMemo(() => {
    const rewardValue = parseFloat(userRewards.totalRewards.replace(/[^0-9.]/g, ''));
    return {
      kafusdBalance: parseFloat(balances.kafUSD || "0").toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      totalRewards: userRewards.totalRewards,
      hasRewards: rewardValue > 0,
      unlockTime: withdrawalInfo.unlockTime,
    };
  }, [balances.kafUSD, withdrawalInfo.unlockTime, userRewards.totalRewards]);

  return (
    <div className="flex min-w-0 flex-col space-y-6 sm:space-y-10">
      {/* Combined Stats Section */}
      <div className="pt-4 sm:pt-10">
        <CombinedStats />
      </div>
      
      {/* Unified Operations Section - Mint | Redeem | Lock | Withdraw */}
      <div className="flex h-full min-w-0 flex-col items-center justify-center space-y-6 px-0 py-4 sm:space-y-9 sm:px-4">
        {/* Tabs */}
        <div className="kaleido-scrollbar mb-2 flex w-full justify-start gap-1 overflow-x-auto sm:justify-center">
          <button
            onClick={() => setActiveTab("mint")}
            className={`border-b-2 px-2.5 py-0.5 text-base sm:text-[20px] whitespace-nowrap ${
              activeTab === "mint" ? "border-[#00ff6e] text-[#00ff6e]" : "border-transparent text-gray-400"
            }`}
          >
            Mint
          </button>
          <button
            onClick={() => setActiveTab("redeem")}
            className={`border-b-2 px-2.5 py-0.5 text-base sm:text-[20px] whitespace-nowrap ${
              activeTab === "redeem" ? "border-[#00ff6e] text-[#00ff6e]" : "border-transparent text-gray-400"
            }`}
          >
            Redeem
          </button>
          <button
            onClick={() => setActiveTab("lock")}
            className={`border-b-2 px-2.5 py-0.5 text-base sm:text-[20px] whitespace-nowrap ${
              activeTab === "lock" ? "border-[#00ff6e] text-[#00ff6e]" : "border-transparent text-gray-400"
            }`}
          >
            Lock
          </button>
          <button
            onClick={() => setActiveTab("withdraw")}
            className={`border-b-2 px-2.5 py-0.5 text-base sm:text-[20px] whitespace-nowrap ${
              activeTab === "withdraw" ? "border-[#00ff6e] text-[#00ff6e]" : "border-transparent text-gray-400"
            }`}
          >
            Withdraw
          </button>
        </div>

        {/* User Vault Info Bar - Only shown for Lock/Withdraw */}
        {(activeTab === "lock" || activeTab === "withdraw") && (
          <div className="w-full min-w-0 rounded-xl border border-[#00ff6e]/20 bg-black/60 p-3 backdrop-blur-sm sm:p-4 lg:w-[500px]">
            <div className="flex flex-col gap-4">
              <div className="flex flex-row sm:flex-row items-center justify-between">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full">
                  <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-green-400" />
                    <div>
                      <p className="text-xs text-gray-400">kafUSD Balance</p>
                      <p className="break-words text-base font-semibold text-white sm:text-lg">{userVaultStats.kafusdBalance}</p>
                    </div>
                  </div>
                  <div className="hidden sm:block h-8 w-px bg-[#00ff6e]/20 absolute left-1/3"></div>
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-5 h-5 text-green-400" />
                    <div>
                      <p className="text-xs text-gray-400">Total Rewards</p>
                      <p className="break-words text-base font-semibold text-white sm:text-lg">{userVaultStats.totalRewards}</p>
                    </div>
                  </div>
                  <div className="hidden sm:block h-8 w-px bg-[#00ff6e]/20 absolute left-2/3"></div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-5 h-5 text-green-400" />
                    <div>
                      <p className="text-xs text-gray-400">Unlock Time</p>
                      <p className="break-words text-base font-semibold text-white sm:text-lg">{userVaultStats.unlockTime}</p>
                    </div>
                  </div>
                </div>
              </div>
              
              
              {/* Claim Yield Buttons */}
              {userVaultStats.hasRewards && (
                <>
                  {/* Reward Breakdown */}
                  {userRewards.breakdown.length > 0 && (
                    <div className="pt-2 border-t border-[#00ff6e]/10">
                      <p className="text-xs text-gray-400 mb-2">Available to Claim:</p>
                      <div className="flex flex-wrap gap-2">
                        {userRewards.breakdown.map((reward, idx) => (
                          <div 
                            key={idx}
                            className="bg-green-500/10 border border-green-500/20 rounded-lg px-2 py-1 flex items-center gap-1.5"
                          >
                            <span className="text-xs font-bold text-green-400">{reward.amount}</span>
                            <span className="text-xs text-gray-300">{reward.symbol}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-[#00ff6e]/10">
                    <button
                      onClick={() => claimAndCompound()}
                      className="flex-1 px-3 py-2 sm:py-1.5 bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 text-green-400 text-sm font-semibold rounded-lg transition-colors"
                    >
                      Claim & Compound
                    </button>
                    <button
                      onClick={() => claimYield("ALL")}
                      className="flex-1 px-3 py-2 sm:py-1.5 bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 text-green-400 text-sm font-semibold rounded-lg transition-colors"
                    >
                      Claim All Yield
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        <div className="relative h-auto w-full min-w-0 rounded-2xl border border-[#00ff6e]/30 bg-black p-4 sm:p-6 lg:w-[500px] text-white shadow-md">
          <div className="relative z-10">
            {activeTab === "mint" || activeTab === "redeem" ? (
              <MintRedeem mode={activeTab} />
            ) : (
              <LockWithdraw mode={activeTab} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
