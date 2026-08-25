"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { getProvider } from "@/config/provider";
import { getKLDVaultContract } from "@/config/contracts";
import { ErrorDecoder } from "ethers-decode-error";
import KLDVaultAbi from "@/abi/KLDVaultAbi.json";

import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";
import { ethers6Adapter } from "thirdweb/adapters/ethers6";
import { client } from "@/config/client";
import useTxFactory from "@/components/factory/TxFactory";

const useRequestWithdrawal = () => {
  const activeAccount = useActiveAccount();
  const activeChain = useActiveWalletChain();
  const [withdrawalRequestStatus, setTxStatus] = useState(false);
  const { handleStakeError, StakeTransactionResult } = useTxFactory();
  const chainId = activeChain?.id;
  const address = activeAccount?.address;

  /**
   * Starts the vault's withdrawal cooldown.
   *
   * Takes no amount: the vault stores a per-account timestamp and every later
   * withdraw() call is gated on it, so there is nothing to size here. This hook
   * used to accept one and pass stKLD's address to a zero-argument function,
   * which reverted — and the toast quoted a figure that never reached the chain.
   */
  const requestWithdrawal = useCallback(async () => {
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

    const contract = getKLDVaultContract(signer);
    let loadingToastId = toast.loading("Requesting withdrawal...");

    try {
      setTxStatus(true);
      await contract.requestWithdrawal.staticCall();
      const transaction = await contract.requestWithdrawal();
      const receipt = transaction.wait();
      await StakeTransactionResult(transaction, loadingToastId, "request");
    } catch (error) {
      await handleStakeError(error, loadingToastId);
    } finally {
      setTxStatus(false);
    }
  }, [activeChain, activeAccount, client, handleStakeError]);

  return {
    requestWithdrawal,
    withdrawalRequestStatus,
  };
};

export default useRequestWithdrawal;
