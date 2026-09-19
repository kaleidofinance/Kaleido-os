"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useActiveAccount } from "thirdweb/react";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import { envVars } from "@/constants/envVars";
import s from "./LinkX.module.css";

/**
 * "Link X" — the header control that ties an X account to the CONNECTED WALLET.
 *
 * It used to read link state from the `twitter_user` cookie alone (/api/auth/user),
 * with no wallet dependency — so the handle showed whenever that cookie existed,
 * even with the wallet disconnected or a different wallet connected. The link is
 * meant to be a fact about the wallet (one X per wallet, the waitlist's rule), so
 * this now derives its state from the connected wallet:
 *
 *   - /api/x/for-wallet?address= gives the X bound to THIS wallet. No wallet, or a
 *     wallet with no binding, shows "Link X"; the same wallet reconnecting brings
 *     its handle back.
 *   - Binding reuses the signature-gated api/waitlist/x (task "link"): the wallet
 *     signs, the server reads the OAuth cookie and writes wallet↔X, enforcing one
 *     X per wallet. This works for ordinary dapp users as well as waitlisters;
 *     linking never creates a waitlist row. So linking is: press → X OAuth →
 *     return → sign to confirm.
 *
 * The `twitter_user` cookie is now only the mid-flow proof that OAuth completed;
 * it is not what the header trusts. The binding, and the handle shown, live in the
 * table against the wallet.
 */
export default function LinkX() {
  const { address } = useWalletV2();
  const account = useActiveAccount();
  /** The X bound to the connected wallet (the table's truth). */
  const [handle, setHandle] = useState<string | null>(null);
  /** An X from a just-finished OAuth (cookie) that is not yet bound to this wallet. */
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (addr?: string) => {
    if (!addr) {
      setHandle(null);
      setPending(null);
      return;
    }
    try {
      const bound = await fetch(`/api/x/for-wallet?address=${addr}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (bound?.handle) {
        setHandle(bound.handle);
        setPending(null);
        return;
      }
      setHandle(null);
      /* Not bound to this wallet — but if an OAuth cookie is sitting there from a
         just-finished link, offer to confirm it rather than restart OAuth. */
      const sess = await fetch("/api/waitlist/x")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      setPending(sess?.handle ?? null);
    } catch {
      /* Leave the last good state; the flow's own errors are legible. */
    }
  }, []);

  useEffect(() => {
    refresh(address);
  }, [address, refresh]);

  const startOAuth = () => {
    if (!envVars.twitterClientId) {
      toast.error("X sign-in isn't configured on this deployment.");
      return;
    }
    if (!address) {
      toast.error("Connect your wallet first — your X link is bound to it.");
      return;
    }
    window.location.href = "/api/auth/twitter";
  };

  const confirmLink = async () => {
    if (!account || !address || busy) return;
    setBusy(true);
    try {
      /* Same message and endpoint the waitlist signs — one binding path, one
         one-X-per-wallet rule. */
      const signature = await account.signMessage({
        message: `Link my X account to the Kaleido wallet ${address}.`,
      });
      const res = await fetch("/api/waitlist/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, signature, task: "link" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          data?.error === "wallet already linked to a different X"
              ? "This wallet is already linked to a different X account."
              : data?.error === "this X is already linked to another wallet"
                ? "That X account is already linked to another wallet."
                : "Couldn't link X — try again.",
        );
      } else {
        const linked = pending;
        await refresh(address);
        if (linked) toast.success(`Linked as @${linked}`);
      }
    } catch {
      /* User rejected the signature, or the wallet threw. Not an error state. */
    } finally {
      setBusy(false);
    }
  };

  const linked = Boolean(handle);
  const canConfirm = !linked && Boolean(pending);
  const label = linked ? `@${handle}` : canConfirm ? "Confirm X" : "Link X";
  const title = linked
    ? `X @${handle} is linked to this wallet`
    : canConfirm
      ? `Sign to link @${pending} to this wallet`
      : "Link your X account to this wallet";

  return (
    <button
      type="button"
      className={`${s.btn} ${linked ? s.linked : ""}`}
      title={title}
      aria-label={title}
      disabled={busy}
      onClick={linked ? undefined : canConfirm ? confirmLink : startOAuth}
    >
      <svg className={s.mark} viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
        />
      </svg>
      <span className={s.label}>{busy ? "Linking…" : label}</span>
    </button>
  );
}
