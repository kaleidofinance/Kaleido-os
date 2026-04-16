"use client";
import React from "react";
import { IToken } from "@/constants/types/dex";
import { Plus, ArrowRight } from "lucide-react";
import V3LiquidityChart from "./V3LiquidityChart";
import Button from "@/components/shared/Button";
import { AddLiquidityFrom, AddLiquidityTo } from "./liquidityPanel";
import { useTokenUsdPrice } from "@/hooks/useTokenUsdPrice";
import { formatBalance } from "@/utils/formatBalance";

interface TokenInputPanelProps {
  selectedToken: IToken | null;
  selectedToToken: IToken | null;
  onTokenSelect: (token: IToken) => void;
  onTokenToSelect: (token: IToken) => void;
  value: string;
  toValue: string;
  onValueChange: (value: string) => void;
  onToValueChange: (value: string) => void;
  balance: string;
  tobalance: string;
  tokenA?: string;
  tokenB?: string;
  reserveA?: string;
  reserveB?: string;
  price?: string;
  shareOfPool?: string;
  noLiquidity?: boolean;
  onAction?: () => void;
  actionText?: string;
  actionDisabled?: boolean;
  poolType?: "volatile" | "stable";
  onPoolTypeChange?: (type: "volatile" | "stable") => void;
  feeTier?: string;
  dexVersion?: "v2" | "v3";
  onDexVersionChange?: (version: "v2" | "v3") => void;
  onFeeTierChange?: (tier: string) => void;
  minPrice?: string;
  onMinPriceChange?: (val: string) => void;
  maxPrice?: string;
  onMaxPriceChange?: (val: string) => void;
  isFullRange?: boolean;
  onFullRangeToggle?: () => void;
  currentPrice?: string;
  onWrap?: (amount: string) => void;
  isWrapping?: boolean;
}

