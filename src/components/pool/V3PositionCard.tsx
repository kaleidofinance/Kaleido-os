"use client";
import React, { useState } from "react";
import { V3Position } from "@/hooks/dex/useV3Positions";
import { ABSTRACT_TOKENS } from "@/constants/tokens";
import { ExternalLink, Layers, TrendingUp, ChevronDown, ChevronUp, Loader2, X } from "lucide-react";
import { ethers } from "ethers";
import { toast } from "sonner";
import { tickToPrice } from "@/constants/utils/v3Math";
import { usePoolData } from "@/hooks/dex/usePoolData";

interface V3PositionCardProps {
  position: V3Position;
  onCollectFees: (tokenId: string) => Promise<any>;
  onRemoveLiquidity: (tokenId: string, liquidity: string, amount0Min?: string, amount1Min?: string) => Promise<any>;
}

export default function V3PositionCard({ position, onCollectFees, onRemoveLiquidity }: V3PositionCardProps) {
  const token0 = ABSTRACT_TOKENS.find(t => t.address.toLowerCase() === position.token0.toLowerCase());
  const token1 = ABSTRACT_TOKENS.find(t => t.address.toLowerCase() === position.token1.toLowerCase());

  // Fetch all pools and find the one matching this position
  const { pools } = usePoolData();
  const matchingPool = pools.find(p => 
    (p.token0.address.toLowerCase() === position.token0.toLowerCase() && p.token1.address.toLowerCase() === position.token1.toLowerCase()) ||
    (p.token0.address.toLowerCase() === position.token1.toLowerCase() && p.token1.address.toLowerCase() === position.token0.toLowerCase())
  );
  const currentPrice = matchingPool?.price || 0;

  const feePercent = position.fee / 10000;
  const hasLiquidity = position.liquidity !== "0";
  const hasFees = position.tokensOwed0 !== "0" || position.tokensOwed1 !== "0";

  // Convert ticks to human prices
  const minPriceVal = tickToPrice(position.tickLower, token0?.decimals || 18, token1?.decimals || 18);
  const maxPriceVal = tickToPrice(position.tickUpper, token0?.decimals || 18, token1?.decimals || 18);

  const minPrice = Math.min(minPriceVal, maxPriceVal).toFixed(token1?.decimals === 6 ? 2 : 6);
  const maxPrice = Math.max(minPriceVal, maxPriceVal).toFixed(token1?.decimals === 6 ? 2 : 6);

  const isInRange = position.inRange;
  const isOutOfRange = hasLiquidity && !isInRange;

  // UI States
  const [expanded, setExpanded] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removePercent, setRemovePercent] = useState(100);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);

  // Price range comparison is handled above on line 40
  const handleCollectFees = async () => {
    if (collecting) return;
    setCollecting(true);
    const toastId = toast.loading("Collecting fees...");
    try {
      await onCollectFees(position.tokenId);
      toast.success("Fees collected successfully!", { id: toastId });
    } catch (e: any) {
      console.error(e);
      toast.error("Failed to collect: " + (e?.message || "Unknown error"), { id: toastId });
    } finally {
      setCollecting(false);
    }
  };

  const handleRemoveLiquidity = async () => {
    if (removing || !hasLiquidity) return;
    setRemoving(true);
    const toastId = toast.loading(`Removing ${removePercent}% liquidity...`);
    try {
      const liquidityBN = BigInt(position.liquidity);
      const toRemove = (liquidityBN * BigInt(removePercent)) / BigInt(100);
      
      // Pass '0' for min outputs as we are on testnet, but the hook now supports them
      await onRemoveLiquidity(position.tokenId, toRemove.toString(), "0", "0");
      toast.success("Liquidity removed!", { id: toastId });
      setShowRemoveConfirm(false);
    } catch (e: any) {
      console.error(e);
      toast.error("Failed to remove: " + (e?.message || "Unknown error"), { id: toastId });
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className={`group relative bg-white/5 backdrop-blur-md rounded-2xl border transition-all duration-300 overflow-hidden ${isInRange ? "border-[#00ff99]/30 shadow-[0_0_20px_rgba(0,255,153,0.05)]" : "border-white/10"}`}>
      {/* Dynamic Background Glow */}
      <div className={`absolute -right-10 -top-10 w-32 h-32 rounded-full blur-3xl transition-all ${isInRange ? "bg-[#00ff99]/10" : "bg-white/5"}`}></div>
      
      {/* Main Content */}
      <div className="p-6">
        {/* Header */}
        <div className="flex justify-between items-start mb-6">
          <div className="flex items-center gap-3">
            <div className="flex -space-x-2">
              <img src={token0?.logoURI || "/klogo.png"} alt={token0?.symbol} className="w-10 h-10 rounded-full border-2 border-black bg-black" />
              <img src={token1?.logoURI || "/klogo.png"} alt={token1?.symbol} className="w-10 h-10 rounded-full border-2 border-black bg-black" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                {token0?.symbol || "???"} / {token1?.symbol || "???"}
                <span className="text-[10px] bg-white/10 text-gray-400 px-2 py-0.5 rounded-full border border-white/5 uppercase tracking-wider">
                  #{position.tokenId}
                </span>
              </h3>
              <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-gray-400 font-medium">{feePercent}% Fee Tier</span>
                  {hasLiquidity ? (
                    <span className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-tighter ${isInRange ? "bg-[#00ff99]/20 text-[#00ff99]" : "bg-yellow-500/20 text-yellow-500"}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${isInRange ? "bg-[#00ff99] animate-pulse" : "bg-yellow-500"}`}></span>
                        {isInRange ? "In Range" : "Out of Range"}
                    </span>
                  ) : (
                    <span className="bg-white/5 text-gray-500 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-tighter border border-white/5">
                        Closed
                    </span>
                  )}
              </div>
            </div>
          </div>
          <button 
            onClick={() => setExpanded(!expanded)}
            className="p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors border border-white/5"
          >
              {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-black/20 rounded-xl p-3 border border-white/5">
              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1 flex items-center gap-1">
                  <Layers className="w-3 h-3" /> Liquidity
              </p>
              <p className="text-white font-mono text-sm truncate">{hasLiquidity ? position.liquidity : "0"}</p>
          </div>
          <div className="bg-black/20 rounded-xl p-3 border border-white/5">
              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> Fees Earned
              </p>
              <div className="space-y-0.5">
                  <p className="text-[#00ff99] font-mono text-[10px]">{position.tokensOwed0 !== "0" ? ethers.formatUnits(position.tokensOwed0, token0?.decimals || 18) : "0.00"} {token0?.symbol}</p>
                  <p className="text-[#00ff99] font-mono text-[10px]">{position.tokensOwed1 !== "0" ? ethers.formatUnits(position.tokensOwed1, token1?.decimals || 18) : "0.00"} {token1?.symbol}</p>
              </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button 
            onClick={handleCollectFees}
            disabled={collecting || !hasFees}
            className={`flex-1 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2
              ${hasFees 
                ? "bg-[#00ff99]/10 hover:bg-[#00ff99]/20 border border-[#00ff99]/20 text-[#00ff99] hover:shadow-[0_0_15px_rgba(0,255,153,0.15)]" 
                : "bg-white/5 border border-white/5 text-gray-600 cursor-not-allowed"}`}
          >
              {collecting ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              {collecting ? "Collecting..." : "Collect Fees"}
          </button>
          <button 
            onClick={() => setExpanded(!expanded)}
            className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white text-[10px] font-bold uppercase tracking-widest transition-all"
          >
              Manage
          </button>
        </div>
      </div>

      {/* Expandable Manage Panel */}
      {expanded && (
        <div className="border-t border-white/10 bg-black/20 p-6 animate-in slide-in-from-top-2 duration-300">
          {/* Tick Range */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-white/5 rounded-xl p-3 border border-white/5">
                <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1">Min Price</p>
                <p className="text-white font-mono text-sm">{minPrice} <span className="text-[8px] text-gray-600">{token1?.symbol}</span></p>
                <p className="text-[8px] text-gray-600 mt-1">Tick: {position.tickLower}</p>
            </div>
            <div className="bg-white/5 rounded-xl p-3 border border-white/5">
                <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1">Max Price</p>
                <p className="text-white font-mono text-sm">{maxPrice} <span className="text-[8px] text-gray-600">{token1?.symbol}</span></p>
                <p className="text-[8px] text-gray-600 mt-1">Tick: {position.tickUpper}</p>
            </div>
          </div>

          {/* Remove Liquidity Section */}
          {hasLiquidity && (
            <>
              {!showRemoveConfirm ? (
                <button
                  onClick={() => setShowRemoveConfirm(true)}
                  className="w-full py-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-bold uppercase tracking-widest transition-all"
                >
                  Remove Liquidity
                </button>
              ) : (
                <div className="space-y-4 bg-red-500/5 rounded-xl p-4 border border-red-500/10">
                    <div className="flex justify-between items-center">
                        <p className="text-xs text-red-400 font-bold uppercase tracking-wider">Remove Liquidity</p>
                        <button onClick={() => setShowRemoveConfirm(false)} className="text-gray-500 hover:text-white">
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Percent Selector */}
                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <span className="text-white font-mono text-2xl font-bold">{removePercent}%</span>
                        </div>
                        <input 
                            type="range" 
                            min="1" 
                            max="100" 
                            value={removePercent}
                            onChange={(e) => setRemovePercent(parseInt(e.target.value))}
                            className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-red-500"
                        />
                        <div className="flex gap-2">
                            {[25, 50, 75, 100].map(pct => (
                                <button 
                                    key={pct} 
                                    onClick={() => setRemovePercent(pct)}
                                    className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all border
                                        ${removePercent === pct 
                                            ? "bg-red-500/20 text-red-400 border-red-500/30" 
                                            : "bg-white/5 text-gray-500 border-white/5 hover:text-white"}`}
                                >
                                    {pct}%
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Confirm Button */}
                    <button
                        onClick={handleRemoveLiquidity}
                        disabled={removing}
                        className="w-full py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white text-xs font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        {removing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        {removing ? "Removing..." : `Confirm Remove ${removePercent}%`}
                    </button>
                </div>
              )}
            </>
          )}

          {!hasLiquidity && (
            <div className="text-center py-4">
                <p className="text-gray-500 text-xs uppercase tracking-wider">This position has been fully withdrawn.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
