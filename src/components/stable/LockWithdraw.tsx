"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { ChevronDown, ArrowUpDown, X, History } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { useStablecoin } from "@/hooks/useStablecoin";
import TransactionHistoryModal from "./TransactionHistoryModal";

interface VaultAsset {
  symbol: string;
  name: string;
  address: string;
  image: string;
  balance: string;
  apy: string;
}

interface LockWithdrawProps {
  mode: "lock" | "withdraw";
}

export default function LockWithdraw({ mode }: LockWithdrawProps) {
  const { balances, stats, lockAssets, requestWithdrawal, completeWithdrawal, withdrawalInfo } = useStablecoin();
  const [selectedOutputAsset, setSelectedOutputAsset] = useState<VaultAsset | null>(null);
  const [lockAmount, setLockAmount] = useState("");
  const [unlockAmount, setUnlockAmount] = useState("");
  const [isLocking, setIsLocking] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [hasWithdrawalRequest, setHasWithdrawalRequest] = useState(false);
  const [cooldownEndTime, setCooldownEndTime] = useState<number | null>(null);
  const [isCompletePending, setIsCompletePending] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<string>("");

  // Memoize vaultAssets to update when balances change
  const vaultAssets: VaultAsset[] = React.useMemo(() => [
    {
      symbol: "kfUSD",
      name: "Kaleido USD",
      address: "0x913f3354942366809A05e89D288cCE60d87d7348", // Updated
      image: "/stable/kfUSD.png",
      balance: parseFloat(balances.kfUSD || "0").toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      apy: stats.totalYieldAPY || "5.0%"
    },
    {
      symbol: "USDC",
      name: "USD Coin",
      address: "0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3",
      image: "/USDC.svg",
      balance: parseFloat(balances.USDC || "0").toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      apy: "8.5%"
    },
    {
      symbol: "USDT",
      name: "Tether USD",
      address: "0x717A36E56b33585Bd00260422FfCc3270af34D3E", // Updated
      image: "/usdt.svg",
      balance: parseFloat(balances.USDT || "0").toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      apy: "9.2%"
    },
    {
      symbol: "USDe",
      name: "Ethena USD",
      address: "0x2F7744E8fcc75F8F26Ea455968556591091cb46F", // Updated
      image: "/stable/USDe.jpeg",
      balance: parseFloat(balances.USDe || "0").toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      apy: "15.7%"
    }
  ], [balances, stats.totalYieldAPY]);

  const userkafUSDBalance = React.useMemo(() => 
    parseFloat(balances.kafUSD || "0").toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    [balances.kafUSD]
  );
  
  // Set kfUSD as default selected asset
  const [selectedAsset, setSelectedAsset] = useState<VaultAsset | null>(null);

  // Set default selected asset when vaultAssets updates
  useEffect(() => {
    if (!selectedAsset && vaultAssets.length > 0) {
      setSelectedAsset(vaultAssets[0]); // kfUSD at index 0
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultAssets]);

  // Update countdown timer
  useEffect(() => {
    if (!cooldownEndTime) {
      setTimeRemaining("");
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      const timeLeft = cooldownEndTime - now;

      if (timeLeft <= 0) {
        setTimeRemaining("0d 0h 0m");
        return;
      }

      const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
      const hours = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));

      setTimeRemaining(`${days}d ${hours}h ${minutes}m`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [cooldownEndTime]);

  const handleLock = async () => {
    if (!selectedAsset || !lockAmount) return;
    setIsLocking(true);
    
    try {
      await lockAssets(selectedAsset.symbol, lockAmount);
      setLockAmount("");
      setSelectedAsset(vaultAssets[0]); // Reset to kfUSD
    } catch (error) {
      console.error("Transaction failed:", error);
    } finally {
      setIsLocking(false);
    }
  };

  const handleUnlock = async () => {
    if (!unlockAmount || !selectedOutputAsset) return;
    setIsUnlocking(true);
    
    try {
      await requestWithdrawal(unlockAmount);
      setUnlockAmount("");
      setSelectedOutputAsset(null);
      // Set cooldown end time (7 days from now)
      const cooldownEnd = Date.now() + 7 * 24 * 60 * 60 * 1000;
      setCooldownEndTime(cooldownEnd);
      setHasWithdrawalRequest(true);
    } catch (error) {
      console.error("Transaction failed:", error);
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleCompleteWithdrawal = async () => {
    if (!selectedOutputAsset) return;
    setIsCompletePending(true);
    
    try {
      await completeWithdrawal(selectedOutputAsset.symbol);
      setHasWithdrawalRequest(false);
      setCooldownEndTime(null);
      setSelectedOutputAsset(null);
      setUnlockAmount("");
    } catch (error) {
      console.error("Transaction failed:", error);
    } finally {
      setIsCompletePending(false);
    }
  };

  const calculateKAFUSDAmount = () => {
    if (!lockAmount) return "0";
    return (parseFloat(lockAmount)).toFixed(2);
  };

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold text-white">
          {mode === "lock" ? "Lock Assets" : "Withdraw Assets"}
        </h2>
        <button
          onClick={() => setShowHistoryModal(true)}
          className="p-2 hover:bg-green-500/20 rounded-lg transition-all duration-200 hover:scale-110 group"
          title={`${mode === "lock" ? "Lock" : "Withdraw"} History`}
        >
          <History className="w-5 h-5 text-gray-400 group-hover:text-[#00ff99] transition-colors" />
        </button>
      </div>

      <div className="flex flex-col space-y-4">
        {/* Lock Mode */}
        {mode === "lock" && (
          <>
            {/* Input Panel 1: From (Asset to Lock) */}
            <div className="w-full h-24 rounded-xl bg-inputPanel p-3 flex flex-col space-y-1 relative overflow-hidden">
              <div className="flex justify-between relative z-10">
                <p className="text-gray-400 text-xs font-medium">From</p>
                {selectedAsset && (
                  <p className="text-gray-400 text-xs font-medium">Balance: {selectedAsset.balance}</p>
                )}
              </div>
              <div className="px-2 flex justify-between relative z-10">
                <input
                  placeholder="0.0"
                  value={lockAmount}
                  onChange={(e) => setLockAmount(e.target.value)}
                  type="text"
                  className="bg-transparent sm:w-full lg:w-40 border-none focus:outline-none h-8 text-2xl font-medium text-white placeholder:text-2xl placeholder:font-medium placeholder:text-gray-400 focus:ring-0 resize-none overflow-hidden"
                />
                <div className="flex items-center gap-2">
                  <Dialog.Root open={showAssetModal} onOpenChange={setShowAssetModal}>
                    <Dialog.Trigger asChild>
                      <button className="flex items-center gap-1.5 px-2 py-1 bg-green-500/20 border border-green-500/40 rounded-lg hover:bg-green-500/30 transition-colors">
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
                            Select Asset to Lock
                          </Dialog.Title>
                          <Dialog.Close asChild>
                            <button className="p-2 hover:bg-black rounded-lg">
                              <X className="w-5 h-5 text-gray-400" />
                            </button>
                          </Dialog.Close>
                        </div>
                        
                        <div className="space-y-2">
                          {vaultAssets.map((asset) => (
                            <button
                              key={asset.address}
                              onClick={() => {
                                setSelectedAsset(asset);
                                setShowAssetModal(false);
                              }}
                              className="w-full flex cursor-pointer items-center gap-3 p-3 hover:bg-black rounded-lg transition-colors"
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

            {/* Arrow Icon */}
            <div className="flex justify-center">
              <div className="w-8 h-8 bg-black/80 backdrop-blur-sm hover:bg-black rounded-full border-2 border-[#00ff99]/40 flex items-center justify-center transition-all duration-300 hover:rotate-180 hover:border-tokenSelector">
                <ArrowUpDown className="w-4 h-4 text-white" />
              </div>
            </div>

            {/* Input Panel 2: To (KAFUSD) */}
            <div className="w-full h-24 rounded-xl bg-inputPanel p-3 flex flex-col space-y-1 relative overflow-hidden">
              <div className="flex justify-between relative z-10">
                <p className="text-gray-400 text-xs font-medium">To</p>
                {selectedAsset && (
                  <p className="text-gray-400 text-xs font-medium">APY: {selectedAsset.apy}</p>
                )}
              </div>
              <div className="px-2 flex justify-between relative z-10">
                <div className="text-2xl font-medium text-white">
                  {lockAmount ? calculateKAFUSDAmount() : "0"}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-green-500/20 border border-green-500/40 rounded-lg">
                    <div className="w-5 h-5 rounded-full overflow-hidden flex items-center justify-center">
                      <Image src="/stable/kafUSD.png" alt="kafUSD" width={20} height={20} className="w-full h-full object-cover" />
                    </div>
                    <span className="text-white text-sm font-medium">kafUSD</span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Withdraw Mode */}
        {mode === "withdraw" && (
          <>
            {/* Input Panel 1: From (KAFUSD) */}
            <div className="w-full h-24 rounded-xl bg-inputPanel p-3 flex flex-col space-y-1 relative overflow-hidden">
              <div className="flex justify-between relative z-10">
                <p className="text-gray-400 text-xs font-medium">From</p>
                <p className="text-gray-400 text-xs font-medium">
                  Balance: {
                    hasWithdrawalRequest && unlockAmount 
                      ? `${parseFloat(userkafUSDBalance.replace(/,/g, '')) + parseFloat(unlockAmount.replace(/,/g, ''))}` 
                      : userkafUSDBalance
                  }
                </p>
              </div>
              <div className="px-2 flex justify-between relative z-10">
                <input
                  placeholder="0.0"
                  value={unlockAmount}
                  onChange={(e) => setUnlockAmount(e.target.value)}
                  type="text"
                  className="bg-transparent sm:w-full lg:w-40 border-none focus:outline-none h-8 text-2xl font-medium text-white placeholder:text-2xl placeholder:font-medium placeholder:text-gray-400 focus:ring-0 resize-none overflow-hidden"
                />
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-green-500/20 border border-green-500/40 rounded-lg">
                    <div className="w-5 h-5 rounded-full overflow-hidden flex items-center justify-center">
                      <Image src="/stable/kafUSD.png" alt="kafUSD" width={20} height={20} className="w-full h-full object-cover" />
                    </div>
                    <span className="text-white text-sm font-medium">kafUSD</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Arrow Icon */}
            <div className="flex justify-center">
              <div className="w-8 h-8 bg-black/80 backdrop-blur-sm hover:bg-black rounded-full border-2 border-[#00ff99]/40 flex items-center justify-center transition-all duration-300 hover:rotate-180 hover:border-tokenSelector">
                <ArrowUpDown className="w-4 h-4 text-white" />
              </div>
            </div>

            {/* Input Panel 2: To (Original Asset) */}
            <div className="w-full h-24 rounded-xl bg-inputPanel p-3 flex flex-col space-y-1 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-[#00ff99]/5 via-transparent to-[#00ff99]/10 pointer-events-none"></div>
              <div className="flex justify-between relative z-10">
                <p className="text-gray-400 text-xs font-medium">To</p>
                <p className="text-gray-400 text-xs font-medium">≈ ${unlockAmount || "0"}</p>
              </div>
              <div className="px-2 flex justify-between relative z-10">
                <div className="text-2xl font-medium text-white">
                  {unlockAmount || "0"}
                </div>
                <div className="flex items-center gap-2">
                  <Dialog.Root open={showAssetModal} onOpenChange={setShowAssetModal}>
                    <Dialog.Trigger asChild>
                      <button className="flex items-center gap-1.5 px-2 py-1 bg-green-500/20 border border-green-500/40 rounded-lg hover:bg-green-500/30 transition-colors">
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
                            <button className="p-2 hover:bg-black rounded-lg">
                              <X className="w-5 h-5 text-gray-400" />
                            </button>
                          </Dialog.Close>
                        </div>
                        
                        <div className="space-y-2">
                          {vaultAssets.map((asset) => (
                            <button
                              key={asset.address}
                              onClick={() => {
                                setSelectedOutputAsset(asset);
                                setShowAssetModal(false);
                              }}
                              className="w-full flex cursor-pointer items-center gap-3 p-3 hover:bg-black rounded-lg transition-colors"
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
          {mode === "lock" && selectedAsset && (
            <div className="flex flex-col space-y-2">
              <div className="flex justify-between">
                <p className="text-gray-400 font-normal">Estimated APY</p>
                <p className="font-normal text-[#00ff99]">{selectedAsset.apy}</p>
              </div>
              <div className="flex justify-between">
                <p className="text-gray-400 font-normal">Cooldown Period</p>
                <p className="font-normal text-white">7 days</p>
              </div>
            </div>
          )}

          {mode === "withdraw" && (
            <>
              {!hasWithdrawalRequest ? (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                  <p className="text-yellow-400 text-sm">
                    ⚠️ Your assets will be available after a 7-day cooldown period
                  </p>
                </div>
              ) : cooldownEndTime && Date.now() < cooldownEndTime ? (
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                  <p className="text-blue-400 text-sm flex items-center gap-2">
                    ⏳ Cooldown active. Withdrawal available in: <span className="font-bold">{timeRemaining || "Calculating..."}</span>
                  </p>
                </div>
              ) : (
                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3">
                  <p className="text-green-400 text-sm">
                    ✅ Cooldown complete! Complete your withdrawal now.
                  </p>
                </div>
              )}
            </>
          )}

          {/* Show different buttons based on withdrawal state */}
          {mode === "withdraw" && withdrawalInfo.hasWithdrawal && withdrawalInfo.unlockTime === "Ready" ? (
            <button
              onClick={handleCompleteWithdrawal}
              disabled={isCompletePending || !selectedOutputAsset}
              className="w-full rounded-lg bg-gradient-to-r from-green-500 to-green-600 py-4 font-semibold text-black transition disabled:cursor-not-allowed disabled:opacity-50 hover:opacity-90"
            >
              {isCompletePending ? "Completing..." : "Complete Withdrawal"}
            </button>
          ) : (
            <button
              onClick={mode === "lock" ? handleLock : handleUnlock}
              disabled={
                (mode === "lock" && (!lockAmount || !selectedAsset || isLocking)) ||
                (mode === "withdraw" && (withdrawalInfo.hasWithdrawal || !unlockAmount || isUnlocking))
              }
              className={`w-full rounded-lg bg-gradient-to-r ${
                mode === "lock" 
                  ? "from-green-500 to-green-600" 
                  : "from-orange-500 to-orange-600"
              } py-4 font-semibold text-black transition disabled:cursor-not-allowed disabled:opacity-50 hover:opacity-90`}
            >
              {isLocking || isUnlocking 
                ? (mode === "lock" ? "Locking..." : "Unlocking...") 
                : (mode === "lock" ? "Lock Now" : "Start Unlock Process")
              }
            </button>
          )}
        </div>
      </div>

      {/* Transaction History Modal */}
      <TransactionHistoryModal
        open={showHistoryModal}
        onOpenChange={setShowHistoryModal}
        actionType={mode === "lock" ? "lock" : "withdraw"}
      />
    </>
  );
}

