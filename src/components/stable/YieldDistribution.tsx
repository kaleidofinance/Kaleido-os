"use client";

import React from "react";
import { TrendingUp, DollarSign, Users, Activity, PieChart, ArrowUpRight, Zap, Shield } from "lucide-react";

export default function YieldDistribution() {
  const yieldStats = {
    totalYieldGenerated: "$89,234",
    dailyYield: "$2,847",
    monthlyYield: "$23,456",
    treasuryShare: "$44,617",
    lpShare: "$26,770",
    ecosystemShare: "$17,847"
  };

  const yieldSources = [
    {
      name: "USDe Yields",
      amount: "$45,234",
      percentage: "50.7%",
      description: "Delta-neutral funding yields from Ethena protocol",
      color: "green"
    },
    {
      name: "USDtb Yields",
      amount: "$28,456",
      percentage: "31.9%",
      description: "Treasury bill yields from BlackRock BUIDL",
      color: "blue"
    },
    {
      name: "Minting Fees",
      amount: "$8,234",
      percentage: "9.2%",
      description: "Fees from kfUSD minting operations",
      color: "purple"
    },
    {
      name: "Redemption Fees",
      amount: "$4,567",
      percentage: "5.1%",
      description: "Fees from kfUSD redemption operations",
      color: "orange"
    },
    {
      name: "Other Revenue",
      amount: "$2,743",
      percentage: "3.1%",
      description: "Additional protocol revenue streams",
      color: "gray"
    }
  ];

  const distributionAllocation = [
    {
      recipient: "Kaleido Treasury",
      percentage: "50%",
      amount: "$44,617",
      description: "Protocol development, security, and operations",
      color: "green"
    },
    {
      recipient: "Liquidity Providers & Miners",
      percentage: "30%",
      amount: "$26,770",
      description: "Rewards for providing liquidity and mining",
      color: "blue"
    },
    {
      recipient: "Ecosystem Growth & Buybacks",
      percentage: "20%",
      amount: "$17,847",
      description: "KLD buybacks and ecosystem incentives",
      color: "purple"
    }
  ];

  const getColorClass = (color: string) => {
    switch (color) {
      case "green": return "text-green-400 bg-green-500/20";
      case "blue": return "text-blue-400 bg-blue-500/20";
      case "purple": return "text-purple-400 bg-purple-500/20";
      case "orange": return "text-orange-400 bg-orange-500/20";
      case "gray": return "text-gray-400 bg-[#2a2a2a]/20";
      default: return "text-gray-400 bg-[#2a2a2a]/20";
    }
  };

  const getBarColor = (color: string) => {
    switch (color) {
      case "green": return "bg-green-500";
      case "blue": return "bg-blue-500";
      case "purple": return "bg-purple-500";
      case "orange": return "bg-orange-500";
      case "gray": return "bg-[#2a2a2a]";
      default: return "bg-[#2a2a2a]";
    }
  };

  return (
    <div className="space-y-8">
      {/* Yield Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
          <div className="flex items-center mb-3">
            <TrendingUp className="w-5 h-5 text-green-400 mr-2" />
            <h3 className="text-sm font-medium text-gray-400">Total Yield Generated</h3>
          </div>
          <p className="text-2xl font-bold text-white">{yieldStats.totalYieldGenerated}</p>
          <p className="text-xs text-gray-500 mt-1">All time</p>
        </div>

        <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
          <div className="flex items-center mb-3">
            <Activity className="w-5 h-5 text-blue-400 mr-2" />
            <h3 className="text-sm font-medium text-gray-400">Daily Yield</h3>
          </div>
          <p className="text-2xl font-bold text-white">{yieldStats.dailyYield}</p>
          <p className="text-xs text-gray-500 mt-1">Average per day</p>
        </div>

        <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
          <div className="flex items-center mb-3">
            <DollarSign className="w-5 h-5 text-purple-400 mr-2" />
            <h3 className="text-sm font-medium text-gray-400">Monthly Yield</h3>
          </div>
          <p className="text-2xl font-bold text-white">{yieldStats.monthlyYield}</p>
          <p className="text-xs text-gray-500 mt-1">Current month</p>
        </div>

        <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
          <div className="flex items-center mb-3">
            <Users className="w-5 h-5 text-orange-400 mr-2" />
            <h3 className="text-sm font-medium text-gray-400">Treasury Share</h3>
          </div>
          <p className="text-2xl font-bold text-white">{yieldStats.treasuryShare}</p>
          <p className="text-xs text-gray-500 mt-1">50% allocation</p>
        </div>
      </div>

      {/* Yield Sources */}
      <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-6">Yield Sources</h3>
        <div className="space-y-4">
          {yieldSources.map((source, index) => (
            <div key={index} className="bg-[#2a2a2a]/50 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center mr-3 ${getColorClass(source.color)}`}>
                    <span className="text-sm font-bold">{source.name.charAt(0)}</span>
                  </div>
                  <div>
                    <h4 className="text-white font-semibold">{source.name}</h4>
                    <p className="text-gray-400 text-sm">{source.description}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-white font-semibold">{source.amount}</p>
                  <p className="text-gray-400 text-sm">{source.percentage}</p>
                </div>
              </div>
              
              {/* Progress bar */}
              <div className="w-full bg-[#2a2a2a] rounded-full h-2">
                <div 
                  className={`h-2 rounded-full ${getBarColor(source.color)}`}
                  style={{ width: source.percentage }}
                ></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Distribution Allocation */}
      <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-6">Yield Distribution</h3>
        <div className="space-y-4">
          {distributionAllocation.map((allocation, index) => (
            <div key={index} className="bg-[#2a2a2a]/50 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center mr-3 ${getColorClass(allocation.color)}`}>
                    <span className="text-sm font-bold">{allocation.recipient.charAt(0)}</span>
                  </div>
                  <div>
                    <h4 className="text-white font-semibold">{allocation.recipient}</h4>
                    <p className="text-gray-400 text-sm">{allocation.description}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-white font-semibold">{allocation.amount}</p>
                  <p className="text-gray-400 text-sm">{allocation.percentage}</p>
                </div>
              </div>
              
              {/* Progress bar */}
              <div className="w-full bg-[#2a2a2a] rounded-full h-2">
                <div 
                  className={`h-2 rounded-full ${getBarColor(allocation.color)}`}
                  style={{ width: allocation.percentage }}
                ></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Self-Sustaining Cycle */}
      <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-6">Self-Sustaining Yield Cycle</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="text-center">
            <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <Zap className="w-8 h-8 text-green-400" />
            </div>
            <h4 className="text-white font-semibold mb-2">Yield Generation</h4>
            <p className="text-gray-300 text-sm">
              Stablecoin yield from USDe, USDtb, and protocol fees generates sustainable revenue
            </p>
          </div>
          
          <div className="text-center">
            <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <PieChart className="w-8 h-8 text-blue-400" />
            </div>
            <h4 className="text-white font-semibold mb-2">Distribution</h4>
            <p className="text-gray-300 text-sm">
              50% Treasury, 30% LP Rewards, 20% Ecosystem Growth & KLD Buybacks
            </p>
          </div>
          
          <div className="text-center">
            <div className="w-16 h-16 bg-purple-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <Shield className="w-8 h-8 text-purple-400" />
            </div>
            <h4 className="text-white font-semibold mb-2">Value Support</h4>
            <p className="text-gray-300 text-sm">
              Creates self-sustaining yield cycle supporting both kfUSD and KLD token value
            </p>
          </div>
        </div>
      </div>

      {/* Information Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
          <div className="flex items-center mb-3">
            <TrendingUp className="w-5 h-5 text-green-400 mr-2" />
            <h3 className="text-lg font-semibold text-white">Yield Optimization</h3>
          </div>
          <p className="text-gray-300 text-sm mb-4">
            Backing assets are strategically deployed into safe yield protocols like USDe and USDtb, 
            generating sustainable yield while maintaining stability and transparency.
          </p>
          <button className="w-full py-2 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-lg transition-colors">
            View Yield Strategy
          </button>
        </div>

        <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
          <div className="flex items-center mb-3">
            <DollarSign className="w-5 h-5 text-blue-400 mr-2" />
            <h3 className="text-lg font-semibold text-white">Economic Engine</h3>
          </div>
          <p className="text-gray-300 text-sm mb-4">
            kfUSD serves as the economic engine powering Kaleido's modular DeFi ecosystem, 
            blending USDC-like stability with Ethena-grade yield and AI-driven management.
          </p>
          <button className="w-full py-2 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg transition-colors">
            Learn More
          </button>
        </div>
      </div>
    </div>
  );
}
