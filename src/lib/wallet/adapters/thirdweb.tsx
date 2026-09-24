"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  AutoConnect,
  ThirdwebProvider,
  useActiveAccount,
  useActiveWallet,
  useActiveWalletChain,
  useConnectModal,
  useSwitchActiveWalletChain,
} from "thirdweb/react";
import { defineChain } from "thirdweb/chains";
import { ethers6Adapter } from "thirdweb/adapters/ethers6";
import {
  getCapabilities,
  sendCalls,
  waitForCallsReceipt,
} from "thirdweb/wallets/eip5792";
import { prepareTransaction } from "thirdweb";
import { toast } from "sonner";

import { client } from "@/config/client";
import { WALLETS } from "@/config/wallets";
import {
  CHAINS_BY_ID,
  getChainMeta,
  toThirdwebChainOptions,
} from "@/constants/chains";
import type { BatchCall } from "@/lib/v2/intents/batch";
import type {
  BatchResult,
  WalletAccountHandle,
  WalletAdapter,
  WalletChainHandle,
} from "../adapter";

/**
 * The thirdweb implementation of {@link WalletAdapter} — the only file that
 * imports the thirdweb SDK for the core wallet surface. Everything here was
 * previously spread across `useWalletV2`, `useChainAction`, `ethersSigner`,
 * `useBatchCalls`, `web3Modal`/`AutoConnectProvider`; collecting it behind the
 * interface is what makes a provider swap a new sibling file rather than edits
 * across all of those.
 *
 * Behaviour is deliberately identical to those originals — the notes that
 * explain *why* each piece is shaped the way it is now live next to the code
 * they describe.
 */

type ToEthersArgs = Parameters<typeof ethers6Adapter.signer.toEthers>[0];

/* New connections should land on Kaleido's live home chain. Passing this to
 * thirdweb is important: its omitted-chain default is Ethereum. Existing
 * sessions are restored by AutoConnect and keep the wallet's current chain. */
const ARC_MAINNET = defineChain(toThirdwebChainOptions(CHAINS_BY_ID[5042]));

/* ---------------------------------------------------------------- signing -- */

function getSigner(
  account: WalletAccountHandle | undefined,
  chain: WalletChainHandle | undefined,
) {
  if (!account || !chain) {
    throw new Error("Wallet not connected — no signer available.");
  }
  // Synchronous, deliberately: callers pass the result straight into a contract
  // (`ethers6Adapter.signer.toEthers` returns a Signer, not a Promise). The
  // handles ARE thirdweb's own account/chain objects — this adapter is the one
  // place that knows that and narrows them back.
  return ethers6Adapter.signer.toEthers({
    client,
    chain: chain as ToEthersArgs["chain"],
    account: account as ToEthersArgs["account"],
  });
}

/* ---------------------------------------------------------------- batching -- */

/**
 * THE GATE IS THE DECLARED CAPABILITY, NOT WHETHER sendCalls THROWS.
 *
 * thirdweb's `sendCalls` accepts an array from every wallet: one that cannot
 * batch loops and sends each call as its own transaction, reporting
 * `atomic: false`. So a resolved `sendCalls` is not evidence the user signed
 * once. `getCapabilities` is the gate — `atomic.status` of "supported"/"ready"
 * means one atomic transaction; anything else is the sequential loop, and the
 * callers keep that path and fall back to it, so this is purely advisory.
 */
