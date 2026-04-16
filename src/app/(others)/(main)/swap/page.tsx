"use client";

import SwapHeader from "@/components/swap/SwapHeader";
import SwapCardPage from "@/components/swap/swapCard";
import PriceChart from "@/components/swap/PriceChart";
import TokenInfoCards from "@/components/swap/TokenInfoCards";
import React, { useState } from "react";
import { IToken } from "@/constants/types/dex";
import { ACTIVE_TOKENS } from "@/constants/tokens";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const recentTrades = [
  {
    pair: "ETH/USDT",
    price: "2,534.21",
    amount: "0.5",
    time: "2m ago",
    type: "buy",
  },
  {
    pair: "KLD/USDT",
    price: "43,250.00",
    amount: "0.02",
    time: "5m ago",
    type: "sell",
  },
  {
    pair: "PENGU/USDT",
    price: "2,530.15",
    amount: "1.2",
    time: "8m ago",
    type: "buy",
  },
  {
    pair: "USDC/USDT",
    price: "1.001",
    amount: "1000",
    time: "12m ago",
    type: "sell",
  },
  {
    pair: "ETH/USDT",
    price: "2,528.90",
    amount: "0.8",
    time: "15m ago",
    type: "buy",
  },
  {
    pair: "LOL/USDT",
    price: "310.45",
    amount: "2.5",
    time: "18m ago",
    type: "buy",
  },
  {
    pair: "ADA/USDT",
    price: "0.385",
    amount: "5000",
    time: "20m ago",
    type: "sell",
  },
];

export default function Trade() {
  const [fromToken, setFromToken] = useState<IToken | null>(ACTIVE_TOKENS[0] || null);
  const [toToken, setToToken] = useState<IToken | null>(ACTIVE_TOKENS[1] || null);

  return (
    <div className="flex flex-col space-y-10">
      <div className="pt-10">
        <SwapHeader />
      </div>
      <div className="flex flex-col lg:flex-row gap-6 justify-center items-start h-full px-4 py-10">
        <div className="flex flex-col gap-6">
          <SwapCardPage 
            fromToken={fromToken}
            toToken={toToken}
            onFromTokenChange={setFromToken}
            onToTokenChange={setToToken}
          />
          {/* Token Info Cards - Under swap box */}
          <TokenInfoCards fromToken={fromToken} toToken={toToken} />
        </div>
        <div className="lg:w-[700px] w-full">
          <PriceChart 
            fromTokenAddress={fromToken?.address}
            toTokenAddress={toToken?.address}
            fromTokenSymbol={fromToken?.symbol || "KLD"} 
            toTokenSymbol={toToken?.symbol || "USDC"} 
          />
        </div>
      </div>
      {/* <div className="border-b border-[#00ff99]/30 h-16 flex items-center px-6 overflow-hidden sticky z-50 top-0">
        <span className="text-sm text-gray-400 mr-4 whitespace-nowrap">
          Recent Trades:
        </span>

        <div className="flex-1 overflow-hidden">
          <div className="flex gap-4 animate-marquee">
            {[...recentTrades, ...recentTrades].map((trade, index) => (
              <div
                key={index}
                className="flex items-center gap-2 whitespace-nowrap"
              >
                <span className="text-xs text-white">{trade.pair}</span>
                <span
                  className={`text-xs ${
                    trade.type === "buy" ? "text-green-400" : "text-red-400"
                  }`}
                >
                  ${trade.price}
                </span>
                <span className="text-xs text-gray-500">{trade.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div> */}
    </div>
  );
}