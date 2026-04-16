"use client";
import React, { Suspense, useEffect, useRef, useState } from "react";
import TokenInputPanel from "./tokenInputPanel";
import { ArrowUpDown, Settings } from "lucide-react";
import Button from "@/components/shared/Button";
import { SettingModal } from "./swapDialog";
import { ACTIVE_TOKENS } from "@/constants/tokens";
import { IToken } from "@/constants/types/dex";
import { useSearchParams, useRouter } from "next/navigation";
import Loading from "@/components/ui/loading";
import { useSwapRouter } from "@/hooks/dex/useSwapRouter";
import { useTokenApproval } from "@/hooks/dex/useTokenApproval";
import { useTokenBalance } from "@/hooks/dex/useTokenBalance";
import { useWrap } from "@/hooks/dex/useWrap";
import { useTokenUsdPrice } from "@/hooks/useTokenUsdPrice";
import { usePoolData } from "@/hooks/dex/usePoolData";
import { useV3SwapRouter } from "@/hooks/dex/useV3SwapRouter";
import { KALEIDOSWAP_V3_ROUTER, WETH_ADDRESS } from "@/constants/utils/addresses";
import { toast } from "sonner";

interface SwapCardProps {
  fromToken?: IToken | null;
  toToken?: IToken | null;
  onFromTokenChange?: (token: IToken | null) => void;
  onToTokenChange?: (token: IToken | null) => void;
}

