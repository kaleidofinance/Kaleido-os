"use client";

import Image from "next/image";
import { Btn } from "../shared/Btn";
import { useState } from "react";
import DepositModal from "@/components/shared/DepositModal";

const NoAssets = () => {
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);

  return (
    <div className="custom-corner-header w-full min-w-0 overflow-hidden bg-black/40 backdrop-blur-md rounded-xl border border-[#00ff99]/10 py-5 transition-all hover:border-[#00ff99]/30 sm:py-6">
      <div className="mb-1 px-4 text-lg sm:px-6 sm:text-xl">
        <h3>Collateral&apos;s Balance</h3>
      </div>

      {/* Summary Section */}
      <div className="mb-2 flex flex-col gap-1 border-y border-[#00ff99]/30 p-2 text-xs text-white/50 sm:flex-row sm:justify-between sm:p-1">
        <h4 className="p-1 sm:p-0">
          Total Bal: <span className="pl-1">{`N/A`}</span>
        </h4>

        <div className="p-1 text-right sm:p-0 sm:text-left">
          Max Withdrawal: <span className="pl-1">{`N/A`}</span>
        </div>
      </div>

      {/* Scrollable Table for mobile */}
      <div className="overflow-x-auto px-3 text-white sm:px-4">
        <table className="min-w-[420px] text-[12px] sm:min-w-full">
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
                  <Image
                    src={"/toggleOff.svg"}
                    alt={`Collateral`}
                    width={20}
                    height={8.5}
                    priority
                    quality={100}
                  />
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
      <DepositModal
        open={showDepositModal}
        onOpenChange={setShowDepositModal}
        action="deposit"
      />

      {/* Withdraw Modal */}
      <DepositModal
        open={showWithdrawModal}
        onOpenChange={setShowWithdrawModal}
        action="withdraw"
      />
    </div>
  );
};

export default NoAssets;
