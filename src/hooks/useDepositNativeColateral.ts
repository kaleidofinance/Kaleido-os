"use client";
import { useCallback } from "react";
import { toast } from "sonner";
import { isSupportedChain } from "@/config/chain";
import { getProvider } from "@/config/provider";
import { useRouter } from "next/navigation";
import { ErrorWithReason } from "@/constants/types";
import { NATIVE_SENTINEL } from "@/constants/registry";
import { ethers } from "ethers";
import { ErrorDecoder } from "ethers-decode-error";
import lendbitAbi from "@/abi/ProtocolFacet.json";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";
import { client } from "@/config/client";
import { getKaleidoContract } from "@/config/contracts";
import { ethers6Adapter } from "thirdweb/adapters/ethers6";

const errorDecoder = ErrorDecoder.create([lendbitAbi]);
const useDepositNativeCollateral = () => {
  const activeAccount = useActiveAccount();
  const activeChain = useActiveWalletChain();
  const chainId = activeChain?.id;
  const address = activeAccount?.address;
  const router = useRouter();

  return useCallback(
    async (_amountOfCollateral: string, onSuccess?: () => void) => {
      if (!isSupportedChain(chainId))
        return toast.warning("SWITCH TO SUPPORTED CHAINS");

      if (!activeChain) {
        toast.error("Chain not connected");
        return;
      }
      const amount = ethers.parseEther(_amountOfCollateral);
      if (!activeAccount) {
        toast.error("Account not connected");
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
        // Show loading toast when starting the transaction
        toastId = toast.loading(`Signing deposit transaction...`);

        await contract.depositCollateral.staticCall(
          NATIVE_SENTINEL.lending,
          amount,
          {
            value: amount,
          },
        );

        const transaction = await contract.depositCollateral(
          NATIVE_SENTINEL.lending,
          amount,
          {
            value: amount,
          },
        );

        // Wait for the transaction to be mined
        const receipt = await transaction.wait();

        // Update the loading toast based on the transaction receipt
        if (receipt.status) {
          toast.success(
            `${_amountOfCollateral} ETH successfully deposited as collateral!`,
            {
              id: toastId,
            },
          );
          /* Removed here: a second toast saying "Kindly wait for a few minutes
           * for your deposited ETH to go cross-chain", shown whenever
           * chainId !== 11124. It was a relic of a cross-chain design that no
           * longer exists — each chain now has its own Diamond and this deposit
           * lands on the connected chain, in the transaction whose receipt we
           * just confirmed. So on every chain we ship it fired unconditionally
           * and told the user to wait for something that had already happened. */
          // Callers handle their own navigation — this used to redirect to a

          // legacy route that no longer exists.
          onSuccess?.();
        } else {
          toast.error("Transaction failed!", {
            id: toastId,
          });
        }
      } catch (error: unknown) {
        // Handle error, update the loading toast to show an error message
        const err = await errorDecoder.decode(error);
        // console.error(contract.interface.parseError("0xc6826680"));
        // console.error("Error in depositCollateral:", err)

        let errorText: string;

        /* Neither name this used to match could ever arrive. A native deposit
         * performs no transfer at all — depositCollateral's native branch only
         * reads msg.value — so Protocol__TransferFailed is unreachable from
         * here, and spoke__InsufficientGasFee is not in ProtocolFacet's ABI, so
         * the decoder cannot produce that name from the only interface it was
         * given. The shape hid it too: `if (A) {...}` followed by
         * `if (B) {...} else {...}` overwrote A's message whenever B was false,
         * so even a match would have shown the generic string. Matched here
         * instead are the two errors the native path can actually revert with,
         * both from its modifiers. */
        switch (err?.fragment?.name || err?.reason) {
          case "Protocol__MustBeMoreThanZero":
            errorText = "Enter an amount greater than zero.";
            break;
          case "Protocol__TokenNotAllowed":
            errorText = "This asset is not accepted as collateral.";
            break;
          default:
            errorText = "Transaction canceled or failed!";
        }

        // console.error(error);

        // If a toast was shown, update it with the error message
        if (toastId) {
          toast.error(`Error: ${errorText}`, { id: toastId });
        } else {
          // Fallback toast if no loading toast was created
          toast.warning(`Error: ${errorText}`);
        }
      }
    },
    [chainId, router],
  );
};

export default useDepositNativeCollateral;
