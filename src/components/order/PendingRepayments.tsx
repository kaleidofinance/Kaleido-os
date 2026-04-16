import { useState, useEffect, useMemo } from "react"
import Image from "next/image"
import { Btn } from "../shared/Btn"
import useGetActiveRequest from "@/hooks/useGetActiveRequest"
import { tokenImageMap } from "@/constants/utils/tokenImageMap"
import { ethers } from "ethers"
import useRepayLoan from "@/hooks/useRepayLoan"
import { ADDRESS_1, USDC_ADDRESS, USDR } from "@/constants/utils/addresses"
import type { BigNumberish } from "ethers"

const PendingRepayments = () => {
  const activeReq = useGetActiveRequest()
  const repay = useRepayLoan()

  // Filter requests with positive totalRepayment
  const filteredReq = useMemo(() => {
    if (!activeReq) return []
    return activeReq.filter((item) => {
      return !isNaN(parseFloat(item.totalRepayment)) && parseFloat(item.totalRepayment) > 0
    })
  }, [activeReq])

  const [countdowns, setCountdowns] = useState<string[]>([])
  const [totalPending, setTotalPending] = useState<number>(0)

  // Calculate countdown string from timestamp (seconds)
  const calculateCountdown = (timestamp: number) => {
    const now = Date.now()
    const returnDateMs = timestamp * 1000
    const timeLeft = returnDateMs - now

    if (timeLeft <= 0) return "Expired"

    const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24))
    const hours = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60))

    return `${days}d ${hours}h ${minutes}m`
  }

  // Update countdowns on filteredReq changes and every minute
  useEffect(() => {
    if (filteredReq.length === 0) {
      setCountdowns([])
      return
    }

    const updateCountdowns = () => {
      setCountdowns(filteredReq.map((item) => calculateCountdown(item.returnDate)))
    }

    updateCountdowns()
    const interval = setInterval(updateCountdowns, 60000)

    return () => clearInterval(interval)
  }, [filteredReq])

  // Calculate total pending repayment
  useEffect(() => {
    if (filteredReq.length === 0) {
      setTotalPending(0)
      return
    }

    const formmattedTotalRepayments = filteredReq.map((item) => {
      const decimals =
        item.tokenAddress === ADDRESS_1
          ? 18
          : item.tokenAddress === USDC_ADDRESS
            ? 6
            : item.tokenAddress === USDR
              ? 6
              : 6
      const rawValue = ethers.parseUnits(item.totalRepayment.toString(), decimals)
      return ethers.formatUnits(rawValue, decimals)
    })

    const total = formmattedTotalRepayments.reduce((acc, val) => acc + parseFloat(val), 0)
    setTotalPending(total)
  }, [filteredReq])

  if (filteredReq.length === 0 || totalPending === 0) {
    return (
      <div className="u-class-shadow w-full bg-black px-4 py-6 font-[family-name:var(--font-outfit)] sm:px-6">
        <h3 className="text-xl font-medium text-[#F6F6F6]">No Pending Repayments</h3>
      </div>
    )
  }

  return (
    <div className="u-class-shadow w-full bg-black px-4 py-6 font-[family-name:var(--font-outfit)] sm:px-6">
      <div className="flex items-center justify-between pb-4">
        <h3 className="text-xl font-medium text-[#F6F6F6]"></h3>
        <div className="text-lg font-semibold text-[#F6F6F6]">
          Total: {totalPending.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
        </div>
        <Image src="/Hhourglass.svg" alt="Hourglass" width={24} height={24} priority quality={100} />
      </div>

      <div className="space-y-4 sm:space-y-6">
        {filteredReq.map((item, index) => {
          const tokenData = tokenImageMap[item.tokenAddress] || { image: "/defaultToken.svg", label: "Unknown" }
          const countdown = countdowns[index] || "Calculating..."
          const decimals = item.tokenAddress === ADDRESS_1 ? 18 : 6

          let formattedAmount = item.totalRepayment
          try {
            formattedAmount = ethers.formatUnits(item.totalRepayment, decimals)
          } catch {
            // fallback to raw string if formatting fails
          }

          const handleRepayClick = () => {
            const repaymentValue =
              tokenData.label === "ETH"
                ? ethers.parseEther(item.totalRepayment.toString()).toString()
                : tokenData.label === "USDR"
                  ? (Number(item.totalRepayment) * 1e6).toString()
                  : tokenData.label === "USDC"
                    ? (Number(item.totalRepayment) * 1e6).toString()
                    : ""
            repay(item.requestId, item.tokenAddress, repaymentValue)
          }

          return (
            <div
              key={index}
              className="flex max-h-80 flex-col items-center justify-between gap-4 overflow-auto rounded-lg bg-[#1f1f1f] p-3 sm:flex-row"
            >
              {/* Asset Name with Token Image */}
              <div className="flex w-full items-center gap-2 text-base font-normal text-[#C5C4C7] sm:w-2/5">
                <Image src={tokenData.image} alt={tokenData.label} width={24} height={24} />
                <span>{tokenData.label}</span>
              </div>

              {/* Repay Button */}
              <div onClick={handleRepayClick} className="w-full cursor-pointer font-normal sm:w-1/5">
                <Btn text="Repay" css="text-black bg-[#D8EE10] text-sm px-3 py-1" />
              </div>

              {/* Days Remaining */}
              <div className="w-full text-center text-sm font-medium text-[#F6F6F6] sm:w-1/5">{countdown}</div>

              {/* Balance */}
              <div className="w-full text-right text-sm font-medium text-[#F6F6F6] sm:w-1/5">
                {Number(formattedAmount).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 6,
                })}{" "}
                {tokenData.label}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default PendingRepayments
