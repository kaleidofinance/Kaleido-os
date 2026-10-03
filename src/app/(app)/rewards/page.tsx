"use client";

import { useCallback, useEffect, useState } from "react";
import {
  useActiveAccount,
  useConnectModal,
  useActiveWalletChain,
  useSwitchActiveWalletChain,
} from "thirdweb/react";
import { defineChain } from "thirdweb/chains";

import { client } from "@/config/client";
import { WALLETS, APP_METADATA } from "@/config/wallets";
import { CHAINS_BY_ID, toThirdwebChainOptions } from "@/constants/chains";
import { findLatestAcrossChains } from "@/lib/v2/txLog";
import type { WaitlistStatus } from "@/lib/waitlist/status";
import {
  CHECKIN_POINTS,
  STREAK_BONUS,
  STREAK_LENGTH,
  WELCOME_BONUS,
  checkinMessage,
  msUntilNextUtcDay,
  utcDay,
} from "@/lib/rewards/checkin";

/** "Day 3/7 of streak", or "7-day streak 🔥" on a bonus day. */
const streakLabel = (n: number) => {
  const inCycle = ((n - 1) % STREAK_LENGTH) + 1;
  return inCycle === STREAK_LENGTH
    ? `${n}-day streak 🔥 +${STREAK_BONUS}`
    : `day ${inCycle}/${STREAK_LENGTH} of streak`;
};
import Nav from "@/components/v2/Nav";
import s from "./rewards.module.css";

/**
 * The waitlist join is a chain-agnostic signature, but we switch the wallet to
 * the live Arc mainnet before signing so the act of joining happens on Arc. The
 * chain comes from the same global registry as the rest of the app.
 */
const ARC_CHAIN_ID = 5042;
const ARC_CHAIN = defineChain(
  toThirdwebChainOptions(CHAINS_BY_ID[ARC_CHAIN_ID]),
);

// Task-status shape shared with the /api/waitlist route (lib/waitlist/status.ts),
// so this page and the payload can't drift out of sync (what caused the arcMainnet
// crash). Reads below stay defensively optional-chained for API/bundle version skew.
type Status = WaitlistStatus | null;
type XTaskKey = "link" | "follow" | "retweet" | "comment" | "launch" | "llama" | "argus" | "argus2";

const X_HANDLE = "kaleido_finance";
// The launch post users repost for +100 $kPoint. Defaulted to the live announce
// tweet so the task works without a separate Vercel env step at launch; the
// NEXT_PUBLIC var still overrides it if we ever point the task at a different post.
const ANNOUNCE_TWEET_ID =
  process.env.NEXT_PUBLIC_WAITLIST_ANNOUNCE_TWEET_ID ?? "2099572698380730531";
const MAINNET_LAUNCH_TWEET_ID = "2101296214293500009";
// The DefiLlama-listing post for the like & repost task. The task opens X's
// repost intent for it (like + repost are one attested task); the env var still
// overrides the id.
/** The $ARGUS listing post: RT + comment, first 100 wallets get +600. */
const ARGUS_TWEET_ID =
  process.env.NEXT_PUBLIC_ARGUS_TWEET_ID ?? "2104598739604373636";
const bridgeOpenedKey = (address: string) =>
  `kaleido.waitlist.bridge-opened:${address.toLowerCase()}`;

/** Must match the message the API rebuilds and verifies. */
const joinMessage = (address: string) =>
  `Join the Kaleido Pre-Season 1 Arc waitlist.\nWallet: ${address}`;

/** Must match xTaskMessage in /api/waitlist/x. */
const xTaskMessage = (address: string, task: XTaskKey) =>
  task === "link"
    ? `Link my X account to the Kaleido waitlist wallet ${address}.`
    : `Confirm my Kaleido waitlist X ${task} for wallet ${address}.`;
const transactionTaskMessage = (address: string) =>
  `Confirm my first Kaleido bridge transaction for wallet ${address}.`;

