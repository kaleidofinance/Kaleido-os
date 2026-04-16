"use client";
import React, { useState, useEffect } from "react";
import LiquidityInputPanel from "./liquidityInputPanel";
import { IToken } from "@/constants/types/dex";
import { ACTIVE_TOKENS } from "@/constants/tokens"; // Use global active tokens
import { useSwapRouter } from "@/hooks/dex/useSwapRouter";
import { useTokenApproval } from "@/hooks/dex/useTokenApproval";
import { useActiveAccount } from "thirdweb/react";
import { usePoolData } from "@/hooks/dex/usePoolData";
import { ethers } from "ethers";

import { toast } from "sonner";
import { useTokenBalance } from "@/hooks/dex/useTokenBalance";

interface CreateLiquidityProps {
  tokenA: string;
  tokenB: string;
  bg?: boolean;
}

export default function CreateLiquidity({
  tokenA,
  tokenB,
}: CreateLiquidityProps) {
  const activeAccount = useActiveAccount();
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");

  const [fromToken, setFromToken] = useState<IToken | null>(null);
  const [toToken, setToToken] = useState<IToken | null>(null);

  // Initialize tokens from props
  useEffect(() => {
    if (tokenA) {
      const foundA = ACTIVE_TOKENS.find(t => t.symbol === tokenA || t.address === tokenA);
      if (foundA) setFromToken(foundA);
    }
    if (tokenB) {
      const foundB = ACTIVE_TOKENS.find(t => t.symbol === tokenB || t.address === tokenB);
      if (foundB) setToToken(foundB);
    }
  }, [tokenA, tokenB]);

  const { balance: fromBalance } = useTokenBalance(fromToken);
  const { balance: toBalance } = useTokenBalance(toToken);

  const handleFromTokenSelect = (token: IToken | null) => {
    setFromToken(token);
  };

  const handleToTokenSelect = (token: IToken | null) => {
    setToToken(token);
  };

  const { addLiquidity, ROUTER_ADDRESS, getAmountsOut } = useSwapRouter();
  const { isApproved: isApprovedA, isApproving: isApprovingA, approve: approveA } = useTokenApproval(fromToken?.address, ROUTER_ADDRESS, fromAmount, fromToken?.decimals || 18);
  const { isApproved: isApprovedB, isApproving: isApprovingB, approve: approveB } = useTokenApproval(toToken?.address, ROUTER_ADDRESS, toAmount, toToken?.decimals || 18);
  
  const [isAdding, setIsAdding] = useState(false);
  const [isQuoting, setIsQuoting] = useState(false);

  // Pool Data Logic
  const { pools } = usePoolData();
  
  // Find matching pool
  const matchingPool = pools.find(p =>
    (p.token0.address.toLowerCase() === fromToken?.address.toLowerCase() && p.token1.address.toLowerCase() === toToken?.address.toLowerCase()) ||
    (p.token0.address.toLowerCase() === toToken?.address.toLowerCase() && p.token1.address.toLowerCase() === fromToken?.address.toLowerCase())
  );

  // Derived state for pool data
  const reserveA = matchingPool ? (matchingPool.token0.address.toLowerCase() === fromToken?.address.toLowerCase() ? matchingPool.reserves.reserve0 : matchingPool.reserves.reserve1) : 0;
  const reserveB = matchingPool ? (matchingPool.token1.address.toLowerCase() === toToken?.address.toLowerCase() ? matchingPool.reserves.reserve1 : matchingPool.reserves.reserve0) : 0;

  const tokenADecimals = fromToken?.decimals || 18;
  const tokenBDecimals = toToken?.decimals || 18;

  const reserveAFormatted = fromToken && reserveA ? ethers.formatUnits(reserveA.toString(), tokenADecimals) : "0";
  const reserveBFormatted = toToken && reserveB ? ethers.formatUnits(reserveB.toString(), tokenBDecimals) : "0";

  // Determine if this is a new pool (no liquidity)
  const noLiquidity = !matchingPool || (Number(reserveAFormatted) === 0 && Number(reserveBFormatted) === 0);

  // Calculate Price
  let price = "0";
  if (noLiquidity) {
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



  // Helper to fetch external price
  const fetchExternalPrice = async (token: IToken): Promise<number> => {
      if (!token.priceUrl) return 0;
      try {
          const res = await fetch(token.priceUrl);
          const data = await res.json();
          // CoinGecko response: { [id]: { usd: 123 } }
          const firstKey = Object.keys(data)[0];
          return data[firstKey]?.usd || 0;
      } catch (e) {
          console.error(`Failed to fetch price for ${token.symbol}`, e);
          return 0;
      }
  };

  // Auto-Quote Logic
  const handleFromValueChange = async (val: string) => {
    setFromAmount(val);
    if (val === "" || isNaN(Number(val)) || Number(val) === 0) {
      setToAmount("");
      return;
    }

    if (!noLiquidity && Number(reserveAFormatted) > 0) {
      const rA = Number(reserveAFormatted);
      const rB = Number(reserveBFormatted);
      const quote = (Number(val) * rB / rA);
      setToAmount(quote.toFixed(6));
    } else if (noLiquidity && fromToken && toToken) {
      // Try to get market price from other pools
      setIsQuoting(true);
      try {
        let quote = "0";
        // 1. Try on-chain quote (direct or potentially multi-hop via router if updated)
        try {
            const marketQuote = await getAmountsOut(val, [fromToken.address, toToken.address], fromToken.decimals, toToken.decimals);
            if (Number(marketQuote) > 0) quote = marketQuote;
        } catch (e) { console.warn("On-chain quote failed", e); }

        // 2. Fallback to external API (CoinGecko) if on-chain failed
        if (Number(quote) === 0 && fromToken.priceUrl && toToken.priceUrl) {
            console.log(`fetching external prices for ${fromToken.symbol} and ${toToken.symbol}`);
            const [priceA, priceB] = await Promise.all([
                fetchExternalPrice(fromToken),
                fetchExternalPrice(toToken)
            ]);
            console.log(`Prices fetched: ${fromToken.symbol}=${priceA}, ${toToken.symbol}=${priceB}`);
            if (priceA > 0 && priceB > 0) {
                const ratio = priceA / priceB;
                console.log(`Calculated ratio: ${ratio}`);
                quote = (Number(val) * ratio).toFixed(6);
            }
        }
        
        if (Number(quote) > 0) {
          console.log(`Setting quote to: ${quote}`);
          setToAmount(quote);
        }
      } catch (e) {
        console.error("Failed to get fallback quote", e);
      } finally {
        setIsQuoting(false);
      }
    }
  };

  const handleToValueChange = async (val: string) => {
    setToAmount(val);
    if (val === "" || isNaN(Number(val)) || Number(val) === 0) {
      setFromAmount("");
      return;
    }

    if (!noLiquidity && Number(reserveBFormatted) > 0) {
      const rA = Number(reserveAFormatted);
      const rB = Number(reserveBFormatted);
      const quote = (Number(val) * rA / rB);
      setFromAmount(quote.toFixed(6));
    } else if (noLiquidity && fromToken && toToken) {
      setIsQuoting(true);
      try {
        let quote = "0";
        // 1. Try on-chain quote
        try {
             const marketQuote = await getAmountsOut(val, [toToken.address, fromToken.address], toToken.decimals, fromToken.decimals);
             if (Number(marketQuote) > 0) quote = marketQuote;
        } catch (e) { console.warn("On-chain quote failed", e); }

        // 2. Fallback to external API
        if (Number(quote) === 0 && fromToken.priceUrl && toToken.priceUrl) {
            const [priceA, priceB] = await Promise.all([
                fetchExternalPrice(fromToken),
                fetchExternalPrice(toToken)
            ]);
             // We need B -> A, so PriceB / PriceA
            if (priceA > 0 && priceB > 0) {
                const ratio = priceB / priceA;
                quote = (Number(val) * ratio).toFixed(6);
            }
        }

        if (Number(quote) > 0) {
          setFromAmount(quote);
        }
      } catch (e) {
        console.error("Failed to get fallback quote", e);
      } finally {
        setIsQuoting(false);
      }
    }
  };

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

  const feeTier = poolType === "stable" ? "0.05%" : "0.3%";

  const handleAddLiquidity = async () => {
      if (!fromToken || !toToken || !fromAmount || !toAmount || !activeAccount) return;
      setIsAdding(true);
      const toastId = toast.loading("Adding Liquidity...");
      try {
          const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
          await addLiquidity(
              fromToken.address,
              toToken.address,
              fromAmount,
              toAmount,
              activeAccount.address, // Use real user address
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
          toast.error("Failed: " + e.message, { id: toastId });
      } finally {
          setIsAdding(false);
      }
  };

  // Button Logic
  let actionText = "Enter Amount";
  let onAction = () => {};
  let actionDisabled = false;

  if (!fromAmount || !toAmount || parseFloat(fromAmount) === 0 || parseFloat(toAmount) === 0) {
      actionText = "Enter Amount";
      actionDisabled = true;
  } else if (!isApprovedA) {
      actionText = isApprovingA ? "Approving " + fromToken?.symbol + "..." : "Approve " + fromToken?.symbol;
      onAction = approveA;
      actionDisabled = isApprovingA;
  } else if (!isApprovedB) {
      actionText = isApprovingB ? "Approving " + toToken?.symbol + "..." : "Approve " + toToken?.symbol;
      onAction = approveB;
      actionDisabled = isApprovingB;
  } else {
      actionText = isAdding ? "Adding..." : "Add Liquidity";
      onAction = handleAddLiquidity;
      actionDisabled = isAdding;
  }
  
  return (
    <div className="px-0">
      <div className="flex flex-col mb-4">
        <h1 className="text-2xl font-bold text-white">Add Liquidity</h1>
        <p className="text-gray-400 font-normal">Add Liquidity to earn reward</p>
      </div>
      <LiquidityInputPanel
        selectedToken={fromToken}
        selectedToToken={toToken}
        onTokenSelect={handleFromTokenSelect}
        onTokenToSelect={handleToTokenSelect}
        value={fromAmount}
        toValue={toAmount}
        onValueChange={handleFromValueChange}
        onToValueChange={handleToValueChange}
        balance={fromBalance}
        tobalance={toBalance}
        tokenA={tokenA}
        tokenB={tokenB}
        reserveA={reserveAFormatted}
        reserveB={reserveBFormatted}
        price={price}
        shareOfPool={share}
        noLiquidity={noLiquidity}
        onAction={onAction}
        actionText={actionText}
        actionDisabled={actionDisabled}
        poolType={poolType}
        onPoolTypeChange={setPoolType}
        feeTier={feeTier}
        verticalLayout={true}
      />
    </div>
  );
}
