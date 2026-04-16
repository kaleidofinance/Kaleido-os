import React from "react";
import { DollarSign, Shield, TrendingUp, Globe, Zap, Lock } from "lucide-react";

export default function KFUSDHeader() {
  return (
    <div className="relative overflow-hidden bg-gradient-to-br from-[#1a2f1a] via-[#0d1b0d] to-[#0a140a] py-16 px-6 border-b border-green-900/20">
      {/* Animated background glows */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-10 left-10 w-32 h-32 bg-green-400 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute top-20 right-20 w-24 h-24 bg-green-300 rounded-full blur-2xl animate-pulse delay-700"></div>
        <div className="absolute bottom-10 left-1/3 w-20 h-20 bg-green-500 rounded-full blur-2xl animate-pulse delay-1000"></div>
      </div>

      {/* Enhanced background pattern */}
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%2322c55e' fill-opacity='0.3'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3Ccircle cx='15' cy='15' r='1'/%3E%3Ccircle cx='45' cy='15' r='1'/%3E%3Ccircle cx='15' cy='45' r='1'/%3E%3Ccircle cx='45' cy='45' r='1'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      />

      <div className="relative max-w-7xl mx-auto text-center">
        <div className="flex flex-col items-center justify-center mb-6">
          <div className="w-20 h-20 bg-gradient-to-br from-green-400/20 to-green-600/20 backdrop-blur-sm border border-green-400/30 rounded-2xl flex items-center justify-center mb-4 shadow-2xl shadow-green-500/20">
            <DollarSign className="w-10 h-10 text-green-400" />
          </div>
          <h1 className="text-4xl md:text-6xl font-bold text-white tracking-tight">
            $kfUSD
          </h1>
          <p className="text-xl text-gray-300 mt-2">
            The Liquidity Engine of Modular DeFi
          </p>
        </div>

        <p className="text-xl text-gray-300 mb-8 max-w-3xl mx-auto leading-relaxed">
          A 1:1 yield-enhanced stable asset built to serve as the settlement layer across the Kaleido ecosystem, Abstract Chain, and future cross-chain deployments.
        </p>

        {/* Key features */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto mb-6">
          <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-4 text-left">
            <div className="flex items-center mb-2">
              <div className="w-8 h-8 bg-green-500/20 rounded-lg flex items-center justify-center mr-3">
                <Shield className="w-4 h-4 text-green-400" />
              </div>
              <h3 className="text-base font-semibold text-white">1:1 Backing</h3>
            </div>
            <p className="text-gray-300 text-sm">
              Every $kfUSD is backed by $1 worth of stable or yield-bearing assets (USDC, USDe, USDtb)
            </p>
          </div>

          <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-4 text-left">
            <div className="flex items-center mb-2">
              <div className="w-8 h-8 bg-green-500/20 rounded-lg flex items-center justify-center mr-3">
                <Zap className="w-4 h-4 text-green-400" />
              </div>
              <h3 className="text-base font-semibold text-white">Instant Mint & Redeem</h3>
            </div>
            <p className="text-gray-300 text-sm">
              Users can deposit accepted assets to mint $kfUSD at a 1:1 ratio and redeem at any time
            </p>
          </div>

          <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-4 text-left">
            <div className="flex items-center mb-2">
              <div className="w-8 h-8 bg-green-500/20 rounded-lg flex items-center justify-center mr-3">
                <TrendingUp className="w-4 h-4 text-green-400" />
              </div>
              <h3 className="text-base font-semibold text-white">Yield Integration</h3>
            </div>
            <p className="text-gray-300 text-sm">
              Backing assets are strategically deployed into safe yield protocols generating sustainable yield
            </p>
          </div>

          <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-4 text-left">
            <div className="flex items-center mb-2">
              <div className="w-8 h-8 bg-green-500/20 rounded-lg flex items-center justify-center mr-3">
                <Lock className="w-4 h-4 text-green-400" />
              </div>
              <h3 className="text-base font-semibold text-white">Transparency</h3>
            </div>
            <p className="text-gray-300 text-sm">
              Live on-chain proof-of-reserves dashboard showing total backing and asset allocation
            </p>
          </div>

          <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-4 text-left">
            <div className="flex items-center mb-2">
              <div className="w-8 h-8 bg-green-500/20 rounded-lg flex items-center justify-center mr-3">
                <Globe className="w-4 h-4 text-green-400" />
              </div>
              <h3 className="text-base font-semibold text-white">Cross-Chain Ready</h3>
            </div>
            <p className="text-gray-300 text-sm">
              Designed to operate natively on Abstract Chain and expand to other ecosystems
            </p>
          </div>

          <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-4 text-left">
            <div className="flex items-center mb-2">
              <div className="w-8 h-8 bg-green-500/20 rounded-lg flex items-center justify-center mr-3">
                <DollarSign className="w-4 h-4 text-green-400" />
              </div>
              <h3 className="text-base font-semibold text-white">Ecosystem Engine</h3>
            </div>
            <p className="text-gray-300 text-sm">
              Powers lending, staking, and trading activities across the Kaleido ecosystem
            </p>
          </div>
        </div>

        {/* Mission Statement */}
        <div className="bg-black/30 backdrop-blur-sm border border-green-500/40 rounded-xl p-6 max-w-4xl mx-auto">
          <h3 className="text-lg font-semibold text-white mb-3">Mission</h3>
          <p className="text-gray-300 leading-relaxed">
            To create a trust-minimized, yield-optimized, multi-chain stablecoin that powers lending, staking, and trading activities across the Kaleido ecosystem — while maintaining price stability and transparency.
          </p>
        </div>
      </div>
    </div>
  );
}
