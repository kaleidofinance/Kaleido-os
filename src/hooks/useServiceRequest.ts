"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { isSupportedChain } from "@/config/chain";
import { getKaleidoContract } from "@/config/contracts";
import { ErrorDecoder } from "ethers-decode-error";

import lendbitAbi from "@/abi/ProtocolFacet.json";

import { isNativeSentinel } from "@/constants/registry";
import { getContractAddressesByChainId } from "@/config/getContractByChain";

import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";
import { ethers6Adapter } from "thirdweb/adapters/ethers6";
import { client } from "@/config/client";
import { ensureAllowance } from "@/lib/lending/approve";

const errorDecoder = ErrorDecoder.create([lendbitAbi]);
import { sendLoanFilledNotification } from "@/lib/notifications/emit";

/**
 * Fund someone else's borrow request. `_amount` is RAW base units.
 *
 * No decimals and no `LendingAsset`, for the same reason as useRepayLoan: the
 * amount is the request's own stored figure, read out of the loan-request row in
 * the units the facet holds it in, and `serviceRequest` pulls
 * `_foundRequest.amount` regardless of what is passed (ProtocolFacet.sol:291) —
 * so the only thing to get right is the allowance covering it.
 *
 * The ERC20 leg used to resolve `currency` from `_tokenAddress === USDC_ADDRESS ||
 * === USDR`, both Abstract-testnet literals. On all five deployed chains neither
 * matched, so `currency` was `undefined`, `getERC20Contract(signer, undefined)`
 * threw, and no ERC20 request could be funded. Where it did match, the approval
 * was `parseUnits(_amount, 6)` over an amount already in base units — 1e6 times
 * too large — compared against a stale allowance from useCheckAllowance.
 *
 * Acts on the connected chain, which is now the point: the book is multi-chain,
 * and BorrowBookView switches the wallet to the funded request's own chain
 * before calling this, so `chainId` here is the request's chain and the fund
 * lands in the right deployment's storage. It used to carry an extra
 * lendingChainMismatch lock refusing anything but LENDING_CHAIN_ID; that lock
 * belonged to the single-chain design and is gone.
 */
const useServiceRequest = () => {
  const activeAccount = useActiveAccount();
  const activeChain = useActiveWalletChain();
  const chainId = activeChain?.id;

  return useCallback(
    async (_requestId: number, _tokenAddress: string, _amount: string) => {
      /*
       * Any supported chain, not one fixed lending chain. Lending is multi-chain
       * now (the book sweeps every deployment), so funding a request happens on
       * the chain the request lives on — the caller switches the wallet there
       * first, and this only has to check that wherever it landed is a chain the
       * protocol is deployed to. The old lendingChainMismatch lock, which refused
       * anything but LENDING_CHAIN_ID, is gone with the single-chain design.
       *
       * Still required, and still first: getKaleidoContract throws when the
       * chain has no Diamond, and the call below sits outside the try, so an
       * unsupported chain here would escape as an unhandled rejection and the
       * button would silently do nothing.
       */
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
      const amountToLend = BigInt(_amount);

      const loadingToastId = toast.loading("Processing service request...");

      try {
        let tx;

        if (isNativeSentinel(_tokenAddress, "lending")) {
          await contract.serviceRequest.staticCall(_requestId, _tokenAddress, {
            value: amountToLend,
          });
          tx = await contract.serviceRequest(_requestId, _tokenAddress, {
            value: amountToLend,
          });
        } else {
          const protocolAddress = getContractAddressesByChainId(chainId);
          if (!protocolAddress) {
            toast.error("No lending contract on this chain", {
              id: loadingToastId,
            });
            return;
          }

          await ensureAllowance(
            signer,
            _tokenAddress,
            activeAccount.address,
            protocolAddress,
            amountToLend,
          );

          await contract.serviceRequest.staticCall(_requestId, _tokenAddress);
          tx = await contract.serviceRequest(_requestId, _tokenAddress);
        }

        const receipt = await tx.wait();
        if (receipt.status) {
          toast.success("Request serviced!", { id: loadingToastId });
          sendLoanFilledNotification();
        } else {
          toast.error("Request servicing failed!", { id: loadingToastId });
        }
      } catch (error: unknown) {
        /* ensureAllowance throws a plain Error, which the decoder returns
           unrecognised — so it has to be matched before the switch or its message
           is replaced by "Unknown error occurred." */
        const approvalMessage = (error as Error)?.message;
        if (approvalMessage?.startsWith("Token approval")) {
          toast.error(approvalMessage, { id: loadingToastId });
          return;
        }

        const decoded = await errorDecoder.decode(error);
        console.error("Service Request Error:", decoded);

        let errorText = "Unknown error occurred.";
        switch (decoded?.fragment?.name || decoded?.reason) {
          case "Protocol__RequestNotOpen":
            errorText = "Request has already been serviced or closed.";
            break;
          case "Protocol__InvalidToken":
            errorText = "Invalid token specified.";
            break;
          case "Protocol__CantFundSelf":
            errorText = "You cannot service your own request.";
            break;
          case "Protocol__InsufficientBalance":
            errorText = "Insufficient balance.";
            break;
          case "Protocol__InsufficientAmount":
            errorText = "The value sent is less than the requested amount.";
            break;
          case "Protocol__InsufficientCollateral":
            errorText = "Borrower has insufficient collateral.";
            break;
          case "Protocol__InsufficientAllowance":
            errorText = "Token allowance too low.";
            break;
          /* serviceRequest funds the borrower either natively or through
           * SafeERC20, so both of these are reachable and neither was handled.
           * Without them a failed transfer fell through to "Unknown error
           * occurred", which for the ERC20 leg is the likeliest failure of the
           * two — the explicit allowance check above does not cover a token
           * that reverts or refuses the pull for its own reasons. */
          case "SafeERC20FailedOperation":
            errorText =
              "Token transfer failed. Please check your allowance and balance.";
            break;
          case "Protocol__TransferFailed":
            errorText = "Transfer failed. Please try again.";
            break;
          case "Protocol__RequestExpired":
            errorText = "Request has expired.";
            break;
          case "Request is being rate limited":
            errorText = "Request is being rate limited";
            break;
          case "Protocol__InsufficientCollateralBalance":
            errorText =
              "Borrower's collateral balance is insufficient to cover this loan.";
            break;
        }

        toast.error(`Error: ${errorText} `, { id: loadingToastId });
      }
    },
    [activeAccount, activeChain, chainId],
  );
};

export default useServiceRequest;
