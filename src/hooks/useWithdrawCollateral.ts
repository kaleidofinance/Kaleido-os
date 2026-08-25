"use client";
import { useCallback } from "react";
import { toast } from "sonner";
import { isSupportedChain } from "@/config/chain";
import { ethers } from "ethers";
import { ErrorDecoder } from "ethers-decode-error";
import lendbitAbi from "@/abi/ProtocolFacet.json";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";
import { ethers6Adapter } from "thirdweb/adapters/ethers6";
import { client } from "@/config/client";
import { getKaleidoContract } from "@/config/contracts";
import type { LendingAsset } from "@/lib/lending/assets";

const errorDecoder = ErrorDecoder.create([lendbitAbi]);

/**
 * Withdraw deposited collateral, native or ERC20.
 *
 * Takes the resolved `LendingAsset` so the amount is scaled by the asset's own
 * declared decimals. It used to take an address and pick the scale from a
 * five-way if-chain over the native sentinel plus four Abstract-testnet literals,
 * with **no else branch**: on every deployed chain an ERC20 address matched
 * nothing, `_weiAmount` stayed `undefined`, and `withdrawCollateral(addr,
 * undefined)` threw inside ethers before a transaction existed. Every ERC20
 * withdrawal on all five chains failed that way.
 */
const useWithdrawCollateral = () => {
  const activeAccount = useActiveAccount();
  const activeChain = useActiveWalletChain();
  const chainId = activeChain?.id;

  return useCallback(
    async (
      asset: LendingAsset,
      _amountOfCollateral: string,
      onSuccess?: () => void,
    ) => {
      if (!isSupportedChain(chainId)) return toast.warning("SWITCH NETWORK");

      if (!activeChain) {
        toast.error("Chain not connected");
        return;
      }
      if (!activeAccount) {
        toast.error("invalid account");
        return;
      }
      const signer = ethers6Adapter.signer.toEthers({
        client,
        chain: activeChain,
        account: activeAccount,
      });
      if (!signer) {
        toast.error("Signer not available");
        return;
      }

      const contract = getKaleidoContract(signer, chainId);

      let toastId: string | number | undefined;

      try {
        const _weiAmount = ethers.parseUnits(
          String(_amountOfCollateral),
          asset.decimals,
        );

        // Show loading toast when the withdraw transaction is initiated
        toastId = toast.loading(`Signing tx... Withdrawing collateral...`);

        await contract.withdrawCollateral.staticCall(asset.address, _weiAmount);
        const transaction = await contract.withdrawCollateral(
          asset.address,
          _weiAmount,
        );

        const receipt = await transaction.wait();

        if (receipt.status) {
          toast.success(
            `${_amountOfCollateral} ${asset.symbol} successfully withdrawn!`,
            {
              id: toastId,
            },
          );
          // Callers handle their own navigation — this used to redirect to a
          // legacy route that no longer exists.
          return onSuccess?.();
        } else {
          toast.error("Failed to withdraw collateral.", {
            id: toastId,
          });
        }
      } catch (error: unknown) {
        // console.error(error)
        // console.error("Error withdrawing:", await errorDecoder.decode(error))
        const err = await errorDecoder.decode(error);
        let errorText: string;

        if (err?.reason === "Protocol__InsufficientCollateralDeposited") {
          errorText = "Insufficient collateral!";
        } else if (err?.reason === "SafeERC20FailedOperation") {
          /* withdrawCollateral is the case where both names are live: the ERC20
           * leg goes through SafeERC20 and reverts with this, while the native
           * leg still reverts with Protocol__TransferFailed below. Matching
           * only one of them would leave half the withdrawals unexplained. */
          errorText = "Token transfer failed. Please try again.";
        } else if (err?.reason === "Protocol__TransferFailed") {
          errorText = "Transaction failed!";
        } else {
          errorText = "Action canceled or failed!";
        }

        if (toastId) {
          toast.error(`Error: ${errorText}`, { id: toastId });
        } else {
          // Fallback toast if no loading toast was created
          toast.error(`Error: ${errorText}`);
        }
      }
    },
    [activeAccount, activeChain, chainId],
  );
};

export default useWithdrawCollateral;
