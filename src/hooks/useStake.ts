"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { getProvider } from "@/config/provider";
import { getKLDVaultContract } from "@/config/contracts";
import { ErrorDecoder } from "ethers-decode-error";
import { ethers, MaxUint256 } from "ethers";
import KLDVaultAbi from "@/abi/KLDVaultAbi.json";
import erc20Abi from "@/abi/ERC20Abi.json";
import { stakingContracts } from "@/constants/registry";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";
import { ethers6Adapter } from "thirdweb/adapters/ethers6";
import { client } from "@/config/client";
import useTxFactory from "@/components/factory/TxFactory";

const errorDecoder = ErrorDecoder.create([KLDVaultAbi]);

const useStake = () => {
  const activeAccount = useActiveAccount();
  const activeChain = useActiveWalletChain();
  const [txStakeStatus, setTxStatus] = useState(false);
  const { handleStakeError, StakeTransactionResult } = useTxFactory();
  const chainId = activeChain?.id;
  const address = activeAccount?.address;

  const Stake = useCallback(
    async (_amount: string) => {
      const amountinWei = ethers.parseUnits(_amount, 18);
      if (!activeChain) {
        toast.error("Chain not connected");
        return;
      }
      if (!activeAccount) {
        toast.error("invalid account");
        return;
      }
      if (Number(_amount) == 0) {
        toast.error("amount must be greater than 0");
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

      /* All three addresses come from the wallet's chain, together. The vault's
       * `deposit` takes the token address as an argument, so a vault from one
       * chain and a token from another is a transaction that cannot succeed —
       * which is exactly what happened while these were three flat literals
       * from Abstract testnet. */
      const staking = stakingContracts(activeChain.id);
      if (!staking.supported) {
        toast.error(`Staking is not available on ${activeChain.name ?? `chain ${activeChain.id}`}`);
        return;
      }

      const contract = getKLDVaultContract(signer, activeChain.id);
      let loadingToastId = toast.loading(
        `Staking ${_amount.toString()} $KLD...`,
      );

      try {
        setTxStatus(true);
        const KldTokenContract = new ethers.Contract(
          staking.kld!,
          erc20Abi,
          signer,
        );

        // Approve vault to spend tokens

        const approveTx = await KldTokenContract.approve(
          staking.kldVault!,
          ethers.parseUnits(_amount, 18),
        );
        await approveTx.wait();
        // deposit(token, amount) — the vault derives the share mint itself, so
        // stKLD's address is not a parameter. Passing it made every stake revert.
        await contract.deposit.staticCall(staking.kld!, amountinWei);
        const transaction = await contract.deposit(staking.kld!, amountinWei);
        const receipt = transaction.wait();

        await StakeTransactionResult(transaction, loadingToastId, "stake");
      } catch (error) {
        await handleStakeError(error, loadingToastId);
      } finally {
        setTxStatus(false);
      }
    },
    [activeChain, activeAccount, client, handleStakeError],
  );

  return {
    Stake,
    txStakeStatus,
  };
};

export default useStake;
