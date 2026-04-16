"use client";

import React from "react";
import { DollarSign, Shield, Lock, TrendingUp } from "lucide-react";
import { useStablecoin } from "@/hooks/useStablecoin";

export default function CombinedStats() {
  const { stats, balances } = useStablecoin();

  const StatCard = ({ title, value, icon: Icon, subtitle }: {
    title: string;
    value: string;
    icon: React.ElementType;
    subtitle?: string;
  }) => (
    <div className="bg-black rounded-lg px-4 py-6 flex justify-between items-center u-class-shadow-2">
      <div>
        <p className="text-xs text-white/50 pb-1">{title}</p>
        <h1 className="text-xl">{value}</h1>
        {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
      </div>
      <div className="flex items-center justify-center bg-black mr-2">
        <Icon className="w-8 h-8 text-green-400" />
      </div>
    </div>
  );

  return (
    <div className="space-y-8">
      {/* Protocol Stats Grid - 3 cards total */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Protocol Stats */}
        <StatCard
          title="Total Value Locked"
          value={stats.tvl}
          icon={Lock}
          subtitle="Protocol TVL"
        />
        <StatCard
          title="kfUSD Total Supply"
          value={stats.kfUSDSupply}
          icon={Shield}
          subtitle="Circulating supply"
        />
        <StatCard
          title="Total Yield APY"
          value={stats.totalYieldAPY || "5.0%"}
          icon={TrendingUp}
          subtitle="Current earning rate"
        />
      </div>
    </div>
  );
}

