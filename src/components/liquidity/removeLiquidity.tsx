"use client";
import Button from "@/components/shared/Button";
import TokenIcon from "@/components/icons/tokenIcon";
import { ACTIVE_TOKENS } from "@/constants/tokens";
import { useSearchParams } from "next/navigation";
import React, { Suspense, useState, useEffect, useMemo } from "react";
import Loading from "../ui/loading";
import { ArrowDown } from "lucide-react";

import { useSwapRouter } from "@/hooks/dex/useSwapRouter";
import { useDEXFactory } from "@/hooks/dex/useDEXFactory";
import { useTokenApproval } from "@/hooks/dex/useTokenApproval";
import { useActiveAccount } from "thirdweb/react";
import { ethers } from "ethers";
import { toast } from "sonner";
import { useTokenUsdPrice } from "@/hooks/useTokenUsdPrice";
import { formatBalance } from "@/utils/formatBalance";

const formatOutputAmount = (val: string) => {
  if (!val) return "0";
  const num = parseFloat(val);
  if (num === 0) return "0";
  if (num > 1000) return num.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (num < 0.000001) return "< 0.000001";
  return num.toLocaleString("en-US", { maximumFractionDigits: 6 });
};

const PAIR_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];

interface RemoveLiquidityProps {
  style?: boolean;
  tokenA?: string;
  tokenB?: string;
}

