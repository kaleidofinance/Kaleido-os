"use client";

import React, { useState } from "react";
import { DollarSign, ArrowUpDown, Info, Shield, TrendingUp, Zap } from "lucide-react";

interface CollateralAsset {
  symbol: string;
  name: string;
  address: string;
  image: string;
  balance: string;
  price: string;
  description: string;
  yield: string;
}

export default function MintKFUSD() {
  const [selectedAsset, setSelectedAsset] = useState<CollateralAsset | null>(null);
  const [mintAmount, setMintAmount] = useState("");
  const [isMinting, setIsMinting] = useState(false);

  const supportedAssets: CollateralAsset[] = [
    {
      symbol: "USDC",
      name: "USD Coin",
      address: "0xA0b86a33E6441b8C4C8C0C4C8C0C4C8C0C4C8C0C4",
      image: "/tokens/usdc.png",
      balance: "1,250.00",
      price: "$1.00",
      description: "Base Reserve (Stability Anchor)",
      yield: "0%"
    },
    {
      symbol: "USDe",
      name: "Ethena USD",
      address: "0xB1c97a44E7551b9D4D5D1D5D1D5D1D5D1D5D1D5D1",
      image: "/tokens/usde.png",
      balance: "2,100.50",
      price: "$1.00",
      description: "Delta-neutral funding yields",
      yield: "12.4%"
    },
    {
      symbol: "USDtb",
      name: "BlackRock BUIDL-backed USD",
      address: "0xC2d88b66F6662c8C2D2D2D2D2D2D2D2D2D2D2D2D2",
      image: "/tokens/usdtb.png",
      balance: "5.25",
      price: "$1.00",
      description: "Treasury bill yields",
      yield: "4.8%"
    }
  ];

  const mintingFees = {
    mintFee: "0.1%",
    stabilityFee: "0.1%",
    totalFee: "0.2%"
  };

  const handleMint = async () => {
    if (!selectedAsset || !mintAmount) return;
    
    setIsMinting(true);
    // Simulate minting process
    await new Promise(resolve => setTimeout(resolve, 2000));
    setIsMinting(false);
    
    // Reset form
    setMintAmount("");
  };

  const calculateKFUSDAmount = () => {
    if (!selectedAsset || !mintAmount) return "0";
    const amount = parseFloat(mintAmount);
    const kfusdAmount = (amount * 0.998).toFixed(2); // 0.2% total fee
    return kfusdAmount;
  };

  return (
    <div className="space-y-8">
      {/* Mint Interface */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Asset Selection */}
        <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Select Collateral Asset</h3>
          <div className="space-y-3">
            {supportedAssets.map((asset) => (
              <button
                key={asset.address}
                onClick={() => setSelectedAsset(asset)}
                className={`w-full p-4 rounded-lg border transition-all ${
                  selectedAsset?.address === asset.address
                    ? "border-green-500 bg-green-500/10"
                    : "border-gray-700 hover:border-gray-600"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="w-10 h-10 bg-[#2a2a2a] rounded-full flex items-center justify-center mr-3">
                      <span className="text-xs font-bold text-white">{asset.symbol.charAt(0)}</span>
                    </div>
                    <div className="text-left">
                      <p className="text-white font-medium">{asset.symbol}</p>
                      <p className="text-gray-400 text-sm">{asset.name}</p>
                      <p className="text-gray-500 text-xs">{asset.description}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-white font-medium">{asset.balance}</p>
                    <p className="text-gray-400 text-sm">{asset.price}</p>
                    <p className="text-green-400 text-xs">{asset.yield} APY</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Mint Form */}
        <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Mint kfUSD</h3>
          
          {selectedAsset && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Amount to Deposit
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={mintAmount}
                    onChange={(e) => setMintAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-4 py-3 bg-[#2a2a2a] border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:border-green-500 focus:outline-none"
                  />
                  <div className="absolute right-3 top-3 text-gray-400 text-sm">
                    {selectedAsset.symbol}
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Balance: {selectedAsset.balance} {selectedAsset.symbol}
                </p>
              </div>

              <div className="flex items-center justify-between py-2">
                <span className="text-gray-400">You will receive:</span>
                <span className="text-white font-semibold">
                  {calculateKFUSDAmount()} kfUSD
                </span>
              </div>

              <div className="bg-[#2a2a2a]/50 rounded-lg p-4">
                <h4 className="text-sm font-medium text-gray-300 mb-3">Fee Breakdown</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Minting Fee</span>
                    <span className="text-white">{mintingFees.mintFee}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Stability Fee</span>
                    <span className="text-white">{mintingFees.stabilityFee}</span>
                  </div>
                  <div className="flex justify-between border-t border-gray-700 pt-2">
                    <span className="text-white font-medium">Total Fees</span>
                    <span className="text-green-400 font-medium">{mintingFees.totalFee}</span>
                  </div>
                </div>
              </div>

              <button
                onClick={handleMint}
                disabled={!mintAmount || isMinting}
                className="w-full py-3 bg-green-500 hover:bg-green-600 disabled:bg-[#2a2a2a] disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
              >
                {isMinting ? "Minting..." : "Mint kfUSD"}
              </button>
            </div>
          )}

          {!selectedAsset && (
            <div className="text-center py-8">
              <Shield className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-400">Select a collateral asset to start minting</p>
            </div>
          )}
        </div>
      </div>

      {/* Minting Process Information */}
      <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Minting Process</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="flex items-start">
            <div className="w-8 h-8 bg-green-500/20 rounded-lg flex items-center justify-center mr-3 mt-1">
              <span className="text-sm font-bold text-green-400">1</span>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-1">Deposit Asset</h4>
              <p className="text-gray-300 text-sm">
                Deposit USDC, USDe, or USDtb into the Kaleido Stable Vault
              </p>
            </div>
          </div>
          <div className="flex items-start">
            <div className="w-8 h-8 bg-green-500/20 rounded-lg flex items-center justify-center mr-3 mt-1">
              <span className="text-sm font-bold text-green-400">2</span>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-1">Smart Contract Mint</h4>
              <p className="text-gray-300 text-sm">
                Smart contract mints kfUSD at 1:1 ratio with minimal fees
              </p>
            </div>
          </div>
          <div className="flex items-start">
            <div className="w-8 h-8 bg-green-500/20 rounded-lg flex items-center justify-center mr-3 mt-1">
              <span className="text-sm font-bold text-green-400">3</span>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-1">Vault Update</h4>
              <p className="text-gray-300 text-sm">
                Vault balance updates on-chain and reflected in dashboard
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Information Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
          <div className="flex items-center mb-3">
            <Info className="w-5 h-5 text-blue-400 mr-2" />
            <h3 className="text-lg font-semibold text-white">1:1 Backing</h3>
          </div>
          <p className="text-gray-300 text-sm">
            Every kfUSD is backed by $1 worth of stable or yield-bearing assets held in transparent on-chain vaults.
          </p>
        </div>

        <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
          <div className="flex items-center mb-3">
            <Zap className="w-5 h-5 text-green-400 mr-2" />
            <h3 className="text-lg font-semibold text-white">Instant Redemption</h3>
          </div>
          <p className="text-gray-300 text-sm">
            Users can redeem kfUSD for any supported reserve asset at any time with minimal fees.
          </p>
        </div>

        <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
          <div className="flex items-center mb-3">
            <TrendingUp className="w-5 h-5 text-purple-400 mr-2" />
            <h3 className="text-lg font-semibold text-white">Yield Integration</h3>
          </div>
          <p className="text-gray-300 text-sm">
            Backing assets are strategically deployed into safe yield protocols generating sustainable yield for the ecosystem.
          </p>
        </div>
      </div>
    </div>
  );
}
