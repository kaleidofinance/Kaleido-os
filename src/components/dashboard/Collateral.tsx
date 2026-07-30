"use client";

import Image from "next/image";
import { Btn } from "../shared/Btn";
import { tokenData2 } from "@/constants/utils/tokenData2";
import { useEffect, useState } from "react";
import { getEthBalance } from "@/constants/utils/getEthBalance";

import { toast } from "sonner";
import { isSupportedChain } from "@/config/chain";
import {
  fetchOmniAssetBalance,
  OmniPortfolioItem,
} from "@/constants/utils/omniChainBalances";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";
import DepositModal from "@/components/shared/DepositModal";
import { formatWithCommas } from "@/constants/utils/formatNumber";

const Collateral = ({ id }: { id?: string }) => {
  const [updatedTokenData, setUpdatedTokenData] = useState<any[]>(tokenData2);
  const [omniData, setOmniData] = useState<Record<string, OmniPortfolioItem>>(
    {},
  );
  const [showDepositModal, setShowDepositModal] = useState(false);
  const activeAccount = useActiveAccount();
  const activeChain = useActiveWalletChain();
  const address = activeAccount?.address;

  const ENABLED_CHAINS = [2741, 8453, 56, 137, 999]; // Abstract, Base, BSC, Polygon, Hyperliquid

  useEffect(() => {
    const fetchAllBalances = async () => {
      if (activeAccount && address) {
        try {
          const tokens = ["ETH", "USDC", "USDR", "kfUSD", "USDT"];
          const results = await Promise.all(
            tokens.map((token) =>
              fetchOmniAssetBalance(address, token, ENABLED_CHAINS),
            ),
          );

          const newOmniData: Record<string, OmniPortfolioItem> = {};
          results.forEach((res) => {
            newOmniData[res.token] = res;
          });
          setOmniData(newOmniData);

          const updatedData = tokenData2.map((item) => {
            const omni = newOmniData[item.token];
            if (omni) {
              return {
                ...item,
                tokenPrice: omni.totalBalance,
                isMultichain: omni.chains.length > 1,
                chains: omni.chains,
              };
            }
            return { ...item, tokenPrice: "0" };
          });

          setUpdatedTokenData(updatedData);
        } catch (error) {
          console.error("Omni-fetch error:", error);
        }
      }
    };
    fetchAllBalances();
  }, [activeAccount, address]);

  const handleDepositClick = (token: string) => {
    if (["ETH", "USDC", "USDR", "kfUSD", "USDT"].includes(token)) {
      setShowDepositModal(true);
    } else {
      toast.warning(`${token} support not available on the testnet.`, {
        duration: 1000,
      });
    }
  };

  return (
    <div
      className="u-class-shadow-2 w-full min-w-0 overflow-hidden rounded-xl border border-edge bg-surface py-5 transition-colors hover:border-edge-strong sm:py-6"
      {...(id ? { id } : {})}
    >
      <div className="mb-3 px-4 sm:px-6">
        <h3 className="text-[11px] uppercase tracking-[0.1em] text-content-muted">
          Wallet balances
        </h3>
      </div>
      <div className="kaleido-scrollbar relative max-h-[220px] overflow-x-hidden overflow-y-auto px-3 sm:px-6">
        <table className="min-w-full text-center text-sm">
          <thead>
            <tr>
              <th className="sticky top-0 z-20 bg-surface py-2 text-left text-[10px] font-medium uppercase tracking-[0.1em] text-content-muted">
                Asset
              </th>
              <th className="sticky top-0 z-20 bg-surface py-2 text-right text-[10px] font-medium uppercase tracking-[0.1em] text-content-muted">
                <span className="sm:hidden">Balance</span>
                <span className="hidden sm:inline">Wallet balance</span>
              </th>
              <th className="sticky top-0 z-20 bg-surface py-2 text-center text-[10px] font-medium uppercase tracking-[0.1em] text-content-muted">
                Collateral
              </th>
              <th className="sticky top-0 z-20 bg-surface py-2 text-right text-[10px] font-medium uppercase tracking-[0.1em] text-content-muted">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {updatedTokenData.map((item, index) => (
              <tr
                key={index}
                className="border-t border-edge text-xs sm:text-sm"
              >
                <td className="py-2.5 text-start align-top">
                  <div className="flex min-w-0 items-center gap-2">
                    <img
                      src={item.icon}
                      alt=""
                      className="w-5 shrink-0 rounded-full sm:w-4"
                    />
                    <span className="min-w-0 truncate text-content">
                      {item.token}
                    </span>
                  </div>
                  {item.isMultichain && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {item.chains?.map((c: any) => (
                        <span
                          key={c.chainId}
                          className="rounded-[4px] border border-edge bg-surface-raised px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-content-muted"
                        >
                          {c.chainName}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="py-2.5 text-right align-top font-mono tabular-nums text-content">
                  {formatWithCommas(
                    item.tokenPrice,
                    item.token === "ETH" ? 4 : 3,
                  )}
                </td>
                <td className="py-2.5 align-top">
                  <div className="flex flex-col items-center">
                    <Image
                      src={
                        ["ETH", "USDC", "USDR", "kfUSD", "USDT"].includes(
                          item.token,
                        )
                          ? "/mark.svg"
                          : "/toggleOff.svg"
                      }
                      alt="tick"
                      width={12}
                      height={10}
                      priority
                      quality={100}
                    />
                  </div>
                </td>
                <td className="py-2.5 align-top">
                  <div className="flex justify-end">
                    <div onClick={() => handleDepositClick(item.token)}>
                      <Btn
                        text={
                          item.chains?.some(
                            (c: any) =>
                              c.chainId !== 2741 && c.chainId !== 11124,
                          ) && parseFloat(item.tokenPrice) > 0
                            ? "Bridge"
                            : "Deposit"
                        }
                        css="deposit-collateral-btn w-20 justify-center text-center sm:w-24"
                      />
                    </div>
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
    </div>
  );
};

export default Collateral;
