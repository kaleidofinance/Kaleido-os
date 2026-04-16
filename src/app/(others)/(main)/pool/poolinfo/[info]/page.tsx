"use client";
import Button from "@/components/shared/Button";
import { Plus, Minus, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useSearchParams, useParams } from "next/navigation";
import React, { Suspense, useState } from "react";
import {
  AddLiquiditySimple,
  RemoveLiquiditySimple,
} from "@/components/icons/liquidityIcon";
import {
  DialogRoot as Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import Loading from "@/components/ui/loading";
import { usePoolData } from "@/hooks/dex/usePoolData";
import { ethers } from "ethers";
import LiquidityModal from "@/components/modals/LiquidityModal";
import PoolLiquidityChart from "@/components/liquidity/PoolLiquidityChart";

// Helper to format currency
const formatUSD = (val: string | number) => {
    const num = Number(val);
    if (isNaN(num)) return "$0.00";
    return "$" + num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatAmount = (val: string | number) => {
    const num = Number(val);
    if (isNaN(num)) return "0.00";
    return num.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
};

function PoolInfo() {
  const searchParams = useSearchParams();
  const params = useParams();
  const symbolA = searchParams.get("symbolA");
  const symbolB = searchParams.get("symbolB");
  const tokenA = searchParams.get("tokenA");
  const tokenB = searchParams.get("tokenB");
  const poolAddress = params.info as string;
  const [isOpen, setIsOpen] = useState(false);
  const [liquidityModalOpen, setLiquidityModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<"add" | "remove">("add");
  const [selectedTimeframe, setSelectedTimeframe] = useState("30m");
  const timeframes = ["30m", "1h", "2h", "1d", "1M"];

  const { pools, loading } = usePoolData();
  const poolData = pools.find(p => p.address.toLowerCase() === poolAddress?.toLowerCase());

  const handleTimeframeSelect = (timeframe: string) => {
    setSelectedTimeframe(timeframe);
    setIsOpen(false);
  };
  
  if (loading) {
    return <div className="h-full w-full flex items-center justify-center"><Loading /></div>;
  }

  // Safe reserve access with fallback
  // Note: reserves in poolData are returned as Number() of wei in usePoolData implementation.
  // We need to format them back to human readable. 
  // Since we don't want to change usePoolData right now, we handle it here.
  // However, small numbers might be okay. Large wei numbers as Number type lose precision but are roughly correct.
  // Ideally usePoolData should return string.
  
  const reserve0Raw = poolData?.reserves?.reserve0 || 0;
  const reserve1Raw = poolData?.reserves?.reserve1 || 0;
  const decimals0 = poolData?.token0?.decimals || 18;
  const decimals1 = poolData?.token1?.decimals || 18;

  // Use a safe conversion strategy:
  // We assume the Number represents the full wei integer (roughly). 
  // We can try to cast to BigInt string if no scientific notation, otherwise use formatting.
  // Actually, ethers.formatUnits accepts string or BigInt. 
  // If reserve0Raw is 1e18, String(reserve0Raw) is "1000000000000000000".
  // If it is 1.2e18, String is "1.2e+18". ethers fails on that.
  
  // Robust fallback:
  let amount0 = "0";
  let amount1 = "0";

  try {
     amount0 = ethers.formatUnits(BigInt(reserve0Raw.toLocaleString('fullwide', {useGrouping:false})), decimals0);
  } catch (e) {
     // Fallback if BigInt conversion fails aka scientific notation or something
     amount0 = String(reserve0Raw); 
  }

  try {
     amount1 = ethers.formatUnits(BigInt(reserve1Raw.toLocaleString('fullwide', {useGrouping:false})), decimals1);
  } catch(e) {
     amount1 = String(reserve1Raw);
  }

  const poolStats = [
      {
        title: "Total Value Locked (TVL)",
        amount: poolData ? formatUSD(poolData.liquidity) : "$0.00",
        change24h: 0,
      },
      {
        title: "24 Hour Trading Volume",
        amount: poolData ? formatUSD(poolData.volume24h) : "$0.00",
        change24h: poolData?.volumeChange24h || 0,
      },
      {
        title: "Pool Balance",
        amount: "0", 
        token0: {
          amount: amount0,
          symbol: poolData?.token0?.symbol || symbolA || "Token A",
        },
        token1: {
          amount: amount1,
          symbol: poolData?.token1?.symbol || symbolB || "Token B",
        },
      },
      {
        title: "Total Fees (24h)",
        amount: poolData ? formatUSD(poolData.fees24h) : "$0.00",
        change24h: 0,
      },
  ];

  return (
    <div className="p-10 h-full w-full">
      <div className="flex flex-col space-y-5">
        <div className="flex flex-row justify-between items-center">
          <div className="flex flex-row space-x-2">
            <p className="text-white font-normal text-4xl">
              {poolData?.token0?.symbol || symbolA}-{poolData?.token1?.symbol || symbolB} Pool
            </p>
          </div>
          <div className="flex flex-row space-x-2">
            <div className="hidden lg:flex">
              <Button
                fullWidth={false}
                startIcon={<Plus className="w-5 h-5" />}
                onClick={() => {
                  setModalTab("add");
                  setLiquidityModalOpen(true);
                }}
              >
                Add Liquidity
              </Button>
            </div>

            <button
               onClick={() => {
                  setModalTab("add");
                  setLiquidityModalOpen(true);
               }}
              className="flex lg:hidden p-3 bg-[#00ff99] text-black rounded-full hover:bg-[#2fa05e] transition-colors"
            >
              <AddLiquiditySimple size={16} />
            </button>

            <div className="hidden lg:flex">
              <Button
                fullWidth={false}
                className="bg-[#1a1a1a] text-white border border-[#00ff99]/40"
                startIcon={<Minus className="w-5 h-5" />}
                onClick={() => {
                  setModalTab("remove");
                  setLiquidityModalOpen(true);
                }}
              >
                Remove Liquidity
              </Button>
            </div>

            <button
              onClick={() => {
                  setModalTab("remove");
                  setLiquidityModalOpen(true);
               }}
              className="flex lg:hidden p-3 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
            >
              <RemoveLiquiditySimple size={16} />
            </button>
          </div>
        </div>

        <div className="grid lg:grid-cols-5 sm:grid-cols-1 gap-4">
          <div className="lg:col-span-3 p-4 bg-white/5 backdrop-blur-md border border-[#00ff99]/20 rounded-xl h-[465px] flex flex-col overflow-hidden">
             {/* Chart Section */}
            <div className="flex flex-row justify-between items-center">
              <div className="flex flex-row space-x-2">
                <p className="text-white font-medium text-lg">
                  {poolData?.token0?.symbol || symbolA}-{poolData?.token1?.symbol || symbolB} Pool
                </p>
              </div>
              <div className="hidden lg:block text-white">
                <div className="bg-[#1a1a1a] border p-2 border-[#00ff99]/40 rounded-md">
                  <div className="grid grid-cols-5 gap-1">
                    {timeframes.map((timeframe) => (
                      <div
                        key={timeframe}
                        onClick={() => setSelectedTimeframe(timeframe)}
                        className={`cursor-pointer px-3 py-2 rounded transition-colors duration-200 text-center ${
                          selectedTimeframe === timeframe
                            ? "bg-[#00ff99] text-black"
                            : "hover:bg-[#00ff99]/20 hover:bg-opacity-50"
                        }`}
                      >
                        <h1
                          className={`text-sm ${
                            selectedTimeframe === timeframe
                              ? "text-black"
                              : "text-white hover:text-[#00ff99]"
                          }`}
                        >
                          {timeframe}
                        </h1>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Mobile version - Dialog modal */}
              <div className="lg:hidden">
                <Dialog open={isOpen} onOpenChange={setIsOpen}>
                  <DialogTrigger asChild>
                    <button className="bg-[#1a1a1a] border border-[#00ff99]/40 rounded-md px-4 py-2 text-white flex items-center justify-between min-w-20">
                      <span className="text-sm">{selectedTimeframe}</span>
                      <ChevronDown size={16} className="ml-2" />
                    </button>
                  </DialogTrigger>
                  <DialogContent className="bg-[#1a1a1a] border-[#00ff99]/40">
                    <DialogHeader>
                      <DialogTitle>
                        <p className="font-medium text-lg text-white">
                          Select Timeframe
                        </p>
                      </DialogTitle>
                    </DialogHeader>
                    <div className="p-4">
                      <div className="grid grid-cols-2 gap-3">
                        {timeframes.map((timeframe) => (
                          <button
                            key={timeframe}
                            onClick={() => handleTimeframeSelect(timeframe)}
                            className={`p-4 rounded-lg transition-colors duration-200 text-center ${
                              selectedTimeframe === timeframe
                                ? "bg-[#00ff99] text-black"
                                : "bg-[#1a1a1a] border border-[#00ff99]/40 text-white hover:bg-[#00ff99]/10"
                            }`}
                          >
                            <span className="text-lg font-medium">
                              {timeframe}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
            
            <p className="text-white text-3xl font-bold">{poolData ? formatUSD(poolData.liquidity) : "$0.00"}</p>
            <div className="flex items-center gap-2">
              <p className="text-gray-500 text-xs font-mono">Last 30 Days</p>
              <p className="text-[#00ff99] text-xs font-mono font-medium">+0.00%</p>
            </div>
            <div className="flex-1 mt-2 min-h-0">
              <PoolLiquidityChart 
                currentLiquidity={poolData?.liquidity || 0} 
                timeframe={selectedTimeframe}
                className="h-full"
              />
            </div>
          </div>
          <div className="lg:col-span-2 flex flex-col space-y-5">
            <div className="flex flex-col space-y-5">
              {poolStats.map((pool, index) => {
                return (
                  <div
                    key={index}
                    className="w-full bg-white/5 backdrop-blur-md border border-[#00ff99]/20 rounded-lg p-3"
                  >
                    <p className="text-gray-400 text-xs font-medium uppercase tracking-wider">
                      {pool.title}
                    </p>

                    {pool.title === "Pool Balance" ? (
                      <div className="mt-2">
                        <div className="flex items-center justify-between">
                          <div className="text-white text-lg font-bold">
                            {formatAmount(pool.token0?.amount || "0")} {pool.token0?.symbol}
                          </div>
                          <div className="text-gray-500 text-sm mx-2">|</div>
                          <div className="text-white text-lg font-bold">
                            {formatAmount(pool.token1?.amount || "0")} {pool.token1?.symbol}
                          </div>
                        </div>
                        <p className="text-gray-500 text-[10px] uppercase font-mono mt-1">
                          Token Reserves
                        </p>
                      </div>
                    ) : (
                      <div className="mt-2">
                        <p className="text-white text-2xl font-bold">
                          {String(pool.amount)}
                        </p>
                        {pool.change24h !== undefined && (
                          <p
                            className={`text-xs mt-1 ${
                              pool.change24h >= 0
                                ? "text-[#00ff99]"
                                : "text-red-400"
                            }`}
                          >
                            {pool.change24h > 0 ? "+" : ""}
                            {pool.change24h.toFixed(2)}% (24h)
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex flex-col space-y-4">
          <h1 className="text-white text-3xl">Recent Transaction</h1>
          <div className="text-gray-400 border border-[#00ff99]/20 p-8 rounded-xl text-center">
             Transaction history is currently unavailable.
          </div>
        </div>
      </div>
      <LiquidityModal 
        isOpen={liquidityModalOpen} 
        onClose={() => setLiquidityModalOpen(false)} 
        tokenA={tokenA || ""} 
        tokenB={tokenB || ""} 
        initialTab={modalTab}
      />
    </div>
  );
}

export default function PoolInfoPage() {
  return (
    <Suspense fallback={<Loading />}>
      <PoolInfo />
    </Suspense>
  );
}
