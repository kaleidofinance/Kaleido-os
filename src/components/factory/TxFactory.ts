import { ethers } from "ethers";
import { ErrorDecoder } from "ethers-decode-error";
import { toast } from "sonner";
import tokenFaucetAbi from "@/abi/TokenFaucet.json";
import kldVaultAbi from "@/abi/KLDVaultAbi.json";

const errorDecoder = ErrorDecoder.create([tokenFaucetAbi]);
const KLDvaultErrordecoder = ErrorDecoder.create([kldVaultAbi]);
const useTxFactory = () => {
  /**
   * The faucet's success toast. Takes what was actually paid out.
   *
   * It used to take a `text` discriminator of "usdc" or anything-else and
   * announce a hardcoded "100 USDC claimed successfully!" or "10,000 KLD claimed
   * successfully!" — two figures the contract no longer pays and one asset that
   * does not exist. KaleidoTokenFaucet's drip is per-asset owner configuration
   * read from `drips(token)`, so the amount is only knowable at the call site,
   * and the asset list is whatever the chain's deploy listed.
   *
   * The old version also attached a "Post an offer" action routing to /borrow.
   * Dropped: a claimed test token is equally the input to a swap, a kfUSD mint or
   * a loan, and picking one of the three for everybody is a guess dressed as
   * help.
   */
  const handleTransactionResult = async (
    transaction: ethers.ContractTransactionResponse,
    loadingToastId: string | number | undefined,
    amount: string,
    symbol: string,
  ) => {
    const receipt = await transaction.wait();
    if (receipt?.status) {
      toast.success(`Claimed ${amount} ${symbol}`, { id: loadingToastId });
    } else {
      toast.error("Transaction failed!", { id: loadingToastId });
    }
  };

  const StakeTransactionResult = async (
    transaction: ethers.Contract,
    loadingToastId: string | number | undefined,
    text: string,
  ) => {
    const receipt = await transaction.wait();
    if (receipt.status) {
      if (text === "stake") {
        toast.success("You have successfully staked!", { id: loadingToastId });
      } else if (text === "request") {
        toast.success("Your request has been processed!", {
          id: loadingToastId,
        });
      } else if (text === "cancel") {
        toast.success("Your withdrawal request has been cancelled!", {
          id: loadingToastId,
        });
      } else {
        toast.success("You have successfully UnStaked!", {
          id: loadingToastId,
        });
      }
      // router.push("/successful")
    } else {
      toast.error("Transaction failed!", { id: loadingToastId });
    }
  };

  const handleStakeError = async (
    error: unknown,
    loadingToastId: string | number | undefined,
  ) => {
    const err = await errorDecoder.decode(error);
    const vaultErr = await KLDvaultErrordecoder.decode(error);
    let errorText: string;

    /*
     * These names come from KLDVaultV2.sol's `error` declarations, via the
     * generated ABI the decoder above is built from.
     *
     * They were previously all prefixed `KLDVault_` — names from the stale ABI,
     * which described a vault that does not exist in this repo. The contract
     * emits `InsufficientBalance`, nothing matched, and every failed stake,
     * unstake, request and cancel showed the same "unexpected error" toast.
     *
     * The faucet cases that used to sit in this switch are gone: it reads
     * `vaultErr`, so a KaleidoTokenFaucet_* fragment could never appear here.
     * handleError below is the faucet's decoder.
     */
    switch (vaultErr?.fragment?.name) {
      case "TokenNotSupported":
        errorText = "The token you are trying to use is not supported.";
        break;
      case "InvalidAmount":
        errorText = "Amount must be greater than zero.";
        break;
      case "CooldownNotPassed":
        errorText =
          "Withdrawal waiting period has not yet passed. Please wait.";
        break;
      case "NoWithdrawalRequest":
        errorText =
          "No withdrawal request found. Please request withdrawal first.";
        break;
      case "InsufficientBalance":
        errorText = "You have insufficient balance for this operation.";
        break;
      case "SafeERC20FailedOperation":
        errorText =
          "Token transfer failed. Please check your allowance and balance.";
        break;
      case "EnforcedPause":
        errorText = "Staking is paused. Please try again later.";
        break;
      default:
        errorText = "An unexpected error occurred. Please try again later.";
    }

    toast.error(`Error: ${errorText}`, { id: loadingToastId });
    // console.log("vault error:", vaultErr)
    // console.error("ERROR", err)
  };

  const handleError = async (
    error: unknown,
    loadingToastId: string | number | undefined,
  ) => {
    const err = await errorDecoder.decode(error);
    let errorText: string;

    switch (err?.fragment?.name) {
      case "KaleidoTokenFaucet_InsufficientContractBalance":
        errorText = "The faucet is out of this token. Try another, or tell us.";
        break;
      case "KaleidoTokenFaucet_CooldownNotOver":
        errorText =
          "Please wait for the cooldown period to end before requesting again";
        break;
      /*
       * KaleidoTokenFaucet_FailToSendToken used to have a case here and is gone
       * from the contract: it was declared and never reverted, because the payout
       * goes through SafeERC20.safeTransfer, which raises its own
       * SafeERC20FailedOperation instead. An unreachable case is worse than none —
       * it reads as evidence the path was considered and handled.
       */
      case "SafeERC20FailedOperation":
        errorText = "The token rejected the transfer. Please try again";
        break;
      case "KaleidoTokenFaucet_AssetNotListed":
        errorText = "The faucet is not handing out this token on this chain";
        break;
      /*
       * Only `claimMany` raises this, and only when it paid nothing at all — a
       * batch that pays some and skips the rest succeeds, so this cannot mean
       * "some failed". The reason is deliberately not in the revert (see
       * Faucet.sol), which is why the message points at the rows instead of
       * naming one: the page already shows, per asset, whether it is paused,
       * empty, or still on cooldown.
       */
      case "KaleidoTokenFaucet_NothingClaimable":
        errorText =
          "Nothing is claimable right now — every asset is either on cooldown, paused, or out of stock";
        break;
      default:
        errorText = "An unexpected error occurred. Please try again later";
    }

    toast.error(`Error: ${errorText}`, { id: loadingToastId });
    // console.error("ERROR", err)
  };

  return {
    handleTransactionResult,
    handleError,
    handleStakeError,
    StakeTransactionResult,
  };
};

export default useTxFactory;