export default function LiquidityInputPanel({
  selectedToken,
  selectedToToken,
  onTokenSelect,
  value,
  toValue,
  onValueChange,
  onToValueChange,
  balance,
  tobalance,
  tokenA,
  tokenB,
  onTokenToSelect,
  reserveA = "0",
  reserveB = "0",
  price = "0",
  shareOfPool = "0",
  noLiquidity = false,
  onAction,
  actionText = "Add Liquidity",
  actionDisabled = false,
  feeTier = "0.3%",
  poolType = "volatile",

  onPoolTypeChange,
  dexVersion = "v2",
  onDexVersionChange,
  onFeeTierChange,
  minPrice,
  onMinPriceChange,
  maxPrice,
  onMaxPriceChange,
  isFullRange = false,
  onFullRangeToggle,
  currentPrice,
  onWrap,
  isWrapping,
  verticalLayout = false,
}: TokenInputPanelProps & { verticalLayout?: boolean }) {
  const symbolA = selectedToken?.symbol || tokenA || "Token A";
  const symbolB = selectedToToken?.symbol || tokenB || "Token B";

  const { price: priceA } = useTokenUsdPrice(selectedToken);
  const { price: priceB } = useTokenUsdPrice(selectedToToken);

  const calculateUsdValue = (amount: string, price: number | null) => {
    if (!amount || !price || isNaN(Number(amount))) return null;
    return (Number(amount) * price).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const calculatePercentage = (percent: number, bal: string, setVal: (val: string) => void) => {
    if (!bal) return;
    const balanceNum = parseFloat(bal);
    if (isNaN(balanceNum)) return;
    const val = (balanceNum * percent) / 100;
    setVal(val.toString());
  };

  const usdValueA = calculateUsdValue(value, priceA);
  const usdValueB = calculateUsdValue(toValue, priceB);

  const PercentButtons = ({ bal, setVal }: { bal: string, setVal: (val: string) => void }) => (
    <div className="flex gap-2">
      {[25, 50, 75, 100].map((percent) => (
        <button
          key={percent}
          onClick={() => calculatePercentage(percent, bal, setVal)}
          className="text-xs font-semibold text-[#00ff99] hover:bg-[#00ff99]/10 rounded px-1.5 py-0.5 transition-colors uppercase tracking-wide border border-[#00ff99]/30"
        >
          {percent === 100 ? "Max" : `${percent}%`}
        </button>
      ))}
    </div>
  );

  const formatReserve = (val: string | number) => {
    const num = Number(val);
    if (isNaN(num)) return "-";
    if (num === 0) return "0";
    if (num < 0.000001) return "< 0.000001";
    return num.toLocaleString(undefined, { maximumFractionDigits: 6 });
  };

  return (
    <div className="flex flex-col space-y-3">
      {/* Pool Type Selector & Alert */}
      {noLiquidity && (
        <div className="space-y-6">
           {/* New Pool Alert */}
          <div className="relative overflow-hidden rounded-xl border border-[#00ff99]/30 bg-gradient-to-r from-[#00ff99]/10 to-transparent p-6 backdrop-blur-sm">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div className="space-y-1">
                <h3 className="text-[#00ff99] text-lg font-bold">First Liquidity Provider</h3>
                <p className="text-gray-300 text-sm">The ratio of tokens you add will set the initial price of this pool.</p>
              </div>
              <div className="px-4 py-2 rounded-lg bg-[#00ff99]/10 border border-[#00ff99]/20">
                <span className="text-xs text-[#00ff99] font-medium uppercase tracking-wider">New Pool</span>
              </div>
            </div>
          </div>

          {/* DEX Version Selector */}
          <div className="bg-white/5 p-1 rounded-xl flex border border-white/10 relative backdrop-blur-sm">
            <button
                onClick={() => onDexVersionChange?.("v2")}
                className={`flex-1 py-2.5 px-4 rounded-lg text-xs font-bold uppercase tracking-widest transition-all duration-300 flex items-center justify-center gap-2
                ${dexVersion === "v2" ? "bg-[#00ff99] text-black shadow-[0_0_20px_rgba(0,255,153,0.3)]" : "text-gray-400 hover:text-white hover:bg-white/5"}`}
            >
                V2 Classic
            </button>
            <button
                onClick={() => onDexVersionChange?.("v3")}
                className={`flex-1 py-2.5 px-4 rounded-lg text-xs font-bold uppercase tracking-widest transition-all duration-300 flex items-center justify-center gap-2
                ${dexVersion === "v3" ? "bg-[#00ff99] text-black shadow-[0_0_20px_rgba(0,255,153,0.3)]" : "text-gray-400 hover:text-white hover:bg-white/5"}`}
            >
                V3 Concentrated
            </button>
          </div>

          {/* Pool Type Selector (V2 only) or Fee Tier Selector (V3) */}
          {dexVersion === "v2" ? (
            <div className="bg-white/5 p-1 rounded-xl flex border border-white/10 relative backdrop-blur-sm">
                <button
                    onClick={() => onPoolTypeChange?.("volatile")}
                    className={`flex-1 py-3 px-4 rounded-lg text-sm font-bold uppercase tracking-wide transition-all duration-300 flex flex-col items-center gap-1
                    ${poolType === "volatile" ? "bg-[#00ff99] text-black shadow-[0_0_20px_rgba(0,255,153,0.3)]" : "text-gray-400 hover:text-white hover:bg-white/5"}`}
                >
                    <span>Volatile Pair</span>
                    <span className={`text-[10px] ${poolType === "volatile" ? "text-black/70" : "text-gray-500"}`}>0.30% Fee Tier</span>
                </button>
                <button
                    onClick={() => onPoolTypeChange?.("stable")}
                    className={`flex-1 py-3 px-4 rounded-lg text-sm font-bold uppercase tracking-wide transition-all duration-300 flex flex-col items-center gap-1
                    ${poolType === "stable" ? "bg-[#00ff99] text-black shadow-[0_0_20px_rgba(0,255,153,0.3)]" : "text-gray-400 hover:text-white hover:bg-white/5"}`}
                >
                    <span>Stable Pair</span>
                    <span className={`text-[10px] ${poolType === "stable" ? "text-black/70" : "text-gray-500"}`}>0.05% Fee Tier</span>
                </button>
            </div>
          ) : (
            <div className="bg-white/5 p-1 rounded-xl flex border border-white/10 relative backdrop-blur-sm overflow-x-auto no-scrollbar">
                {[0.01, 0.05, 0.3, 1.0].map((tier) => (
                    <button
                        key={tier}
                        onClick={() => onFeeTierChange?.(tier + "%")}
                        className={`flex-1 py-3 px-3 rounded-lg text-sm font-bold uppercase tracking-wide transition-all duration-300 flex flex-col items-center gap-1 min-w-[80px]
                        ${feeTier === tier + "%" ? "bg-[#00ff99] text-black shadow-[0_0_20px_rgba(0,255,153,0.3)]" : "text-gray-400 hover:text-white hover:bg-white/5"}`}
                    >
                        <span>{tier}%</span>
                        <span className={`text-[10px] ${feeTier === tier + "%" ? "text-black/70" : "text-gray-500"}`}>{tier === 0.01 ? "Best for stable" : tier === 0.05 ? "Most pairs" : "Exotic"}</span>
                    </button>
                ))}
            </div>
          )}

          {/* V3 Range Selector */}
          {dexVersion === "v3" && (
            <div className="rounded-xl border border-[#00ff99]/20 bg-[#00ff99]/5 p-6 backdrop-blur-sm animate-in fade-in slide-in-from-top-4 duration-500">
                <div className="flex justify-between items-center mb-6">
                    <div className="space-y-1">
                        <h4 className="text-[#00ff99] font-bold text-base uppercase tracking-wider">Set Price Range</h4>
                        <p className="text-gray-400 text-xs">Concentrate your liquidity for higher efficiency.</p>
                    </div>
                    {currentPrice && currentPrice !== "0" && (
                        <div className="bg-[#00ff99]/10 border border-[#00ff99]/20 rounded-lg px-3 py-1.5 backdrop-blur-sm">
                            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-0.5">V2 Market Price</p>
                            <p className="text-[#00ff99] font-mono font-bold text-sm text-right">{currentPrice}</p>
                        </div>
                    )}
                </div>

                {/* V3 Visualizer Chart */}
                <div className="mb-8">
                    <V3LiquidityChart 
                        currentPrice={currentPrice || "0"}
                        minPrice={minPrice || "0"}
                        maxPrice={maxPrice || "0"}
                        onMinPriceChange={onMinPriceChange || (() => {})}
                        onMaxPriceChange={onMaxPriceChange || (() => {})}
                        isFullRange={isFullRange}
                    />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className={`bg-black/40 rounded-xl p-4 border transition-all ${isFullRange ? "border-white/5 opacity-50" : "border-white/5 hover:border-[#00ff99]/30"}`}>
                        <span className="text-[10px] text-gray-500 font-bold uppercase block mb-2">Low Price</span>
                        <div className="flex items-center justify-between gap-2">
                            <button 
                                disabled={isFullRange}
                                onClick={() => {
                                    const current = parseFloat(minPrice || "0");
                                    const next = current === 0 ? 0.000001 : current * 0.95;
                                    onMinPriceChange?.(next.toFixed(6));
                                }}
                                className="text-[#00ff99] hover:bg-[#00ff99]/10 rounded-lg p-1 transition-colors disabled:text-gray-600"
                            >-</button>
                            <input 
                                type="text"
                                disabled={isFullRange}
                                value={isFullRange ? "0" : minPrice}
                                onChange={(e) => onMinPriceChange?.(e.target.value)}
                                className="w-full bg-transparent text-center text-xl font-mono font-bold text-white focus:outline-none disabled:text-gray-500"
                            />
                            <button 
                                disabled={isFullRange}
                                onClick={() => {
                                    const current = parseFloat(minPrice || "0");
                                    const next = current === 0 ? 0.000001 : current * 1.05;
                                    onMinPriceChange?.(next.toFixed(6));
                                }}
                                className="text-[#00ff99] hover:bg-[#00ff99]/10 rounded-lg p-1 transition-colors disabled:text-gray-600"
                            >+</button>
                        </div>
                        <span className="text-[10px] text-gray-400 block mt-2 text-center font-mono">{symbolB} per {symbolA}</span>
                    </div>
                    <div className={`bg-black/40 rounded-xl p-4 border transition-all ${isFullRange ? "border-white/5 opacity-50" : "border-white/5 hover:border-[#00ff99]/30"}`}>
                        <span className="text-[10px] text-gray-500 font-bold uppercase block mb-2">High Price</span>
                        <div className="flex items-center justify-between gap-2">
                            <button 
                                disabled={isFullRange}
                                onClick={() => {
                                    const current = parseFloat(maxPrice || "0");
                                    const next = current === 0 ? 0.000001 : current * 0.95;
                                    onMaxPriceChange?.(next.toFixed(6));
                                }}
                                className="text-[#00ff99] hover:bg-[#00ff99]/10 rounded-lg p-1 transition-colors disabled:text-gray-600"
                            >-</button>
                            <input 
                                type="text"
                                disabled={isFullRange}
                                value={isFullRange ? "∞" : maxPrice}
                                onChange={(e) => onMaxPriceChange?.(e.target.value)}
                                className="w-full bg-transparent text-center text-xl font-mono font-bold text-white focus:outline-none disabled:text-gray-500"
                            />
                            <button 
                                disabled={isFullRange}
                                onClick={() => {
                                    const current = parseFloat(maxPrice || "0");
                                    const next = current === 0 ? 0.000001 : current * 1.05;
                                    onMaxPriceChange?.(next.toFixed(6));
                                }}
                                className="text-[#00ff99] hover:bg-[#00ff99]/10 rounded-lg p-1 transition-colors disabled:text-gray-600"
                            >+</button>
                        </div>
                        <span className="text-[10px] text-gray-400 block mt-2 text-center font-mono">{symbolB} per {symbolA}</span>
                    </div>
                </div>

                <button 
                    onClick={onFullRangeToggle}
                    className={`w-full mt-4 py-3 rounded-xl border text-xs font-bold uppercase tracking-widest transition-all
                    ${isFullRange ? "bg-[#00ff99] text-black border-[#00ff99]" : "border-[#00ff99]/30 text-[#00ff99] hover:bg-[#00ff99]/10"}`}
                >
                    {isFullRange ? "Full Range Active" : "Set Full Range"}
                </button>
            </div>
          )}
        </div>
      )}
      
      {/* Main Input Grid - Side by Side or Stacked */}
      <div className={`relative grid gap-2 items-center ${verticalLayout ? "grid-cols-1" : "grid-cols-1 md:grid-cols-[1fr,auto,1fr]"}`}>
        
        {/* Token A Input */}
        <div className="flex flex-col space-y-3">
          
          <div className="group relative rounded-xl border border-white/10 bg-white/5 p-4 transition-all duration-300 hover:border-[#00ff99]/50 hover:shadow-[0_0_30px_rgba(0,255,153,0.05)] focus-within:border-[#00ff99] focus-within:shadow-[0_0_30px_rgba(0,255,153,0.1)] backdrop-blur-sm">
             <div className="flex justify-between items-center mb-2">
                <div className="flex items-center">
                    <span className="text-xs font-mono text-[#00ff99]">
                      Balance: {formatBalance(balance)}
                    </span>
                    {selectedToken?.address === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" && onWrap && (
                        <button 
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (value) onWrap(value);
                            }}
                            disabled={isWrapping}
                            className="ml-2 text-[10px] bg-[#00ff99]/10 hover:bg-[#00ff99]/20 text-[#00ff99] px-2 py-0.5 rounded-md border border-[#00ff99]/20 transition-all uppercase font-black tracking-tighter disabled:opacity-50"
                        >
                            {isWrapping ? "..." : "Wrap"}
                        </button>
                    )}
                </div>
                <PercentButtons bal={balance} setVal={onValueChange} />
             </div>
            <div className="flex flex-col gap-3">
              <input
                placeholder="0.0"
                value={value}
                onChange={(e) => onValueChange(e.target.value)}
                type="number"
                step="any"
                className="w-full bg-transparent border-none outline-none text-2xl font-bold text-white placeholder:text-gray-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none font-mono mt-1"
              />
              <div className="flex justify-between items-end">
                <div className="h-6">
                 {usdValueA && (
                    <span className="text-sm font-medium text-gray-500">≈ {usdValueA}</span>
                 )}
                </div>
                <AddLiquidityFrom
                  selectedToken={selectedToken}
                  onTokenSelect={onTokenSelect}
                  symbolA={symbolA}
                  onWrap={onWrap}
                  isWrapping={isWrapping}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Center Connector */}
        <div className="flex justify-center">
            <div className="p-2 bg-white/5 backdrop-blur-sm border border-[#00ff99]/30 rounded-full shadow-lg shadow-[#00ff99]/10">
                <Plus className="w-4 h-4 text-[#00ff99]" strokeWidth={3} />
            </div>
        </div>

        {/* Token B Input */}
        <div className="flex flex-col space-y-3">
          
          <div className="group relative rounded-xl border border-white/10 bg-white/5 p-4 transition-all duration-300 hover:border-[#00ff99]/50 hover:shadow-[0_0_30px_rgba(0,255,153,0.05)] focus-within:border-[#00ff99] focus-within:shadow-[0_0_30px_rgba(0,255,153,0.1)] backdrop-blur-sm">
            <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-mono text-[#00ff99]">
                  Balance: {formatBalance(tobalance)}
                </span>
                 <PercentButtons bal={tobalance} setVal={onToValueChange} />
            </div>
            <div className="flex flex-col gap-3">
              <input
                placeholder="0.0"
                value={toValue}
                onChange={(e) => onToValueChange(e.target.value)}
                type="number"
                step="any"
                className="w-full bg-transparent border-none outline-none text-2xl font-bold text-white placeholder:text-gray-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none font-mono mt-1"
              />
              <div className="flex justify-between items-end">
                 <div className="h-6">
                 {usdValueB && (
                    <span className="text-sm font-medium text-gray-500">≈ {usdValueB}</span>
                 )}
                </div>
                <AddLiquidityTo
                  selectedToken={selectedToToken}
                  onTokenSelect={onTokenToSelect}
                  symbolB={symbolB}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Info Grid - Side by Side or Stacked */}
      <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
        
        {/* Prices Card */}
        <div className="rounded-xl border border-white/5 bg-white/5 p-3 backdrop-blur-sm">
          <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
            {noLiquidity ? "Initial Prices" : "Current Prices"} & Share
          </h4>
          <div className="space-y-2">
            <div className="flex justify-between items-center pb-2 border-b border-white/5">
              <span className="text-xs text-gray-400 font-mono">{symbolB} per {symbolA}</span>
              <div className="flex items-center gap-1">
                {priceB && Number(price) > 0 && (
                   <span className="text-[10px] text-gray-500 font-mono">
                     (≈${formatReserve(Number(price) * (priceB || 0))})
                   </span>
                )}
                <span className="text-sm text-white font-bold font-mono">{price}</span>
              </div>
            </div>
            <div className="flex justify-between items-center pb-2 border-b border-white/5">
              <span className="text-xs text-gray-400 font-mono">Pool Share</span>
              <span className="text-sm text-[#00ff99] font-bold font-mono">{shareOfPool}%</span>
            </div>
             <div className="flex justify-between items-center">
              <span className="text-xs text-gray-400 font-mono">Pool Fee</span>
              <span className="text-sm text-[#00ff99] font-bold font-mono">{feeTier}</span>
            </div>
          </div>
        </div>

        {/* Reserves Card */}
        <div className="rounded-xl border border-white/5 bg-white/5 p-3 backdrop-blur-sm">
          <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
             Pool Reserves
          </h4>
          <div className="space-y-2">
            <div className="flex justify-between items-center pb-2 border-b border-white/5">
               <span className="text-xs text-gray-400 font-mono">{symbolA}</span>
               <span className="text-sm text-white font-bold font-mono">{formatReserve(reserveA)}</span>
            </div>
            <div className="flex justify-between items-center">
               <span className="text-xs text-gray-400 font-mono">{symbolB}</span>
               <span className="text-sm text-white font-bold font-mono">{formatReserve(reserveB)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Action Button */}
      <div className="pt-2">
        <Button 
            variant="neon"
            fullWidth={true} 
            onClick={onAction}
            loading={actionText?.includes("...")}
            disabled={actionDisabled}
            className="h-14 font-black text-lg uppercase tracking-wider !transition-all duration-300"
        >
          {actionText}
        </Button>
      </div>
    </div>
  );
}
