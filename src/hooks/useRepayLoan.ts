"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { isSupportedChain } from "@/config/chain";
import { getKaleidoContract } from "@/config/contracts";
import { isNativeSentinel } from "@/constants/registry";
import { getContractAddressesByChainId } from "@/config/getContractByChain";
import { ErrorDecoder } from "ethers-decode-error";
import lendbitAbi from "@/abi/ProtocolFacet.json";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";
import { ethers6Adapter } from "thirdweb/adapters/ethers6";
import { client } from "@/config/client";
import { ensureAllowance } from "@/lib/lending/approve";

const errorDecoder = ErrorDecoder.create([lendbitAbi]);

/**
 * Repay an open loan. `_amount` is RAW base units — see ActiveLoan.totalRepaymentRaw.
 *
 * No `LendingAsset` here, and no decimals: the caller already holds the exact
 * repayment figure in the token's own units, so re-deriving a scale would only
 * create a second place for it to be wrong. The token address is the one the
 * request was denominated in, straight off the loan row.
 *
 * Three defects removed, all in the ERC20 leg:
 *
 *   - Approval was only attempted for two Abstract-testnet literals
 *     (`USDC_ADDRESS`, `USDR`). On every deployed chain neither matched, so
 *     `currency` stayed `undefined`, `getERC20Contract(signer, undefined)` threw,
 *     and no ERC20 repayment could be made at all.
 *   - The amount approved was `ethers.parseUnits(_amount, 6)` over an amount
 *     already in base units, i.e. the true figure times 1e6 — so a repayment that
 *     did get past the address check asked the user to approve a million times
 *     what it needed.
 *   - The allowance it compared against was `val < Number(_amount)`, raw units on
 *     one side and… also raw on the other here, but read from useCheckAllowance's
 *     effect state, which is a render behind the wallet and reads the wrong
 *     chain's allowance after a network switch.
 *
 * `ensureAllowance` replaces all three: live read, base units both sides, exactly
 * the amount needed, any token.
 */
const useRepayLoan = () => {
  const activeAccount = useActiveAccount();
  const activeChain = useActiveWalletChain();
  const chainId = activeChain?.id;

  return useCallback(
    async (_requestId: number, _tokenAddress: string, _amount: string) => {
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

      let loadingToastId: string | number | undefined;

      try {
        loadingToastId = toast.loading("Please wait!... Processing repayments");

        // Native value is addressed by the lending sentinel, so repayLoan is
        // called directly with `value` rather than approving an ERC20 first.
        if (isNativeSentinel(_tokenAddress, "lending")) {
          await contract.repayLoan.staticCall(_requestId, _amount, {
            value: _amount,
          });

          const transaction = await contract.repayLoan(_requestId, _amount, {
            value: _amount,
          });

          const receipt = await transaction.wait();

          if (receipt.status) {
            return toast.success("Outstanding payed!", {
              id: loadingToastId,
            });
          }

          return toast.error("Repayment failed!", {
            id: loadingToastId,
          });
        }

        const destination = getContractAddressesByChainId(chainId);
        if (!destination) {
          return toast.error("No lending contract on this chain", {
            id: loadingToastId,
          });
        }

        await ensureAllowance(
          signer,
          _tokenAddress,
          activeAccount.address,
          destination,
          BigInt(_amount),
        );

        await contract.repayLoan.staticCall(_requestId, _amount);
        const transaction = await contract.repayLoan(_requestId, _amount);

        const receipt = await transaction.wait();

        if (receipt.status) {
          return toast.success("Outstanding payed!", {
            id: loadingToastId,
          });
        }

        return toast.error("Repayment failed!", {
          id: loadingToastId,
        });
      } catch (error: unknown) {
        /* ensureAllowance throws plain Errors, which the decoder passes through
           unchanged — so they have to be recognised before the switch, or the one
           message explaining a refused allowance change becomes "Trying to resolve
           error!". */
        const approvalMessage = (error as Error)?.message;
        if (approvalMessage?.startsWith("Token approval")) {
          return toast.error(approvalMessage, { id: loadingToastId });
        }

        const err = await errorDecoder.decode(error);
        console.log("Error rapaying loan:", err);
        let errorText: string;

        // Handle different error reasons from the protocol
        switch (err?.reason) {
          case "Protocol__RequestNotServiced":
            errorText = "Repayment action failed!";
            break;
          case "Protocol__InvalidToken":
          case "Protocol__InsufficientBalance":
            errorText = "Insufficient balance!";
            break;
          case "Protocol__InsufficientAllowance":
            errorText = "Insufficient allowance!";
            break;
          case "Protocol__MustBeMoreThanZero":
            errorText = "No outstanding to repay!";
            break;
          default:
            errorText = "Trying to resolve error!";
        }

        toast.warning(`Error: ${errorText}`, {
          id: loadingToastId,
        });
      }
    },
    [activeAccount, activeChain, chainId],
  );
};

export default useRepayLoan;
