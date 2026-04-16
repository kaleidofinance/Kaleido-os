"use client";
import CreatePoolHeader from "@/components/pool/CreatePoolHeader";
import LiquidityInputPanel from "@/components/liquidity/liquidityInputPanel";
import { ABSTRACT_TOKENS } from "@/constants/tokens";
import Loading from "@/components/ui/loading";
import { IToken } from "@/constants/types/dex";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useState, useEffect, Suspense } from "react";
import { useTokenBalance } from "@/hooks/dex/useTokenBalance";
import { usePoolData } from "@/hooks/dex/usePoolData";
import { ethers } from "ethers";
import { useWrap } from "@/hooks/dex/useWrap";
import { WETH_ADDRESS } from "@/constants/utils/addresses";
import { useSwapRouter } from "@/hooks/dex/useSwapRouter";
import { useTokenApproval } from "@/hooks/dex/useTokenApproval";
import { useActiveAccount } from "thirdweb/react";
import { useV3PositionManager } from "@/hooks/dex/useV3PositionManager";
import { KALEIDOSWAP_V3_POSITION_MANAGER, KALEIDOSWAP_V3_FACTORY } from "@/constants/utils/addresses";
import { priceToTick, nearestUsableTick, TICK_SPACINGS, MIN_TICK, MAX_TICK, getV3AmountRatio } from "@/constants/utils/v3Math";
import { toast } from "sonner";

