"use client";

import React from "react";
import { TrendingUp, DollarSign, Users, Activity, ArrowUpRight, ArrowDownRight, Shield, Globe } from "lucide-react";

export default function KFUSDDashboard() {
  // Mock data for KFUSD dashboard stats
  const dashboardStats = {
    totalSupply: "$2,847,392",
    totalBacking: "$2,923,847",
    collateralRatio: "102.7%",
    activeUsers: "1,247",
    dailyMintVolume: "$847,392",
    dailyRedeemVolume: "$234,567",
    totalFeesGenerated: "$23,847",
    treasuryBuffer: "$145,234"
  };

  const reserveComposition = [
    { asset: "USDC", allocation: "40%", amount: "$1,169,539", yield: "0%", description: "Base Reserve (Stability Anchor)" },
    { asset: "USDe", allocation: "40%", amount: "$1,169,539", yield: "12.4%", description: "Delta-neutral funding yields" },
    { asset: "USDtb", allocation: "20%", amount: "$584,769", yield: "4.8%", description: "Treasury bill yields" }
  ];

  const recentActivity = [
    { type: "mint", amount: "10,000 kfUSD", user: "0x1234...5678", time: "2m ago", status: "completed" },
    { type: "redeem", amount: "5,000 kfUSD", user: "0x9876...5432", time: "5m ago", status: "completed" },
    { type: "mint", amount: "25,000 kfUSD", user: "0x4567...8901", time: "8m ago", status: "completed" },
    { type: "redeem", amount: "1,200 kfUSD", user: "0x2345...6789", time: "12m ago", status: "completed" },
  ];

  const StatCard = ({ title, value, change, icon: Icon, trend, subtitle }: {
    title: string;
    value: string;
    change?: string;
    icon: React.ElementType;
    trend?: "up" | "down";
    subtitle?: string;
  }) => (
    <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center">
          <div className="w-10 h-10 bg-green-500/20 rounded-lg flex items-center justify-center mr-3">
            <Icon className="w-5 h-5 text-green-400" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-400">{title}</h3>
            <p className="text-2xl font-bold text-white">{value}</p>
            {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
          </div>
        </div>
        {change && (
          <div className={`flex items-center text-sm ${
            trend === "up" ? "text-green-400" : "text-red-400"
          }`}>
            {trend === "up" ? (
              <ArrowUpRight className="w-4 h-4 mr-1" />
            ) : (
              <ArrowDownRight className="w-4 h-4 mr-1" />
            )}
            {change}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-8">
      {/* Main Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Total Supply"
          value={dashboardStats.totalSupply}
          change="+12.4%"
          icon={DollarSign}
          trend="up"
          subtitle="kfUSD in circulation"
        />
        <StatCard
          title="Total Backing"
          value={dashboardStats.totalBacking}
          change="+8.2%"
          icon={Shield}
          trend="up"
          subtitle="Collateral value"
        />
        <StatCard
          title="Collateral Ratio"
          value={dashboardStats.collateralRatio}
          change="+2.1%"
          icon={Activity}
          trend="up"
          subtitle="Health indicator"
        />
        <StatCard
          title="Active Users"
          value={dashboardStats.activeUsers}
          change="+15.7%"
          icon={Users}
          trend="up"
          subtitle="Monthly active"
        />
      </div>

      {/* Secondary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
          <div className="flex items-center mb-2">
            <TrendingUp className="w-5 h-5 text-green-400 mr-2" />
            <h3 className="text-sm font-medium text-gray-400">Daily Mint Volume</h3>
          </div>
          <p className="text-2xl font-bold text-white">{dashboardStats.dailyMintVolume}</p>
        </div>

        <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
          <div className="flex items-center mb-2">
            <ArrowDownRight className="w-5 h-5 text-orange-400 mr-2" />
            <h3 className="text-sm font-medium text-gray-400">Daily Redeem Volume</h3>
          </div>
          <p className="text-2xl font-bold text-white">{dashboardStats.dailyRedeemVolume}</p>
        </div>

        <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
          <div className="flex items-center mb-2">
            <DollarSign className="w-5 h-5 text-purple-400 mr-2" />
            <h3 className="text-sm font-medium text-gray-400">Fees Generated</h3>
          </div>
          <p className="text-2xl font-bold text-white">{dashboardStats.totalFeesGenerated}</p>
        </div>

        <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
          <div className="flex items-center mb-2">
            <Shield className="w-5 h-5 text-blue-400 mr-2" />
            <h3 className="text-sm font-medium text-gray-400">Treasury Buffer</h3>
          </div>
          <p className="text-2xl font-bold text-white">{dashboardStats.treasuryBuffer}</p>
        </div>
      </div>

      {/* Reserve Composition */}
      <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-6">Reserve Composition</h3>
        <div className="space-y-4">
          {reserveComposition.map((reserve, index) => (
            <div key={index} className="flex items-center justify-between py-4 border-b border-gray-700/50 last:border-b-0">
              <div className="flex items-center">
                <div className="w-12 h-12 bg-[#2a2a2a] rounded-full flex items-center justify-center mr-4">
                  <span className="text-sm font-bold text-white">{reserve.asset.charAt(0)}</span>
                </div>
                <div>
                  <h4 className="text-white font-semibold">{reserve.asset}</h4>
                  <p className="text-gray-400 text-sm">{reserve.description}</p>
                </div>
              </div>
              <div className="text-right">
                <div className="flex items-center space-x-4">
                  <div>
                    <p className="text-white font-semibold">{reserve.allocation}</p>
                    <p className="text-gray-400 text-sm">{reserve.amount}</p>
                  </div>
                  <div>
                    <p className="text-green-400 font-semibold">{reserve.yield}</p>
                    <p className="text-gray-400 text-sm">APY</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Recent Activity</h3>
        <div className="space-y-3">
          {recentActivity.map((activity, index) => (
            <div key={index} className="flex items-center justify-between py-3 border-b border-gray-700/50 last:border-b-0">
              <div className="flex items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center mr-3 ${
                  activity.type === "mint" ? "bg-green-500/20" : "bg-orange-500/20"
                }`}>
                  {activity.type === "mint" ? (
                    <TrendingUp className="w-4 h-4 text-green-400" />
                  ) : (
                    <ArrowDownRight className="w-4 h-4 text-orange-400" />
                  )}
                </div>
                <div>
                  <p className="text-white font-medium">{activity.amount}</p>
                  <p className="text-gray-400 text-sm">{activity.user}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-green-400 text-sm font-medium">{activity.status}</p>
                <p className="text-gray-500 text-xs">{activity.time}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Use Cases */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
          <div className="flex items-center mb-3">
            <DollarSign className="w-5 h-5 text-green-400 mr-2" />
            <h3 className="text-lg font-semibold text-white">Lending & Borrowing</h3>
          </div>
          <p className="text-gray-300 text-sm">
            Primary lending/borrowing stablecoin for optimized yield across the Kaleido ecosystem.
          </p>
        </div>

        <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
          <div className="flex items-center mb-3">
            <TrendingUp className="w-5 h-5 text-blue-400 mr-2" />
            <h3 className="text-lg font-semibold text-white">Launchpad</h3>
          </div>
          <p className="text-gray-300 text-sm">
            Standard currency for IDO participation and liquidity bootstrap on Kaleido Launchpad.
          </p>
        </div>

        <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
          <div className="flex items-center mb-3">
            <Activity className="w-5 h-5 text-purple-400 mr-2" />
            <h3 className="text-lg font-semibold text-white">DEX & Swap</h3>
          </div>
          <p className="text-gray-300 text-sm">
            Deep kfUSD pairs serve as the liquidity core for Kaleido's AMM and trading infrastructure.
          </p>
        </div>

        <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
          <div className="flex items-center mb-3">
            <Globe className="w-5 h-5 text-orange-400 mr-2" />
            <h3 className="text-lg font-semibold text-white">Cross-Chain</h3>
          </div>
          <p className="text-gray-300 text-sm">
            Unified stable settlement layer across Abstract, Hyperliquid, and future supported chains.
          </p>
        </div>
      </div>
    </div>
  );
}
