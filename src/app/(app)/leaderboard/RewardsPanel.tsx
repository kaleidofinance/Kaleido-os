"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useActiveAccount,
  useActiveWalletChain,
  useConnectModal,
  useSwitchActiveWalletChain,
} from "thirdweb/react";
import { defineChain } from "thirdweb/chains";

import { client } from "@/config/client";
import { APP_METADATA, WALLETS } from "@/config/wallets";
import { CHAINS_BY_ID, toThirdwebChainOptions } from "@/constants/chains";
import { readTxLog, type TxLogEntry } from "@/lib/v2/txLog";
import type { WaitlistStatus } from "@/lib/waitlist/status";
import s from "./leaderboard.module.css";

const ARC_CHAIN = defineChain(toThirdwebChainOptions(CHAINS_BY_ID[5042]));

// The task-status shape is shared with the /api/waitlist route and the /waitlist
// page (one source of truth — see lib/waitlist/status.ts). tsc now flags any
// reader that touches a task key the payload doesn't carry (the arcMainnet crash).
type Status = WaitlistStatus | null;

export function PendingPoints() {
  const account = useActiveAccount();
  const [held, setHeld] = useState(0);

  const loadPending = useCallback(async () => {
    if (!account?.address) {
      setHeld(0);
      return;
    }
    const res = await fetch(`/api/waitlist?wallet=${account.address}`, {
      cache: "no-store",
    });
    if (!res.ok) return;
    const data = await res.json();
    setHeld(Number(data?.heldPoints ?? 0));
  }, [account?.address]);

  useEffect(() => {
    void loadPending();
    const refresh = () => void loadPending();
    window.addEventListener("kaleido:tasks-updated", refresh);
    return () => window.removeEventListener("kaleido:tasks-updated", refresh);
  }, [loadPending]);

  if (held <= 0) return null;
  return (
    <p className={s.pendingPoints}>
      +{held.toLocaleString()} points pending · available after the 5-hour hold
    </p>
  );
}

const announceTweet = "2101296214293500009";
const xMessage = (address: string, task: string) =>
  task === "link"
    ? `Link my X account to the Kaleido wallet ${address}.`
    : `Confirm my Kaleido waitlist X ${task} for wallet ${address}.`;
const txMessage = (
  address: string,
  task: "arcMainnet" | "agent" | "bridge",
  txHash?: string,
) =>
  task === "arcMainnet"
    ? `Confirm my Kaleido Arc mainnet transaction for wallet ${address}.`
    : task === "agent"
      ? txHash
        ? `Confirm my first Kaleido agent transaction ${txHash} for wallet ${address}.`
        : `Confirm my first Kaleido agent transaction for wallet ${address}.`
      : `Confirm my first Kaleido bridge transaction for wallet ${address}.`;

