"use client";

import React from "react";
import { Shield, DollarSign, TrendingUp, Activity, Eye, Lock, Globe, Zap } from "lucide-react";

export default function ReserveDashboard() {
  const reserveStats = {
    totalBacking: "$2,923,847",
    totalSupply: "$2,847,392",
    collateralRatio: "102.7%",
    treasuryBuffer: "$145,234",
    lastUpdate: "2 minutes ago",
    nextRebalance: "6 hours"
  };

  const reserveAssets = [
    {
      asset: "USDC",
      allocation: "40%",
      amount: "$1,169,539",
      yield: "0%",
      description: "Base Reserve (Stability Anchor)",
      color: "blue",
      health: "Excellent"
    },
    {
      asset: "USDe",
      allocation: "40%",
      amount: "$1,169,539",
      yield: "12.4%",
      description: "Delta-neutral funding yields",
      color: "green",
      health: "Good"
    },
    {
      asset: "USDtb",
      allocation: "20%",
      amount: "$584,769",
      yield: "4.8%",
      description: "Treasury bill yields",
      color: "purple",
      health: "Excellent"
    }
  ];

  const stabilityMechanisms = [
    {
      title: "Fully Collateralized Vaults",
      description: "Smart contracts maintain reserves at or above 100% collateral ratio",
      icon: Shield,
      status: "Active"
    },
    {
      title: "AI Monitoring System",
      description: "Luca AI continuously monitors collateral health and market volatility",
      icon: Activity,
      status: "Active"
    },
    {
      title: "Treasury Buffer",
      description: "2-5% reserve buffer from protocol revenue acts as insurance",
      icon: Lock,
      status: "Active"
    },
    {
      title: "Proof-of-Reserves",
      description: "Real-time verification of total supply and collateral reserves",
      icon: Eye,
      status: "Live"
    }
  ];

  const getColorClass = (color: string) => {
    switch (color) {
      case "blue": return "text-blue-400 bg-blue-500/20";
      case "green": return "text-green-400 bg-green-500/20";
      case "purple": return "text-purple-400 bg-purple-500/20";
      default: return "text-gray-400 bg-[#2a2a2a]/20";
    }
  };

  const getHealthColor = (health: string) => {
    switch (health) {
      case "Excellent": return "text-green-400";
      case "Good": return "text-blue-400";
      case "Fair": return "text-yellow-400";
      case "Poor": return "text-red-400";
      default: return "text-gray-400";
    }
  };

  return (
    <div className="space-y-8">
      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
          <div className="flex items-center mb-3">
            <Shield className="w-5 h-5 text-green-400 mr-2" />
            <h3 className="text-sm font-medium text-gray-400">Total Backing</h3>
          </div>
          <p className="text-2xl font-bold text-white">{reserveStats.totalBacking}</p>
          <p className="text-xs text-gray-500 mt-1">Collateral value</p>
        </div>

        <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
          <div className="flex items-center mb-3">
            <DollarSign className="w-5 h-5 text-blue-400 mr-2" />
            <h3 className="text-sm font-medium text-gray-400">Total Supply</h3>
          </div>
          <p className="text-2xl font-bold text-white">{reserveStats.totalSupply}</p>
          <p className="text-xs text-gray-500 mt-1">kfUSD in circulation</p>
        </div>

        <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
          <div className="flex items-center mb-3">
            <TrendingUp className="w-5 h-5 text-purple-400 mr-2" />
            <h3 className="text-sm font-medium text-gray-400">Collateral Ratio</h3>
          </div>
          <p className="text-2xl font-bold text-white">{reserveStats.collateralRatio}</p>
          <p className="text-xs text-gray-500 mt-1">Health indicator</p>
        </div>

        <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
          <div className="flex items-center mb-3">
            <Lock className="w-5 h-5 text-orange-400 mr-2" />
            <h3 className="text-sm font-medium text-gray-400">Treasury Buffer</h3>
          </div>
          <p className="text-2xl font-bold text-white">{reserveStats.treasuryBuffer}</p>
          <p className="text-xs text-gray-500 mt-1">Insurance fund</p>
        </div>
      </div>

      {/* Reserve Composition */}
      <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-6">Reserve Asset Allocation</h3>
        <div className="space-y-4">
          {reserveAssets.map((asset, index) => (
            <div key={index} className="bg-[#2a2a2a]/50 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center mr-4 ${getColorClass(asset.color)}`}>
                    <span className="text-sm font-bold">{asset.asset.charAt(0)}</span>
                  </div>
                  <div>
                    <h4 className="text-white font-semibold">{asset.asset}</h4>
                    <p className="text-gray-400 text-sm">{asset.description}</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center space-x-4">
                    <div>
                      <p className="text-white font-semibold">{asset.allocation}</p>
                      <p className="text-gray-400 text-sm">{asset.amount}</p>
                    </div>
                    <div>
                      <p className="text-green-400 font-semibold">{asset.yield}</p>
                      <p className="text-gray-400 text-sm">APY</p>
                    </div>
                    <div>
                      <p className={`font-semibold ${getHealthColor(asset.health)}`}>{asset.health}</p>
                      <p className="text-gray-400 text-sm">Health</p>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Progress bar for allocation */}
              <div className="w-full bg-[#2a2a2a] rounded-full h-2">
                <div 
                  className={`h-2 rounded-full ${
                    asset.color === "blue" ? "bg-blue-500" :
                    asset.color === "green" ? "bg-green-500" :
                    "bg-purple-500"
                  }`}
                  style={{ width: asset.allocation }}
                ></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Stability Mechanisms */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {stabilityMechanisms.map((mechanism, index) => (
          <div key={index} className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
            <div className="flex items-start">
              <div className="w-10 h-10 bg-green-500/20 rounded-lg flex items-center justify-center mr-3 mt-1">
                <mechanism.icon className="w-5 h-5 text-green-400" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-white font-semibold">{mechanism.title}</h4>
                  <span className="text-green-400 text-sm font-medium">{mechanism.status}</span>
                </div>
                <p className="text-gray-300 text-sm">{mechanism.description}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Live Data */}
      <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Live Reserve Data</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="text-center">
            <div className="flex items-center justify-center mb-2">
              <Activity className="w-5 h-5 text-green-400 mr-2" />
              <h4 className="text-white font-semibold">Last Update</h4>
            </div>
            <p className="text-gray-300">{reserveStats.lastUpdate}</p>
          </div>
          
          <div className="text-center">
            <div className="flex items-center justify-center mb-2">
              <Zap className="w-5 h-5 text-blue-400 mr-2" />
              <h4 className="text-white font-semibold">Next Rebalance</h4>
            </div>
            <p className="text-gray-300">{reserveStats.nextRebalance}</p>
          </div>
          
          <div className="text-center">
            <div className="flex items-center justify-center mb-2">
              <Globe className="w-5 h-5 text-purple-400 mr-2" />
              <h4 className="text-white font-semibold">Chain Status</h4>
            </div>
            <p className="text-green-400 font-semibold">Abstract Chain</p>
          </div>
        </div>
      </div>

      {/* Transparency Information */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
          <div className="flex items-center mb-3">
            <Eye className="w-5 h-5 text-blue-400 mr-2" />
            <h3 className="text-lg font-semibold text-white">Transparency</h3>
          </div>
          <p className="text-gray-300 text-sm mb-4">
            All reserve data is publicly verifiable on-chain. Users can independently verify 
            total supply, collateral reserves, and asset allocation at any time.
          </p>
          <button className="w-full py-2 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg transition-colors">
            View On-Chain Data
          </button>
        </div>

        <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
          <div className="flex items-center mb-3">
            <Shield className="w-5 h-5 text-green-400 mr-2" />
            <h3 className="text-lg font-semibold text-white">Security</h3>
          </div>
          <p className="text-gray-300 text-sm mb-4">
            Multi-layered security with smart contract audits, AI monitoring, 
            and treasury buffer protection against extreme market conditions.
          </p>
          <button className="w-full py-2 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-lg transition-colors">
            Security Report
          </button>
        </div>
      </div>
    </div>
  );
}
