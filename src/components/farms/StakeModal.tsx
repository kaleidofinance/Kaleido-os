"use client";
import React, { useState } from "react";
import { X } from "lucide-react";
import Button from "@/common/button";
import TokenIcon from "../icons/tokenIcon";
import { ABSTRACT_MAINNET_CHAIN_ID } from "@/constants/tokens";

interface StakeModalProps {
  isOpen: boolean;
  onClose: () => void;
  poolAddress: string;
  pair: {
    token0: {
      symbol: string;
      name: string;
      address: string;
      decimals: number;
      verified: boolean;
      logoURI?: string;
    };
    token1: {
      symbol: string;
      name: string;
      address: string;
      decimals: number;
      verified: boolean;
      logoURI?: string;
    };
  };
  userPosition?: {
    stakedBalance?: string;
    stakedBalanceFormatted?: string;
    pointsEarnedFormatted?: string;
    unclaimedPointsFormatted?: string;
    pointsMultiplier?: string;
    earnings?: string;
  };
  onStake: (poolAddress: string, amount: string) => void;
  onUnstake: (poolAddress: string, amount: string) => void;
  onClaim: (poolAddress: string) => void;
  onHarvest?: (poolAddress: string) => void;
  isStaking?: boolean;
  isUnstaking?: boolean;
  isClaiming?: boolean;
  isHarvesting?: boolean;
  farmApr?: number;
  farmMultiplier?: string;
  earnedKLD?: string;
  lpSymbol?: string;
}

