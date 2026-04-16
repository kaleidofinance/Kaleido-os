"use client";

import React, { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, History } from "lucide-react";
import Image from "next/image";
import { ethers } from "ethers";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";

interface Transaction {
  id: string;
  type: "mint" | "redeem" | "lock" | "withdraw";
  asset: string;
  amount: string;
  txHash: string;
  timestamp: string;
  status: "pending" | "completed" | "failed";
  description: string;
}

interface TransactionHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actionType: "mint" | "redeem" | "lock" | "withdraw";
}

const CONTRACTS = {
  kfUSD: "0x913f3354942366809A05e89D288cCE60d87d7348", // Updated
  kafUSD: "0x601191730174c2651E76dC69325681a5A5D5B9a6", // Updated
  USDC: "0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3",
  USDT: "0x717A36E56b33585Bd00260422FfCc3270af34D3E", // Updated
  USDe: "0x2F7744E8fcc75F8F26Ea455968556591091cb46F", // Updated
};

// Helper function to get asset symbol from address
const getAssetSymbol = (address: string): string => {
  const addressLower = address?.toLowerCase();
  if (addressLower === CONTRACTS.USDC?.toLowerCase()) return "USDC";
  if (addressLower === CONTRACTS.USDT?.toLowerCase()) return "USDT";
  if (addressLower === CONTRACTS.USDe?.toLowerCase()) return "USDe";
  return "Unknown";
};

