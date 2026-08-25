"use client";
import { useCallback } from "react";
import { toast } from "sonner";
import { isSupportedChain } from "@/config/chain";
import { getKaleidoContract } from "@/config/contracts";
import { ethers } from "ethers";
import { getContractAddressesByChainId } from "@/config/getContractByChain";
import { ErrorDecoder } from "ethers-decode-error";
import lendbitAbi from "@/abi/ProtocolFacet.json";
import { formatInterestRate } from "@/constants/utils/FormatInterestRate";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";
import { ethers6Adapter } from "thirdweb/adapters/ethers6";
import { client } from "@/config/client";
import { ensureAllowance } from "@/lib/lending/approve";
import type { LendingAsset } from "@/lib/lending/assets";

const errorDecoder = ErrorDecoder.create([lendbitAbi]);
import { sendLoanCreatedNotification } from "@/lib/notifications/emit";

/**
 * Post a loan offer — lend `_amount` of one asset, with a borrow band.
 *
 * Takes the resolved `LendingAsset` (address, decimals, isNative together) rather
 * than a symbol. It used to map the symbol to an address through a five-way
 * if-chain over Abstract-testnet literals, so on all five deployed chains a real
 * loan currency matched nothing, `currency` became `""`, and the call reverted
 * inside ethers. It then picked the scale from `let decimals = 6; if (symbol ===
 * "kfUSD") decimals = 18`, which is a decimals inferred from a symbol — rule 2 in
 * constants/registry.ts — and would have scaled Arc's 18-decimal WUSDC by 1e12
 * across the amount and both bounds.
 *
 * `createLoanListing` is `payable` (ProtocolFacet.sol:674) and its native leg
 * overwrites `_amount` with `msg.value`, so the native branch below is real and
 * has to send the value. `_valueMoreThanZero` rejects a native call with no value.
 *
 * Allowance goes through `ensureAllowance`, which compares base units to base
 * units. The four branches this replaces compared a raw allowance against the
 * human amount (`val < Number("5")`, so `5000000 < 5` was false and approval was
 * skipped) off `useCheckAllowance`'s stale effect state, and only for four
 * hardcoded addresses — every other token skipped approval entirely and hit the
 * facet's own `Protocol__InsufficientAllowance`.
 */
const useCreateLoanListing = () => {
  const activeAccount = useActiveAccount();
  const activeChain = useActiveWalletChain();
  const chainId = activeChain?.id;

  const handleTransactionResult = async (
    transaction: ethers.Contract,
    loadingToastId: string | number | undefined,
    onSuccess?: () => void,
  ) => {
    const receipt = await transaction.wait();
    if (receipt.status) {
      toast.success("Loan order created!", { id: loadingToastId });
      sendLoanCreatedNotification("lending");
      // Callers handle their own navigation — this used to redirect to a

      // legacy route that no longer exists.
      onSuccess?.();
    } else {
      toast.error("Transaction failed!", { id: loadingToastId });
    }
  };

  return useCallback(
    async (
      _amount: string,
      _min_amount: number,
      _max_amount: number,
      _returnDate: number,
      _interest: number,
      asset: LendingAsset,
      onSuccess?: () => void,
    ) => {
      if (!isSupportedChain(chainId)) {
        toast.warning("SWITCH NETWORK");
        return; // Early return if chain is not supported
      }

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
      const destination = getContractAddressesByChainId(chainId);
      if (!destination) {
        toast.error("No lending contract on this chain");
        return;
      }

      /* One scale for all three figures, taken from the asset itself. The bounds
         are numbers rather than strings at this boundary, so they are fixed to the
         asset's own precision before parsing — parseUnits rejects more fraction
         digits than the token has. */
      let _weiAmount: bigint;
      let _min_amount_wei: bigint;
      let _max_amount_wei: bigint;
      try {
        _weiAmount = ethers.parseUnits(_amount, asset.decimals);
        _min_amount_wei = ethers.parseUnits(
          _min_amount.toFixed(asset.decimals),
          asset.decimals,
        );
        _max_amount_wei = ethers.parseUnits(
          _max_amount.toFixed(asset.decimals),
          asset.decimals,
        );
      } catch {
        toast.error(`Enter a valid ${asset.symbol} amount`);
        return;
      }

      let loadingToastId: string | number | undefined;

      try {
        loadingToastId = toast.loading("Processing order...");

        if (asset.isNative) {
          await contract.createLoanListing.staticCall(
            _weiAmount,
            _min_amount_wei,
            _max_amount_wei,
            _returnDate,
            formatInterestRate(_interest),
            asset.address,
            { value: _weiAmount },
          );

          const transaction = await contract.createLoanListing(
            _weiAmount,
            _min_amount_wei,
            _max_amount_wei,
            _returnDate,
            formatInterestRate(_interest),
            asset.address,
            { value: _weiAmount },
          );

          await handleTransactionResult(transaction, loadingToastId, onSuccess);
        } else {
          await ensureAllowance(
            signer,
            asset.address,
            activeAccount.address,
            destination,
            _weiAmount,
          );

          await contract.createLoanListing.staticCall(
            _weiAmount,
            _min_amount_wei,
            _max_amount_wei,
            _returnDate,
            formatInterestRate(_interest),
            asset.address,
          );

          const transaction = await contract.createLoanListing(
            _weiAmount,
            _min_amount_wei,
            _max_amount_wei,
            _returnDate,
            formatInterestRate(_interest),
            asset.address,
          );

          await handleTransactionResult(transaction, loadingToastId, onSuccess);
        }
      } catch (error: unknown) {
        // console.error("Error creating loan listing:", error)
        handleError(error, loadingToastId);
      }
    },
    [activeAccount, activeChain, chainId],
  );
};

const handleError = async (
  error: unknown,
  loadingToastId: string | number | undefined,
) => {
  /* ensureAllowance throws plain Errors, not reverts, so they survive the decoder
     unchanged and would otherwise land on "Unknown error occurred" — losing the
     one message that tells the user their token refuses to change a non-zero
     allowance. */
  const approvalMessage = (error as Error)?.message;
  if (approvalMessage?.startsWith("Token approval")) {
    toast.error(approvalMessage, { id: loadingToastId });
    return;
  }

  const err = await errorDecoder.decode(error);
  let errorText: string;
  console.log("Error details:", err);
  switch (err?.fragment?.name) {
    case "Protocol__DateMustBeInFuture":
      errorText = "Input a valid date!";
      break;
    case "Protocol__TokenNotLoanable":
      errorText = "Token not loanable!";
      break;
    case "Protocol__InsufficientBalance":
      errorText = "Insufficient balance!";
      break;
    case "Protocol__InsufficientAllowance":
      errorText = "Insufficient allowance!";
      break;
    case "Protocol__MustBeMoreThanZero":
      errorText = "Enter an amount greater than zero!";
      break;
    /* createLoanListing's ERC20 leg pulls the lent asset in through SafeERC20 and
     * its native leg only reads msg.value rather than transferring, so
     * Protocol__TransferFailed cannot reach this switch and the case that matched
     * it is gone. The duplicate Protocol__DateMustBeInFuture that sat below it was
     * dead from the first one above. */
    case "SafeERC20FailedOperation":
      errorText =
        "Token transfer failed. Please check your allowance and balance.";
      break;
    case "Protocol__LoanAmountTooLow":
      errorText = "The minimum order amount is $10!";
      break;
    default:
      errorText = "Unknown error occurred!";
  }

  toast.error(`${errorText}`, { id: loadingToastId });
  // console.error("ERROR", err)
};

export default useCreateLoanListing;