function SwapCard({ 
  fromToken: propFromToken, 
  toToken: propToToken, 
  onFromTokenChange, 
  onToTokenChange 
}: SwapCardProps) {
  const [fromToken, setFromToken] = useState<IToken | null>(propFromToken || ACTIVE_TOKENS[0] || null);
  const [toToken, setToToken] = useState<IToken | null>(propToToken || ACTIVE_TOKENS[1] || null);
  const [open, setOpen] = useState<boolean>(false);

  const [labelTo, setLabelTo] = useState<string>("to"); 
  const [labelFrom, setLabelFrom] = useState<string>("from");
  // Balance state replaced by hooks below
  const [invertRate, setInvertRate] = useState(false);
  const [slippage, setSlippage] = useState("0.5");
  const [deadline, setDeadline] = useState("20");
  const [autoRouter, setAutoRouter] = useState(true);
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");

  const { getAmountsOut, swap, ROUTER_ADDRESS } = useSwapRouter();
  const { 
    getV3AmountOut, 
    getV3MultiHopAmountOut, 
    swapV3, 
    swapV3MultiHop, 
    V3_ROUTER_ADDRESS 
  } = useV3SwapRouter();

  const [activeVersion, setActiveVersion] = useState<"v2" | "v3">("v2");
  const [v3Fee, setV3Fee] = useState<number>(3000);
  const [v3Path, setV3Path] = useState<string[]>([]);
  const [v3Fees, setV3Fees] = useState<number[]>([]);
  const [isMultiHop, setIsMultiHop] = useState(false);
  const [savings, setSavings] = useState<number | null>(null);

  const spenderAddress = activeVersion === "v2" ? ROUTER_ADDRESS : V3_ROUTER_ADDRESS;

  const { isApproved, isApproving, approve } = useTokenApproval(
      fromToken?.address || ACTIVE_TOKENS[0]?.address, 
      spenderAddress, 
      fromAmount,
      fromToken?.decimals || 18
  );
  const [isSwapping, setIsSwapping] = useState(false);
  
  // Fetch real balances
  // Fetch real balances
  const { balance: fromBalance } = useTokenBalance(fromToken);
  const { balance: toBalance } = useTokenBalance(toToken);

  // Wrap/Unwrap hook
  const wethToken = ACTIVE_TOKENS.find(t => t.symbol === "WETH");
  const { wrap, unwrap, loading: wrapLoading } = useWrap(wethToken?.address);

  // Fetch token prices
  const { price: fromTokenPrice } = useTokenUsdPrice(fromToken);
  const { price: toTokenPrice } = useTokenUsdPrice(toToken);

  // Detect Wrap/Unwrap mode
  const isWrap = fromToken?.symbol === "ETH" && toToken?.symbol === "WETH";
  const isUnwrap = fromToken?.symbol === "WETH" && toToken?.symbol === "ETH";
  const isWrapAction = isWrap || isUnwrap;

  const searchParams = useSearchParams();
  const router = useRouter();
  const handleTokenSwitch = () => {
    // Swap tokens
    const tempToken = fromToken;
    const newFromToken = toToken;
    const newToToken = tempToken;
    setFromToken(toToken);
    setToToken(tempToken);
    
    // Notify parent
    onFromTokenChange?.(toToken);
    onToTokenChange?.(tempToken);

    updateURL(newFromToken, newToToken);
    // Swap amounts
    const tempAmount = fromAmount;
    setFromAmount(toAmount);
    setToAmount(tempAmount);
    // Balances update automatically via hooks when tokens change
  };

  const fromTokenRef = useRef(fromToken);
  const toTokenRef = useRef(toToken);

  useEffect(() => {
    fromTokenRef.current = fromToken;
    toTokenRef.current = toToken;
  });
  useEffect(() => {
    const tokenA = searchParams.get("tokenA");
    const tokenB = searchParams.get("tokenB");

    if (tokenA) {
      const foundTokenA = ACTIVE_TOKENS.find(
        (token) => token.address === tokenA
      );
      if (foundTokenA) {
        setFromToken(foundTokenA);
        onFromTokenChange?.(foundTokenA);
      }
    }

    if (tokenB) {
      const foundTokenB = ACTIVE_TOKENS.find(
        (token) => token.address === tokenB
      );
      if (foundTokenB) {
        setToToken(foundTokenB);
        onToTokenChange?.(foundTokenB);
      }
    }
  }, [searchParams]);

  // Update URL when tokens are selected
  const updateURL = (
    newFromToken: IToken | null,
    newToToken: IToken | null
  ) => {
    const params = new URLSearchParams(searchParams);

    if (newFromToken) {
      params.set("tokenA", newFromToken.address);
    } else {
      params.delete("tokenA");
    }

    if (newToToken) {
      params.set("tokenB", newToToken.address);
    } else {
      params.delete("tokenB");
    }

    router.replace(`/swap?${params.toString()}`, { scroll: false });
  };

  // Handle from token selection
  const handleFromTokenSelect = (token: IToken | null) => {
    setFromToken(token);
    onFromTokenChange?.(token);
    updateURL(token, toToken);
  };

  // Handle to token selection
  const handleToTokenSelect = (token: IToken | null) => {
    setToToken(token);
    onToTokenChange?.(token);
    updateURL(fromToken, token);
  };

  // Auto-calculate To Amount
  const [bestPath, setBestPath] = useState<any[]>([]); // Array of Route objects
  const [priceImpact, setPriceImpact] = useState<number | null>(null);
  const [insufficientLiquidity, setInsufficientLiquidity] = useState(false);
  const [rawToAmount, setRawToAmount] = useState<string>("0");
  
  const { pools } = usePoolData();

  const getRoutesForPair = (token0Addr: string, token1Addr: string) => {
      const matchingPools = pools.filter(p => 
          (p.token0.address.toLowerCase() === token0Addr.toLowerCase() && p.token1.address.toLowerCase() === token1Addr.toLowerCase()) ||
          (p.token0.address.toLowerCase() === token1Addr.toLowerCase() && p.token1.address.toLowerCase() === token0Addr.toLowerCase())
      );
      
      return matchingPools.map(pool => ({
          from: token0Addr,
          to: token1Addr,
          stable: pool.stable
      }));
  };

  // Auto-calculate To Amount with Multi-hop Routing
  useEffect(() => {
      const fetchAmountOut = async () => {
          if (!fromAmount || !fromToken || !toToken || parseFloat(fromAmount) === 0) {
             setToAmount("");
             setBestPath([]);
             setPriceImpact(null);
             setInsufficientLiquidity(false);
             return;
          }
          if (fromToken.address === toToken.address) return;

          // If Wrap/Unwrap, 1:1 ratio
          if (isWrap || isUnwrap) {
              setToAmount(fromAmount);
              setPriceImpact(0);
              setInsufficientLiquidity(false);
              return;
          }
        
          const NATIVE_PLACEHOLDER = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
          const WETH_ADDRESS = ACTIVE_TOKENS.find(t => t.symbol === "WETH")?.address || "";

          const getAddr = (t: IToken) => t.address.toLowerCase() === NATIVE_PLACEHOLDER.toLowerCase() ? WETH_ADDRESS : t.address;
          const fromAddr = getAddr(fromToken);
          const toAddr = getAddr(toToken);

          // Define potential paths (arrays of Route objects)
          const paths: any[][] = [];
          
          // 1. Direct paths
          const directRoutes = getRoutesForPair(fromAddr, toAddr);
          directRoutes.forEach(route => paths.push([route]));
          
          // 2. Via Base Tokens (WETH, USDC, USDT, etc.) - Only if NO direct pool exists or autoRouter is explicitly requested
          // User preference: "the smart route doesn't need to route a direct pair that have direct pool now"
          if (autoRouter && paths.length === 0) {
              const baseTokens = ACTIVE_TOKENS.filter(t => 
                 (t.tags?.includes("stablecoin") || t.tags?.includes("wrapped") || t.tags?.includes("native")) &&
                 t.address !== fromToken.address && 
                 t.address !== toToken.address
              );
    
              for (const base of baseTokens) {
                  const baseAddr = getAddr(base);
                  const routes1 = getRoutesForPair(fromAddr, baseAddr);
                  const routes2 = getRoutesForPair(baseAddr, toAddr);
                  
                  // Try every combination of pools for the two hops
                  for (const r1 of routes1) {
                      for (const r2 of routes2) {
                          paths.push([r1, r2]);
                      }
                  }
              }
          }

          // If no paths found from local pools state, try a direct path fallback
          if (paths.length === 0) {
              paths.push([{
                  from: fromAddr,
                  to: toAddr,
                  stable: false // Default fallback
              }]);
          }

          // 3. V3 Paths (Single + Multi Hop)
          const v3FeesToTry = [500, 3000, 10000];
          
          let maxAmountOut = "0";
          let bestP: any[] = [];
          let bestVer: "v2" | "v3" = "v2";
          let bestV3Fee: number = 3000;
          let bestV3Path: string[] = [];
          let bestV3Fees: number[] = [];
          let currentIsMultiHop = false;
          
          // Check all V2 paths
          const v2QuotesPromise = Promise.all(paths.map(async (path) => {
              try {
                  const amount = await getAmountsOut(fromAmount, path, fromToken.decimals, toToken.decimals);
                  return { path, amount, version: "v2" as const };
              } catch (e) {
                  return { path, amount: "0", version: "v2" as const };
              }
          }));

          // Check Single Hop V3
          const v3SingleQuotesPromise = Promise.all(v3FeesToTry.map(async (fee) => {
              try {
                  const amount = await getV3AmountOut(fromAddr, toAddr, fromAmount, fee, fromToken.decimals, toToken.decimals);
                  return { fee, amount, version: "v3" as const, isMulti: false };
              } catch (e) {
                  return { fee, amount: "0", version: "v3" as const, isMulti: false };
              }
          }));

          // Check 2-Hop V3 (via Common Bases)
          const commonBases = [WETH_ADDRESS, "0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3", "0x717A36E56b33585Bd00260422FfCc3270af34D3E"]; // WETH, USDC, USDT
          const v3MultiQuotesPromise = Promise.all(
              commonBases.filter(b => b.toLowerCase() !== fromAddr && b.toLowerCase() !== toAddr).flatMap(base => 
                  v3FeesToTry.flatMap(fee1 => 
                      v3FeesToTry.map(async (fee2) => {
                          try {
                              const path = [fromAddr, base, toAddr];
                              const fees = [fee1, fee2];
                              const amount = await getV3MultiHopAmountOut(path, fees, fromAmount, fromToken.decimals, toToken.decimals);
                              return { path, fees, amount, version: "v3" as const, isMulti: true };
                          } catch (e) {
                              return null;
                          }
                      })
                  )
              )
          ).then(results => results.filter((r): r is any => r !== null && parseFloat(r.amount) > 0));

          const [v2Results, v3SingleResults, v3MultiResults] = await Promise.all([
              v2QuotesPromise, 
              v3SingleQuotesPromise, 
              v3MultiQuotesPromise
          ]);

          // Compare all results
          const allResults = [
              ...v2Results,
              ...v3SingleResults,
              ...v3MultiResults
          ];

          let secondBestAmount = "0";
          for (const res of allResults) {
              const amount = parseFloat(res?.amount || "0");
              if (amount > parseFloat(maxAmountOut)) {
                  secondBestAmount = maxAmountOut;
                  maxAmountOut = res!.amount!;
                  bestP = (res as any).path || [];
                  bestVer = res!.version;
                  bestV3Fee = (res as any).fee || 3000;
                  bestV3Path = (res as any).path || [];
                  bestV3Fees = (res as any).fees || [];
                  currentIsMultiHop = (res as any).isMulti || false;
              } else if (amount > parseFloat(secondBestAmount)) {
                  secondBestAmount = res!.amount!;
              }
          }

          if (parseFloat(maxAmountOut) === 0) {
              setInsufficientLiquidity(true);
              setToAmount("0.000000");
              setRawToAmount("0");
              setPriceImpact(null);
              setSavings(null);
          } else {
              setInsufficientLiquidity(false);
              
              // Calculate Savings Percentage
              if (parseFloat(secondBestAmount) > 0) {
                  const diff = parseFloat(maxAmountOut) - parseFloat(secondBestAmount);
                  const percent = (diff / parseFloat(secondBestAmount)) * 100;
                  setSavings(percent > 0.01 ? percent : null);
              } else {
                  setSavings(null);
              }

              // Use actual token decimals for display precision (capped at 8 for UI)
              const displayDecimals = Math.min(toToken.decimals || 18, 8);
              setToAmount(parseFloat(maxAmountOut).toFixed(displayDecimals));
              setRawToAmount(maxAmountOut);
              setBestPath(bestP);
              setActiveVersion(bestVer);
              setV3Fee(bestV3Fee);
              setV3Path(bestV3Path);
              setV3Fees(bestV3Fees);
              setIsMultiHop(currentIsMultiHop);

              // Calculate Price Impact
              try {
                  const smallIn = "0.01";
                  let smallOut = "0";
                  if (bestVer === "v2") {
                      smallOut = await getAmountsOut(smallIn, bestP, fromToken.decimals, toToken.decimals);
                  } else if (currentIsMultiHop) {
                      smallOut = await getV3MultiHopAmountOut(bestV3Path, bestV3Fees, smallIn, fromToken.decimals, toToken.decimals);
                  } else {
                      smallOut = await getV3AmountOut(fromAddr, toAddr, smallIn, bestV3Fee, fromToken.decimals, toToken.decimals);
                  }
                  
                  if (parseFloat(smallOut) > 0) {
                      const fairRate = parseFloat(smallOut) / parseFloat(smallIn);
                      const actualRate = parseFloat(maxAmountOut) / parseFloat(fromAmount);
                      const impact = ((fairRate - actualRate) / fairRate) * 100;
                      setPriceImpact(Math.max(0, impact));
                  }
              } catch (e) {
                  setPriceImpact(null);
              }
          }
      };
      
      const timeout = setTimeout(fetchAmountOut, 500); // Debounce
      return () => clearTimeout(timeout);
  }, [fromAmount, fromToken, toToken, getAmountsOut, getV3AmountOut, isWrap, isUnwrap, autoRouter, pools]);

  const handleSwapAction = async () => {
      if (!fromToken || !toToken || !fromAmount) return;
      setIsSwapping(true);
      const toastId = toast.loading(isWrap ? "Wrapping..." : isUnwrap ? "Unwrapping..." : "Swapping...");
      try {
          if (isWrap) {
              const res = await wrap(fromAmount);
              if (!res?.success) throw new Error(res?.error as string);
              toast.success("Wrap Successful!", { id: toastId });
          } else if (isUnwrap) {
              const res = await unwrap(fromAmount);
              if (!res?.success) throw new Error(res?.error as string);
              toast.success("Unwrap Successful!", { id: toastId });
          } else {
              const deadlineTimestamp = Math.floor(Date.now() / 1000) + 60 * (parseFloat(deadline) || 20);
              // Dynamic slippage
              const amountOutMaxFloat = parseFloat(rawToAmount);
              const slippagePercent = parseFloat(slippage) || 0.5;
              const amountOutMin = (amountOutMaxFloat * (1 - slippagePercent / 100)).toFixed(toToken.decimals || 18);

              let tx;
              if (activeVersion === "v3") {
                  if (isMultiHop) {
                      tx = await swapV3MultiHop(
                          v3Path,
                          v3Fees,
                          fromAmount,
                          amountOutMin,
                          deadlineTimestamp,
                          fromToken.decimals,
                          toToken.decimals
                      );
                  } else {
                      tx = await swapV3(
                          fromToken.address,
                          toToken.address,
                          v3Fee,
                          fromAmount,
                          amountOutMin,
                          deadlineTimestamp,
                          fromToken.decimals,
                          toToken.decimals
                      );
                  }
              } else {
                  tx = await swap(
                      fromToken.address,
                      toToken.address,
                      fromAmount,
                      amountOutMin,
                      deadlineTimestamp,
                      bestPath,
                      fromToken.decimals,
                      toToken.decimals
                  );
              }
              await tx.wait();
              toast.success("Swap Successful!", { id: toastId });
          }
          setFromAmount("");
      } catch (e: any) {
          console.error(e);
          toast.error((isWrap ? "Wrap" : isUnwrap ? "Unwrap" : "Swap") + " Failed: " + (e?.message || "Unknown error"), { id: toastId });
      } finally {
          setIsSwapping(false);
      }
  };

  return (
    <div className="lg:w-[600px] sm:w-full bg-board/80 backdrop-blur-sm h-auto min-h-[500px] rounded-2xl p-8 shadow-xl text-white relative overflow-hidden border border-[#00ff99]/20">
      {/* Subtle overlay for transparency effect with faint green tint */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#00ff99]/5 via-transparent to-[#00ff99]/10 pointer-events-none"></div>
      
      <div className="flex justify-between items-center relative z-10">
        <h1 className="text-2xl font-bold text-white">Swap</h1>
        <button 
          onClick={() => setOpen(true)}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
        >
          <Settings className="w-5 h-5 text-white" />
        </button>
        <SettingModal 
          open={open} 
          setOpen={setOpen} 
          slippage={slippage}
          setSlippage={setSlippage}
          deadline={deadline}
          setDeadline={setDeadline}
          autoRouter={autoRouter}
          setAutoRouter={setAutoRouter}
        />
      </div>

      <div className="flex flex-col space-y-4 relative z-10">
        <div className="flex relative flex-col space-y-4">
          <TokenInputPanel
            label={labelFrom}
            selectedToken={fromToken}
            onTokenSelect={handleFromTokenSelect}
            value={fromAmount}
            onValueChange={setFromAmount}
            balance={fromBalance}
            usdValue={fromAmount && fromTokenPrice && !isNaN(parseFloat(fromAmount)) 
              ? (parseFloat(fromAmount) * fromTokenPrice).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})
              : null}
          />
          <div
            onClick={handleTokenSwitch}
            className="w-10 h-10 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 
                     bg-black/80 backdrop-blur-sm hover:bg-black rounded-full border-2 border-[#00ff99]/30
                     flex items-center justify-center transition-all duration-300 
                     hover:rotate-180 hover:border-tokenSelector"
          >
            <ArrowUpDown className="w-5 h-5 text-white" />
          </div>
          <TokenInputPanel
            label={labelTo}
            selectedToken={toToken}
            onTokenSelect={handleToTokenSelect}
            value={toAmount}
            onValueChange={setToAmount}
            balance={toBalance}
            usdValue={
              (toAmount && toTokenPrice && !isNaN(parseFloat(toAmount)) && (parseFloat(toAmount) * toTokenPrice) > 0)
              ? (parseFloat(toAmount) * toTokenPrice).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})
              : (fromAmount && fromTokenPrice && !isNaN(parseFloat(fromAmount))
                  ? (parseFloat(fromAmount) * fromTokenPrice).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})
                  : null)
            }
          />
        </div>

        <div className="flex flex-col space-y-2 mt-2">
          <div className="flex flex-col space-y-1">
            <div className="flex justify-between ">
              <p className="text-gray-400 font-normal">Exchange Rate</p>
              <p 
                className="font-normal text-white cursor-pointer hover:text-green-400 transition-colors select-none"
                onClick={() => setInvertRate(!invertRate)}
                title="Click to invert exchange rate"
              >
                {fromAmount && toAmount && parseFloat(fromAmount) > 0 && parseFloat(toAmount) > 0 
                  ? (!invertRate 
                      ? `1 ${fromToken?.symbol} ≈ ${(parseFloat(toAmount)/parseFloat(fromAmount)).toFixed(6)} ${toToken?.symbol}`
                      : `1 ${toToken?.symbol} ≈ ${(parseFloat(fromAmount)/parseFloat(toAmount)).toFixed(6)} ${fromToken?.symbol}`
                    )
                  : "-"}
              </p>
            </div>
            <div className="flex justify-between">
              <p className="text-gray-400 font-normal">Slippage Tolerance</p>
              <p className="text-green-500 front-normal">{slippage || "0.5"}%</p>
            </div>
            {fromAmount && toAmount && parseFloat(fromAmount) > 0 && (
               <div className="bg-[#00ff99]/5 rounded-lg px-3 py-2.5 mt-1 border border-[#00ff99]/10 space-y-2">
                 {/* Header Row */}
                 <div className="flex justify-between items-center">
                   <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Smart Router</p>
                   <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#00ff99] animate-pulse"></span>
                      <p className="text-[10px] text-[#00ff99] font-bold uppercase">
                        Best Price
                        {savings && <span className="ml-1 opacity-80">(+{savings.toFixed(2)}%)</span>}
                      </p>
                   </div>
                 </div>
                 {/* Visual Route Map */}
                 <div className="flex items-center gap-1 flex-wrap">
                   {(() => {
                     const resolveSymbol = (addr: string) => {
                       if (!addr) return "?";
                       const lc = addr.toLowerCase();
                       const found = ACTIVE_TOKENS.find(t => t.address.toLowerCase() === lc);
                       if (found) return found.symbol;
                       if (lc === WETH_ADDRESS.toLowerCase()) return "WETH";
                       return addr.slice(0, 6);
                     };

                     const tokenBadge = (symbol: string, isEndpoint: boolean = false) => (
                       <span key={`tok-${symbol}-${Math.random()}`} className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isEndpoint ? "bg-[#00ff99]/20 text-[#00ff99]" : "bg-white/10 text-white"}`}>
                         {symbol}
                       </span>
                     );

                     const arrow = (key: string) => (
                       <span key={`arr-${key}`} className="text-[10px] text-gray-500 font-mono">→</span>
                     );

                     const protocolBadge = (version: string, fee?: number) => (
                       <span key={`proto-${version}-${fee}-${Math.random()}`} className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-[#00ff99]/10 text-[#00ff99]/70 border border-[#00ff99]/20">
                         {version}{fee ? ` ${fee / 10000}%` : ""}
                       </span>
                     );

                     const elements: React.ReactNode[] = [];

                     if (activeVersion === "v3" && isMultiHop && v3Path.length >= 2) {
                       // V3 Multi-Hop: ETH → [V3 0.3%] → USDC → [V3 1%] → KLD
                       v3Path.forEach((addr, i) => {
                         elements.push(tokenBadge(resolveSymbol(addr), i === 0 || i === v3Path.length - 1));
                         if (i < v3Path.length - 1) {
                           elements.push(arrow(`mh-${i}`));
                           elements.push(protocolBadge("V3", v3Fees[i]));
                           elements.push(arrow(`mh2-${i}`));
                         }
                       });
                     } else if (activeVersion === "v3") {
                       // V3 Single Hop: ETH → [V3 0.3%] → USDC
                       elements.push(tokenBadge(fromToken?.symbol || "?", true));
                       elements.push(arrow("s1"));
                       elements.push(protocolBadge("V3", v3Fee));
                       elements.push(arrow("s2"));
                       elements.push(tokenBadge(toToken?.symbol || "?", true));
                     } else {
                       // V2: Could be direct or multi-hop via bestPath
                       if (bestPath.length > 0 && typeof bestPath[0] === "object") {
                         // Route objects {from, to, stable}
                         elements.push(tokenBadge(resolveSymbol(bestPath[0].from), true));
                         bestPath.forEach((route: any, i: number) => {
                           elements.push(arrow(`v2-${i}`));
                           elements.push(protocolBadge(route.stable ? "V2 Stable" : "V2"));
                           elements.push(arrow(`v2b-${i}`));
                           elements.push(tokenBadge(resolveSymbol(route.to), i === bestPath.length - 1));
                         });
                       } else if (bestPath.length > 0) {
                         // Address array path
                         bestPath.forEach((addr: string, i: number) => {
                           elements.push(tokenBadge(resolveSymbol(addr), i === 0 || i === bestPath.length - 1));
                           if (i < bestPath.length - 1) {
                             elements.push(arrow(`v2a-${i}`));
                             elements.push(protocolBadge("V2"));
                             elements.push(arrow(`v2a2-${i}`));
                           }
                         });
                       } else {
                         // Fallback
                         elements.push(tokenBadge(fromToken?.symbol || "?", true));
                         elements.push(arrow("fb1"));
                         elements.push(protocolBadge("V2"));
                         elements.push(arrow("fb2"));
                         elements.push(tokenBadge(toToken?.symbol || "?", true));
                       }
                     }

                     return elements;
                   })()}
                 </div>
               </div>
            )}
             {priceImpact !== null && (
               <div className="flex justify-between">
                 <p className="text-gray-400 font-normal">Price Impact</p>
                 <p className={`font-medium ${priceImpact > 5 ? "text-red-500" : priceImpact > 2 ? "text-yellow-500" : "text-gray-300"}`}>
                   {priceImpact < 0.01 ? "< 0.01%" : `${priceImpact.toFixed(2)}%`}
                 </p>
               </div>
            )}
          </div>
          
          <div className="flex gap-2">
            {!isApproved && !isWrapAction && !insufficientLiquidity ? (
                 <Button 
                   fullWidth={true} 
                   onClick={approve} 
                   disabled={isApproving}
                 >
                   {isApproving ? "Approving..." : `Approve ${fromToken?.symbol}`}
                 </Button>
            ) : (
                 <Button 
                   fullWidth={true} 
                   onClick={handleSwapAction} 
                   disabled={isSwapping || wrapLoading || insufficientLiquidity || (!!fromAmount && (parseFloat(fromAmount) > parseFloat(fromBalance || "0")))}
                 >
                   {insufficientLiquidity ? "Insufficient Liquidity" : 
                    isSwapping || wrapLoading 
                       ? (isWrap ? "Wrapping..." : isUnwrap ? "Unwrapping..." : "Swapping...") 
                       : (!!fromAmount && (parseFloat(fromAmount) > parseFloat(fromBalance || "0"))) ? "Insufficient Balance" :
                         (isWrap ? "Wrap" : isUnwrap ? "Unwrap" : "Swap")}
                 </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface SwapCardPageProps {
  fromToken?: IToken | null;
  toToken?: IToken | null;
  onFromTokenChange?: (token: IToken | null) => void;
  onToTokenChange?: (token: IToken | null) => void;
}

export default function SwapCardPage({ 
  fromToken, 
  toToken, 
  onFromTokenChange, 
  onToTokenChange 
}: SwapCardPageProps) {
  return (
    <Suspense fallback={<Loading />}>
      <SwapCard 
        fromToken={fromToken}
        toToken={toToken}
        onFromTokenChange={onFromTokenChange}
        onToTokenChange={onToTokenChange}
      />
    </Suspense>
  );
}