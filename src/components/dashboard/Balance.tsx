"use client"

import Image from "next/image"
import { Btn } from "../shared/Btn"
import useGetValueAndHealth from "@/hooks/useGetValueAndHealth"
import NoAssets from "./NoAssets"
import { ethers } from "ethers"
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react"
import { useState, useEffect } from "react"
import DepositModal from "@/components/shared/DepositModal"
import { formatWithCommas } from "@/constants/utils/formatNumber"

const Balance = () => {
  const [mounted, setMounted] = useState(false)
  const [showDepositModal, setShowDepositModal] = useState(false)
  const [showWithdrawModal, setShowWithdrawModal] = useState(false)
  const activeAccount = useActiveAccount()
  const address = activeAccount?.address
  
  useEffect(() => {
    setMounted(true)
  }, [])
  
  const { etherPrice, usdcPrice, data3, data4, data5, AVA4, AVA5, collateralVal, availBal } = useGetValueAndHealth()

  // Initialize the array with dynamic balance and market value calculation
  const balanceData = [
    {
      assetName: "ETH",
      assetImg: "/eth.svg",
      balance: data3 ?? 0,
      marketValue: `$${(data3 ?? 0) * Number(etherPrice)}`,
      netProfit: "12.30%",
      netProfitColor: "text-green-500",
      collateralImg: "/toggleOff.svg",
      collateralStatus: "Off",
      tokenPrice: 11,
    },
    {
      assetName: "USDC",
      assetImg: "/USDC.svg",
      balance: data4 ?? 0,
      marketValue: `$${(data4 ?? 0) * Number(usdcPrice)}`,
      netProfit: "2.53%",
      netProfitColor: "text-green-500",
      collateralImg: "/toggleOn.svg",
      collateralStatus: "On",
      tokenPrice: 2500,
    },

    {
      assetName: "USDR",
      assetImg: "/drakov4.png",
      balance: data5 ?? 0,
      marketValue: `$${(data5 ?? 0) * Number(usdcPrice)}`,
      netProfit: "2.53%",
      netProfitColor: "text-green-500",
      collateralImg: "/toggleOn.svg",
      collateralStatus: "On",
      tokenPrice: 2500,
    },
    {
      assetName: "kfUSD",
      assetImg: "/stable/kfUSD.png",
      balance: AVA4 ?? 0,
      marketValue: `$${(AVA4 ?? 0) * 1}`, // Stable
      netProfit: "0.00%",
      netProfitColor: "text-green-500",
      collateralImg: "/toggleOn.svg",
      collateralStatus: "On",
      tokenPrice: 1,
    },
    {
      assetName: "USDT",
      assetImg: "/usdt.svg",
      balance: AVA5 ?? 0,
      marketValue: `$${(AVA5 ?? 0) * 1}`, // Stable
      netProfit: "0.00%",
      netProfitColor: "text-green-500",
      collateralImg: "/toggleOn.svg",
      collateralStatus: "On",
      tokenPrice: 1,
    },
  ]

  // Filter out tokens with 0 balance
  const filteredBalanceData = balanceData.filter((item) => item.balance > 0)

  // If no tokens have a non-zero balance, return null or an alternative message
  if (filteredBalanceData.length === 0) {
    return (
      <div>
        <NoAssets />
      </div>
    )
  }

  if (!activeAccount || !address) {
    return (
      <div>
        <NoAssets />
      </div>
    )
  }

  return (
    <div id="balances-card" className="custom-corner-header w-full bg-black/40 backdrop-blur-md rounded-xl border border-[#00ff99]/10 py-4 transition-all hover:border-[#00ff99]/30">
      <div className="mb-1 px-6 text-xl">
        <h3>Collateral&apos;s Balance</h3>
      </div>

      {/* Summary Section */}
      <div className="mb-2 flex justify-between border-y border-[#00ff99]/30 p-1 text-xs text-white/50">
        <h4 className="p-1 sm:p-0">
          Total Bal: <span className="pl-1">{`$${formatWithCommas(collateralVal ? collateralVal : 0)}`}</span>
        </h4>
        <div className="p-1 text-right sm:p-0 sm:text-left">
          Max Withdrawal: <span className="pl-1"> {`$${formatWithCommas(availBal ? (Number(availBal) / 1e16) : 0)}`}</span>
        </div>
      </div>

      {/* Scrollable Table */}
      <div className="px-6 relative overflow-y-auto max-h-[220px] kaleido-scrollbar">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-center text-white/70">
              <th className="sticky top-0 py-2 font-medium bg-[#060606] z-20">Asset</th>
              <th className="sticky top-0 py-2 font-medium bg-[#060606] z-20">Balance</th>
              <th className="sticky top-0 py-2 font-medium bg-[#060606] z-20">Value</th>
              <th className="sticky top-0 py-2 font-medium hidden sm:table-cell bg-[#060606] z-20">Price</th>
              <th className="sticky top-0 py-2 font-medium bg-[#060606] z-20">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredBalanceData.map((item, index) => (
              <tr key={index} className="text-center text-xs sm:text-sm border-t border-white/5">
                {/* Asset */}
                <td className="flex flex-wrap items-center justify-center gap-2 pt-2">
                  <img src={item.assetImg} alt={item.assetName} className="h-6 w-6" />
                  <span>{item.assetName}</span>
                </td>
                {/* Balance */}
                <td className="pt-2">{formatWithCommas(item.balance, item.assetName === "ETH" ? 4 : 2)}</td>
                {/* Market Value */}
                <td className="pt-2">
                  {item.marketValue ? `$${formatWithCommas(item.marketValue.replace("$", ""))}` : "—"}
                </td>

                {/* Net Profit (Price) */}
                <td className={`pt-2 text-white hidden sm:table-cell`}>
                  {item.assetName === "ETH"
                    ? `$${formatWithCommas(etherPrice)}`
                    : ["USDC", "USDR", "kfUSD", "USDT"].includes(item.assetName)
                      ? `$${formatWithCommas(usdcPrice || 1)}`
                      : "$1.00"}
                </td>
                {/* Collateral Toggle (Hidden on mobile) */}
                {/* <td className="hidden pt-2 sm:table-cell">
                  <div className="flex justify-center">
                    <Image
                      src={item.collateralImg}
                      alt={`Collateral ${item.collateralStatus}`}
                      width={20}
                      height={8.5}
                      priority
                      quality={100}
                    />
                  </div>
                </td> */}
                {/* Deposit and Withdraw */}
                <td className="pt-2">
                  <div className="flex justify-center gap-2">
                    <button onClick={() => setShowDepositModal(true)}>
                      <Btn text="Deposit" />
                    </button>
                    <button onClick={() => setShowWithdrawModal(true)}>
                      <Btn text="Withdraw" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {/* Deposit Modal */}
      <DepositModal open={showDepositModal} onOpenChange={setShowDepositModal} action="deposit" />
      
      {/* Withdraw Modal */}
      <DepositModal open={showWithdrawModal} onOpenChange={setShowWithdrawModal} action="withdraw" />
    </div>
  )
}

export default Balance
