"use client"
import PleaseConnect from "@/components/shared/PleaseConnect"
import React, { useEffect, useState } from "react"
import { Spinner } from "@radix-ui/themes"
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react"
import useClaimToken from "@/hooks/useClaimToken"
import { getKLDBalance, getstKLDBalance } from "@/constants/utils/getEthBalance"
import useGetValueAndHealth from "@/hooks/useGetValueAndHealth"
import { TimerIcon } from "@radix-ui/react-icons"
import useStake from "@/hooks/useStake"
import useWithdrawStake from "@/hooks/useWithdrawStake"
import useRequestWithdrawal from "@/hooks/useRequestWithdrawal"
import useCancelWithdrawal from "@/hooks/useCancelWithdrawalRequest"
import Link from "next/link"
import StakeHeader from "@/components/stake/StakeHeader"
import { Vault_ADDRESS } from "@/constants/utils/addresses"

const StakeBoard = () => {
  const [isClient, setIsClient] = useState(false)
  const activeAccount = useActiveAccount()
  const address = activeAccount?.address
  const activeChain = useActiveWalletChain()
  const chainId = activeChain?.id
  const { claimToken } = useClaimToken()
  const [stakeAmount, setStakeAmount] = useState<string>("0")
  const [withdrawAmount, setWithdrawAmount] = useState<string>("0")
  const [kldbal, setKldBal] = useState<string>("")
  const [stkldbal, setstKldBal] = useState<string>("")
  const { totalStakers, totalPooledKLD, userKldDeposit, totalShares, timeLeft } = useGetValueAndHealth()
  const { Stake, txStakeStatus } = useStake()
  const { WithdrawStake, txStatus } = useWithdrawStake()
  const { requestWithdrawal, withdrawalRequestStatus } = useRequestWithdrawal()
  const { cancelWithdrawalRequest, cancelWithdrawalRequestStatus } = useCancelWithdrawal()
  const [activeTab, setActiveTab] = useState<"stake" | "withdraw">("stake")

  function formatTime(seconds: any) {
    if (seconds <= 0) return "0"
    const days = Math.floor(Number(seconds) / 86400)
    const hrs = Math.floor((Number(seconds) % 86400) / 3600)
    const mins = Math.floor((Number(seconds) % 3600) / 60)
    return `${days}d ${hrs}h ${mins}m`
  }

  useEffect(() => {
    setIsClient(true)
  }, [])

  useEffect(() => {
    const fetchUserKLDBalance = async () => {
      if (address) {
        try {
          const kldbalance = await getKLDBalance(address)
          setKldBal(kldbalance)
        } catch (error) {
          // console.error("Failed to fetch KLD balance:", error)
          setKldBal("0")
        }
      }
    }
    fetchUserKLDBalance()
  }, [address])

  useEffect(() => {
    const fetchUserstKLDBalance = async () => {
      if (address) {
        try {
          const stkldbalance: any = await getstKLDBalance(address)
          setstKldBal(stkldbalance)
        } catch (error) {
          // console.error("Failed to fetch KLD balance:", error)
          setstKldBal("0")
        }
      }
    }
    fetchUserstKLDBalance()
  }, [address])

  const value = (Number(stakeAmount) * Number(totalShares)) / Number(totalPooledKLD)
  const formattedValue = value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const displayValue = formattedValue.length > 15 ? formattedValue.slice(0, 15) + "..." : formattedValue

  if (!isClient) {
    return (
      <div className="my-64 flex justify-center text-[#00ff6e]">
        <Spinner size={"3"} />
      </div>
    )
  }


  return (
    <div className="flex h-full flex-col items-center justify-center space-y-9 px-4 py-4">
      {/* <div className="flex justify-center space-x-9 sm:flex-col md:flex-row"> */}
      {/* Tabs */}
      <div className="mb-4 flex space-x-4">
        <button
          onClick={() => setActiveTab("stake")}
          className={`rounded-t-lg border-b-2 px-6 py-2 text-[20px] ${
            activeTab === "stake" ? "border-[#00ff6e] text-[#00ff6e]" : "border-transparent text-gray-400"
          }`}
        >
          Stake
        </button>
        <button
          onClick={() => setActiveTab("withdraw")}
          className={`rounded-t-lg border-b-2 px-6 py-2 text-[20px] ${
            activeTab === "withdraw" ? "border-[#00ff6e] text-[#00ff6e]" : "border-transparent text-gray-400"
          }`}
        >
          Withdraw
        </button>
      </div>

      <div className="w-full max-w-xl rounded-xl border border-[#00ff6e]/30 bg-[#0a0a0a] bg-opacity-75 p-8">
        {activeTab === "stake" ? (
          <>
            <h2 className="mb-6 text-3xl font-extrabold text-white">Stake Your Token</h2>

            <div className="mb-2 flex items-center justify-between font-mono text-[#b3ffcc]">
              <span>$KLD Balance: {Number(kldbal).toFixed(3)}</span>
              <button
                onClick={() => setStakeAmount(kldbal)}
                className="font-semibold text-[#FF4D00] transition hover:text-[#FF4D00]"
                aria-label="Max amount"
              >
                Max
              </button>
            </div>

            <input
              type="number"
              min="0"
              step="any"
              placeholder="Amount to stake"
              value={stakeAmount}
              onChange={(e) => setStakeAmount(e.target.value)}
              className="mb-4 w-full rounded-md border-2 border-[#00ff6e]/30 bg-[#0a0a0a] p-3 text-white transition focus:outline-none focus:ring-2 focus:ring-[#FF4D00]"
              aria-label="Amount to stake"
            />

            <button
              onClick={activeAccount ? () => Stake(stakeAmount) : () => {}}
              disabled={txStakeStatus || !activeAccount}
              className="mb-4 w-full rounded-md bg-gradient-to-r from-[#FF4D00] to-[#ff7a33] py-3 font-semibold text-black transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              {activeAccount ? "Stake Now" : "Connect Wallet"}
            </button>

            <div className="mb-4 flex items-center space-x-2 text-sm text-white">
              <TimerIcon className="text-[#00ff6e]" />
              <span>
                Estimated Rewards:{" "}
                <strong className="text-[#00ff6e]">
                  {((Number(totalPooledKLD) * 0.02) / 365).toFixed(4)} $KLD/day
                </strong>
              </span>
            </div>

            <Link
              href={`https://sepolia.abscan.org/address/${Vault_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <button className="w-full rounded-md border border-[#FF4D00] bg-transparent py-2 text-[#FF4D00] transition hover:bg-[#FF4D0022]">
                View Staking Contract
              </button>
            </Link>

            <p className="mt-2 text-sm text-gray-400">Tip: Only interact with the official Staking contract</p>

            <div className="mt-6 text-center text-lg font-bold text-[#fff]">Exchange Rate: 1 KLD = 1stKLD</div>
          </>
        ) : (
          <>
            <h2 className="mb-6 text-3xl font-extrabold text-white">Withdraw Your Token</h2>

            <div className="mb-2 flex items-center justify-between font-mono text-[#b3ffcc]">
              <span>Your $stKLD Balance: {Number(stkldbal).toFixed(3)}</span>
              <button
                onClick={() => setWithdrawAmount(stkldbal)}
                className="font-semibold text-[#FF4D00] transition hover:text-[#ff7a33]"
                aria-label="Max amount"
              >
                Max
              </button>
            </div>

            <input
              type="number"
              min="0"
              step="any"
              placeholder="Amount to withdraw"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              className="mb-4 w-full rounded-md border-2 border-[#00ff6e]/30 bg-[#0a0a0a] p-3 text-white transition focus:outline-none focus:ring-2 focus:ring-[#FF4D00]"
              aria-label="Amount to withdraw"
            />

            <button
              onClick={activeAccount ? () => WithdrawStake(withdrawAmount) : () => {}}
              disabled={txStatus || !activeAccount}
              className="mb-4 w-full rounded-md bg-gradient-to-r from-[#FF4D00] to-[#ff7a33] py-3 font-semibold text-black transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              {activeAccount ? "Withdraw Now" : "Connect Wallet"}
            </button>

            <div className="flex flex-col space-y-5">
              <button
                onClick={activeAccount ? () => requestWithdrawal(withdrawAmount) : () => {}}
                disabled={withdrawalRequestStatus || !activeAccount}
                className="w-full rounded-md border border-[#FF4D00] bg-transparent py-2 text-[#FF4D00] transition hover:bg-[#FF4D0022] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {activeAccount ? "Request Withdrawal" : "Connect Wallet"}
              </button>

              <button
                onClick={activeAccount ? cancelWithdrawalRequest : () => {}}
                disabled={cancelWithdrawalRequestStatus || !activeAccount}
                className="w-full rounded-md border border-[#FF4D00] bg-transparent py-2 text-[#FF4D00] transition hover:bg-[#FF4D0022] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {activeAccount ? "Cancel Request" : "Connect Wallet"}
              </button>
            </div>
            <span className="mt-5 flex items-center space-x-2 text-sm text-white">
              <svg
                className="h-4 w-4 text-[#00ff6e]"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M12 8v4l3 3"></path>
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none"></circle>
              </svg>
              <span>
                Waiting Period: <strong className="text-[#00ff6e]">14 days</strong>
              </span>
            </span>

            <div className="text-muted-foreground flex items-center space-x-2 text-sm">
              <TimerIcon className="h-4 w-4 text-[#00ff6e]" />
              <span>
                Withdrawal available in: <strong className="text-[#00ff6e]">{formatTime(timeLeft)}</strong>
              </span>
            </div>
          </>
        )}
      </div>

    </div>
  )
}

export default StakeBoard