function RemoveLiquidityContent({ style, tokenA: propTokenA, tokenB: propTokenB }: RemoveLiquidityProps) {
  const Percentage = ["25", "50", "75", "100"];
  const searchParams = useSearchParams();
  const [percentage, setPercentage] = useState<string>("0");
  const [amount, setAmount] = useState<string>("");

  const tokenA = propTokenA || searchParams.get("tokenA");
  const tokenB = propTokenB || searchParams.get("tokenB");
  
  const { removeLiquidity, ROUTER_ADDRESS } = useSwapRouter();
  const { getPairAddress } = useDEXFactory();
  const activeAccount = useActiveAccount();
  
  const [pairAddress, setPairAddress] = useState<string | null>(null);
  const [lpBalance, setLpBalance] = useState<string>("0");
  const [reserves, setReserves] = useState<{ reserve0: string; reserve1: string }>({ reserve0: "0", reserve1: "0" });
  const [totalSupply, setTotalSupply] = useState<string>("0");
  const [token0Address, setToken0Address] = useState<string>("");
  
  // Fetch LP Token Address, Balance, and Pool Data
  const fetchPairData = React.useCallback(async () => {
      if (!tokenA || !tokenB || !activeAccount) return;
      const pair = await getPairAddress(tokenA, tokenB);
      setPairAddress(pair);
      
      if (pair && pair !== ethers.ZeroAddress) {
          try {
              const provider = new ethers.BrowserProvider(window.ethereum);
              const pairContract = new ethers.Contract(pair, PAIR_ABI, provider);
              
              // Get LP balance
              const bal = await pairContract.balanceOf(activeAccount.address);
              setLpBalance(ethers.formatUnits(bal, 18));
              
              // Get reserves
              const reservesData = await pairContract.getReserves();
              setReserves({
                  reserve0: reservesData.reserve0.toString(),
                  reserve1: reservesData.reserve1.toString(),
              });
              
              // Get total supply
              const supply = await pairContract.totalSupply();
              setTotalSupply(supply.toString());
              
              // Get token0
              const t0 = await pairContract.token0();
              setToken0Address(t0.toLowerCase());
          } catch (error) {
              console.error("Error fetching pair data:", error);
          }
      }
  }, [tokenA, tokenB, activeAccount, getPairAddress]);

  useEffect(() => {
      fetchPairData();
  }, [fetchPairData]);

  const { isApproved, isApproving, approve } = useTokenApproval(pairAddress || undefined, ROUTER_ADDRESS, amount);
  const [isRemoving, setIsRemoving] = useState(false);

  const handlePercentage = (p: string) => {
    setPercentage(p);
    if (parseFloat(lpBalance) > 0) {
        const val = (parseFloat(lpBalance) * parseFloat(p)) / 100;
        setAmount(val.toFixed(18));
    }
  };
  
  const handleRemove = async () => {
      if (!pairAddress || !amount || !tokenA || !tokenB || !activeAccount) return;
      setIsRemoving(true);
      const toastId = toast.loading("Removing Liquidity...");
      try {
           const deadline = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
           
           // Apply 0.5% default slippage to expected outputs to prevent sandwich attacks
           const minA = (parseFloat(amountAOut) * 0.995).toFixed(tokenADetails?.decimals || 18);
           const minB = (parseFloat(amountBOut) * 0.995).toFixed(tokenBDetails?.decimals || 18);
           
           await removeLiquidity(
               tokenA, 
               tokenB,
               amount,
               minA, // amountAMin
               minB, // amountBMin
               activeAccount.address,
               deadline,
               tokenADetails?.decimals,
               tokenBDetails?.decimals
           );
           toast.success("Liquidity Removed!", { id: toastId });
           // Refresh data
           await fetchPairData();
           // Reset form
           setAmount("");
           setPercentage("0");
      } catch (e: any) {
           console.error(e);
           toast.error("Failed: " + e.message, { id: toastId });
      } finally {
          setIsRemoving(false);
      }
  };

  const findTokenDetails = (token: string) => {
    if (!token) return;
    const tokenFormatted = token.toLowerCase();
    const result = ACTIVE_TOKENS.find((tokenInfo) => {
      return (
        tokenInfo.address.toLowerCase() === tokenFormatted ||
        tokenInfo.symbol.toLowerCase() === tokenFormatted
      );
    });
    return result;
  };

  const tokenADetails = findTokenDetails(tokenA || "");
  const tokenBDetails = findTokenDetails(tokenB || "");

  // USD Prices
  const { price: priceA_USD } = useTokenUsdPrice(tokenADetails || null);
  const { price: priceB_USD } = useTokenUsdPrice(tokenBDetails || null);

  // Calculate expected output
  const { amountAOut, amountBOut, priceAPerB, priceBPerA, totalUsdValue } = useMemo(() => {
    if (!amount || parseFloat(amount) === 0 || !totalSupply || parseFloat(totalSupply) === 0) {
      return { amountAOut: "0", amountBOut: "0", priceAPerB: "0", priceBPerA: "0", totalUsdValue: null };
    }

    const lpAmount = parseFloat(amount);
    const supply = parseFloat(ethers.formatUnits(totalSupply, 18));
    
    const decimalsA = tokenADetails?.decimals || 18;
    const decimalsB = tokenBDetails?.decimals || 18;

    // Determine which reserve corresponds to which token
    const isToken0A = tokenA?.toLowerCase() === token0Address;
    const reserveA = isToken0A ? reserves.reserve0 : reserves.reserve1;
    const reserveB = isToken0A ? reserves.reserve1 : reserves.reserve0;

    const resA = parseFloat(ethers.formatUnits(reserveA, decimalsA));
    const resB = parseFloat(ethers.formatUnits(reserveB, decimalsB));

    // Calculate outputs: (lpAmount / totalSupply) * reserve
    const outA = (lpAmount / supply) * resA;
    const outB = (lpAmount / supply) * resB;

    // Calculate prices
    const priceAB = resA > 0 ? (resB / resA).toFixed(6) : "0";
    const priceBA = resB > 0 ? (resA / resB).toFixed(6) : "0";

    // Calculate USD value if available
    let usdVal = null;
    if (priceA_USD && priceB_USD) {
        usdVal = (outA * priceA_USD) + (outB * priceB_USD);
    } else if (priceA_USD) {
        usdVal = outA * priceA_USD * 2; // Approximate if only one price known
    } else if (priceB_USD) {
        usdVal = outB * priceB_USD * 2;
    }

    return {
      amountAOut: outA.toFixed(6),
      amountBOut: outB.toFixed(6),
      priceAPerB: priceAB,
      priceBPerA: priceBA,
      totalUsdValue: usdVal,
    };
  }, [amount, totalSupply, reserves, tokenA, tokenB, token0Address, tokenADetails, tokenBDetails, priceA_USD, priceB_USD]);

  const formattedUsdValue = totalUsdValue 
    ? totalUsdValue.toLocaleString("en-US", { style: "currency", currency: "USD" }) 
    : null;

  return (
    <div className="flex justify-center w-full pb-4 px-0">
      <div className={`w-full max-w-5xl ${style ? "bg-transparent border-none shadow-none" : "bg-modal/90 backdrop-blur-md rounded-2xl border border-[#00ff99]/20 shadow-[0_0_50px_rgba(0,255,153,0.05)]"} relative overflow-hidden p-4`}>


        <div className="grid grid-cols-1 md:grid-cols-[1fr,auto,1fr] gap-2">
            {/* Left Column: Input */}
             <div className="flex flex-col space-y-4 min-w-0">
                 <div className="group relative rounded-xl border border-white/10 bg-white/5 p-4 transition-all duration-300 hover:border-[#00ff99]/50 hover:shadow-[0_0_30px_rgba(0,255,153,0.05)] focus-within:border-[#00ff99] focus-within:shadow-[0_0_30px_rgba(0,255,153,0.1)] backdrop-blur-sm">
                     <div className="flex flex-col gap-3 mb-4">
                        <span className="text-xs font-mono text-[#00ff99]">Balance: {formatBalance(lpBalance, 6)}</span>
                        <div className="flex gap-2">
                            {Percentage.map((item, index) => (
                                <button
                                    key={index}
                                    onClick={() => handlePercentage(item)}
                                    className={`py-0.5 px-2 rounded-md border border-[#00ff99]/30 text-[10px] font-semibold transition-all duration-200 uppercase tracking-wide
                                        ${item === percentage ? "bg-[#00ff99] text-black border-[#00ff99]" : "bg-transparent text-[#00ff99] hover:bg-[#00ff99]/10"}`}
                                >
                                    {item}%
                                </button>
                            ))}
                        </div>
                     </div>
                     <div className="flex flex-col gap-2">
                        <input
                            placeholder="0.0"
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            className="w-full bg-transparent border-none outline-none text-2xl font-bold text-white placeholder:text-gray-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none font-mono min-w-0"
                        />
                         <div className="flex justify-between items-center h-6">
                            <span className="text-sm font-medium text-gray-500">{formattedUsdValue ? `≈ ${formattedUsdValue}` : ""}</span>
                            <span className="text-sm font-bold text-white">LP Tokens</span>
                        </div>
                     </div>
                 </div>
            </div>

             {/* Center Arrow */}
            <div className="flex justify-center items-center md:pt-8">
                <div className="p-2 bg-white/5 backdrop-blur-sm border border-[#00ff99]/30 rounded-full shadow-lg shadow-[#00ff99]/10">
                    <ArrowDown className="w-4 h-4 text-[#00ff99]" strokeWidth={3} />
                </div>
            </div>

            {/* Right Column: Output Preview */}
            <div className="flex flex-col space-y-3 min-w-0">
                 <div className="rounded-xl border border-white/5 bg-white/5 p-3 backdrop-blur-sm h-full">
                    <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">You Will Receive</h4>
                    
                     <div className="space-y-3">
                        <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2">
                                {tokenADetails && (
                                    <TokenIcon 
                                        symbol={tokenADetails.symbol} 
                                        address={tokenADetails.address} 
                                        name={tokenADetails.name}
                                        decimals={tokenADetails.decimals}
                                        verified={tokenADetails.verified}
                                        logoURI={tokenADetails.logoURI}
                                        variant="minimal"
                                        size="sm" 
                                    />
                                )}
                                <span className="text-xs font-bold text-white">{tokenADetails?.symbol || "Token A"}</span>
                            </div>
                            <div className="text-right">
                                <div className="text-sm font-bold text-[#00ff99] font-mono">{formatOutputAmount(amountAOut)}</div>
                            </div>
                        </div>

                        <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2">
                                {tokenBDetails && (
                                    <TokenIcon 
                                        symbol={tokenBDetails.symbol} 
                                        address={tokenBDetails.address} 
                                        name={tokenBDetails.name}
                                        decimals={tokenBDetails.decimals}
                                        verified={tokenBDetails.verified}
                                        logoURI={tokenBDetails.logoURI}
                                        variant="minimal"
                                        size="sm" 
                                    />
                                )}
                                <span className="text-xs font-bold text-white">{tokenBDetails?.symbol || "Token B"}</span>
                            </div>
                            <div className="text-right">
                                <div className="text-sm font-bold text-[#00ff99] font-mono">{formatOutputAmount(amountBOut)}</div>
                            </div>
                        </div>
                     </div>
                 </div>
            </div>
        </div>

        {/* Prices Row */}
        {parseFloat(priceAPerB) > 0 && (
             <div className="mt-4 rounded-xl border border-white/5 bg-white/5 p-3 backdrop-blur-sm flex flex-col md:flex-row justify-between items-center gap-2">
                <span className="text-xs text-gray-400">Exchange Rate</span>
                <div className="flex gap-4 text-xs font-mono">
                     <span className="text-white">1 {tokenADetails?.symbol} = <span className="text-[#00ff99]">{priceAPerB}</span> {tokenBDetails?.symbol}</span>
                     <span className="text-white">1 {tokenBDetails?.symbol} = <span className="text-[#00ff99]">{priceBPerA}</span> {tokenADetails?.symbol}</span>
                </div>
             </div>
        )}
        
        <div className="mt-4">
             {!isApproved ? (
                 <Button fullWidth={true} onClick={approve} disabled={isApproving} className="h-10 bg-[#00ff99] hover:bg-[#00cc7a] text-black font-bold text-sm uppercase tracking-wider">
                     {isApproving ? "Approving..." : "Approve usage of LP Token"}
                 </Button>
            ) : (
                 <Button fullWidth={true} onClick={handleRemove} disabled={isRemoving || parseFloat(amount) === 0} className="h-10 bg-[#00ff99] hover:bg-[#00cc7a] text-black font-bold text-sm uppercase tracking-wider">
                     {isRemoving ? "Removing..." : "Remove Liquidity"}
                 </Button>
            )}
        </div>

      </div>
    </div>
  );
}

export default function RemoveLiquidity({ style, tokenA, tokenB }: RemoveLiquidityProps) {
  return (
    <Suspense fallback={<Loading />}>
      <RemoveLiquidityContent style={style} tokenA={tokenA} tokenB={tokenB} />
    </Suspense>
  );
}
