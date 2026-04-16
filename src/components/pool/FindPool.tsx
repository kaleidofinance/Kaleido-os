import { ITradingPair } from "@/constants/types/dex";
import { Search } from "lucide-react";
import React from "react";
import TokenIcon from "../icons/tokenIcon";
import Button from "@/components/shared/Button";
import Link from "next/link";
import { useUserPoolData } from "@/hooks/dex/useUserPoolData";
import { ABSTRACT_MAINNET_CHAIN_ID } from "@/constants/tokens";

export default function FindPool() {
  const { userPositions, loading } = useUserPoolData();

  return (
    <div className="flex flex-col space-y-2 bg-black/90 backdrop-blur-sm lg:p-4 lg:w-[500px] text-white rounded-lg sm:w-full sm:p-4 border border-[#00ff99]/40">
      <h1>Select Token Pair</h1>
      <div className="p-5 overflow-auto">
        <div className="relative">
          <Search
            size={20}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />

          <input
            className="form-input w-full rounded-lg border border-transparent bg-[#2a2a2a] pl-10 pr-4 py-3 text-white placeholder:text-gray-400 focus:border-[#00ff99] focus:ring-[#00ff99] focus:outline-none focus:border-none"
            placeholder="Search name or paste address"
            type="text"
            //   value={searchkeyToken}
            //   onChange={(e: any) => setSearchKeyToken(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col space-y-2">
        <h1>My Active Pool</h1>

        <div className="">
          <div className="flex flex-col space-y-3">
            {loading ? (
                <div className="text-gray-400 text-center py-4">Loading active pools...</div>
            ) : userPositions.length === 0 ? (
                <div className="text-gray-400 text-center py-4">No active pools found</div>
            ) : (
                userPositions.map((position, index) => {
                  const pair = position.pair;
                  return (
                    <div
                      key={index}
                      className="flex justify-between items-center text-start bg-[#1a1a1a]/80 backdrop-blur-sm border border-[#00ff99]/20 rounded-lg p-3"
                    >
                      <div className="flex flex-row space-x-5 items-center">
                        <div className="flex flex-row relative">
                          <TokenIcon
                            size="sm"
                            variant="minimal"
                            address={pair.token0?.address || ""}
                            chainId={ABSTRACT_MAINNET_CHAIN_ID}
                            name={pair.token0?.name || ""}
                            symbol={pair.token0?.symbol || ""}
                            decimals={pair.token0?.decimals || 18}
                            verified={pair.token0?.verified || false}
                            logoURI={pair.token0?.logoURI || ""}
                          />
                          <div className="absolute left-4 z-10">
                            <TokenIcon
                              size="sm"
                              variant="minimal"
                              address={pair.token1?.address || ""}
                              chainId={ABSTRACT_MAINNET_CHAIN_ID}
                              name={pair.token1?.name || ""}
                              symbol={pair.token1?.symbol || ""}
                              decimals={pair.token1?.decimals || 18}
                              verified={pair.token1?.verified || false}
                              logoURI={pair.token1?.logoURI || ""}
                            />
                          </div>
                        </div>
                        <div className="flex flex-col">
                            <span className="font-medium text-sm">
                            {pair.token0?.symbol || "UNK"}/{pair.token1?.symbol || "UNK"}
                            </span>
                            <span className="text-xs text-gray-400">
                                {position.lpTokenBalanceFormatted} LP
                            </span>
                        </div>
                      </div>

                      <Link
                        href={`/remove-pool/${pair.address}?tokenA=${pair.token0?.address}&tokenB=${pair.token1?.address}`}
                      >
                        <Button variant="outline" className="text-xs py-1 px-3 h-auto">Remove</Button>
                      </Link>
                    </div>
                  );
                })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
