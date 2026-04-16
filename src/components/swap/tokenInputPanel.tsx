"use client";
import React from "react";
import TokenSelector from "./tokenSelector";
import { IToken } from "@/constants/types/dex";
import { formatBalance } from "@/utils/formatBalance";

interface TokenInputPanelProps {
  label: string;
  selectedToken: IToken | null;
  onTokenSelect: (token: IToken) => void;
  value: string;
  onValueChange: (value: string) => void;
  balance: string;
  usdValue?: string | null;
}

export default function TokenInputPanel({
  label,
  selectedToken,
  onTokenSelect,
  value,
  onValueChange,
  balance,
  usdValue,
}: TokenInputPanelProps) {

  const calculatePercentage = (percent: number, bal: string) => {
    if (!bal) return;
    const balanceNum = parseFloat(bal);
    if (isNaN(balanceNum)) return;
    const val = (balanceNum * percent) / 100;
    onValueChange(val.toString());
  };

  const PercentButtons = () => (
    <div className="flex gap-2">
      {[25, 50, 75, 100].map((percent) => (
        <button
          key={percent}
          onClick={() => calculatePercentage(percent, balance)}
          className="text-xs font-semibold text-[#00ff99] hover:bg-[#00ff99]/10 rounded px-1.5 py-0.5 transition-colors uppercase tracking-wide border border-[#00ff99]/30"
        >
          {percent === 100 ? "Max" : `${percent}%`}
        </button>
      ))}
    </div>
  );

  return (
    <div className="w-full h-32 rounded-xl bg-[#0a2915]/40 backdrop-blur-md p-5 flex flex-col space-y-2 mt-5 relative overflow-hidden border border-[#00ff99]/10">
      <div className="flex justify-between items-center relative z-10">
        <div className="flex items-center gap-2">
           <p className="text-gray-400 font-medium">
             {label === "from" ? "From" : "To"}
           </p>
           <PercentButtons />
        </div>
        <span className="text-xs text-[#00ff99] font-mono">
          Balance: {formatBalance(balance)}
        </span>
      </div>
      <div className="px-3 flex justify-between relative z-10 pt-2">
        <div className="flex flex-col">
            <input
              placeholder="0.0"
              value={value}
              onChange={(e) => onValueChange(e.target.value)}
              type="number"
              maxLength={20}
              className="bg-transparent sm:w-full lg:w-48 border-none focus:outline-none focus:border-none h-10
                text-3xl font-medium text-white
                placeholder:text-3xl placeholder:font-medium placeholder:text-gray-400 focus:ring-0 resize-none overflow-hidden [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            {usdValue && (
                <p className="text-gray-500 font-medium text-sm mt-1">≈${usdValue}</p>
            )}
        </div>
        <TokenSelector
          label={label}
          selectedToken={selectedToken}
          onTokenSelect={onTokenSelect}
        />
      </div>
    </div>
  );
}
