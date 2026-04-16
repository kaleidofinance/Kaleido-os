"use client"

import Image from "next/image"
import { Btn } from "../shared/Btn"
import { useState } from "react"
import DepositModal from "@/components/shared/DepositModal"

const NoAssets = () => {
  const [showDepositModal, setShowDepositModal] = useState(false)
  const [showWithdrawModal, setShowWithdrawModal] = useState(false)

  return (
    <div className="custom-corner-header w-full bg-black/40 backdrop-blur-md rounded-xl border border-[#00ff99]/10 py-6 transition-all hover:border-[#00ff99]/30">
      <div className="mb-1 px-6 text-xl">
        <h3>Collateral&apos;s Balance</h3>
      </div>

      {/* Summary Section */}
      <div className="mb-2 flex justify-between border-y border-[#00ff99]/30 p-1 text-xs text-white/50">
        <h4 className="p-1 sm:p-0">
          Total Bal: <span className="pl-1">{`N/A`}</span>
        </h4>

        <div className="p-1 text-right sm:p-0 sm:text-left">
          Max Withdrawal: <span className="pl-1">{`N/A`}</span>
        </div>
      </div>

      {/* Scrollable Table for mobile */}
      <div className="overflow-x-auto px-4 text-white">
        <table className="min-w-full text-[12px]">
          <thead>
            <tr className="text-center">
              <th className="py-2">Asset</th>
              <th className="py-2">Balance</th>
              <th className="py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr className="text-center text-[10px] sm:text-[12px]">
              <td className="pt-2">No assets available</td>
              <td className="table-cell pt-2">
                <div className="flex justify-center">
                  <Image src={"/toggleOff.svg"} alt={`Collateral`} width={20} height={8.5} priority quality={100} />
                </div>
              </td>
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

export default NoAssets
