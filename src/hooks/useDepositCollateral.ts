"use client";
import { useCallback } from "react";
import { toast } from "sonner";
import { isSupportedChain } from "@/config/chain";
import { getKaleidoContract } from "@/config/contracts";
import { ethers } from "ethers";
import { getContractAddressesByChainId } from "@/config/getContractByChain";
import { ErrorDecoder } from "ethers-decode-error";
import lendbitAbi from "@/abi/ProtocolFacet.json";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";
import { ethers6Adapter } from "thirdweb/adapters/ethers6";
import { client } from "@/config/client";
import { ensureAllowance } from "@/lib/lending/approve";
import type { LendingAsset } from "@/lib/lending/assets";

const errorDecoder = ErrorDecoder.create([lendbitAbi]);

/**
 * Deposit an ERC20 as collateral. The native branch is useDepositNativeColateral.
 *
 * Takes the resolved `LendingAsset` — address and declared decimals together —
 * rather than a bare address. It used to take an address and rediscover both from
 * a four-way if-chain over Abstract-testnet literals (`USDC_ADDRESS`, `USDR`,
 * `kfUSD_ADDRESS`, `USDT_ADDRESS`), which meant that on all five deployed chains
 * no branch matched: `currency` stayed `undefined`, `getERC20Contract(signer,
 * undefined)` threw, and every ERC20 collateral deposit failed before a
 * transaction was built. `decimals` also defaulted to 18, so had a branch
 * matched, a USDC deposit would have been scaled by 1e12.
 *
 * Allowance goes through `ensureAllowance`, which reads the live allowance and
 * compares base units to base units. The old check compared the raw allowance
 * against the human amount (`val < Number("5")`, so `5000000 < 5`) off a stale
 * `useCheckAllowance` effect, and only for four hardcoded addresses — anything
 * else skipped approval entirely.
 */
const useDepositCollateral = () => {
  const activeAccount = useActiveAccount();
  const activeChain = useActiveWalletChain();
  const chainId = activeChain?.id;

  return useCallback(
    async (
      _amountOfCollateral: string,
      asset: LendingAsset,
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

      if (asset.isNative) {
        toast.error("Use the native deposit path for this asset");
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

      const _weiAmount = ethers.parseUnits(
        _amountOfCollateral,
        asset.decimals,
      );
      let toastId: string | number | undefined;

      try {
        toastId = toast.loading(`Processing deposit transaction...`);

        await ensureAllowance(
          signer,
          asset.address,
          activeAccount.address,
          destination,
          _weiAmount,
        );

        await contract.depositCollateral.staticCall(asset.address, _weiAmount);
        const transaction = await contract.depositCollateral(
          asset.address,
          _weiAmount,
        );

        const receipt = await transaction.wait();

        if (receipt.status) {
          toast.success(
            `${_amountOfCollateral} ${asset.symbol} successfully deposited as collateral!`,
            {
              id: toastId,
            },
          );
          /* Removed here: a second toast saying "Kindly wait for a few minutes
           * for your deposit to go cross-chain", shown whenever
           * chainId !== 11124 — see the same removal in
           * useDepositNativeColateral. Each chain has its own Diamond, so the
           * deposit is already settled on the connected chain by the receipt
           * checked above. */
          // Callers handle their own navigation — this used to redirect to a
          // legacy route that no longer exists.
          onSuccess?.();
        } else {
          toast.error("Transaction failed!", {
            id: toastId,
          });
        }
      } catch (error: unknown) {
        console.error(error);

        const err = await errorDecoder.decode(error);
        /* SafeERC20FailedOperation, not Protocol__TransferFailed: the facet now
         * transfers through SafeERC20, and depositCollateral's native branch
         * only reads msg.value rather than transferring, so the old name is
         * unreachable from this path and matching it caught nothing. The new
         * error carries the token that failed, which is why the message can
         * name a cause — a failed pull here is almost always allowance.
         *
         * `Protocol__TokenNotAllowed` is the one this surface should now never
         * produce: the picker reads getAllCollateralToken() from the diamond, so
         * an asset it offers is one the diamond registered. Seeing it means the
         * registered set changed under an open modal. */
        const errorText: string =
          err?.fragment?.name === "SafeERC20FailedOperation"
            ? "Deposit failed — check your token allowance and balance."
            : err?.fragment?.name === "Protocol__TokenNotAllowed"
              ? `${asset.symbol} is no longer accepted as collateral — reload and try again.`
              : ((error as Error)?.message?.startsWith("Token approval") ??
                  false)
                ? (error as Error).message
                : "Action canceled or failed!";

        if (toastId) {
          toast.error(`Error: ${errorText}`, { id: toastId });
        } else {
          toast.warning(`Error: ${errorText}`);
        }
      }
    },
    [activeAccount, activeChain, chainId],
  );
};

export default useDepositCollateral;