export default function CreatePoolPage() {
  return (
    <Suspense fallback={<Loading />}>
      <CreatePool />
    </Suspense>
  );
}
function CreatePool() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeAccount = useActiveAccount();

  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");

  const ethToken = ABSTRACT_TOKENS.find(t => t.address === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE") || ABSTRACT_TOKENS[0];
  const [fromToken, setFromToken] = useState<IToken | null>(ethToken);
  const [toToken, setToToken] = useState<IToken | null>(null);

  const [isAdding, setIsAdding] = useState(false);
  const [dexVersion, setDexVersion] = useState<"v2" | "v3">("v3");
  const [v3FeeTier, setV3FeeTier] = useState("0.3%");
  
  // V3 Range State
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [isFullRange, setIsFullRange] = useState(false);
  const { balance: fromBalance } = useTokenBalance(fromToken);
  const { balance: toBalance } = useTokenBalance(toToken);

  const { pools, loading: poolsLoading } = usePoolData();
  const { addLiquidity, ROUTER_ADDRESS } = useSwapRouter();
  const { mintPosition, POSITION_MANAGER_ADDRESS } = useV3PositionManager();
  const { wrap, loading: wrapLoading } = useWrap(WETH_ADDRESS);

  const handleQuickWrap = async (amountToWrap?: string) => {
    const finalAmount = amountToWrap || fromAmount;
    if (!finalAmount || parseFloat(finalAmount) === 0) {
        toast.error("Enter amount to wrap");
        return;
    }
    const toastId = toast.loading(`Wrapping ${finalAmount} ETH...`);
    const result = await wrap(finalAmount);
    if (result.success) {
        toast.success(`Successfully Wrapped ${finalAmount} ETH`, { id: toastId });
        // Automatically switch selection to WETH after wrapping
        const wethToken = ABSTRACT_TOKENS.find(t => t.address.toLowerCase() === WETH_ADDRESS.toLowerCase());
        if (wethToken) {
            setFromToken(wethToken);
        }
    } else {
        toast.error(`Wrap Failed: ${result.error}`, { id: toastId });
    }
  };

  // Approve target depends on Dex Version
  const spenderAddress = dexVersion === "v2" ? ROUTER_ADDRESS : POSITION_MANAGER_ADDRESS;

  // Approvals
  const { isApproved: isApprovedA, isApproving: isApprovingA, approve: approveA } = useTokenApproval(
      fromToken?.address, 
      spenderAddress, 
      fromAmount,
      fromToken?.decimals || 18
  );
  const { isApproved: isApprovedB, isApproving: isApprovingB, approve: approveB } = useTokenApproval(
      toToken?.address, 
      spenderAddress, 
      toAmount,
      toToken?.decimals || 18
  );

  const fromAddr = fromToken?.address === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" ? "0x618B1561b189972482168fd31f5B5a3B5A10Ce33" : fromToken?.address;
  const toAddr = toToken?.address === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" ? "0x618B1561b189972482168fd31f5B5a3B5A10Ce33" : toToken?.address;

  // Find matching pool (Normalized to WETH for detection)
  const matchingPool = pools.find(p =>
    (p.token0.address.toLowerCase() === fromAddr?.toLowerCase() && p.token1.address.toLowerCase() === toAddr?.toLowerCase()) ||
    (p.token0.address.toLowerCase() === toAddr?.toLowerCase() && p.token1.address.toLowerCase() === fromAddr?.toLowerCase())
  );

  // Derived state for pool data
  const reserveA = matchingPool ? (matchingPool.token0.address.toLowerCase() === fromAddr?.toLowerCase() ? matchingPool.reserves.reserve0 : matchingPool.reserves.reserve1) : 0;
  const reserveB = matchingPool ? (matchingPool.token1.address.toLowerCase() === toAddr?.toLowerCase() ? matchingPool.reserves.reserve1 : matchingPool.reserves.reserve0) : 0;

  const tokenADecimals = fromToken?.decimals || 18;
  const tokenBDecimals = toToken?.decimals || 18;

  const reserveAFormatted = fromToken && reserveA ? ethers.formatUnits(BigInt(Math.floor(Number(reserveA))), tokenADecimals) : "0";
  const reserveBFormatted = toToken && reserveB ? ethers.formatUnits(BigInt(Math.floor(Number(reserveB))), tokenBDecimals) : "0";

  // V3 Pool Existence and Price State
  const [v3PoolExists, setV3PoolExists] = useState<boolean | null>(null);
  const [v3CurrentPrice, setV3CurrentPrice] = useState<string | null>(null);

  // Check if V3 pool exists and fetch its current price
  useEffect(() => {
    const checkV3Pool = async () => {
      if (!fromAddr || !toAddr || !v3FeeTier) return;
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const factory = new ethers.Contract(KALEIDOSWAP_V3_FACTORY, [
          "function getPool(address,address,uint24) view returns (address)"
        ], provider);
        
        const f = Math.round(parseFloat(v3FeeTier.replace("%", "")) * 10000);
        
        const [t0, t1] = fromAddr.toLowerCase() < toAddr.toLowerCase() 
          ? [fromAddr, toAddr] 
          : [toAddr, fromAddr];
          
        const poolAddr = await factory.getPool(t0, t1, f);
        const exists = poolAddr !== ethers.ZeroAddress;
        setV3PoolExists(exists);

        if (exists) {
            const poolContract = new ethers.Contract(poolAddr, [
                "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)"
            ], provider);
            const { sqrtPriceX96 } = await poolContract.slot0();
            
            // sqrtPriceX96 = sqrt(price) * 2^96
            // price = (sqrtPriceX96 / 2^96)^2
            const d0 = fromAddr.toLowerCase() < toAddr.toLowerCase() ? (fromToken?.decimals || 18) : (toToken?.decimals || 18);
            const d1 = fromAddr.toLowerCase() < toAddr.toLowerCase() ? (toToken?.decimals || 18) : (fromToken?.decimals || 18);
            
            const ratio = Number(sqrtPriceX96) / Math.pow(2, 96);
            const rawPrice = ratio * ratio;
            
            // Adjust for decimals to get human price (token1/token0)
            const humanPrice = rawPrice * Math.pow(10, d0 - d1);
            
            // If fromToken is NOT token0, we need the inverse price (tokenB/tokenA)
            const isFromToken0 = fromAddr.toLowerCase() < toAddr.toLowerCase();
            const finalPrice = isFromToken0 ? humanPrice : 1 / humanPrice;
            
            setV3CurrentPrice(finalPrice.toFixed(6));
        } else {
            setV3CurrentPrice(null);
        }
      } catch (e) {
        console.error("Error checking V3 pool:", e);
        setV3PoolExists(null);
        setV3CurrentPrice(null);
      }
    };
    checkV3Pool();
  }, [fromAddr, toAddr, v3FeeTier, fromToken, toToken]);

  // Determine if this is a new pool (no liquidity)
  const noLiquidity = dexVersion === "v3" 
    ? (v3PoolExists !== true) // If it's not explicitly true, treat as "New/No Liquidity" 
    : (!matchingPool || (Number(reserveAFormatted) === 0 && Number(reserveBFormatted) === 0));

  // Calculate Price
  let price = "0";
  if (dexVersion === "v3" && v3CurrentPrice) {
      price = v3CurrentPrice;
  } else if (!matchingPool || (Number(reserveAFormatted) === 0 && Number(reserveBFormatted) === 0)) {
      const amountA = Number(fromAmount || "0");
      const amountB = Number(toAmount || "0");
      if (amountA > 0) {
          price = (amountB / amountA).toFixed(6);
      }
  } else {
      if (Number(reserveAFormatted) > 0) {
          price = (Number(reserveBFormatted) / Number(reserveAFormatted)).toFixed(6);
      }
  }

  // Calculate share of pool
  let share = "0";
  if (noLiquidity) {
      if (fromAmount && Number(fromAmount) > 0) share = "100";
  } else {
      const amountA = Number(fromAmount || 0);
      const resA = Number(reserveAFormatted);
      if (amountA + resA > 0) {
          share = ((amountA / (amountA + resA)) * 100).toFixed(2);
      }
  }

  // Handle URL parameters on component mount
  useEffect(() => {
    const tokenA = searchParams.get("tokenA");
    const tokenB = searchParams.get("tokenB");

    if (tokenA) {
      const foundTokenA = ABSTRACT_TOKENS.find(
        (token) => token.address === tokenA
      );
      if (foundTokenA) {
        setFromToken(foundTokenA);
      }
    }

    if (tokenB) {
      const foundTokenB = ABSTRACT_TOKENS.find(
        (token) => token.address === tokenB
      );
      if (foundTokenB) {
        setToToken(foundTokenB);
      }
    }
  }, [searchParams]);

  // Reset range and amounts when tokens change
  useEffect(() => {
    setFromAmount("");
    setToAmount("");
    setMinPrice("");
    setMaxPrice("");
    setIsFullRange(false);
  }, [fromToken?.address, toToken?.address]);

  // Update URL when tokens are selected
  const updateURL = (
    newFromToken: IToken | null,
    newToToken: IToken | null
  ) => {
    const params = new URLSearchParams();

    if (newFromToken) {
      params.set("tokenA", newFromToken.address);
    }

    if (newToToken) {
      params.set("tokenB", newToToken.address);
    }

    // Only update URL if we have at least one token
    if (newFromToken || newToToken) {
      router.replace(`/create-pool?${params.toString()}`, { scroll: false });
    }
  };

  // Handle from token selection
  const handleFromTokenSelect = (token: IToken | null) => {
    if (!token) return;
    const isEthA = token.address === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" || token.address.toLowerCase() === WETH_ADDRESS.toLowerCase();
    const isEthB = toToken?.address === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" || toToken?.address.toLowerCase() === WETH_ADDRESS.toLowerCase();

    if (toToken && (token.address === toToken.address || (isEthA && isEthB))) {
      setToToken(fromToken);
      updateURL(token, fromToken);
    } else {
      updateURL(token, toToken);
    }
    setFromToken(token);
  };

  const handleToTokenSelect = (token: IToken | null) => {
    if (!token) return;
    const isEthA = fromToken?.address === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" || fromToken?.address.toLowerCase() === WETH_ADDRESS.toLowerCase();
    const isEthB = token.address === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" || token.address.toLowerCase() === WETH_ADDRESS.toLowerCase();

    if (fromToken && (token.address === fromToken.address || (isEthA && isEthB))) {
      setFromToken(toToken);
      updateURL(toToken, token);
    } else {
      updateURL(fromToken, token);
    }
    setToToken(token);
  };

  const handleAddLiquidity = async () => {
      if (!fromToken || !toToken || !fromAmount || !toAmount || !activeAccount) return;
      
      setIsAdding(true);

      if (dexVersion === "v3") {
          const toastId = toast.loading("Minting V3 Position...");
          try {
              const fAddr = fromToken.address === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" ? WETH_ADDRESS : fromToken.address;
              const tAddr = toToken.address === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" ? WETH_ADDRESS : toToken.address;

              const fee = Math.round(parseFloat(v3FeeTier.replace("%", "")) * 10000);
              const spacing = TICK_SPACINGS[fee] || 60;
              
              let tickLower = Math.ceil(MIN_TICK / spacing) * spacing;
              let tickUpper = Math.floor(MAX_TICK / spacing) * spacing;

              const isToken0 = fAddr.toLowerCase() < tAddr.toLowerCase();
              const [address0, address1] = isToken0 ? [fAddr, tAddr] : [tAddr, fAddr];
              const [token0, token1] = isToken0 ? [fromToken, toToken] : [toToken, fromToken];
              
              if (!isFullRange) {
                  const tLowerRaw = priceToTick(parseFloat(isToken0 ? minPrice : (1/parseFloat(maxPrice)).toString()), token0.decimals, token1.decimals);
                  const tUpperRaw = priceToTick(parseFloat(isToken0 ? maxPrice : (1/parseFloat(minPrice)).toString()), token0.decimals, token1.decimals);
                  
                  const minT = Math.min(tLowerRaw, tUpperRaw);
                  const maxT = Math.max(tLowerRaw, tUpperRaw);

                  // HARD-CODED SNAP (Internalized for 100% Reliability)
                  tickLower = Math.round(minT / spacing) * spacing;
                  tickUpper = Math.round(maxT / spacing) * spacing;
                  
                  if (tickLower === tickUpper) tickUpper += spacing;

                  console.log("FINAL PROTOCOL TICKS:", { tickLower, tickUpper, spacing, divisible: tickLower % spacing === 0 });
              }

              const amount0Desired = isToken0 ? fromAmount : toAmount;
              const amount1Desired = isToken0 ? toAmount : fromAmount;
              
              const amount0DesiredWei = ethers.parseUnits(amount0Desired, token0.decimals);
              const amount1DesiredWei = ethers.parseUnits(amount1Desired, token1.decimals);
              
              const amount0MinFinal = (amount0DesiredWei * BigInt(99)) / BigInt(100);
              const amount1MinFinal = (amount1DesiredWei * BigInt(99)) / BigInt(100);

              const deadline = Math.floor(Date.now() / 1000) + 60 * 60;

              const tx = await mintPosition(
                  address0,
                  address1,
                  fee,
                  tickLower,
                  tickUpper,
                  amount0Desired,
                  amount1Desired,
                  activeAccount.address,
                  deadline,
                  token0.decimals,
                  token1.decimals,
                  amount0MinFinal.toString(),
                  amount1MinFinal.toString(),
                  isToken0 ? price : (1/parseFloat(price)).toString()
              );
              await tx.wait();
              toast.success("V3 Position Created!", { id: toastId });
              setFromAmount("");
              setToAmount("");
          } catch (e: any) {
              console.error(e);
              toast.error("V3 Failed: " + (e.message || "Unknown error"), { id: toastId });
          } finally {
              setIsAdding(false);
          }
          return;
      }

      const toastId = toast.loading("Adding V2 Liquidity...");
      try {
          const deadline = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // 24 hours (avoid EXPIRED on testnet)
          
          // Slippage logic could be added here (using amountAMin, amountBMin)
          // For now using 0 for simplicity in this step, similar to removeLiquidity
          await addLiquidity(
              fromToken.address,
              toToken.address,
              fromAmount,
              toAmount,
              activeAccount.address,
              deadline,
              poolType === "stable",
              fromToken.decimals,
              toToken.decimals
          );
          toast.success("Liquidity Added!", { id: toastId });
          setFromAmount("");
          setToAmount("");
      } catch (e: any) {
          console.error(e);
          toast.error("Failed: " + (e.message || "Unknown error"), { id: toastId });
      } finally {
          setIsAdding(false);
      }
  };

  // Handle amount change for token A (with V2 price sync)
  const handleAmountAChange = (val: string) => {
    setFromAmount(val);
    if (!val || isNaN(parseFloat(val))) return;

    if (dexVersion === "v3" && fromToken && toToken) {
        const adr0 = fromToken.address === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" ? WETH_ADDRESS : fromToken.address;
        const adr1 = toToken.address === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" ? WETH_ADDRESS : toToken.address;
        const isToken0 = adr0.toLowerCase() < adr1.toLowerCase();
        
        const ratio = getV3AmountRatio(
            parseFloat(price), 
            isToken0 ? parseFloat(minPrice) : 1/parseFloat(maxPrice), 
            isToken0 ? parseFloat(maxPrice) : 1/parseFloat(minPrice),
            isToken0 ? fromToken.decimals : toToken.decimals,
            isToken0 ? toToken.decimals : fromToken.decimals
        );

        if (isToken0) {
            setToAmount((parseFloat(val) * ratio).toFixed(6));
        } else {
            setToAmount(ratio > 0 ? (parseFloat(val) / ratio).toFixed(6) : "0");
        }
    } else {
        const numericalPrice = parseFloat(price);
        if (numericalPrice > 0) {
            setToAmount((parseFloat(val) * numericalPrice).toFixed(6));
        }
    }
  };

  // Handle amount change for token B (with V2 price sync)
  const handleAmountBChange = (val: string) => {
    setToAmount(val);
    if (!val || isNaN(parseFloat(val))) return;

    if (dexVersion === "v3" && fromToken && toToken) {
        const adr0 = fromToken.address === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" ? WETH_ADDRESS : fromToken.address;
        const adr1 = toToken.address === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" ? WETH_ADDRESS : toToken.address;
        const isToken0 = adr0.toLowerCase() < adr1.toLowerCase();
        
        const ratio = getV3AmountRatio(
            parseFloat(price), 
            isToken0 ? parseFloat(minPrice) : 1/parseFloat(maxPrice), 
            isToken0 ? parseFloat(maxPrice) : 1/parseFloat(minPrice),
            isToken0 ? fromToken.decimals : toToken.decimals,
            isToken0 ? toToken.decimals : fromToken.decimals
        );

        if (isToken0) {
            setFromAmount(ratio > 0 ? (parseFloat(val) / ratio).toFixed(6) : "0");
        } else {
            setFromAmount((parseFloat(val) * ratio).toFixed(6));
        }
    } else {
        const numericalPrice = parseFloat(price);
        if (numericalPrice > 0 && numericalPrice !== Infinity) {
            setFromAmount((parseFloat(val) / numericalPrice).toFixed(6));
        }
    }
  };

  // Button Logic
  let actionText = "Enter Amount";
  let onAction = () => {};
  let actionDisabled = false;

  if (!fromAmount || !toAmount || parseFloat(fromAmount) === 0 || parseFloat(toAmount) === 0) {
      actionText = "Enter Amount";
      actionDisabled = true;
  } else if (dexVersion === "v3" && fromToken?.address === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE") {
      // For V3, force a Wrap if using native ETH to ensure clean wallet interaction
      actionText = wrapLoading ? "Wrapping..." : "Wrap ETH";
      onAction = handleQuickWrap;
      actionDisabled = wrapLoading;
  } else if (!isApprovedA) {
      const isPending = isApprovingA;
      actionText = isPending ? `Approving ${fromToken?.symbol}...` : `Approve ${fromToken?.symbol}`;
      onAction = approveA;
      actionDisabled = isPending;
  } else if (!isApprovedB) {
      const isPending = isApprovingB;
      actionText = isPending ? `Approving ${toToken?.symbol}...` : `Approve ${toToken?.symbol}`;
      onAction = approveB;
      actionDisabled = isPending;
  } else {
      actionText = isAdding ? "Adding..." : "Add Liquidity";
      onAction = handleAddLiquidity;
      actionDisabled = isAdding;
  }

  // Fee & Pool Type Logic
  const [poolType, setPoolType] = useState<"volatile" | "stable">("volatile");

  // Auto-select pool type when tokens change
  useEffect(() => {
    const isStableA = fromToken?.tags?.includes('stablecoin');
    const isStableB = toToken?.tags?.includes('stablecoin');
    if (isStableA && isStableB) {
        setPoolType("stable");
    } else {
        setPoolType("volatile");
    }
  }, [fromToken, toToken]);

  const feeTier = dexVersion === "v2" 
    ? (poolType === "stable" ? "0.05%" : "0.3%")
    : v3FeeTier;

  // Auto-set prices when price changes
  useEffect(() => {
    if (price && price !== "0" && !minPrice && !maxPrice) {
      const p = parseFloat(price);
      setMinPrice((p * 0.8).toFixed(6));
      setMaxPrice((p * 1.2).toFixed(6));
    }
  }, [price, minPrice, maxPrice]);

  return (
    <div className="flex flex-col space-y-10">
      <div className="pt-10">
        <CreatePoolHeader />
      </div>
      <div className="py-12">
        <div className="flex justify-center items-center">
        <div className="w-full max-w-5xl px-8 py-8 bg-modal/90 backdrop-blur-md border border-[#00ff99]/20 rounded-2xl relative overflow-hidden shadow-[0_0_50px_rgba(0,255,153,0.05)]">
          {/* Subtle overlay for transparency effect with faint green tint */}
          <div className="absolute inset-0 bg-gradient-to-br from-tokenSelector/5 via-transparent to-tokenSelector/10 pointer-events-none"></div>
            <div className="relative z-10">
              <LiquidityInputPanel
                selectedToken={fromToken}
                selectedToToken={toToken}
                onTokenSelect={handleFromTokenSelect}
                onTokenToSelect={handleToTokenSelect}
                value={fromAmount}
                toValue={toAmount}
                onValueChange={handleAmountAChange}
                onToValueChange={handleAmountBChange}
                balance={fromBalance}
                tobalance={toBalance}
                reserveA={reserveAFormatted}
                reserveB={reserveBFormatted}
                price={price}
                shareOfPool={share}
                noLiquidity={noLiquidity}
                onAction={onAction}
                actionText={actionText}
                actionDisabled={actionDisabled}
                feeTier={feeTier}
                poolType={poolType}
                onPoolTypeChange={setPoolType}
                dexVersion={dexVersion}
                onDexVersionChange={setDexVersion}
                onFeeTierChange={setV3FeeTier}
                minPrice={minPrice}
                onMinPriceChange={setMinPrice}
                maxPrice={maxPrice}
                onMaxPriceChange={setMaxPrice}
                isFullRange={isFullRange}
                onFullRangeToggle={() => setIsFullRange(!isFullRange)}
                currentPrice={price}
                onWrap={handleQuickWrap}
                isWrapping={wrapLoading}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