export default function StakeModal({
  isOpen,
  onClose,
  poolAddress,
  pair,
  userPosition,
  onStake,
  onUnstake,
  onClaim,
  onHarvest,
  isStaking = false,
  isUnstaking = false,
  isClaiming = false,
  isHarvesting = false,
  farmApr = 0,
  farmMultiplier = "0X",
  earnedKLD = "0",
  lpSymbol = "LP",
}: StakeModalProps) {
  const [stakeAmount, setStakeAmount] = useState("");
  const [unstakeAmount, setUnstakeAmount] = useState("");
  const [activeTab, setActiveTab] = useState<"stake" | "unstake">("stake");

  const handleStake = () => {
    if (stakeAmount && Number(stakeAmount) > 0) {
      onStake(poolAddress, stakeAmount);
      setStakeAmount("");
    }
  };

  const handleUnstake = () => {
    if (unstakeAmount && Number(unstakeAmount) > 0) {
      onUnstake(poolAddress, unstakeAmount);
      setUnstakeAmount("");
    }
  };

  const handleHarvest = () => {
    if (onHarvest) {
      onHarvest(poolAddress);
    }
  };

  const handleClaim = () => {
    onClaim(poolAddress);
  };

  const earnedPoints = userPosition?.pointsEarnedFormatted || "0";
  const unclaimedPoints = userPosition?.unclaimedPointsFormatted || "0";
  const hasStakedBalance =
    userPosition?.stakedBalance && parseFloat(userPosition.stakedBalance) > 0;
  const hasEarnings =
    userPosition?.earnings && parseFloat(userPosition.earnings) > 0;
  const hasKLD = parseFloat(earnedKLD) > 0;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#0a1f13]/40 backdrop-blur-md border border-[#00ff99]/20 rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl shadow-[#00ff99]/10">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#00ff99]/20 bg-gradient-to-r from-[#00ff99]/10 to-[#00ff99]/5">
          <div className="flex items-center space-x-4">
            <div className="flex -space-x-2">
              <TokenIcon
                size="md"
                variant="minimal"
                address={pair.token0.address}
                chainId={ABSTRACT_MAINNET_CHAIN_ID}
                name={pair.token0.symbol}
                symbol={pair.token0.symbol}
                decimals={pair.token0.decimals}
                verified={pair.token0.verified}
                logoURI={pair.token0.logoURI}
              />
              <TokenIcon
                size="md"
                variant="minimal"
                address={pair.token1.address}
                chainId={ABSTRACT_MAINNET_CHAIN_ID}
                name={pair.token1.symbol}
                symbol={pair.token1.symbol}
                decimals={pair.token1.decimals}
                verified={pair.token1.verified}
                logoURI={pair.token1.logoURI}
              />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white">{lpSymbol}</h3>
              <div className="flex items-center space-x-2">
                <span className="text-sm text-green-400 font-medium">
                  {farmMultiplier}
                </span>
                <span className="text-xs text-gray-400">Multiplier</span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-lg"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Farm Stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gradient-to-br from-green-500/20 to-green-600/20 border border-green-500/30 rounded-xl p-4 backdrop-blur-sm">
              <p className="text-sm text-green-300 font-medium">Farm APR</p>
              <p className="text-2xl font-bold text-green-400">
                {farmApr.toFixed(2)}%
              </p>
            </div>
            <div className="bg-gradient-to-br from-[#00ff99]/10 to-[#00ff99]/5 border border-[#00ff99]/20 rounded-xl p-4 backdrop-blur-sm">
              <p className="text-sm text-[#00ff99]/80 font-medium">KLD Earned</p>
              <p className="text-2xl font-bold text-[#00ff99]">{earnedKLD} KLD</p>
            </div>
          </div>

          {/* User Position */}
          {userPosition && (
            <div className="bg-gradient-to-br from-orange-500/10 to-orange-600/10 border border-orange-500/20 rounded-xl p-4 backdrop-blur-sm">
              <h4 className="text-sm font-medium text-orange-300 mb-3 flex items-center">
                <span className="w-2 h-2 bg-orange-400 rounded-full mr-2"></span>
                Your Position
              </h4>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-300">Points Earned:</span>
                  <span className="text-sm font-semibold text-orange-400">
                    {earnedPoints}
                  </span>
                </div>
                {Number(unclaimedPoints) > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-300">
                      Unclaimed Points:
                    </span>
                    <span className="text-sm font-semibold text-orange-300">
                      {unclaimedPoints}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-4">
            {/* Harvest and Claim Buttons */}
            <div className="flex space-x-3">
              {hasKLD && onHarvest && (
                <Button
                  fullWidth
                  variant="primary"
                  onClick={handleHarvest}
                  disabled={isHarvesting}
                  className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-semibold py-3"
                >
                  {isHarvesting ? "Harvesting..." : "Harvest KLD"}
                </Button>
              )}
              {Number(unclaimedPoints) > 0 && (
                <Button
                  fullWidth
                  variant="outline"
                  onClick={handleClaim}
                  disabled={isClaiming}
                  className="border-orange-500 text-orange-400 hover:bg-orange-500/10 font-semibold py-3"
                >
                  {isClaiming ? "Claiming..." : "Claim Points"}
                </Button>
              )}
            </div>

            {/* Stake/Unstake Tabs */}
            <div className="flex space-x-1 bg-[#0a2915]/40 backdrop-blur-md rounded-xl p-1 border border-[#00ff99]/20">
              <button
                className={`flex-1 py-3 px-4 rounded-lg text-sm font-semibold transition-all duration-200 ${
                  activeTab === "stake"
                    ? "bg-gradient-to-r from-green-500 to-green-600 text-white shadow-lg"
                    : "text-gray-400 hover:text-white hover:bg-white/5"
                }`}
                onClick={() => setActiveTab("stake")}
              >
                Stake
              </button>
              <button
                className={`flex-1 py-3 px-4 rounded-lg text-sm font-semibold transition-all duration-200 ${
                  activeTab === "unstake"
                    ? "bg-gradient-to-r from-red-500 to-red-600 text-white shadow-lg"
                    : "text-gray-400 hover:text-white hover:bg-white/5"
                }`}
                onClick={() => setActiveTab("unstake")}
              >
                Unstake
              </button>
            </div>

            {/* Stake/Unstake Form */}
            {activeTab === "stake" ? (
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-sm text-gray-300 font-medium">Amount to Stake</label>
                    <span className="text-xs text-[#00ff99]/70">
 Balance: <span className="font-semibold text-[#00ff99]">{userPosition?.stakedBalanceFormatted || "0.0000"}</span>
                    </span>
                  </div>
                  <input
                    type="number"
                    value={stakeAmount}
                    onChange={(e) => setStakeAmount(e.target.value)}
                    placeholder="0.0"
                    className="w-full px-4 py-3 bg-[#0a2915]/40 backdrop-blur-md border border-[#00ff99]/20 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-[#00ff99] focus:ring-2 focus:ring-[#00ff99]/30 transition-all"
                  />
                </div>
                <Button
                  fullWidth
                  onClick={handleStake}
                  disabled={
                    !stakeAmount || Number(stakeAmount) <= 0 || isStaking
                  }
                  className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-semibold py-3 rounded-xl"
                >
                  {isStaking ? "Staking..." : "Stake LP Tokens"}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-sm text-gray-300 font-medium">Amount to Unstake</label>
                    <span className="text-xs text-[#00ff99]/70">
                      Staked: <span className="font-semibold text-[#00ff99]">{userPosition?.stakedBalanceFormatted || "0.0000"}</span>
                    </span>
                  </div>
                  <input
                    type="number"
                    value={unstakeAmount}
                    onChange={(e) => setUnstakeAmount(e.target.value)}
                    placeholder="0.0"
                    className="w-full px-4 py-3 bg-[#0a2915]/40 backdrop-blur-md border border-[#00ff99]/20 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-[#00ff99] focus:ring-2 focus:ring-[#00ff99]/30 transition-all"
                  />
                </div>
                <Button
                  fullWidth
                  variant="outline"
                  onClick={handleUnstake}
                  disabled={
                    !unstakeAmount || Number(unstakeAmount) <= 0 || isUnstaking
                  }
                  className="border-red-500 text-red-400 hover:bg-red-500/10 font-semibold py-3 rounded-xl"
                >
                  {isUnstaking ? "Unstaking..." : "Unstake LP Tokens"}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
