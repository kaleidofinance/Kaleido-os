"use client";
import { useCallback } from "react";
import { toast } from "sonner";
import { isSupportedChain } from "@/config/chain";
import { ethers } from "ethers";
import { getKaleidoContract } from "@/config/contracts";
import { ErrorDecoder } from "ethers-decode-error";
import lendbitAbi from "@/abi/ProtocolFacet.json";
import { formatInterestRate } from "@/constants/utils/FormatInterestRate";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";
import { ethers6Adapter } from "thirdweb/adapters/ethers6";
import { client } from "@/config/client";
import type { LendingAsset } from "@/lib/lending/assets";

const errorDecoder = ErrorDecoder.create([lendbitAbi]);
import { sendLoanCreatedNotification } from "@/lib/notifications/emit";

/**
 * Post a borrow request — ask to borrow `_amount` of one asset against collateral.
 *
 * Takes the resolved `LendingAsset` rather than a symbol, for the same reason as
 * useCreateLoanListing: the five-way if-chain it replaces mapped symbols to
 * Abstract-testnet literals, so on every deployed chain `currency` stayed
 * `undefined` and `_weiAmount` with it, and `createLendingRequest(undefined, …)`
 * threw inside ethers before a transaction existed.
 *
 * No approval and no `value`. `createLendingRequest` is not payable
 * (ProtocolFacet.sol:159) and moves nothing — it records a request that a lender
 * later funds through serviceRequest — so the only thing it needs from the asset
 * is the address it is denominated in and the scale to express the amount in.
 *
 * Also gone: a `getCalculateMinPriceBasedOnToken` helper that priced the request
 * against the $10 floor and was never called from anywhere, which is why the two
 * price atoms it read were this hook's only reason to mount useGetValueAndHealth.
 * The floor is enforced on-chain by Constants.MIN_LOAN_AMOUNT and surfaces below
 * as Protocol__LoanAmountTooLow; the dead helper also compared the token against
 * `USDC_ADDRESS || USDR`, so it could only ever have priced two Abstract tokens.
 */
const useCreateLendingRequest = () => {
  const activeAccount = useActiveAccount();
  const activeChain = useActiveWalletChain();
  const chainId = activeChain?.id;

  const handleTransactionResult = async (
    transaction: ethers.Contract,
    loadingToastId: string | number | undefined,
    onSuccess?: () => void,
  ) => {
    const receipt = await transaction.wait();

    // Callers handle their own navigation — this used to redirect to a

    // legacy route that no longer exists.
    /* One success branch, not two. This was `if (receipt.status && chainId ==
     * 11124)` / `else if (receipt.status && chainId !== 11124)`, two arms that
     * differed only in the second saying "kindly wait for few minutes" — the
     * cross-chain latency of a design that no longer exists. Since 11124 is not a
     * chain we deploy to, the first arm was dead and every user got the arm that
     * asked them to wait for a transaction already confirmed on the line above. */
    if (receipt.status) {
      toast.success("Loan Pool created!", {
        id: loadingToastId,
      });
      sendLoanCreatedNotification("borrow");
      return onSuccess?.();
    } else {
      toast.error("Pool creation failed!", {
        id: loadingToastId,
      });
    }
  };

  const handleError = async (
    error: unknown,
    loadingToastId: string | number | undefined,
  ) => {
    const err = await errorDecoder.decode(error);
    console.log("Error details:", err);
    let errorText: string;

    switch (err?.fragment?.name) {
      case "Protocol__TokenNotLoanable":
        errorText = "Token not loanable!";
        break;
      case "Protocol__DateMustBeInFuture":
        errorText = "Input a valid date!";
        break;
      case "Protocol__InvalidAmount":
        errorText = "Please input a valid amount!";
        break;
      case "Protocol__InsufficientCollateral":
        errorText = "Insufficient collateral!";
        break;
      case "Protocol__CannotBorrowCollateralAsset":
        errorText = "You cannot borrow collateral asset!";
        break;
      case "Protocol__LoanAmountTooLow":
        errorText = "The minimum order amount is $10!";
        break;
      default:
        errorText = "Unknown error occurred!";
    }

    toast.error(`${errorText}`, {
      id: loadingToastId,
    });
    console.log("Error while creating lending request", error);
  };

  return useCallback(
    async (
      _amount: string,
      _interest: number,
      _returnDate: number,
      asset: LendingAsset,
      onSuccess?: () => void,
    ) => {
      if (!isSupportedChain(chainId)) {
        toast.warning("SWITCH NETWORK", { duration: 1000 });
        return;
      }

      if (!activeChain) {
        toast.error("Chain not connected");
        return;
      }

      if (!activeAccount) {
        toast.error("invalid account");
        return;
      }

      let _weiAmount: bigint;
      try {
        _weiAmount = ethers.parseUnits(_amount.toString(), asset.decimals);
      } catch {
        toast.error(`Enter a valid ${asset.symbol} amount`);
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
        loadingToastId = toast.loading("Processing borrowing request...");
        const _basisPointInterest = formatInterestRate(_interest);

        await contract.createLendingRequest.staticCall(
          _weiAmount,
          _basisPointInterest,
          _returnDate,
          asset.address,
        );
        const transaction = await contract.createLendingRequest(
          _weiAmount,
          _basisPointInterest,
          _returnDate,
          asset.address,
        );

        await handleTransactionResult(transaction, loadingToastId, onSuccess);
      } catch (error: unknown) {
        // console.error("Error creating lending request:", error)
        await handleError(error, loadingToastId);
      }
    },
    [activeAccount, activeChain, chainId],
  );
};

export default useCreateLendingRequest;