export default function TransactionHistoryModal({
  open,
  onOpenChange,
  actionType,
}: TransactionHistoryModalProps) {
  const activeAccount = useActiveAccount();
  const activeChain = useActiveWalletChain();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (open && activeAccount?.address && activeChain?.id) {
      fetchTransactions();
    } else {
      setTransactions([]);
    }
  }, [open, activeAccount?.address, activeChain?.id]);

  const fetchTransactions = async () => {
    if (!activeAccount?.address || !activeChain?.id) {
      console.log("No account or chain detected");
      setTransactions([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      
      console.log(`Fetching ${actionType} transactions for ${activeAccount.address}`);
      
      // Connect to blockchain provider
      const provider = new ethers.JsonRpcProvider(
        "https://api.testnet.abs.xyz"
      );
      
      const userAddress = activeAccount.address;
      const transactions: Transaction[] = [];
      
      // Import ABIs
      const kfUSDAbi = await import("@/contracts/kfUSD.json");
      const kafUSDAbi = await import("@/contracts/kafUSD.json");
      
      console.log(`kfUSD contract: ${CONTRACTS.kfUSD}`);
      console.log(`kafUSD contract: ${CONTRACTS.kafUSD}`);
      
      const kfUSDContract = new ethers.Contract(
        CONTRACTS.kfUSD,
        kfUSDAbi.abi,
        provider
      );
      
      const kafUSDContract = new ethers.Contract(
        CONTRACTS.kafUSD,
        kafUSDAbi.abi,
        provider
      );
      
      // Query events based on action type
      if (actionType === "mint" || actionType === "redeem") {
        // Query kfUSD Minted and Redeemed events
        const mintFilter = kfUSDContract.filters.Minted?.();
        const redeemFilter = kfUSDContract.filters.Redeemed?.();
        
        console.log("Fetching mint events...");
        if (mintFilter && actionType === "mint") {
          try {
            const mintEvents = await kfUSDContract.queryFilter(mintFilter);
            console.log(`Found ${mintEvents.length} mint events`);
            mintEvents.forEach((event: any) => {
              console.log("Event:", event.args);
              if (event.args.to?.toLowerCase() === userAddress.toLowerCase()) {
                const amount = parseFloat(ethers.formatUnits(event.args.amount, 18)).toFixed(2);
                const collateralSymbol = getAssetSymbol(event.args.collateral);
                transactions.push({
                  id: `${event.transactionHash}-${event.logIndex}`,
                  type: "mint",
                  asset: collateralSymbol,
                  amount: amount,
                  txHash: event.transactionHash,
                  timestamp: new Date(Date.now()).toLocaleString(),
                  status: "completed",
                  description: `${amount} ${collateralSymbol} minted to ${amount} kfUSD`,
                });
              }
            });
          } catch (err) {
            console.error("Error fetching mint events:", err);
          }
        }
        
        console.log("Fetching redeem events...");
        if (redeemFilter && actionType === "redeem") {
          try {
            const redeemEvents = await kfUSDContract.queryFilter(redeemFilter);
            console.log(`Found ${redeemEvents.length} redeem events`);
            redeemEvents.forEach((event: any) => {
              console.log("Event:", event.args);
              if (event.args.from?.toLowerCase() === userAddress.toLowerCase()) {
                const amount = parseFloat(ethers.formatUnits(event.args.amount, 18)).toFixed(2);
                const outputSymbol = getAssetSymbol(event.args.outputAsset);
                transactions.push({
                  id: `${event.transactionHash}-${event.logIndex}`,
                  type: "redeem",
                  asset: outputSymbol,
                  amount: amount,
                  txHash: event.transactionHash,
                  timestamp: new Date(Date.now()).toLocaleString(),
                  status: "completed",
                  description: `${amount} kfUSD redeemed to ${amount} ${outputSymbol}`,
                });
              }
            });
          } catch (err) {
            console.error("Error fetching redeem events:", err);
          }
        }
      }
      
      if (actionType === "lock" || actionType === "withdraw") {
        // Query kafUSD AssetsLocked and AssetsUnlocked events
        const lockFilter = kafUSDContract.filters.AssetsLocked?.();
        const unlockFilter = kafUSDContract.filters.AssetsUnlocked?.();
        
        console.log("Fetching lock events...");
        if (lockFilter && actionType === "lock") {
          try {
            const lockEvents = await kafUSDContract.queryFilter(lockFilter);
            console.log(`Found ${lockEvents.length} lock events`);
            lockEvents.forEach((event: any) => {
              console.log("Event:", event.args);
              if (event.args.user?.toLowerCase() === userAddress.toLowerCase()) {
                const amount = parseFloat(ethers.formatUnits(event.args.amount, 18)).toFixed(2);
                transactions.push({
                  id: `${event.transactionHash}-${event.logIndex}`,
                  type: "lock",
                  asset: "kfUSD",
                  amount: amount,
                  txHash: event.transactionHash,
                  timestamp: new Date(Date.now()).toLocaleString(),
                  status: "completed",
                  description: `${amount} kfUSD locked to earn yield`,
                });
              }
            });
          } catch (err) {
            console.error("Error fetching lock events:", err);
          }
        }
        
        console.log("Fetching unlock events...");
        if (unlockFilter && actionType === "withdraw") {
          try {
            const unlockEvents = await kafUSDContract.queryFilter(unlockFilter);
            console.log(`Found ${unlockEvents.length} unlock events`);
            unlockEvents.forEach((event: any) => {
              console.log("Event:", event.args);
              if (event.args.user?.toLowerCase() === userAddress.toLowerCase()) {
                const amount = parseFloat(ethers.formatUnits(event.args.amount, 18)).toFixed(2);
                transactions.push({
                  id: `${event.transactionHash}-${event.logIndex}`,
                  type: "withdraw",
                  asset: "kafUSD",
                  amount: amount,
                  txHash: event.transactionHash,
                  timestamp: new Date(Date.now()).toLocaleString(),
                  status: "completed",
                  description: `${amount} kafUSD withdrawn from vault`,
                });
              }
            });
          } catch (err) {
            console.error("Error fetching unlock events:", err);
          }
        }
      }
      
      console.log(`Total transactions found: ${transactions.length}`);
      
      // Sort by timestamp (newest first)
      transactions.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      
      setTransactions(transactions);
    } catch (error) {
      console.error("Error fetching transactions:", error);
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  };

  const getTypeLabel = () => {
    switch (actionType) {
      case "mint":
        return "Mint";
      case "redeem":
        return "Redeem";
      case "lock":
        return "Lock";
      case "withdraw":
        return "Withdraw";
      default:
        return "Transaction";
    }
  };

  const getTypeColor = (status: string) => {
    switch (status) {
      case "completed":
        return "text-green-400";
      case "pending":
        return "text-yellow-400";
      case "failed":
        return "text-red-400";
      default:
        return "text-gray-400";
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/80 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 bg-black/95 backdrop-blur-md border border-green-500/40 rounded-xl shadow-xl p-6">
          <div className="flex justify-between items-center mb-6">
            <Dialog.Title className="text-2xl font-bold text-white flex items-center gap-2">
              <History className="w-6 h-6 text-[#00ff99]" />
              {getTypeLabel()} History
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="p-2 hover:bg-black/50 rounded-lg transition-colors">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </Dialog.Close>
          </div>

          <div className="space-y-3 max-h-[500px] overflow-y-auto">
            {loading ? (
              <div className="text-center py-12">
                <p className="text-gray-400">Loading transactions...</p>
              </div>
            ) : transactions.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-400">No transactions yet</p>
                <p className="text-gray-500 text-sm mt-2">
                  Complete a transaction to see your history here
                </p>
              </div>
            ) : (
              transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between p-4 bg-black/40 rounded-lg border border-green-500/20 hover:border-green-500/40 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center border border-green-500/30">
                      {tx.asset === "USDC" && (
                        <Image src="/USDC.svg" alt="USDC" width={24} height={24} />
                      )}
                      {tx.asset === "USDT" && (
                        <Image src="/usdt.svg" alt="USDT" width={24} height={24} />
                      )}
                      {tx.asset === "USDe" && (
                        <Image src="/stable/USDe.jpeg" alt="USDe" width={24} height={24} />
                      )}
                      {tx.asset === "kfUSD" && (
                        <Image src="/stable/kfUSD.png" alt="kfUSD" width={24} height={24} />
                      )}
                      {tx.asset === "kafUSD" && (
                        <Image src="/stable/kafUSD.png" alt="kafUSD" width={24} height={24} />
                      )}
                    </div>
                    <div>
                      <p className="text-white font-medium">{tx.description}</p>
                      <p className="text-gray-400 text-sm">{tx.timestamp}</p>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className={`text-sm ${getTypeColor(tx.status)}`}>
                      {tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      window.open(`https://sepolia.abscan.org/tx/${tx.txHash}`, "_blank");
                    }}
                    className="ml-4 px-3 py-2 bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 rounded-lg text-[#00ff99] text-sm transition-colors"
                  >
                    View
                  </button>
                </div>
              ))
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

