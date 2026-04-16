"use client"
import { CircularProgressbar, buildStyles } from "react-circular-progressbar"
import "react-circular-progressbar/dist/styles.css"
import { useRouter } from "next/navigation"
import { Request } from "@/constants/types"
import { tokenImageMap } from "@/constants/utils/tokenImageMap"
import { ethers } from "ethers"
import useRepayLoan from "@/hooks/useRepayLoan"
import { Btn2 } from "../shared/Btn2"
import { getKaleidoContract } from "@/config/contracts"
import { readOnlyProvider } from "@/config/provider"
import { useState, useEffect } from "react"
import { ADDRESS_1 } from "@/constants/utils/addresses"
import { convertbasisPointsToPercentage } from "@/constants/utils/FormatInterestRate"
import { getTokenDecimals } from "@/constants/utils/formatTokenDecimals"
import MyOrdersModal from "../modals/MyOrdersModal"
import CreateOrderModal from "../modals/CreateOrderModal"
import { formatWithCommas } from "@/constants/utils/formatNumber"

interface UsageProps {
  activeReq: Request[] | null
  collateralVal: any
}

const Usage = ({ activeReq, collateralVal }: UsageProps) => {
  const router = useRouter()
  const repay = useRepayLoan()
  const contract = getKaleidoContract(readOnlyProvider)
  const [totalBorrowed, setTotalBorrowed] = useState(0)
  const [isOrdersModalOpen, setIsOrdersModalOpen] = useState(false)
  const [isCreateOrderModalOpen, setIsCreateOrderModalOpen] = useState(false)

  // Filter out requests with totalRepayment of 0
  const filteredReq = activeReq?.filter((req) => Number(req.totalRepayment) > 0) || []

  // Calculate total borrowed from filtered requests
  const calculateTotalBorrowed = async () => {
    if (activeReq && filteredReq.length) {
      const values = await Promise.all(
        filteredReq.map(async (req) => {
          // console.log("the totalrepayment", req.totalRepayment)
          const usdValue = await contract.getUsdValue(req.tokenAddress, 1, 0)
          const formattedRepayment = Number(ethers.formatUnits(req.totalRepayment, getTokenDecimals(req.tokenAddress)))
          return Number(usdValue) * formattedRepayment
        }),
      )
      const total = values.reduce((acc, value) => Number(acc) + Number(value), 0)
      setTotalBorrowed(total / 1e16)
    }
  }

  useEffect(() => {
    calculateTotalBorrowed()
  }, [filteredReq, activeReq])
  // console.log("The total borrowed", totalBorrowed)
  const powerLeft = collateralVal ? 100 - (totalBorrowed * 100) / (collateralVal * 0.8) : 0
  const actualPower = isNaN(powerLeft) ? 0 : powerLeft

  return (
    <div id="usage-card" className="w-full rounded-xl border border-[#00ff99]/30 bg-black/40 backdrop-blur-md py-6 transition-all hover:border-[#00ff99]/40">
      <div className="mb-1 px-6 text-xl">
        <h3>Your Usage</h3>
      </div>
      <div className="mb-6 flex items-center justify-between border-y border-[#00ff99]/30 p-1 text-xs text-white/50">
        <h4 className="p-1">
          Total Collateral: <span className="pl-1">{`$${formatWithCommas(collateralVal ? collateralVal : 0)}`}</span>
        </h4>
        <h4 className="p-1">
          Total Borrowed: <span className="pl-1">{`$${formatWithCommas(totalBorrowed)}`}</span>
        </h4>
      </div>

      <div className="relative mb-4 flex flex-col items-center">
        <div className="w-48 h-48 sm:w-64 sm:h-64">
          <CircularProgressbar
            value={actualPower}
            circleRatio={4.7 / 5}
            counterClockwise
            styles={buildStyles({
              pathColor: `#00ff99`,
              trailColor: "rgba(255, 255, 255, 0.4)",
            })}
          />
        </div>

        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <div className="flex items-center rounded-xl border border-[#00ff99]/50 bg-black/60 backdrop-blur-sm px-4 py-2 text-xl text-[#00ff99] font-bold shadow-[0_0_15px_rgba(0,255,153,0.2)]">
            <span className="m-auto pr-[2px]"></span>
            {actualPower.toFixed(2)}%
          </div>
          <p className="text-xs sm:text-sm font-medium text-white shadow-black drop-shadow-md">Borrow Power Left</p>
        </div>
      </div>

      {totalBorrowed > 0 && (
        <div className="mb-2 px-4">
          <div className="max-h-40 overflow-auto">
            <table className="min-w-full text-center text-xs sm:text-sm">
              <thead></thead>
              <tbody>
                {filteredReq.map((item, index) => {
                  const tokenData = tokenImageMap[item.tokenAddress] || { image: "/Eye.svg", label: "None" }

                  return (
                    <tr key={index} className="text-white/50">
                      <td className="flex items-center gap-1 pt-3 text-start text-white">
                        <img src={tokenData.image} alt={tokenData.label} className="w-4 sm:w-5" />
                        <span>{tokenData.label}</span>
                      </td>
                      <td className="pt-2">
                        {" "}
                        {formatWithCommas(ethers.formatUnits(item.amount, getTokenDecimals(item.tokenAddress)), 3)}
                      </td>

                      <td className="pt-2">
                        {" "}
                        {formatWithCommas(ethers.formatUnits(item.totalRepayment, getTokenDecimals(item.tokenAddress)), 3)}
                      </td>
                      <td className="pt-2">{convertbasisPointsToPercentage(item.interest)}%</td>
                      <td className="flex justify-center pt-2">
                        <Btn2
                          text="Repay"
                          css="text-white/90 text-center bg-[#2a2a2a] px-2 py-1 rounded-md text-xs sm:text-sm"
                          onClick={() => {
                            const repaymentValue = ethers.parseUnits(
                                item.totalRepayment.toString(),
                                getTokenDecimals(item.tokenAddress)
                              ).toString()

                            // console.log("The items:", item.totalRepayment)

                            repay(item.requestId, item.tokenAddress, repaymentValue)
                          }}

                          // onClick={() => {
                          //   const decimals = tokenData.label === "ETH" ? 18 :  6;
 
                          //   // Assuming item.totalRepayment needs to be a large value like 29.7 USDC
                          //   const repaymentValue = Number(item.totalRepayment);  // Your decimal value like 0.00000000002970885
 
                          //   let repaymentInSmallestUnit;
 
                          //   if (tokenData.label === "ETH") {
                          //     // For ETH, use parseEther
                          //     repaymentInSmallestUnit = ethers.parseEther(repaymentValue.toString()).toString();
                          //   } else {
                          //     // For USDC or other ERC-20, use parseUnits with correct decimals
                          //     repaymentInSmallestUnit = ethers.parseUnits(repaymentValue.toString(), decimals).toString();
                          //   }
 
                          //   console.log("Repayment value in smallest units:", repaymentInSmallestUnit);
 
                          //   repay(item.requestId, item.tokenAddress, repaymentInSmallestUnit);
                          // }}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="m-auto mt-5 w-4/6 px-6 space-y-3">
        <button 
          onClick={() => setIsOrdersModalOpen(true)} 
          className="w-full rounded-xl bg-[#19aa61] py-3 text-sm font-normal hover:scale-105"
        >
          My Orders
        </button>
        <button 
          onClick={() => setIsCreateOrderModalOpen(true)} 
          className="w-full rounded-xl bg-[#2a2a2a] py-2 text-sm font-normal hover:scale-105"
        >
          Create Order
        </button>
      </div>

      {/* My Orders Modal */}
      <MyOrdersModal 
        isOpen={isOrdersModalOpen} 
        onClose={() => setIsOrdersModalOpen(false)}
        onCreateOrder={() => {
          setIsOrdersModalOpen(false)
          setIsCreateOrderModalOpen(true)
        }}
      />

      {/* Create Order Modal */}
      <CreateOrderModal 
        isOpen={isCreateOrderModalOpen} 
        onClose={() => setIsCreateOrderModalOpen(false)} 
      />
    </div>
  )
}

export default Usage
