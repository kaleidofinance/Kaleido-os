"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { ethers } from "ethers";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";
import { ethers6Adapter } from "thirdweb/adapters/ethers6";
import { ErrorDecoder } from "ethers-decode-error";
import { client } from "@/config/client";
import { isSupportedChain } from "@/config/chain";
import { getKaleidoContract } from "@/config/contracts";
import lendbitAbi from "@/abi/ProtocolFacet.json";
import type { LendingAsset } from "@/lib/lending/assets";

const errorDecoder = ErrorDecoder.create([lendbitAbi]);

const ERROR_MESSAGES: Record<string, string> = {
  Protocol__ListingNotOpen: "This order is not available!",
  Protocol__OwnerCreatedListing: "You cannot accept your own order!",
  "0x8a051e0f": "You cannot accept your own order!",
  Protocol__InsufficientCollateral: "Insufficient collateral!",
  "0x5006c6c0": "Insufficient collateral!",
  Protocol__InvalidAmount: "Please enter a valid amount!",
  /* Both names are live here. requestLoanFromListing pays the borrowed asset
   * out either natively — which still reverts Protocol__TransferFailed — or
   * through SafeERC20, which reverts with its own error naming the token. It is
   * a payout, not a pull, so neither message mentions allowance. */
  Protocol__TransferFailed: "Action failed!",
  SafeERC20FailedOperation:
    "Token transfer failed — the order could not be paid out.",
  Protocol__CannotBorrowCollateralAsset: "You cannot borrow collateral asset!",
  Protocol__DateMustBeInFuture: "Date is Invalid",
};

/**
 * Borrow from an open loan offer. `_amount` is a human figure, as typed.
 *
 * Takes the resolved `LendingAsset` so the amount is scaled by the listing's own
 * token. It used to take a symbol and scale with `tokenType === "ETH" ? 18 : 6` —
 * a decimals inferred from a symbol, which rule 2 in constants/registry.ts forbids
 * precisely because it is wrong somewhere: every 18-decimal loan currency not
 * called "ETH" was under-borrowed by 1e12, which covers WETH and WBNB as
 * collateral-side assets and Arc's 18-decimal WUSDC, the only loanable asset on
 * that chain. The symbol reaching it came from `tokenImageMap[addr]?.label ??
 * "USDC"`, so an unmapped address silently borrowed at 6 decimals.
 *
 * No approval: requestLoanFromListing pays the borrowed asset OUT to the caller
 * and locks their existing collateral — nothing is pulled from the borrower.
 */
const useAcceptListedAds = () => {
  const activeAccount = useActiveAccount();
  const activeChain = useActiveWalletChain();
  const chainId = activeChain?.id;

  return useCallback(
    async (
      _orderId: number,
      _amount: string,
      asset: LendingAsset,
      onSuccess?: () => void,
    ) => {
      if (!activeAccount || !activeChain) {
        toast.warning("Wallet not connected");
        return;
      }

      if (!isSupportedChain(chainId)) {
        toast.warning("SWITCH NETWORK");
        return;
      }

      try {
        const signer = await ethers6Adapter.signer.toEthers({
          client,
          chain: activeChain,
          account: activeAccount,
        });

        if (!signer) {
          toast.error("Signer not available");
          return;
        }

        const contract = getKaleidoContract(signer, chainId);

        let _weiAmount: bigint;
        try {
          _weiAmount = ethers.parseUnits(String(_amount), asset.decimals);
        } catch {
          toast.error(`Enter a valid ${asset.symbol} amount`);
          return;
        }

        const loadingToastId = toast.loading("Processing loan request...");

        try {
          await contract.requestLoanFromListing.staticCall(
            _orderId,
            _weiAmount,
          );

          const transaction = await contract.requestLoanFromListing(
            _orderId,
            _weiAmount,
          );
          const receipt = await transaction.wait();

          if (receipt.status) {
            toast.success("You accepted listed ads successfully!", {
              id: loadingToastId,
            });
            // Callers handle their own navigation — this used to redirect to a

            // legacy route that no longer exists.
            onSuccess?.();
            return;
          }

          toast.error("failed!", { id: loadingToastId });
        } catch (error: unknown) {
          const err = await errorDecoder.decode(error);
          console.log("Error accepting listed ads:", err);

          const errorText =
            ERROR_MESSAGES[err?.fragment?.name || err?.selector] ||
            "Failed to accept bid!";
          toast.warning(`Error: ${errorText}`, { id: loadingToastId });
        }
      } catch (adapterError) {
        // console.error("Adapter error:", adapterError)
        toast.error("Failed to connect to wallet");
      }
    },
    [activeAccount, activeChain, chainId],
  );
};

export default useAcceptListedAds;
