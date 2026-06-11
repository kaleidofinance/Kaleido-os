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
    <div className="flex flex-wrap gap-1.5 sm:gap-2">
      {[25, 50, 75, 100].map((percent) => (
        <button
          key={percent}
          onClick={() => calculatePercentage(percent, balance)}
          className="min-h-7 rounded border border-[#00ff99]/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#00ff99] transition-colors hover:bg-[#00ff99]/10 sm:text-xs"
        >
          {percent === 100 ? "Max" : `${percent}%`}
        </button>
      ))}
    </div>
  );

  return (
    <div className="relative mt-4 flex min-h-32 w-full min-w-0 flex-col space-y-2 overflow-hidden rounded-xl border border-[#00ff99]/10 bg-[#0a2915]/40 p-3 backdrop-blur-md sm:mt-5 sm:p-5">
      <div className="relative z-10 flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
           <p className="text-gray-400 font-medium">
             {label === "from" ? "From" : "To"}
           </p>
           <PercentButtons />
        </div>
        <span className="max-w-full truncate text-xs font-mono text-[#00ff99]">
          Balance: {formatBalance(balance)}
        </span>
      </div>
      <div className="relative z-10 flex min-w-0 items-end justify-between gap-2 px-0 pt-2 sm:px-3">
        <div className="flex min-w-0 flex-1 flex-col">
            <input
              placeholder="0.0"
              value={value}
              onChange={(e) => onValueChange(e.target.value)}
              type="number"
              maxLength={20}
              className="bg-transparent w-full min-w-0 max-w-[150px] sm:max-w-none lg:w-48 border-none focus:outline-none focus:border-none h-10
                text-2xl font-medium text-white sm:text-3xl
                placeholder:text-2xl sm:placeholder:text-3xl placeholder:font-medium placeholder:text-gray-400 focus:ring-0 resize-none overflow-hidden [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
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
