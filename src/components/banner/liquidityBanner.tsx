import React from "react";
import { Coins, DollarSign, Users, TrendingUp, Plus } from "lucide-react";
import PageBanner from "@/components/banner/pageBanner";

// Liquidity Banner Component
export function LiquidityPageBanner() {
  return (
    <PageBanner
      title="Add Liquidity"
      description="Provide liquidity to Abstract Chain's AMM pools and earn trading fees plus additional rewards."
      icon={Plus}
      gradient="from-[#1a2f1a] via-[#0d1b0d] to-[#0a140a]"
    >
      {/* Key features */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl mx-auto mb-6">
        <div className="bg-black/20 backdrop-blur-sm border border-[#00ff99]/20 rounded-xl p-4 text-left">
          <div className="flex items-center mb-2">
            <div className="w-8 h-8 bg-[#00ff99]/20 rounded-lg flex items-center justify-center mr-3">
              <DollarSign className="w-4 h-4 text-[#00ff99]" />
            </div>
            <h3 className="text-base font-semibold text-white">
              Earn Trading Fees
            </h3>
          </div>
          <p className="text-gray-300 text-sm">
            Receive a share of fees from every trade in your pool
          </p>
        </div>

        <div className="bg-black/20 backdrop-blur-sm border border-[#00ff99]/20 rounded-xl p-4 text-left">
          <div className="flex items-center mb-2">
            <div className="w-8 h-8 bg-[#00ff99]/20 rounded-lg flex items-center justify-center mr-3">
              <TrendingUp className="w-4 h-4 text-[#00ff99]" />
            </div>
            <h3 className="text-base font-semibold text-white">
              Liquidity Rewards
            </h3>
          </div>
          <p className="text-gray-300 text-sm">
            Additional rewards for supporting Abstract Chain&apos;s ecosystem
          </p>
        </div>

        <div className="bg-black/20 backdrop-blur-sm border border-[#00ff99]/20 rounded-xl p-4 text-left">
          <div className="flex items-center mb-2">
            <div className="w-8 h-8 bg-[#00ff99]/20 rounded-lg flex items-center justify-center mr-3">
              <Users className="w-4 h-4 text-[#00ff99]" />
            </div>
            <h3 className="text-base font-semibold text-white">
              Community Driven
            </h3>
          </div>
          <p className="text-gray-300 text-sm">
            Join thousands of liquidity providers on Abstract Chain
          </p>
        </div>

        <div className="bg-black/20 backdrop-blur-sm border border-[#00ff99]/20 rounded-xl p-4 text-left">
          <div className="flex items-center mb-2">
            <div className="w-8 h-8 bg-[#00ff99]/20 rounded-lg flex items-center justify-center mr-3">
              <Coins className="w-4 h-4 text-[#00ff99]" />
            </div>
            <h3 className="text-base font-semibold text-white">LP Tokens</h3>
          </div>
          <p className="text-gray-300 text-sm">
            Receive LP tokens representing your pool position
          </p>
        </div>
      </div>
    </PageBanner>
  );
}