export default function WaitlistPage() {
  const account = useActiveAccount();
  const { connect, isConnecting } = useConnectModal();
  const activeChain = useActiveWalletChain();
  const switchChain = useSwitchActiveWalletChain();
  const onArc = activeChain?.id === ARC_CHAIN_ID;

  // Put the wallet on Arc before signing, so joining happens on Arc. Signing is
  // chain-agnostic, but this makes "we run on Arc" real rather than cosmetic.
  const ensureArc = useCallback(async () => {
    if (activeChain?.id === ARC_CHAIN_ID) return;
    await switchChain(ARC_CHAIN);
  }, [activeChain, switchChain]);

  const [ref, setRef] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [statusReady, setStatusReady] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [xLinkedCookie, setXLinkedCookie] = useState(false);
  const [opened, setOpened] = useState<{
    follow: boolean;
    retweet: boolean;
    comment: boolean;
    launch: boolean;
    llama: boolean;
    argus: boolean;
    argus2: boolean;
  }>({
    follow: false,
    retweet: false,
    comment: false,
    launch: false,
    llama: false,
    argus: false,
    argus2: false,
  });
  const [xBusy, setXBusy] = useState<XTaskKey | null>(null);
  const [transactionBusy, setTransactionBusy] = useState<"bridge" | null>(null);
  const [bridgeOpened, setBridgeOpened] = useState(false);
  const [txHashInputs, setTxHashInputs] = useState({ bridge: "" });

  useEffect(() => {
    try {
      const r = new URLSearchParams(window.location.search).get("ref");
      if (r) setRef(r);
    } catch {
      /* no query */
    }
  }, []);


  const loadStatus = useCallback(async () => {
    const addr = account?.address;
    if (!addr) {
      setStatus(null);
      setStatusReady(false);
      setStatusError(null);
      return;
    }
    setStatusReady(false);
    setStatusError(null);
    try {
      const res = await fetch(`/api/waitlist?wallet=${addr}`, {
        cache: "no-store",
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || "Could not load waitlist.");
      setStatus(d && d.refCode ? d : null);
      setStatusReady(true);
    } catch {
      // Never show a first-time claim button while an existing wallet's
      // standing is unknown. Keep the last dashboard, if any, and let the
      // caller retry instead of turning a transient API failure into a
      // duplicate-registration flow.
      setStatusReady(false);
      setStatusError("Could not load your waitlist balance.");
    }
  }, [account?.address]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!account?.address) {
      setBridgeOpened(false);
      return;
    }
    setBridgeOpened(
      window.localStorage.getItem(bridgeOpenedKey(account.address)) === "1",
    );
  }, [account?.address]);

  // Is an X account linked in this browser (the OAuth cookie is set)? Drives
  // whether "Link X" starts OAuth or just needs the on-chain confirm signature.
  useEffect(() => {
    fetch("/api/waitlist/x")
      .then((r) => r.json())
      .then((d) => setXLinkedCookie(Boolean(d?.linked)))
      .catch(() => {});
  }, [status]);

  const onConnect = useCallback(async () => {
    try {
      await connect({
        client,
        wallets: WALLETS,
        chain: ARC_CHAIN,
        appMetadata: APP_METADATA,
      });
    } catch (e) {
      /* A user closing the modal also rejects here, so this isn't necessarily
         an error — but a WalletConnect init failure lands here too and used to
         be invisible (tap a wallet on mobile and nothing happens, no QR). Log
         it so it can be read via remote debugging instead of swallowed. */
      console.error("[waitlist] wallet connect:", e);
    }
  }, [connect]);

  const onClaim = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    setError(null);
    try {
      await ensureArc();
      const signature = await account.signMessage({
        message: joinMessage(account.address),
      });
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: account.address, signature, ref }),
      });
      const d = await res.json();
      if (!res.ok) setError(d.error || "Something went wrong. Try again.");
      else setStatus(d);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setError(
        /reject|denied/i.test(msg)
          ? "Rejected. Approve the Arc switch and signature to claim."
          : /chain|network|switch|4902/i.test(msg)
            ? "Couldn't switch to Arc. Add the Arc network and try again."
            : "Could not register.",
      );
    } finally {
      setLoading(false);
    }
  }, [account, ref, ensureArc]);

  /* Daily check-in: once per UTC day, enforced server-side. */
  const [checkin, setCheckin] = useState<{
    checkedInToday: boolean;
    days: number;
    streak?: number;
    welcomeLeft?: number;
    gotWelcome?: boolean;
  } | null>(null);
  const [checkinBusy, setCheckinBusy] = useState(false);
  const loadCheckin = useCallback(async () => {
    if (!account) return setCheckin(null);
    try {
      const r = await fetch(
        `/api/rewards/checkin?address=${account.address}`,
        { cache: "no-store" },
      );
      if (r.ok) setCheckin(await r.json());
    } catch {
      /* leave the last state */
    }
  }, [account]);
  useEffect(() => {
    void loadCheckin();
  }, [loadCheckin]);
  const doCheckin = useCallback(async () => {
    if (!account || checkinBusy) return;
    setCheckinBusy(true);
    setError(null);
    try {
      const signature = await account.signMessage({
        message: checkinMessage(account.address, utcDay()),
      });
      const res = await fetch("/api/rewards/checkin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: account.address, signature }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setError(d.error || "Couldn't check in. Try again.");
      await loadCheckin();
      await loadStatus();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setError(/reject|denied/i.test(msg) ? "Signature rejected." : "Something went wrong.");
    } finally {
      setCheckinBusy(false);
    }
  }, [account, checkinBusy, loadCheckin, loadStatus]);

  // Sign the task message and record it. Refreshes standing on success.
  const postXTask = useCallback(
    async (task: XTaskKey) => {
      if (!account) return;
      setXBusy(task);
      setError(null);
      try {
        await ensureArc();
        const signature = await account.signMessage({
          message: xTaskMessage(account.address, task),
        });
        const res = await fetch("/api/waitlist/x", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address: account.address, signature, task }),
        });
        const d = await res.json();
        if (!res.ok) setError(d.error || "Couldn't record that. Try again.");
        else await loadStatus();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        setError(
          /reject|denied/i.test(msg)
            ? "Signature rejected."
            : "Something went wrong.",
        );
      } finally {
        setXBusy(null);
      }
    },
    [account, loadStatus, ensureArc],
  );

  const verifyTransactionTask = useCallback(
    async () => {
      if (!account || transactionBusy) return;
      setTransactionBusy("bridge");
      setError(null);
      try {
        /* The bridge may be logged on ANY chain: a bridge into Arc is logged
           under its source chain (Base, BSC), not the Arc chain the user is
           on now. Reading only the active chain's log sent no hash for every
           inbound bridge, and the server then refused it. Search every chain's
           log for this wallet and send the chain the bridge actually left. A
           pasted hash wins; the server locates it on any chain regardless. */
        const inputHash = txHashInputs.bridge.trim();
        const logged = inputHash
          ? null
          : findLatestAcrossChains(
              Object.keys(CHAINS_BY_ID).map(Number),
              account.address,
              "bridge",
            );
        const txHash = inputHash || logged?.entry.hash;
        const txChainId = logged?.chainId ?? activeChain?.id;
        const signature = await account.signMessage({
          message: transactionTaskMessage(account.address),
        });
        const res = await fetch("/api/waitlist/transaction", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            address: account.address,
            signature,
            task: "bridge",
            chainId: txChainId,
            ...(txHash ? { txHash, operation: "bridge" } : {}),
          }),
        });
        const d = await res.json();
        if (!res.ok) setError(d.error || "Transaction not verified.");
        else await loadStatus();
      } catch (e) {
        setError(
          e instanceof Error && /reject|denied/i.test(e.message)
            ? "Signature rejected."
            : "Could not verify transaction.",
        );
      } finally {
        setTransactionBusy(null);
      }
    },
    [
      account,
      activeChain?.id,
      loadStatus,
      transactionBusy,
      txHashInputs,
    ],
  );

  const openKaleidoForBridgeTask = useCallback(() => {
    if (!account?.address) return;
    window.localStorage.setItem(bridgeOpenedKey(account.address), "1");
    setBridgeOpened(true);
    window.location.href = "/trade/agent";
  }, [account?.address]);

  // Link X: start OAuth if no X session in this browser yet, otherwise the
  // account is known and we just need the wallet's confirming signature.
  const onLinkX = useCallback(() => {
    if (xLinkedCookie) {
      void postXTask("link");
    } else {
      window.location.href = "/api/auth/twitter?returnTo=/rewards";
    }
  }, [xLinkedCookie, postXTask]);

  const openIntent = useCallback(
    (task: "follow" | "retweet" | "comment" | "launch" | "llama" | "argus" | "argus2") => {
      const url =
        task === "follow"
          ? `https://x.com/intent/follow?screen_name=${X_HANDLE}`
          : task === "retweet"
            ? `https://x.com/intent/retweet?tweet_id=${ANNOUNCE_TWEET_ID ?? ""}`
            : task === "comment"
              ? `https://x.com/intent/tweet?in_reply_to=${ANNOUNCE_TWEET_ID ?? ""}`
                : task === "argus" || task === "argus2"
                  ? `https://x.com/kaleido_finance/status/${ARGUS_TWEET_ID}`
                : `https://x.com/kaleido_finance/status/${MAINNET_LAUNCH_TWEET_ID}`;
      window.open(url, "_blank", "noopener,noreferrer");
      setOpened((o) => ({ ...o, [task]: true }));
    },
    [],
  );

  const link =
    status && typeof window !== "undefined"
      ? `${window.location.origin}/rewards?ref=${status.refCode}`
      : "";

  const copy = useCallback(() => {
    if (!link) return;
    navigator.clipboard
      ?.writeText(link)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }, [link]);

  return (
    <>
      <Nav />
      <main className={s.page}>
      <header className={s.head}>
        <p className={s.eyebrow}>Kaleido Season 1 · Arc rewards</p>
        <h1 className={`${s.h1} k-display`}>
          {status ? "Your Arc rewards." : "Join Kaleido on Arc."}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className={s.arcMark}
            src="/arc-mark.png"
            alt="Arc"
            width={64}
            height={64}
          />
        </h1>
        {/* The hero pitch is for visitors who haven't registered yet. Once
            someone has claimed (status set), the card below carries their
            balance and tasks, so drop the long description rather than repeat
            the sell — just confirm they're in. */}
        {!status ? (
          <p className={s.lede}>
            Kaleido is live on Arc. Claim your welcome points, complete launch
            tasks, refer friends to earn more, and climb the Season&nbsp;1
            board. Points continue through our pre-TGE rewards season.
          </p>
        ) : null}
      </header>

      <section className={`${s.card} k-glass`}>
        {account && !statusReady ? (
          <>
            <p className={s.cardLede}>
              {statusError ?? "Loading your waitlist balance…"}
            </p>
            {statusError ? (
              <button className={s.primary} onClick={() => void loadStatus()}>
                Retry
              </button>
            ) : null}
          </>
        ) : null}
        {account && statusReady ? (
          <>
            {!account ? (
              <>
                <p className={s.cardLede}>
                  Connect a wallet to claim <strong>100 welcome points</strong>
                  {ref ? " (a friend referred you — you'll get a bonus)" : ""}.
                </p>
                <button
                  className={s.primary}
                  onClick={onConnect}
                  disabled={isConnecting}
                >
                  {isConnecting ? "Connecting…" : "Connect wallet"}
                </button>
                <p className={s.split}>
                  On mobile? Tap <strong>WalletConnect</strong> to open your
                  MetaMask, Coinbase, or Rainbow app, or open this page in a
                  desktop browser.
                </p>
              </>
            ) : !status ? (
              <>
                <p className={s.cardLede}>
                  You&rsquo;re one signature away. It&rsquo;s free — no gas, no
                  deposit.{ref ? " Your referral bonus is applied." : ""}
                </p>
                <button
                  className={s.primary}
                  onClick={onClaim}
                  disabled={loading}
                >
                  {loading
                    ? "Claiming…"
                    : onArc
                      ? "Claim my points"
                      : "Switch to Arc & claim"}
                </button>
                {account && !onArc ? (
                  <p className={s.split}>
                    You&rsquo;ll be switched to Arc mainnet to sign.
                  </p>
                ) : null}
                {error ? <p className={s.error}>{error}</p> : null}
              </>
            ) : (
              <>
                {/* Once the wallet has a Season 1 balance, the headline IS the
                    leaderboard number (point_balances.total) — tasks plus
                    trading plus liquidity — so the two pages always agree.
                    Before activation there is no Season 1 balance yet, and the
                    card shows the pending task total it will convert. */}
                {status.season1 ? (
                  <>
                    <p className={s.pLabel}>Your Season&nbsp;1 points</p>
                    <p className={s.big}>
                      {Math.floor(status.season1.total).toLocaleString()}
                      <span className={s.unit}>$kPoint</span>
                    </p>
                    <p className={s.split}>
                      {[
                        `${Math.floor(status.season1.tasks).toLocaleString()} from tasks`,
                        status.season1.trading >= 1
                          ? `${Math.floor(status.season1.trading).toLocaleString()} from trading`
                          : null,
                        status.season1.liquidity >= 1
                          ? `${Math.floor(status.season1.liquidity).toLocaleString()} from liquidity`
                          : null,
                        status.season1.other >= 1
                          ? `${Math.floor(status.season1.other).toLocaleString()} bonus`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {status.points > status.season1.tasks ? (
                      <p className={s.held}>
                        +{(status.points - status.season1.tasks).toLocaleString()} $kPoint
                        from tasks · added to your total within a few minutes
                      </p>
                    ) : null}
                  </>
                ) : (
                  <>
                    <p className={s.pLabel}>Your pending balance</p>
                    <p className={s.big}>
                      {status.points.toLocaleString()}
                      <span className={s.unit}>$kPoint</span>
                    </p>
                    <p className={s.split}>
                      {status.welcomePoints} welcome
                      {status.referralPoints > 0
                        ? ` · ${status.referralPoints} from ${status.referrals} referral${status.referrals === 1 ? "" : "s"}`
                        : ""}
                      {status.rank ? ` · rank #${status.rank}` : ""}
                    </p>
                  </>
                )}
                {status.heldPoints > 0 ? (
                  <p className={s.held}>
                    +{status.heldPoints} $kPoint from X tasks · counts within 5h
                  </p>
                ) : null}

                <p className={s.refLabel}>Earn more $kPoint</p>
                {error ? <p className={s.error}>{error}</p> : null}
                <ul className={s.tasks}>
                  <li className={s.task}>
                    <div className={s.taskText}>
                      <span className={s.taskTitle}>
                        Daily check-in
                        {!checkin?.gotWelcome && (checkin?.welcomeLeft ?? 0) > 0
                          ? ` · 🎉 +${WELCOME_BONUS} for the first 100 (${checkin?.welcomeLeft} left)`
                          : checkin?.gotWelcome
                            ? ` · 🎉 +${WELCOME_BONUS} early bonus earned`
                            : ""}
                      </span>
                      <span className={s.taskMeta}>
                        {!status.season1
                          ? "Unlocks once your wallet is active on Arc"
                          : checkin?.checkedInToday
                            ? `Checked in · ${streakLabel(checkin.streak ?? 1)} · next in ${Math.ceil(msUntilNextUtcDay() / 3_600_000)}h`
                            : `+${CHECKIN_POINTS} $kPoint daily · +${STREAK_BONUS} every ${STREAK_LENGTH}-day streak${checkin?.streak ? ` · ${streakLabel(checkin.streak)}` : ""}`}
                      </span>
                    </div>
                    {checkin?.checkedInToday ? (
                      <span className={s.taskDone}>✓</span>
                    ) : !status.season1 ? (
                      <span className={s.taskLock}>🔒</span>
                    ) : (
                      <button
                        className={s.taskBtn}
                        onClick={doCheckin}
                        disabled={checkinBusy}
                      >
                        {checkinBusy ? "…" : "Check in"}
                      </button>
                    )}
                  </li>
                  <li className={s.task}>
                    <div className={s.taskText}>
                      <span className={s.taskTitle}>Link your X account</span>
                      <span className={s.taskMeta}>
                        {status.xTasks.linked.done
                          ? `Linked${status.xHandle ? ` @${status.xHandle}` : ""}${status.xTasks.linked.counted ? "" : " · counts within 5h"}`
                          : "+100 $kPoint"}
                      </span>
                    </div>
                    {status.xTasks.linked.done ? (
                      <span className={s.taskDone}>✓</span>
                    ) : (
                      <button
                        className={s.taskBtn}
                        onClick={onLinkX}
                        disabled={xBusy === "link"}
                      >
                        {xBusy === "link"
                          ? "…"
                          : xLinkedCookie
                            ? "Confirm"
                            : "Link X"}
                      </button>
                    )}
                  </li>

                  <li className={s.task}>
                    <div className={s.taskText}>
                      <span className={s.taskTitle}>Follow @{X_HANDLE}</span>
                      <span className={s.taskMeta}>
                        {status.xTasks.followed.done
                          ? status.xTasks.followed.counted
                            ? "Done"
                            : "Done · counts within 5h"
                          : status.xTasks.linked.done
                            ? "+100 $kPoint"
                            : "Link X first"}
                      </span>
                    </div>
                    {status.xTasks.followed.done ? (
                      <span className={s.taskDone}>✓</span>
                    ) : !status.xTasks.linked.done ? (
                      <span className={s.taskLock}>🔒</span>
                    ) : opened.follow ? (
                      <button
                        className={s.taskBtn}
                        onClick={() => postXTask("follow")}
                        disabled={xBusy === "follow"}
                      >
                        {xBusy === "follow" ? "…" : "Claim"}
                      </button>
                    ) : (
                      <button
                        className={s.taskBtn}
                        onClick={() => openIntent("follow")}
                      >
                        Follow
                      </button>
                    )}
                  </li>

                  <li className={s.task}>
                    <div className={s.taskText}>
                      <span className={s.taskTitle}>
                        Like &amp; repost the Mainnet Launch post
                      </span>
                      <span className={s.taskMeta}>
                        {status.xTasks.launch.done
                          ? status.xTasks.launch.counted
                            ? "Done"
                            : "Done · counts within 5h"
                          : status.xTasks.launch.closed
                            ? "Closed"
                            : !status.xTasks.linked.done
                              ? "Link X first"
                              : "+100 $kPoint"}
                      </span>
                    </div>
                    {status.xTasks.launch.done ? (
                      <span className={s.taskDone}>✓</span>
                    ) : status.xTasks.launch.closed ? (
                      <span className={s.taskLock}>🔒</span>
                    ) : !status.xTasks.linked.done ? (
                      <span className={s.taskLock}>🔒</span>
                    ) : opened.launch ? (
                      <button
                        className={s.taskBtn}
                        onClick={() => postXTask("launch")}
                        disabled={xBusy === "launch"}
                      >
                        {xBusy === "launch" ? "…" : "Claim"}
                      </button>
                    ) : (
                      <button
                        className={s.taskBtn}
                        onClick={() => openIntent("launch")}
                      >
                        Open post
                      </button>
                    )}
                  </li>

                  {/* Batch 2 takes the row once batch 1 is full, for wallets
                      that missed it (a batch-1 wallet keeps its ✓ row). */}
                  {status.xTasks.argus?.closed && !status.xTasks.argus?.done ? (
                  <li className={s.task}>
                    <div className={s.taskText}>
                      <span className={s.taskTitle}>
                        RT &amp; comment on the $ARGUS listing · batch 2
                      </span>
                      <span className={s.taskMeta}>
                        {status.xTasks.argus2?.done
                          ? status.xTasks.argus2.counted
                            ? "Done"
                            : "Done · counts within 5h"
                          : status.xTasks.argus2?.closed
                            ? "Closed · all 50 spots claimed"
                            : !status.xTasks.linked.done
                              ? "Link X first"
                              : "50 more spots · +300 $kPoint"}
                      </span>
                    </div>
                    {status.xTasks.argus2?.done ? (
                      <span className={s.taskDone}>✓</span>
                    ) : status.xTasks.argus2?.closed || !status.xTasks.linked.done ? (
                      <span className={s.taskLock}>🔒</span>
                    ) : opened.argus2 ? (
                      <button
                        className={s.taskBtn}
                        onClick={() => postXTask("argus2")}
                        disabled={xBusy === "argus2"}
                      >
                        {xBusy === "argus2" ? "…" : "Claim"}
                      </button>
                    ) : (
                      <button
                        className={s.taskBtn}
                        onClick={() => openIntent("argus2")}
                      >
                        RT &amp; comment
                      </button>
                    )}
                  </li>
                  ) : (
                  <li className={s.task}>
                    <div className={s.taskText}>
                      <span className={s.taskTitle}>
                        RT &amp; comment on the $ARGUS listing
                      </span>
                      <span className={s.taskMeta}>
                        {status.xTasks.argus?.done
                          ? status.xTasks.argus.counted
                            ? "Done"
                            : "Done · counts within 5h"
                          : status.xTasks.argus?.closed
                            ? "Closed · all 100 spots claimed"
                            : !status.xTasks.linked.done
                              ? "Link X first"
                              : "First 100 wallets · +600 $kPoint"}
                      </span>
                    </div>
                    {status.xTasks.argus?.done ? (
                      <span className={s.taskDone}>✓</span>
                    ) : status.xTasks.argus?.closed || !status.xTasks.linked.done ? (
                      <span className={s.taskLock}>🔒</span>
                    ) : opened.argus ? (
                      <button
                        className={s.taskBtn}
                        onClick={() => postXTask("argus")}
                        disabled={xBusy === "argus"}
                      >
                        {xBusy === "argus" ? "…" : "Claim"}
                      </button>
                    ) : (
                      <button
                        className={s.taskBtn}
                        onClick={() => openIntent("argus")}
                      >
                        RT &amp; comment
                      </button>
                    )}
                  </li>
                  )}

                  {/* Swap-volume milestones. Completion is derived on-chain from
                  the wallet's credited Kaleido swap volume (see lib/waitlist/
                  swapVolume), so there is nothing to verify by hand — a tier
                  lights up once the swaps are indexed. Highest reached tier pays;
                  lower completed tiers read "included" so shown points match the
                  credited total. */}
                  {(status.swapVolume?.tiers ?? []).map((tier) => (
                    <li key={tier.key} className={s.task}>
                      <div className={s.taskText}>
                        <span className={s.taskTitle}>
                          {`Make min $${tier.threshold} swap volume on Kaleido`}
                        </span>
                        <span className={s.taskMeta}>
                          {tier.done
                            ? tier.superseded
                              ? "Done · included in higher tier"
                              : `Done · +${tier.displayPoints} $kPoint`
                            : `+${tier.displayPoints} $kPoint · $${(status.swapVolume?.volumeUsd ?? 0).toLocaleString(
                                undefined,
                                { maximumFractionDigits: 2 },
                              )} / $${tier.threshold}`}
                        </span>
                      </div>
                      {tier.done ? (
                        <span className={s.taskDone}>✓</span>
                      ) : (
                        <button
                          className={s.taskBtn}
                          onClick={() => {
                            window.location.href = "/trade/swap";
                          }}
                        >
                          Trade
                        </button>
                      )}
                    </li>
                  ))}

                  <li className={s.task}>
                    <div className={s.taskText}>
                      <span className={s.taskTitle}>
                        Use Luca agent to Bridge assets in/out of Arc
                      </span>
                      <span className={s.taskMeta}>
                        {status.transactionTasks?.bridge?.done
                          ? "Done"
                          : bridgeOpened
                            ? "+500 $kPoint · Verify on-chain"
                            : "+500 $kPoint · Bridge in/out of Arc first"}
                      </span>
                      {!status.transactionTasks?.bridge?.done && bridgeOpened ? (
                        <input
                          className={s.taskHashInput}
                          value={txHashInputs.bridge}
                          onChange={(event) =>
                            setTxHashInputs((current) => ({
                              ...current,
                              bridge: event.target.value,
                            }))
                          }
                          placeholder="Paste tx hash (optional)"
                          aria-label="Bridge transaction hash"
                          spellCheck={false}
                        />
                      ) : null}
                    </div>
                    {status.transactionTasks?.bridge?.done ? (
                      <span className={s.taskDone}>✓</span>
                    ) : (
                      <button
                        className={s.taskBtn}
                        onClick={
                          bridgeOpened
                            ? () => void verifyTransactionTask()
                            : openKaleidoForBridgeTask
                        }
                        disabled={transactionBusy !== null}
                      >
                        {transactionBusy === "bridge"
                          ? "Checking…"
                          : bridgeOpened
                            ? "Verify"
                            : "Open Kaleido"}
                      </button>
                    )}
                  </li>
                </ul>

                <p className={s.refLabel}>Your referral link — you both earn</p>
                <div className={s.refRow}>
                  <input
                    className={s.refInput}
                    readOnly
                    value={link}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button className={s.copy} onClick={copy}>
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                {/* Always-visible referral scoreboard, even at zero, so the payoff of
                sharing is on screen. The summary line under the balance only
                surfaces referral points once there's at least one referral. */}
                <p className={s.split}>
                  {status.referrals === 0
                    ? "No referrals yet — earn 50 $kPoint for each friend who joins and links their X."
                    : `${status.referrals} friend${status.referrals === 1 ? "" : "s"} joined & linked X · ${status.referralPoints.toLocaleString()} $kPoint earned`}
                </p>

                {status.season1 ? null : (
                  <p className={s.note}>
                    Points are pending. They convert to Season&nbsp;1 points on
                    your first trade on Arc mainnet — so they can&rsquo;t be
                    farmed, and they&rsquo;re waiting for you at launch.
                  </p>
                )}
              </>
            )}
          </>
        ) : null}
        {!account ? (
          <>
            <p className={s.cardLede}>
              Connect a wallet to claim <strong>100 welcome points</strong>
              {ref ? " (a friend referred you — you'll get a bonus)" : ""}.
            </p>
            <button
              className={s.primary}
              onClick={onConnect}
              disabled={isConnecting}
            >
              {isConnecting ? "Connecting…" : "Connect wallet"}
            </button>
            <p className={s.split}>
              On mobile? Tap <strong>WalletConnect</strong> to open your
              MetaMask, Coinbase, or Rainbow app, or open this page in a desktop
              browser.
            </p>
          </>
        ) : null}
      </section>

    </main>
    </>
  );
}