export default function RewardsPanel() {
  const account = useActiveAccount();
  const activeChain = useActiveWalletChain();
  const switchChain = useSwitchActiveWalletChain();
  const { connect } = useConnectModal();
  const [status, setStatus] = useState<Status>(null);
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [xSession, setXSession] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [txOpened, setTxOpened] = useState({ agent: false, bridge: false });
  const [txHashInputs, setTxHashInputs] = useState({ agent: "", bridge: "" });
  const [txLog, setTxLog] = useState<TxLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const address = account?.address;
  const load = useCallback(async () => {
    if (!address) {
      setStatus(null);
      setRegistered(null);
      return;
    }
    setRegistered(null);
    const res = await fetch(`/api/waitlist?wallet=${address}`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok)
      throw new Error(data?.error || "Could not load Kaleido tasks.");
    setRegistered(Boolean(data?.refCode));
    setStatus(data?.refCode ? data : null);
  }, [address]);

  useEffect(() => {
    void load().catch(() => setError("Could not load Kaleido tasks."));
  }, [load]);

  useEffect(() => {
    fetch("/api/waitlist/x")
      .then((r) => r.json())
      .then((d) => setXSession(Boolean(d?.linked)))
      .catch(() => {});
  }, [status]);

  useEffect(() => {
    if (!address) {
      setTxOpened({ agent: false, bridge: false });
      return;
    }
    setTxOpened({
      agent:
        window.localStorage.getItem(
          `kaleido.waitlist.agent-opened:${address.toLowerCase()}`,
        ) === "1",
      bridge:
        window.localStorage.getItem(
          `kaleido.waitlist.bridge-opened:${address.toLowerCase()}`,
        ) === "1",
    });
  }, [address]);

  useEffect(() => {
    setTxLog(readTxLog(activeChain?.id, address));
  }, [activeChain?.id, address]);

  const txCandidates = useMemo(() => {
    const find = (task: "agent" | "bridge") => {
      const entry = txLog.find((item) => {
        if (item.status !== "confirmed") return false;
        if (task === "bridge") return item.kind === "bridge";
        return (
          item.kind === "swap" ||
          item.kind === "swapMultiHop" ||
          item.kind === "aggregatorSwap"
        );
      });
      return entry
        ? {
            hash: entry.hash,
            operation: task === "bridge" ? "bridge" : entry.kind,
          }
        : null;
    };
    return { agent: find("agent"), bridge: find("bridge") } as const;
  }, [txLog]);

  const ensureArc = useCallback(async () => {
    if (activeChain?.id !== 5042) await switchChain(ARC_CHAIN);
  }, [activeChain?.id, switchChain]);

  const connectWallet = useCallback(async () => {
    await connect({
      client,
      wallets: WALLETS,
      chain: ARC_CHAIN,
      appMetadata: APP_METADATA,
    });
  }, [connect]);

  const join = useCallback(async () => {
    if (!account) return connectWallet();
    setBusy("join");
    setError(null);
    try {
      await ensureArc();
      const signature = await account.signMessage({
        message: `Join the Kaleido Pre-Season 1 Arc waitlist.\nWallet: ${account.address}`,
      });
      const ref = new URLSearchParams(window.location.search).get("ref");
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: account.address, signature, ref }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not enable tasks.");
      setRegistered(true);
      setStatus(data);
      window.dispatchEvent(new Event("kaleido:tasks-updated"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not enable tasks.");
    } finally {
      setBusy(null);
    }
  }, [account, connectWallet, ensureArc]);

  const recordX = useCallback(
    async (task: "link" | "follow" | "retweet" | "comment" | "launch") => {
      if (!account) return connectWallet();
      setBusy(task);
      setError(null);
      try {
        await ensureArc();
        const signature = await account.signMessage({
          message: xMessage(account.address, task),
        });
        const res = await fetch("/api/waitlist/x", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address: account.address, signature, task }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Could not verify X task.");
        await load();
        window.dispatchEvent(new Event("kaleido:tasks-updated"));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not verify X task.");
      } finally {
        setBusy(null);
      }
    },
    [account, connectWallet, ensureArc, load],
  );

  const verifyTx = useCallback(
    async (task: "arcMainnet" | "agent" | "bridge") => {
      if (!account) return connectWallet();
      setBusy(task);
      setError(null);
      try {
        if (task === "arcMainnet") await ensureArc();
        const inputHash = task === "arcMainnet" ? "" : txHashInputs[task];
        const candidate = task === "arcMainnet" ? null : txCandidates[task];
        const txHash = inputHash.trim() || candidate?.hash;
        const operation =
          task === "agent"
            ? (candidate?.operation ?? "swap")
            : task === "bridge"
              ? "bridge"
              : undefined;
        const signature = await account.signMessage({
          message: txMessage(account.address, task, txHash),
        });
        const res = await fetch("/api/waitlist/transaction", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            address: account.address,
            signature,
            task,
            chainId: activeChain?.id,
            ...(txHash ? { txHash, operation } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok)
          throw new Error(data?.error || "Transaction not verified.");
        await load();
        window.dispatchEvent(new Event("kaleido:tasks-updated"));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Transaction not verified.");
      } finally {
        setBusy(null);
      }
    },
    [
      account,
      activeChain?.id,
      connectWallet,
      ensureArc,
      load,
      txCandidates,
      txHashInputs,
    ],
  );

  const refLink = useMemo(() => {
    if (!status || typeof window === "undefined") return "";
    return `${window.location.origin}/leaderboard?ref=${status.refCode}`;
  }, [status]);

  const openX = (task: "follow" | "retweet" | "comment" | "launch") => {
    const url =
      task === "follow"
        ? "https://x.com/intent/follow?screen_name=kaleido_finance"
        : task === "retweet"
          ? `https://x.com/intent/retweet?tweet_id=${announceTweet}`
          : task === "comment"
            ? `https://x.com/intent/tweet?in_reply_to=${announceTweet}`
            : `https://x.com/kaleido_finance/status/${announceTweet}`;
    window.open(url, "_blank", "noopener,noreferrer");
    setOpened((prev) => ({ ...prev, [task]: true }));
  };

  const openProduct = (kind: "agent" | "bridge") => {
    if (!address) return;
    window.localStorage.setItem(
      `kaleido.waitlist.${kind}-opened:${address.toLowerCase()}`,
      "1",
    );
    setTxOpened((prev) => ({ ...prev, [kind]: true }));
    window.location.href = kind === "agent" ? "/trade/swap" : "/trade/agent";
  };

  const task = (
    id: string,
    title: string,
    meta: string,
    done: boolean,
    action: () => void,
    label: string,
  ) => (
    <li className={s.rewardTask} key={id}>
      <div>
        <strong>{title}</strong>
        <span>{done ? "Done" : meta}</span>
      </div>
      {done ? (
        <span className={s.taskDone}>✓</span>
      ) : (
        <>
          {id === "agent" || id === "bridge" ? (
            <input
              className={s.taskHashInput}
              value={txHashInputs[id]}
              onChange={(event) =>
                setTxHashInputs((current) => ({
                  ...current,
                  [id]: event.target.value,
                }))
              }
              placeholder={
                txCandidates[id]
                  ? "Using latest tx"
                  : "Paste tx hash (optional)"
              }
              aria-label={`${title} transaction hash`}
              spellCheck={false}
            />
          ) : null}
          <button
            className={s.taskButton}
            onClick={action}
            disabled={busy !== null}
          >
            {busy === id ? "Checking…" : label}
          </button>
        </>
      )}
    </li>
  );

  return (
    <section className={s.rewards} aria-label="Kaleido tasks">
      <div className={s.rewardsHead}>
        <div>
          <h2>Kaleido tasks</h2>
          <p>
            Complete launch, trading, and referral tasks from your dashboard.
          </p>
        </div>
      </div>
      {registered === false && (
        <button
          className={s.enableTasks}
          onClick={() => void join()}
          disabled={busy !== null}
        >
          {busy === "join" ? "Enabling…" : "Enable tasks"}
        </button>
      )}
      {error ? <p className={s.rewardError}>{error}</p> : null}
      {registered && status ? (
        <div className={s.rewardsGrid}>
          <div className={s.rewardCard}>
            <h3>Tasks</h3>
            <ul className={s.rewardTasks}>
              {task(
                "link",
                "Link your X account",
                "+100 points",
                Boolean(status.xTasks?.linked?.done),
                () =>
                  xSession
                    ? void recordX("link")
                    : (window.location.href =
                        "/api/auth/twitter?returnTo=/leaderboard"),
                "Link X",
              )}
              {task(
                "follow",
                "Follow @kaleido_finance",
                "+100 points",
                Boolean(status.xTasks?.followed?.done),
                () =>
                  opened.follow ? void recordX("follow") : openX("follow"),
                opened.follow ? "Verify" : "Follow",
              )}
              {task(
                "retweet",
                "Repost the Mainnet Launch post",
                "+100 points",
                Boolean(status.xTasks?.retweeted?.done),
                () =>
                  opened.retweet ? void recordX("retweet") : openX("retweet"),
                opened.retweet ? "Verify" : "Repost",
              )}
              {task(
                "comment",
                "Comment on the launch post",
                "+50 points",
                Boolean(status.xTasks?.commented?.done),
                () =>
                  opened.comment ? void recordX("comment") : openX("comment"),
                opened.comment ? "Verify" : "Comment",
              )}
              {task(
                "launch",
                "Like & repost the Mainnet Launch post",
                "+100 points",
                Boolean(status.xTasks?.launch?.done),
                () =>
                  opened.launch ? void recordX("launch") : openX("launch"),
                opened.launch ? "Verify" : "Open post",
              )}
              {/* arcMainnet was retired 2026-09-23 (farmable) — the API no longer
                  returns transactionTasks.arcMainnet, so rendering it here read
                  `.done` off undefined and crashed the whole page. */}
              {task(
                "agent",
                "Make your first transaction on Kaleido",
                "+500 points · Verify a swap",
                Boolean(status.transactionTasks?.agent?.done),
                () =>
                  txOpened.agent
                    ? void verifyTx("agent")
                    : openProduct("agent"),
                txOpened.agent ? "Verify" : "Open Kaleido",
              )}
              {task(
                "bridge",
                "Use Luca to bridge assets in/out of Arc",
                "+500 points · Verify on-chain",
                Boolean(status.transactionTasks?.bridge?.done),
                () =>
                  txOpened.bridge
                    ? void verifyTx("bridge")
                    : openProduct("bridge"),
                txOpened.bridge ? "Verify" : "Open Luca",
              )}
            </ul>
          </div>
          <div className={s.rewardCard}>
            <h3>Referral link</h3>
            <p className={s.referralBig}>
              {status.referrals} <span>verified referrals</span>
            </p>
            <p className={s.rewardMuted}>
              {status.referralPoints.toLocaleString()} referral points · 50
              points per qualifying X-linked referral
            </p>
            <div className={s.referralRow}>
              <input value={refLink} readOnly aria-label="Referral link" />
              <button
                className={s.pageBtn}
                onClick={() => void navigator.clipboard?.writeText(refLink)}
              >
                Copy
              </button>
            </div>
          </div>
        </div>
      ) : registered === false ? (
        <></>
      ) : (
        <p className={s.rewardMuted}>
          {address
            ? "Loading your tasks and referral link…"
            : "Connect a wallet to view your tasks and referral link."}
        </p>
      )}
    </section>
  );
}
