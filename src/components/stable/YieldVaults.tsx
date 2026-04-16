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

export default function YieldVaults() {
  const { balances, stats, lockAssets, requestWithdrawal, completeWithdrawal } = useStablecoin();
  const [activeTab, setActiveTab] = useState("lock");
  const [selectedOutputAsset, setSelectedOutputAsset] = useState<VaultAsset | null>(null);
  const [lockAmount, setLockAmount] = useState("");
  const [unlockAmount, setUnlockAmount] = useState("");
  const [isLocking, setIsLocking] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [hasWithdrawalRequest, setHasWithdrawalRequest] = useState(false);
  const [cooldownEndTime, setCooldownEndTime] = useState<number | null>(null);
  const [isCompletePending, setIsCompletePending] = useState(false);
  const [requestedWithdrawalAmount, setRequestedWithdrawalAmount] = useState<string>("");
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
      apy: stats.totalYieldAPY || "5.0%" // Use actual yieldAPY from contract
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

  const userVaultStats = React.useMemo(() => ({
    totalLocked: `$${parseFloat(balances.kafUSD || "0").toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    kafusdBalance: parseFloat(balances.kafUSD || "0").toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    totalRewards: "$0.00", // Will be calculated from contract
    totalYieldAPY: stats.totalYieldAPY
  }), [balances.kafUSD, stats.totalYieldAPY]);

  return (
    <div className="space-y-8">
      {/* Vault Overview Stats */}
      <div className="bg-black backdrop-blur-sm border border-green-500/10 rounded-xl p-6 u-class-shadow-2">
        <h3 className="text-lg font-semibold text-white mb-6">Yield Vault Overview</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-black rounded-lg px-4 py-10 flex justify-between items-center u-class-shadow-2">
            <div>
              <p className="text-xs text-white/50 pb-1">Total Locked</p>
              <h1 className="text-xl">{userVaultStats.totalLocked}</h1>
              <p className="text-xs text-gray-500 mt-1">Across all assets</p>
            </div>
            <div className="flex items-center justify-center bg-black mr-2">
              <svg className="w-10 h-10 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
          </div>

          <div className="bg-black rounded-lg px-4 py-10 flex justify-between items-center u-class-shadow-2">
            <div>
              <p className="text-xs text-white/50 pb-1">kafUSD Balance</p>
              <h1 className="text-xl">{userVaultStats.kafusdBalance}</h1>
              <p className="text-xs text-gray-500 mt-1">Liquid staking tokens</p>
            </div>
            <div className="flex items-center justify-center bg-black mr-2">
              <svg className="w-10 h-10 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
          </div>

          <div className="bg-black rounded-lg px-4 py-10 flex justify-between items-center u-class-shadow-2">
            <div>
              <p className="text-xs text-white/50 pb-1">Total Yield APY</p>
              <h1 className="text-xl">{userVaultStats.totalYieldAPY}</h1>
              <p className="text-xs text-gray-500 mt-1">Current earning rate</p>
            </div>
            <div className="flex items-center justify-center bg-black mr-2">
              <svg className="w-10 h-10 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
          </div>

          <div className="bg-black rounded-lg px-4 py-10 flex justify-between items-center u-class-shadow-2">
            <div>
              <p className="text-xs text-white/50 pb-1">Total Rewards</p>
              <h1 className="text-xl">{userVaultStats.totalRewards}</h1>
              <p className="text-xs text-gray-500 mt-1">Lifetime earnings</p>
            </div>
            <div className="flex items-center justify-center bg-black mr-2">
              <svg className="w-10 h-10 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center justify-center space-y-9 px-4 py-4">
      {/* Tabs */}
      <div className="mb-4 flex space-x-4">
        <button
          onClick={() => setActiveTab("lock")}
          className={`rounded-t-lg border-b-2 px-6 py-2 text-[20px] ${
            activeTab === "lock" ? "border-[#00ff6e] text-[#00ff6e]" : "border-transparent text-gray-400"
          }`}
        >
          Lock
        </button>
        <button
          onClick={() => setActiveTab("unlock")}
          className={`rounded-t-lg border-b-2 px-6 py-2 text-[20px] ${
            activeTab === "unlock" ? "border-[#00ff6e] text-[#00ff6e]" : "border-transparent text-gray-400"
          }`}
        >
          Withdraw
        </button>
      </div>

      <div className="lg:w-[600px] sm:w-full w-full bg-black h-auto rounded-2xl p-8 shadow-md text-white relative overflow-visible border border-[#00ff6e]/30">
        <div className="relative z-10">
          <div className="flex flex-col space-y-4">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-white">
                {activeTab === "lock" ? "Lock" : "Withdraw"} Assets
              </h2>
              <button
                onClick={() => setShowHistoryModal(true)}
                className="p-2 hover:bg-green-500/20 rounded-lg transition-all duration-200 hover:scale-110 group"
                title={`${activeTab === "lock" ? "Lock" : "Withdraw"} History`}
              >
                <History className="w-5 h-5 text-gray-400 group-hover:text-[#00ff99] transition-colors" />
              </button>
            </div>

            {/* Lock Mode */}
            {activeTab === "lock" && (
              <>
                {/* Input Panel 1: From (Asset to Lock) */}
                <div className="w-full h-32 rounded-xl bg-inputPanel p-5 flex flex-col space-y-2 relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-[#00ff99]/15 via-transparent to-[#00ff99]/20 pointer-events-none"></div>
                  <div className="flex justify-between relative z-10">
                    <p className="text-gray-400 font-medium">From</p>
                    {selectedAsset && (
                      <p className="text-gray-400 font-medium">Balance: {selectedAsset.balance}</p>
                    )}
                  </div>
                  <div className="px-3 flex justify-between relative z-10">
                    <input
                      placeholder="0.0"
                      value={lockAmount}
                      onChange={(e) => setLockAmount(e.target.value)}
                      type="text"
                      className="bg-transparent sm:w-full lg:w-48 border-none focus:outline-none h-10 text-3xl font-medium text-white placeholder:text-3xl placeholder:font-medium placeholder:text-gray-400 focus:ring-0 resize-none overflow-hidden"
                    />
                    <div className="flex items-center gap-2">
                      <Dialog.Root open={showAssetModal} onOpenChange={setShowAssetModal}>
                        <Dialog.Trigger asChild>
                          <button className="flex items-center gap-2 px-3 py-2 bg-green-500/20 border border-green-500/40 rounded-lg hover:bg-green-500/30 transition-colors">
                            {selectedAsset ? (
                              <>
                                <div className="w-6 h-6 rounded-full overflow-hidden flex items-center justify-center">
                                  <Image src={selectedAsset.image} alt={selectedAsset.symbol} width={24} height={24} className="w-full h-full object-cover" />
                                </div>
                                <span className="text-white font-medium">{selectedAsset.symbol}</span>
                              </>
                            ) : (
                              <span className="text-gray-400">Select</span>
                            )}
                            <ChevronDown className="w-4 h-4 text-gray-400" />
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
                  <div className="w-10 h-10 bg-black/80 backdrop-blur-sm hover:bg-black rounded-full border-2 border-[#00ff99]/40 flex items-center justify-center transition-all duration-300 hover:rotate-180 hover:border-tokenSelector">
                    <ArrowUpDown className="w-5 h-5 text-white" />
                  </div>
                </div>

                {/* Input Panel 2: To (KAFUSD) */}
                <div className="w-full h-32 rounded-xl bg-inputPanel p-5 flex flex-col space-y-2 relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-[#00ff99]/15 via-transparent to-[#00ff99]/20 pointer-events-none"></div>
                  <div className="flex justify-between relative z-10">
                    <p className="text-gray-400 font-medium">To</p>
                    {selectedAsset && (
                      <p className="text-gray-400 font-medium">APY: {selectedAsset.apy}</p>
                    )}
                  </div>
                  <div className="px-3 flex justify-between relative z-10">
                    <div className="text-3xl font-medium text-white">
                      {lockAmount ? calculateKAFUSDAmount() : "0"}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-2 px-3 py-2 bg-green-500/20 border border-green-500/40 rounded-lg">
                        <div className="w-6 h-6 rounded-full overflow-hidden flex items-center justify-center">
                          <Image src="/stable/kafUSD.png" alt="kafUSD" width={24} height={24} className="w-full h-full object-cover" />
                        </div>
                        <span className="text-white font-medium">kafUSD</span>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Unlock Mode */}
            {activeTab === "unlock" && (
              <>
                {/* Input Panel 1: From (KAFUSD) */}
                <div className="w-full h-32 rounded-xl bg-inputPanel p-5 flex flex-col space-y-2 relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-[#00ff99]/15 via-transparent to-[#00ff99]/20 pointer-events-none"></div>
                  <div className="flex justify-between relative z-10">
                    <p className="text-gray-400 font-medium">From</p>
                    <p className="text-gray-400 font-medium">
                      Balance: {
                        hasWithdrawalRequest && unlockAmount 
                          ? `${parseFloat(userkafUSDBalance.replace(/,/g, '')) + parseFloat(unlockAmount.replace(/,/g, ''))}` 
                          : userkafUSDBalance
                      }
                    </p>
                  </div>
                  <div className="px-3 flex justify-between relative z-10">
                    <input
                      placeholder="0.0"
                      value={unlockAmount}
                      onChange={(e) => setUnlockAmount(e.target.value)}
                      type="text"
                      className="bg-transparent sm:w-full lg:w-48 border-none focus:outline-none h-10 text-3xl font-medium text-white placeholder:text-3xl placeholder:font-medium placeholder:text-gray-400 focus:ring-0 resize-none overflow-hidden"
                    />
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-2 px-3 py-2 bg-green-500/20 border border-green-500/40 rounded-lg">
                        <div className="w-6 h-6 rounded-full overflow-hidden flex items-center justify-center">
                          <Image src="/stable/kafUSD.png" alt="kafUSD" width={24} height={24} className="w-full h-full object-cover" />
                        </div>
                        <span className="text-white font-medium">kafUSD</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Arrow Icon */}
                <div className="flex justify-center">
                  <div className="w-10 h-10 bg-black/80 backdrop-blur-sm hover:bg-black rounded-full border-2 border-[#00ff99]/40 flex items-center justify-center transition-all duration-300 hover:rotate-180 hover:border-tokenSelector">
                    <ArrowUpDown className="w-5 h-5 text-white" />
                  </div>
                </div>

                {/* Input Panel 2: To (Original Asset) */}
                <div className="w-full h-32 rounded-xl bg-inputPanel p-5 flex flex-col space-y-2 relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-[#00ff99]/15 via-transparent to-[#00ff99]/20 pointer-events-none"></div>
                  <div className="flex justify-between relative z-10">
                    <p className="text-gray-400 font-medium">To</p>
                    <p className="text-gray-400 font-medium">≈ ${unlockAmount || "0"}</p>
                  </div>
                  <div className="px-3 flex justify-between relative z-10">
                    <div className="text-3xl font-medium text-white">
                      {unlockAmount || "0"}
                    </div>
                    <div className="flex items-center gap-2">
                      <Dialog.Root open={showAssetModal} onOpenChange={setShowAssetModal}>
                        <Dialog.Trigger asChild>
                          <button className="flex items-center gap-2 px-3 py-2 bg-green-500/20 border border-green-500/40 rounded-lg hover:bg-green-500/30 transition-colors">
                            {selectedOutputAsset ? (
                              <>
                                <div className="w-6 h-6 rounded-full overflow-hidden flex items-center justify-center">
                                  <Image src={selectedOutputAsset.image} alt={selectedOutputAsset.symbol} width={24} height={24} className="w-full h-full object-cover" />
                                </div>
                                <span className="text-white font-medium">{selectedOutputAsset.symbol}</span>
                              </>
                            ) : (
                              <span className="text-gray-400">Select</span>
                            )}
                            <ChevronDown className="w-4 h-4 text-gray-400" />
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
              {activeTab === "lock" && selectedAsset && (
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

              {activeTab === "unlock" && (
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
              {activeTab === "unlock" && hasWithdrawalRequest && cooldownEndTime && Date.now() >= cooldownEndTime ? (
                <button
                  onClick={handleCompleteWithdrawal}
                  disabled={isCompletePending || !selectedOutputAsset}
                  className="w-full rounded-lg bg-gradient-to-r from-green-500 to-green-600 py-4 font-semibold text-black transition disabled:cursor-not-allowed disabled:opacity-50 hover:opacity-90"
                >
                  {isCompletePending ? "Completing..." : "Complete Withdrawal"}
                </button>
              ) : (
                <button
                  onClick={activeTab === "lock" ? handleLock : handleUnlock}
                  disabled={
                    (activeTab === "lock" && (!lockAmount || !selectedAsset || isLocking)) ||
                    (activeTab === "unlock" && (hasWithdrawalRequest || !unlockAmount || isUnlocking))
                  }
                  className={`w-full rounded-lg bg-gradient-to-r ${
                    activeTab === "lock" 
                      ? "from-green-500 to-green-600" 
                      : "from-orange-500 to-orange-600"
                  } py-4 font-semibold text-black transition disabled:cursor-not-allowed disabled:opacity-50 hover:opacity-90`}
                >
                  {isLocking || isUnlocking 
                    ? (activeTab === "lock" ? "Locking..." : "Unlocking...") 
                    : (activeTab === "lock" ? "Lock Now" : "Start Unlock Process")
                  }
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      </div>

      {/* Transaction History Modal */}
      <TransactionHistoryModal
        open={showHistoryModal}
        onOpenChange={setShowHistoryModal}
        actionType={activeTab === "lock" ? "lock" : "withdraw"}
      />
    </div>
  );
}
