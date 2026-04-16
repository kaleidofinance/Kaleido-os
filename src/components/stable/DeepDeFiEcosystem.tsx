"use client";

import React from "react";
import { ArrowRight, TrendingUp, Users, Zap, Activity } from "lucide-react";
import Image from "next/image";

interface YieldCard {
  id: string;
  title: string;
  description: string;
  apy: string;
  points: string;
  metrics: {
    label: string;
    value: string;
  }[];
  action: string;
  icon?: string;
}

const DeepDeFiEcosystem: React.FC = () => {
  const yieldOpportunities: YieldCard[] = [
    {
      id: "featured-pool",
      title: "Featured Pool Lending",
      description: "Lend USDC, USDT, USDe through featured pools with instant liquidity",
      apy: "≈8.0%",
      points: "5x Points",
      metrics: [
        { label: "Total Pool", value: "$500.00K" },
        { label: "Borrowed", value: "$250.00K" },
        { label: "Utilization", value: "50%" },
        { label: "Liquidity", value: "$250.00K" }
      ],
      action: "Lend Now",
      icon: "K"
    },
    {
      id: "vault-yield",
      title: "kfUSD Yield Vault",
      description: "Lock kfUSD to earn yield funded by lending interest and fees",
      apy: "≈5.0%",
      points: "3x Points",
      metrics: [
        { label: "TVL", value: "$1.50M" },
        { label: "kafUSD", value: "1.58M" },
        { label: "Total Yield", value: "$75.00K" },
        { label: "APY", value: "5.0%" }
      ],
      action: "Lock Assets",
      icon: "Y"
    },
    {
      id: "liquidity-pool",
      title: "USDC/USDT Liquidity",
      description: "Provide liquidity to stablecoin trading pairs and earn fees",
      apy: "≈12.5%",
      points: "10x Points",
      metrics: [
        { label: "Liquidity", value: "$2.75M" },
        { label: "Volume (24h)", value: "$187.50K" },
        { label: "24h Fees", value: "$2.50K" },
        { label: "Pool Share", value: "3.2%" }
      ],
      action: "Add Liquidity",
      icon: "L"
    }
  ];

  const getIconElement = (icon?: string) => {
    if (!icon) return null;
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#00ff99]/20 to-[#00ff99]/10 border border-[#00ff99]/30">
        <span className="text-lg font-bold text-[#00ff99]">{icon}</span>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Activity className="h-8 w-8 text-[#00ff99]" />
            <h2 className="text-3xl font-bold text-white">Kaleido DeFi Ecosystem</h2>
          </div>
          <div className="flex-1" />
          <span className="rounded-full bg-[#00ff99]/20 px-4 py-1 text-sm font-semibold text-[#00ff99] border border-[#00ff99]/40">
            Explore Partner-Powered Yield
          </span>
        </div>

      {/* Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {yieldOpportunities.map((opportunity, index) => (
          <div
            key={opportunity.id}
            className="group relative overflow-hidden rounded-2xl border border-[#00ff99]/20 bg-gradient-to-br from-black/40 via-black/30 to-black/40 backdrop-blur-sm p-6 transition-all duration-300 hover:border-[#00ff99]/40 hover:shadow-lg hover:shadow-[#00ff99]/20 hover:scale-[1.02] hover:-translate-y-1 animate-fade-in-up"
            style={{
              animationDelay: `${index * 100}ms`,
              animationFillMode: 'both'
            }}
          >
            {/* Animated Background Gradient Effect */}
            <div className="absolute inset-0 bg-gradient-to-br from-[#00ff99]/5 via-transparent to-[#00ff99]/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
            
            {/* Glowing Effect on Hover */}
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#00ff99]/5 to-transparent animate-shimmer" />
            </div>
            
            <div className="relative z-10">
              {/* Header with Animation */}
              <div className="mb-4 flex items-start justify-between">
                  <div className="flex items-center gap-3 group/icon">
                    <div className="transition-transform duration-300 group-hover/icon:scale-110 group-hover/icon:rotate-3">
                      {getIconElement(opportunity.icon)}
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white transition-colors duration-300 group-hover:text-[#00ff99]">{opportunity.title}</h3>
                      <p className="text-xs text-gray-400">{opportunity.points}</p>
                    </div>
                  </div>
              </div>

              {/* APY Badge with Pulse Animation */}
              <div className="mb-4 flex items-center gap-2">
                <span className="rounded-lg bg-gradient-to-r from-[#00ff99]/20 to-[#00ff99]/10 px-3 py-1 text-lg font-bold text-[#00ff99] border border-[#00ff99]/30 transition-all duration-300 group-hover:scale-105 group-hover:shadow-lg group-hover:shadow-[#00ff99]/50">
                  {opportunity.apy}
                </span>
                <span className="text-sm text-gray-400">Current APY</span>
              </div>

              {/* Description */}
              <p className="mb-4 text-sm text-gray-300 transition-colors duration-300 group-hover:text-gray-200">{opportunity.description}</p>

              {/* Metrics with Subtle Animation */}
              <div className="mb-6 grid grid-cols-2 gap-3 rounded-lg bg-black/30 p-3 transition-all duration-300 group-hover:bg-black/40">
                {opportunity.metrics.map((metric, idx) => (
                  <div key={idx} className="space-y-1 transition-transform duration-300 group-hover:translate-x-1">
                    <p className="text-xs text-gray-400">{metric.label}</p>
                    <p className="text-sm font-semibold text-white group-hover:text-[#00ff99] transition-colors duration-300">{metric.value}</p>
                  </div>
                ))}
              </div>

              {/* Action Button with Enhanced Animation */}
              <button className="group/btn flex w-full items-center justify-between rounded-lg bg-gradient-to-r from-[#00ff99]/20 to-[#00ff99]/10 px-4 py-3 text-white transition-all duration-200 hover:from-[#00ff99]/30 hover:to-[#00ff99]/20 border border-[#00ff99]/30 hover:shadow-lg hover:shadow-[#00ff99]/30 hover:scale-105">
                <span className="font-semibold transition-all duration-200 group-hover/btn:translate-x-1">{opportunity.action}</span>
                <ArrowRight className="h-5 w-5 transition-transform duration-200 group-hover/btn:translate-x-2 group-hover/btn:scale-110" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Info Banner */}
      <div className="rounded-xl border border-[#00ff99]/20 bg-gradient-to-r from-[#00ff99]/10 via-transparent to-[#00ff99]/10 p-6 backdrop-blur-sm">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#00ff99]/20">
            <TrendingUp className="h-5 w-5 text-[#00ff99]" />
          </div>
          <div className="flex-1">
            <h4 className="mb-2 font-semibold text-white">Multi-Chain Yield Aggregation</h4>
            <p className="text-sm text-gray-300">
              Access diverse yield opportunities across our Kaleido DeFi Ecosystem. All APYs are calculated based on 
              real-time market conditions and partner protocol rates. Earn bonus Points that can be converted to KLD tokens 
              for additional rewards on select opportunities.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeepDeFiEcosystem;