function useBatch() {
  const wallet = useActiveWallet();
  const account = useActiveAccount();
  const chain = useActiveWalletChain();
  const [support, setSupport] = useState({ supported: false, checking: true });

  useEffect(() => {
    if (!wallet || !account || !chain) {
      setSupport({ supported: false, checking: false });
      return;
    }
    let live = true;
    setSupport({ supported: false, checking: true });

    (async () => {
      try {
        const caps = await getCapabilities({ wallet, chainId: chain.id });
        /* Keyed by chain id; a wallet that ignores the param returns the entry
           directly, so both shapes are read. */
        const forChain =
          (caps as Record<string, unknown>)[String(chain.id)] ?? caps;
        const atomic = (forChain as { atomic?: { status?: string } })?.atomic;
        const ok =
          atomic?.status === "supported" || atomic?.status === "ready";
        if (live) setSupport({ supported: ok, checking: false });
      } catch {
        /* Documented not to throw without EIP-5792, but it does when the account
           has no getCapabilities at all. Either way: no batching. */
        if (live) setSupport({ supported: false, checking: false });
      }
    })();

    return () => {
      live = false;
    };
  }, [wallet, account, chain]);

  const send = useCallback(
    async (calls: BatchCall[]): Promise<BatchResult> => {
      if (!wallet || !account || !chain) {
        throw new Error("Connect a wallet to continue.");
      }
      if (calls.length === 0) throw new Error("No calls to send.");

      const result = await sendCalls({
        wallet,
        calls: calls.map((c) =>
          prepareTransaction({
            /* The wallet's own active chain object, not defineChain(id): the app
               registers per-chain RPC through toThirdwebChainOptions, and
               rebuilding from the id alone throws that away. */
            chain,
            client,
            to: c.to,
            data: c.data as `0x${string}`,
            value: c.value,
          }),
        ),
        /* ATOMIC OR NOTHING. atomicRequired:false would let the wallet split an
           approve from the action it authorises and land only one — the worst
           outcome. True makes it refuse instead, and a refusal is recoverable:
           the caller falls back to the sequential loop. */
        atomicRequired: true,
      });

      /* From here the wallet has ACCEPTED the bundle, so a failure is not
         "nothing was sent" — the calls may still land. Mark it, so the caller
         stops instead of re-signing the steps one by one (which could run a
         swap twice). A throw above this line is a refusal: nothing was sent. */
      let receipt: Awaited<ReturnType<typeof waitForCallsReceipt>>;
      try {
        receipt = await waitForCallsReceipt(result);
      } catch (err) {
        throw Object.assign(
          err instanceof Error ? err : new Error(String(err)),
          { sent: true },
        );
      }
      return {
        hashes: (receipt.receipts ?? []).map((r) => r.transactionHash),
        ok: receipt.status === "success",
      };
    },
    [wallet, account, chain],
  );

  return { support, send };
}

/* ------------------------------------------------------------------- root -- */

/**
 * Resumes the previous session on load so a returning user is not asked to
 * connect on every navigation. AutoConnect can only restore a wallet it was
 * given, so the list here must match the connect modal's — both read WALLETS.
 */
function Root({ children }: { children: ReactNode }) {
  return (
    <ThirdwebProvider>
      <AutoConnect wallets={WALLETS} client={client} />
      {children}
    </ThirdwebProvider>
  );
}

/* ---------------------------------------------------------------- adapter -- */

export const thirdwebAdapter: WalletAdapter = {
  id: "thirdweb",
  Root,
  useAddress: () => useActiveAccount()?.address,
  useChainId: () => useActiveWalletChain()?.id,
  useAccountHandle: () => useActiveAccount(),
  useChainHandle: () => useActiveWalletChain(),
  useConnect: () => {
    const { connect } = useConnectModal();
    return () => {
      connect({
        client,
        wallets: WALLETS,
        chain: ARC_MAINNET,
        size: "compact",
      }).catch(() => {
        /* Dismissing the modal rejects — a choice, not a fault. */
      });
    };
  },
  useSwitchChain: () => {
    const switchChain = useSwitchActiveWalletChain();
    return async (chainId: number) => {
      const meta = getChainMeta(chainId);
      if (!meta) throw new Error(`Chain ${chainId} is not in the registry.`);
      await switchChain(defineChain(toThirdwebChainOptions(meta)));
    };
  },
  getSigner,
  useBatch,
};
