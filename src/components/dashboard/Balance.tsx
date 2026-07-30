"use client";

import Image from "next/image";
import { Btn } from "../shared/Btn";
import useGetValueAndHealth from "@/hooks/useGetValueAndHealth";
import NoAssets from "./NoAssets";
import { ethers } from "ethers";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";
import { useState, useEffect } from "react";
import DepositModal from "@/components/shared/DepositModal";
import { formatWithCommas } from "@/constants/utils/formatNumber";

const Balance = () => {
  const [mounted, setMounted] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const activeAccount = useActiveAccount();
  const address = activeAccount?.address;

  useEffect(() => {
    setMounted(true);
  }, []);

  const {
    etherPrice,
    usdcPrice,
    data3,
    data4,
    data5,
    AVA4,
    AVA5,
    collateralVal,
    availBal,
  } = useGetValueAndHealth();

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
  ];

  // Filter out tokens with 0 balance
  const filteredBalanceData = balanceData.filter((item) => item.balance > 0);

  // If no tokens have a non-zero balance, return null or an alternative message
  if (filteredBalanceData.length === 0) {
    return (
      <div>
        <NoAssets />
      </div>
    );
  }

  if (!activeAccount || !address) {
    return (
      <div>
        <NoAssets />
      </div>
    );
  }

  return (
    <div
      id="balances-card"
      className="custom-corner-header w-full min-w-0 overflow-hidden rounded-xl border border-edge bg-surface py-4 transition-colors hover:border-edge-strong"
    >
      <div className="mb-3 px-4 sm:px-6">
        <h3 className="text-[11px] uppercase tracking-[0.1em] text-content-muted">
          Deposited collateral
        </h3>
      </div>

      {/* Summary Section */}
      <div className="mb-2 flex flex-col gap-1 border-y border-edge px-4 py-2 text-xs sm:flex-row sm:justify-between sm:px-6">
        <h4 className="text-content-muted">
          Total
          <span className="pl-2 font-mono tabular-nums text-content">{`$${formatWithCommas(collateralVal ? collateralVal : 0)}`}</span>
        </h4>
        <div className="text-content-muted">
          Max withdrawal
          <span className="pl-2 font-mono tabular-nums text-content">
            {`$${formatWithCommas(availBal ? Number(availBal) / 1e16 : 0)}`}
          </span>
        </div>
      </div>

      {/* Scrollable Table */}
      <div className="kaleido-scrollbar relative max-h-[220px] overflow-x-auto overflow-y-auto px-3 sm:px-6">
        <table className="min-w-[520px] text-sm sm:min-w-full">
          <thead>
            <tr>
              <th className="sticky top-0 z-20 bg-surface py-2 text-left text-[10px] font-medium uppercase tracking-[0.1em] text-content-muted">
                Asset
              </th>
              <th className="sticky top-0 z-20 bg-surface py-2 text-right text-[10px] font-medium uppercase tracking-[0.1em] text-content-muted">
                Balance
              </th>
              <th className="sticky top-0 z-20 bg-surface py-2 text-right text-[10px] font-medium uppercase tracking-[0.1em] text-content-muted">
                Value
              </th>
              <th className="sticky top-0 z-20 hidden bg-surface py-2 text-right text-[10px] font-medium uppercase tracking-[0.1em] text-content-muted sm:table-cell">
                Price
              </th>
              <th className="sticky top-0 z-20 bg-surface py-2 text-right text-[10px] font-medium uppercase tracking-[0.1em] text-content-muted">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredBalanceData.map((item, index) => (
              <tr
                key={index}
                className="border-t border-edge text-xs sm:text-sm"
              >
                {/* Asset */}
                <td className="py-2.5">
                  <div className="flex items-center gap-2">
                    <img
                      src={item.assetImg}
                      alt=""
                      className="h-6 w-6 shrink-0 rounded-full"
                    />
                    <span className="text-content">{item.assetName}</span>
                  </div>
                </td>
                {/* Balance */}
                <td className="py-2.5 text-right font-mono tabular-nums text-content">
                  {formatWithCommas(
                    item.balance,
                    item.assetName === "ETH" ? 4 : 2,
                  )}
                </td>
                {/* Market Value */}
                <td className="py-2.5 text-right font-mono tabular-nums text-content">
                  {item.marketValue
                    ? `$${formatWithCommas(item.marketValue.replace("$", ""))}`
                    : "—"}
                </td>

                {/* Unit price */}
                <td className="hidden py-2.5 text-right font-mono tabular-nums text-content-secondary sm:table-cell">
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
                <td className="py-2.5">
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setShowDepositModal(true)}
                      aria-label={`Deposit ${item.assetName}`}
                    >
                      <Btn text="Deposit" />
                    </button>
                    <button
                      onClick={() => setShowWithdrawModal(true)}
                      aria-label={`Withdraw ${item.assetName}`}
                    >
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

export default Balance;
