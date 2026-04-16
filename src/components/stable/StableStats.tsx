"use client";

import React from "react";
import { DollarSign, TrendingUp, Shield, Activity, Lock } from "lucide-react";
import { useStablecoin } from "@/hooks/useStablecoin";

export default function StableStats() {
  const { stats } = useStablecoin();

  const StatCard = ({ title, value, icon: Icon, subtitle, trend }: {
    title: string;
    value: string;
    icon: React.ElementType;
    subtitle?: string;
    trend?: string;
  }) => (
    <div className="bg-black rounded-lg px-4 py-10 flex justify-between items-center u-class-shadow-2">
      <div>
        <p className="text-xs text-white/50 pb-1">{title}</p>
        <h1 className="text-xl">{value}</h1>
        {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
      </div>
      <div className="flex items-center justify-center bg-black mr-2">
        <Icon className="w-10 h-10 text-green-400" />
      </div>
    </div>
  );

  return (
    <div className="space-y-8">
      {/* Main Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard
          title="Total Value Locked"
          value={stats.tvl}
          icon={Lock}
        />
        <StatCard
          title="kfUSD Total Supply"
          value={stats.kfUSDSupply}
          icon={Shield}
        />
        <StatCard
          title="Total Stable Deposited"
          value={stats.totalStableDeposited}
          icon={DollarSign}
        />
      </div>
    </div>
  );
}
