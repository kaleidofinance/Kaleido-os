"use client";

import React, { useState, useEffect } from "react";
import { ChevronDown, ArrowUpDown, X, History } from "lucide-react";
import Image from "next/image";
import * as Dialog from "@radix-ui/react-dialog";
import { useStablecoin } from "@/hooks/useStablecoin";
import { useSwapRouter } from "@/hooks/dex/useSwapRouter";
import { WETH_ADDRESS } from "@/constants/utils/addresses";
import TransactionHistoryModal from "./TransactionHistoryModal";
import { toast } from "sonner";
import { ethers } from "ethers";

interface Asset {
  symbol: string;
  name: string;
  address: string;
  image: string;
  balance: string;
  price: string;
  description: string;
}

interface MintRedeemProps {
  mode: "mint" | "redeem";
}

export default function MintRedeem({ mode }: MintRedeemProps) {
  const { balances, stats, mintKfUSD, redeemKfUSD, isLoading, idleBalances } = useStablecoin();
  const { swap, getAmountsOut } = useSwapRouter();
  
  // Memoize supportedAssets to update when balances change
  const supportedAssets: Asset[] = React.useMemo(() => [
    {
      symbol: "USDC",
      name: "USD Coin",
      address: "0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3",
      image: "/USDC.svg",
      balance: parseFloat(balances.USDC || "0").toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      price: "$1.00",
      description: "Stablecoin by Circle"
    },
    {
      symbol: "USDT",
      name: "Tether USD",
      address: "0x717A36E56b33585Bd00260422FfCc3270af34D3E", // Updated
      image: "/usdt.svg",
      balance: parseFloat(balances.USDT || "0").toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      price: "$1.00",
      description: "Stablecoin by Tether"
    },
    {
      symbol: "USDe",
      name: "Ethena USD",
      address: "0x2F7744E8fcc75F8F26Ea455968556591091cb46F", // Updated
      image: "/stable/USDe.jpeg",
      balance: parseFloat(balances.USDe || "0").toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      price: "$1.00",
      description: "Delta-neutral stablecoin by Ethena"
    }
  ], [balances]);

  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null); // Default to USDC
  const [selectedOutputAsset, setSelectedOutputAsset] = useState<Asset | null>(null); // For redeem output
  const [amount, setAmount] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [showOutputModal, setShowOutputModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  const fees = {
    mintFee: `${stats.mintFee}%`,
    redeemFee: `${stats.redeemFee}%`
  };

  // Set default selected asset when supportedAssets loads or updates
  useEffect(() => {
    if (supportedAssets.length > 0) {
      setSelectedAsset(supportedAssets[0]); // Default to USDC
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supportedAssets.length]);

  const handleAction = async () => {
    if (!amount || (mode === "mint" && !selectedAsset) || (mode === "redeem" && !selectedOutputAsset)) return;
    
    setIsProcessing(true);
    
    try {
      if (mode === "mint" && selectedAsset) {
        await mintKfUSD(selectedAsset.symbol, amount);
      } else if (mode === "redeem" && selectedOutputAsset) {
        // liquidity check logic
        const requestedSymbol = selectedOutputAsset.symbol;
        const requestedAmount = parseFloat(amount);
        const availableLiquidity = parseFloat(idleBalances[requestedSymbol as keyof typeof idleBalances] || "0");
        
        if (availableLiquidity < requestedAmount) {
           // Insufficient liquidity - try auto-swap
           const alternativeAssets = ["USDC", "USDT", "USDe"].filter(s => s !== requestedSymbol);
           let routeAsset: string | null = null;
           
           for (const asset of alternativeAssets) {
             const liquidity = parseFloat(idleBalances[asset as keyof typeof idleBalances] || "0");
             if (liquidity >= requestedAmount) {
               routeAsset = asset;
               break;
             }
           }
           
           if (routeAsset) {
             const toastId = toast.loading(`Insufficient ${requestedSymbol} liquidity. Auto-routing via ${routeAsset}...`);
             
             // 1. Redeem to route asset
             const success = await redeemKfUSD(amount, routeAsset);
             
             if (success) {
                toast.loading(`Swapping ${routeAsset} to ${requestedSymbol}...`, { id: toastId });
                
                // 2. Find route asset address
                const routeAssetObj = supportedAssets.find(a => a.symbol === routeAsset);
                
                if (routeAssetObj) {
                  // Strategy: Try direct path first, then via WETH
                  const directPath = [routeAssetObj.address, selectedOutputAsset.address];
                  const wethPath = [routeAssetObj.address, WETH_ADDRESS, selectedOutputAsset.address];
                  
                  const outDecimals = selectedOutputAsset.symbol === "USDC" || selectedOutputAsset.symbol === "USDT" ? 6 : 18;
                  const inDecimals = selectedAsset?.symbol === "USDC" || selectedAsset?.symbol === "USDT" ? 6 : 18;

                  // 1. Check Direct Path
                  let amountOut = await getAmountsOut(amount, directPath, inDecimals, outDecimals);
                  let bestPath = directPath;

                  // 2. If Direct fails, check WETH Path
                  if (amountOut === "0" || amountOut === "0.0") {
                      console.log("Direct path failed, trying via WETH...");
                      amountOut = await getAmountsOut(amount, wethPath, inDecimals, outDecimals);
                      bestPath = wethPath;
                  }

                  if (amountOut === "0" || amountOut === "0.0") {
                      toast.error(`Insufficient liquidity for ${requestedSymbol} and no swap pool available (Direct or WETH). Please redeem to ${routeAsset} instead.`, { id: toastId });
                      return;
                  }
                  
                  // Calculate min amount (5% slippage due to low liquidity potentially)
                  const minAmountRaw = parseFloat(amountOut) * 0.95; 
                  const minAmountStr = minAmountRaw.toFixed(outDecimals);

                  // Execute swap
                  // We need to define deadline
                  const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 mins
                  
                  try {
                    // Update toast to show we are swapping
                    toast.loading(`Swapping ${routeAsset} to ${requestedSymbol}${bestPath.length > 2 ? ' via WETH' : ''}...`, { id: toastId });

                    await swap(
                      routeAssetObj.address,
                      selectedOutputAsset.address,
                      amount,
                      minAmountStr,
                      deadline,
                      bestPath, // Use the path that worked
                      inDecimals,
                      outDecimals
                    );
                    toast.success(`Successfully redeemed and swapped to ${requestedSymbol}`, { id: toastId });
                  } catch (swapError: any) {
                    console.error("Auto-swap failed:", swapError);
                    toast.error(`Redemption successful but swap failed. You received ${routeAsset}.`, { id: toastId });
                  }
                }
             }
           } else {
             toast.error(`Insufficient liquidity for ${requestedSymbol} and no alternatives found.`);
           }
        } else {
          // Sufficient liquidity - normal redeem
          await redeemKfUSD(amount, selectedOutputAsset.symbol);
        }
      }
      
      // Reset form
      setAmount("");
      setSelectedAsset(null);
      setSelectedOutputAsset(null);
    } catch (error) {
      console.error("Transaction failed:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const calculateOutputAmount = () => {
    if (!amount) return "0";
    const inputAmount = parseFloat(amount);
    
    // Use the dynamic fee from on-chain stats
    const feeRate = parseFloat(stats.mintFee) / 100;
    
    const outputAmount = (inputAmount * (1 - feeRate)).toFixed(2);
    return outputAmount;
  };

  const getActionButtonText = () => {
    if (isProcessing) {
      return mode === "mint" ? "Minting..." : "Redeeming...";
    }
    return mode === "mint" ? "Mint kfUSD" : "Redeem";
  };

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold text-white">
          {mode === "mint" ? "Mint kfUSD" : "Redeem kfUSD"}
        </h2>
        <button
          onClick={() => setShowHistoryModal(true)}
          className="p-2 hover:bg-green-500/20 rounded-lg transition-all duration-200 hover:scale-110 group"
          title={`${mode === "mint" ? "Mint" : "Redeem"} History`}
        >
          <History className="w-5 h-5 text-gray-400 group-hover:text-[#00ff99] transition-colors" />
        </button>
      </div>
      <div className="flex flex-col space-y-4">
        {/* Mint Mode: From Asset → To KFUSD */}
        {mode === "mint" && (
          <>
            {/* Input Panel 1: From (Deposit Asset) */}
            <div className="w-full h-24 rounded-xl bg-inputPanel p-3 flex flex-col space-y-1 relative overflow-hidden">
              <div className="flex justify-between relative z-10">
                <p className="text-gray-400 text-xs font-medium">From</p>
                <p className="text-gray-400 text-xs font-medium">Balance: {selectedAsset?.balance || "0"}</p>
              </div>
              <div className="px-2 flex justify-between relative z-10">
                <input
                  placeholder="0.0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  type="text"
                  className="bg-transparent sm:w-full lg:w-40 border-none focus:outline-none h-8 text-2xl font-medium text-white placeholder:text-2xl placeholder:font-medium placeholder:text-gray-400 focus:ring-0 resize-none overflow-hidden"
                />
                <div className="flex items-center gap-2">
                  <Dialog.Root open={showAssetModal} onOpenChange={setShowAssetModal}>
                    <Dialog.Trigger asChild>
                      <button
                        className="flex items-center gap-1.5 px-2 py-1 bg-green-500/20 border border-green-500/40 rounded-lg hover:bg-green-500/30 transition-colors"
                      >
                        {selectedAsset ? (
                          <>
                            <div className="w-5 h-5 rounded-full overflow-hidden flex items-center justify-center">
                              <Image src={selectedAsset.image} alt={selectedAsset.symbol} width={20} height={20} className="w-full h-full object-cover" />
                            </div>
                            <span className="text-white text-sm font-medium">{selectedAsset.symbol}</span>
                          </>
                        ) : (
                          <span className="text-gray-400 text-sm">Select</span>
                        )}
                        <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                      </button>
                    </Dialog.Trigger>

                    <Dialog.Portal>
                      <Dialog.Overlay className="fixed inset-0 bg-black/80 z-50" />
                      <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 bg-black/70 backdrop-blur-sm border border-green-500/40 rounded-lg shadow-lg p-6">
                        <div className="flex justify-between items-center mb-4">
                          <Dialog.Title className="text-xl font-bold text-white">
                            Select Asset
                          </Dialog.Title>
                          <Dialog.Close asChild>
                            <button className="p-2 hover:bg-[#2a2a2a] rounded-lg">
                              <X className="w-5 h-5 text-gray-400" />
                            </button>
                          </Dialog.Close>
                        </div>
                        
                        <div className="space-y-2">
                          {supportedAssets.map((asset) => (
                            <button
                              key={asset.address}
                              onClick={() => {
                                setSelectedAsset(asset);
                                setShowAssetModal(false);
                              }}
                              className="w-full flex cursor-pointer items-center gap-3 p-3 hover:bg-[#2a2a2a] rounded-lg transition-colors"
                            >
                              <div className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center">
                                <Image src={asset.image} alt={asset.symbol} width={32} height={32} className="w-full h-full object-cover" />
                              </div>
                              <div className="flex-1 text-left">
                                <p className="text-white font-medium">{asset.symbol}</p>
                                <p className="text-gray-400 text-sm">{asset.name}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-white font-medium">{asset.balance}</p>
                                <p className="text-gray-400 text-sm">{asset.price}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </Dialog.Content>
                    </Dialog.Portal>
                  </Dialog.Root>
                </div>
              </div>
            </div>

            {/* Arrow Icon between panels */}
            <div className="flex justify-center">
              <div className="w-8 h-8 bg-black/80 backdrop-blur-sm hover:bg-black rounded-full border-2 border-[#00ff99]/40 flex items-center justify-center transition-all duration-300 hover:rotate-180 hover:border-tokenSelector">
                <ArrowUpDown className="w-4 h-4 text-white" />
              </div>
            </div>

            {/* Input Panel 2: To (KFUSD) */}
            <div className="w-full h-24 rounded-xl bg-inputPanel p-3 flex flex-col space-y-1 relative overflow-hidden">
              <div className="flex justify-between relative z-10">
                <p className="text-gray-400 text-xs font-medium">To</p>
                <p className="text-gray-400 text-xs font-medium">Balance: {parseFloat(balances.kfUSD).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>                                        
              </div>
              <div className="px-2 flex justify-between relative z-10">
                <div className="text-2xl font-medium text-white">
                  {amount ? parseFloat(calculateOutputAmount()).toLocaleString() : "0"}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-green-500/20 border border-green-500/40 rounded-lg">
                    <div className="w-5 h-5 rounded-full overflow-hidden flex items-center justify-center">
                      <Image src="/stable/kfUSD.png" alt="kfUSD" width={20} height={20} className="w-full h-full object-cover" />
                    </div>
                    <span className="text-white text-sm font-medium">kfUSD</span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Redeem Mode: From KFUSD → To Asset */}
        {mode === "redeem" && (
          <>
            {/* Input Panel 1: From (KFUSD) */}
            <div className="w-full h-24 rounded-xl bg-inputPanel p-3 flex flex-col space-y-1 relative overflow-hidden">
              <div className="flex justify-between relative z-10">
                <p className="text-gray-400 text-xs font-medium">From</p>
                <p className="text-gray-400 text-xs font-medium">Balance: {parseFloat(balances.kfUSD).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
              <div className="px-2 flex justify-between relative z-10">
                <input
                  placeholder="0.0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  type="text"
                  className="bg-transparent sm:w-full lg:w-40 border-none focus:outline-none h-8 text-2xl font-medium text-white placeholder:text-2xl placeholder:font-medium placeholder:text-gray-400 focus:ring-0 resize-none overflow-hidden"
                />
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-green-500/20 border border-green-500/40 rounded-lg">
                    <div className="w-5 h-5 rounded-full overflow-hidden flex items-center justify-center">
                      <Image src="/stable/kfUSD.png" alt="kfUSD" width={20} height={20} className="w-full h-full object-cover" />
                    </div>
                    <span className="text-white text-sm font-medium">kfUSD</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Arrow Icon between panels */}
            <div className="flex justify-center">
              <div className="w-8 h-8 bg-black/80 backdrop-blur-sm hover:bg-black rounded-full border-2 border-[#00ff99]/40 flex items-center justify-center transition-all duration-300 hover:rotate-180 hover:border-tokenSelector">
                <ArrowUpDown className="w-4 h-4 text-white" />
              </div>
            </div>

            {/* Input Panel 2: To (Output Asset) */}
            <div className="w-full h-24 rounded-xl bg-inputPanel p-3 flex flex-col space-y-1 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-[#00ff99]/5 via-transparent to-[#00ff99]/10 pointer-events-none"></div>
              <div className="flex justify-between relative z-10">
                <p className="text-gray-400 text-xs font-medium">To</p>
                {selectedOutputAsset && (
                  <p className="text-gray-400 text-xs font-medium">Balance: {selectedOutputAsset.balance}</p>
                )}
              </div>
              <div className="px-2 flex justify-between relative z-10">
                <div className="text-2xl font-medium text-white">
                  {calculateOutputAmount()}
                </div>
                <div className="flex items-center gap-2">
                  <Dialog.Root open={showOutputModal} onOpenChange={setShowOutputModal}>
                    <Dialog.Trigger asChild>
                      <button
                        className="flex items-center gap-1.5 px-2 py-1 bg-green-500/20 border border-green-500/40 rounded-lg hover:bg-green-500/30 transition-colors"
                      >
                        {selectedOutputAsset ? (
                          <>
                            <div className="w-5 h-5 rounded-full overflow-hidden flex items-center justify-center">
                              <Image src={selectedOutputAsset.image} alt={selectedOutputAsset.symbol} width={20} height={20} className="w-full h-full object-cover" />
                            </div>
                            <span className="text-white text-sm font-medium">{selectedOutputAsset.symbol}</span>
                          </>
                        ) : (
                          <span className="text-gray-400 text-sm">Select</span>
                        )}
                        <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                      </button>
                    </Dialog.Trigger>

                    <Dialog.Portal>
                      <Dialog.Overlay className="fixed inset-0 bg-black/80 z-50" />
                      <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 bg-black/70 backdrop-blur-sm border border-green-500/40 rounded-lg shadow-lg p-6">
                        <div className="flex justify-between items-center mb-4">
                          <Dialog.Title className="text-xl font-bold text-white">
                            Select Output Asset
                          </Dialog.Title>
                          <Dialog.Close asChild>
                            <button className="p-2 hover:bg-[#2a2a2a] rounded-lg">
                              <X className="w-5 h-5 text-gray-400" />
                            </button>
                          </Dialog.Close>
                        </div>
                        
                        <div className="space-y-2">
                          {supportedAssets.map((asset) => (
                            <button
                              key={asset.address}
                              onClick={() => {
                                setSelectedOutputAsset(asset);
                                setShowOutputModal(false);
                              }}
                              className="w-full flex cursor-pointer items-center gap-3 p-3 hover:bg-[#2a2a2a] rounded-lg transition-colors"
                            >
                              <div className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center">
                                <Image src={asset.image} alt={asset.symbol} width={32} height={32} className="w-full h-full object-cover" />
                              </div>
                              <div className="flex-1 text-left">
                                <p className="text-white font-medium">{asset.symbol}</p>
                                <p className="text-gray-400 text-sm">{asset.name}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-white font-medium">{asset.balance}</p>
                                <p className="text-gray-400 text-sm">{asset.price}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </Dialog.Content>
                    </Dialog.Portal>
                  </Dialog.Root>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Fee and Action Section */}
        <div className="flex flex-col space-y-3 mt-4">
          <div className="flex flex-col space-y-2">
            <div className="flex justify-between">
              <p className="text-gray-400 font-normal">
                {mode === "mint" ? "Minting Fee" : "Redemption Fee"}
              </p>
              <p className="font-normal text-[#00ff99]">
                {mode === "mint" ? fees.mintFee : fees.redeemFee}
              </p>
            </div>
          </div>
          <button
            onClick={handleAction}
            disabled={
              !amount || 
              isProcessing || 
              (mode === "mint" && !selectedAsset) || 
              (mode === "redeem" && !selectedOutputAsset)
            }
            className="w-full rounded-lg bg-gradient-to-r from-[#FF4D00] to-[#ff7a33] py-4 font-semibold text-black transition disabled:cursor-not-allowed disabled:opacity-50 hover:from-[#FF6D00] hover:to-[#ff8a40]"
          >
            {getActionButtonText()}
          </button>
        </div>
      </div>

      {/* Transaction History Modal */}
      <TransactionHistoryModal
        open={showHistoryModal}
        onOpenChange={setShowHistoryModal}
        actionType={mode}
      />
    </>
  );
}
