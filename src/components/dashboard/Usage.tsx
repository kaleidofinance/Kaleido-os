"use client";
import { CircularProgressbar, buildStyles } from "react-circular-progressbar";
import "react-circular-progressbar/dist/styles.css";
import { useRouter } from "next/navigation";
import { Request } from "@/constants/types";
import { tokenImageMap } from "@/constants/utils/tokenImageMap";
import { ethers } from "ethers";
import useRepayLoan from "@/hooks/useRepayLoan";
import { Btn2 } from "../shared/Btn2";
import { getKaleidoContract } from "@/config/contracts";
import { readOnlyProvider } from "@/config/provider";
import { useState, useEffect } from "react";
import { ADDRESS_1 } from "@/constants/utils/addresses";
import { convertbasisPointsToPercentage } from "@/constants/utils/FormatInterestRate";
import { getTokenDecimals } from "@/constants/utils/formatTokenDecimals";
import MyOrdersModal from "../modals/MyOrdersModal";
import CreateOrderModal from "../modals/CreateOrderModal";
import { formatWithCommas } from "@/constants/utils/formatNumber";

interface UsageProps {
  activeReq: Request[] | null;
  collateralVal: any;
}

const Usage = ({ activeReq, collateralVal }: UsageProps) => {
  const router = useRouter();
  const repay = useRepayLoan();
  const contract = getKaleidoContract(readOnlyProvider);
  const [totalBorrowed, setTotalBorrowed] = useState(0);
  const [isOrdersModalOpen, setIsOrdersModalOpen] = useState(false);
  const [isCreateOrderModalOpen, setIsCreateOrderModalOpen] = useState(false);

  // Filter out requests with totalRepayment of 0
  const filteredReq =
    activeReq?.filter((req) => Number(req.totalRepayment) > 0) || [];

  // Calculate total borrowed from filtered requests
  const calculateTotalBorrowed = async () => {
    if (activeReq && filteredReq.length) {
      const values = await Promise.all(
        filteredReq.map(async (req) => {
          // console.log("the totalrepayment", req.totalRepayment)
          const usdValue = await contract.getUsdValue(req.tokenAddress, 1, 0);
          const formattedRepayment = Number(
            ethers.formatUnits(
              req.totalRepayment,
              getTokenDecimals(req.tokenAddress),
            ),
          );
          return Number(usdValue) * formattedRepayment;
        }),
      );
      const total = values.reduce(
        (acc, value) => Number(acc) + Number(value),
        0,
      );
      setTotalBorrowed(total / 1e16);
    }
  };

  useEffect(() => {
    calculateTotalBorrowed();
  }, [filteredReq, activeReq]);
  // console.log("The total borrowed", totalBorrowed)
  const powerLeft = collateralVal
    ? 100 - (totalBorrowed * 100) / (collateralVal * 0.8)
    : 0;
  const actualPower = isNaN(powerLeft) ? 0 : powerLeft;

  // The gauge has to carry risk, not just a number. Previously it rendered the
  // same green at 5% as at 95%, so the one element meant to warn you never did.
  const powerToken =
    actualPower >= 50
      ? "var(--positive)"
      : actualPower >= 20
        ? "var(--warning)"
        : "var(--negative)";

  return (
    <div
      id="usage-card"
      className="w-full min-w-0 overflow-hidden rounded-xl border border-edge bg-surface py-5 transition-colors hover:border-edge-strong sm:py-6"
    >
      <div className="mb-3 px-4 sm:px-6">
        <h3 className="text-[11px] uppercase tracking-[0.1em] text-content-muted">
          Borrowing
        </h3>
      </div>
      <div className="mb-6 flex flex-col gap-1 border-y border-edge px-4 py-2 text-xs sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <h4 className="text-content-muted">
          Collateral
          <span className="pl-2 font-mono tabular-nums text-content">{`$${formatWithCommas(collateralVal ? collateralVal : 0)}`}</span>
        </h4>
        <h4 className="text-content-muted">
          Borrowed
          <span className="pl-2 font-mono tabular-nums text-content">{`$${formatWithCommas(totalBorrowed)}`}</span>
        </h4>
      </div>

      <div className="relative mb-4 flex flex-col items-center">
        <div className="h-44 w-44 sm:h-64 sm:w-64">
          <CircularProgressbar
            value={actualPower}
            circleRatio={4.7 / 5}
            counterClockwise
            styles={buildStyles({
              pathColor: powerToken,
              trailColor: "var(--border-subtle)",
            })}
          />
        </div>

        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <div
            className="font-mono text-3xl tabular-nums tracking-tight"
            style={{ color: powerToken }}
          >
            {actualPower.toFixed(1)}%
          </div>
          <p className="text-[11px] uppercase tracking-[0.08em] text-content-muted">
            Borrow power left
          </p>
        </div>
      </div>

      {totalBorrowed > 0 && (
        <div className="mb-2 px-4">
          <div className="max-h-40 overflow-auto">
            <table className="min-w-full text-xs sm:text-sm">
              <thead>
                <tr>
                  <th className="sticky top-0 z-20 bg-surface py-2 text-left text-[10px] font-medium uppercase tracking-[0.1em] text-content-muted">
                    Loan
                  </th>
                  <th className="sticky top-0 z-20 bg-surface py-2 text-right text-[10px] font-medium uppercase tracking-[0.1em] text-content-muted">
                    Borrowed
                  </th>
                  <th className="sticky top-0 z-20 bg-surface py-2 text-right text-[10px] font-medium uppercase tracking-[0.1em] text-content-muted">
                    Owed
                  </th>
                  <th className="sticky top-0 z-20 bg-surface py-2 text-right text-[10px] font-medium uppercase tracking-[0.1em] text-content-muted">
                    Rate
                  </th>
                  <th className="sticky top-0 z-20 bg-surface py-2 text-right text-[10px] font-medium uppercase tracking-[0.1em] text-content-muted">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredReq.map((item, index) => {
                  const tokenData = tokenImageMap[item.tokenAddress] || {
                    image: "/Eye.svg",
                    label: "None",
                  };

                  return (
                    <tr key={index} className="border-t border-edge">
                      <td className="py-2.5 text-start">
                        <div className="flex items-center gap-2">
                          <img
                            src={tokenData.image}
                            alt=""
                            className="w-4 shrink-0 rounded-full sm:w-5"
                          />
                          <span className="text-content">
                            {tokenData.label}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 text-right font-mono tabular-nums text-content-secondary">
                        {formatWithCommas(
                          ethers.formatUnits(
                            item.amount,
                            getTokenDecimals(item.tokenAddress),
                          ),
                          3,
                        )}
                      </td>

                      <td className="py-2.5 text-right font-mono tabular-nums text-content">
                        {formatWithCommas(
                          ethers.formatUnits(
                            item.totalRepayment,
                            getTokenDecimals(item.tokenAddress),
                          ),
                          3,
                        )}
                      </td>
                      <td className="py-2.5 text-right font-mono tabular-nums text-content-secondary">
                        {convertbasisPointsToPercentage(item.interest)}%
                      </td>
                      <td className="py-2.5">
                        <div className="flex justify-end">
                        <Btn2
                          text="Repay"
                          css="rounded-md border border-edge bg-surface-raised px-2.5 py-1 text-xs text-content-secondary transition-colors hover:border-edge-strong hover:text-content sm:text-sm"
                          onClick={() => {
                            const repaymentValue = ethers
                              .parseUnits(
                                item.totalRepayment.toString(),
                                getTokenDecimals(item.tokenAddress),
                              )
                              .toString();

                            // console.log("The items:", item.totalRepayment)

                            repay(
                              item.requestId,
                              item.tokenAddress,
                              repaymentValue,
                            );
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
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="m-auto mt-5 w-full max-w-xs space-y-3 px-4 sm:w-4/6 sm:px-6">
        <button
          onClick={() => setIsCreateOrderModalOpen(true)}
          className="w-full rounded-xl bg-accent py-2.5 text-sm font-semibold text-content-onAccent transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Create order
        </button>
        <button
          onClick={() => setIsOrdersModalOpen(true)}
          className="w-full rounded-xl border border-edge bg-surface-raised py-2.5 text-sm text-content-secondary transition-colors hover:border-edge-strong hover:text-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          My orders
        </button>
      </div>

      {/* My Orders Modal */}
      <MyOrdersModal
        isOpen={isOrdersModalOpen}
        onClose={() => setIsOrdersModalOpen(false)}
        onCreateOrder={() => {
          setIsOrdersModalOpen(false);
          setIsCreateOrderModalOpen(true);
        }}
      />

      {/* Create Order Modal */}
      <CreateOrderModal
        isOpen={isCreateOrderModalOpen}
        onClose={() => setIsCreateOrderModalOpen(false)}
      />
    </div>
  );
};

export default Usage;
