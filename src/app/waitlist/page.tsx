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
import s from "./waitlist.module.css";

/**
 * The private/unofficial Arc mainnet — defined inline and scoped to this page on
 * purpose. The waitlist join is a chain-agnostic signature, but we switch the
 * wallet to Arc before signing so the act of joining happens on Arc. This is NOT
 * wired into the app's global chain registry.
 */
const ARC_CHAIN_ID = 5042;
const ARC_CHAIN = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc",
  rpc: "https://rpc.arc-scan.org",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  blockExplorers: [{ name: "Arc Scan", url: "https://arc-scan.org" }],
});

type XTask = { done: boolean; counted: boolean; countsAt: string | null };
type Status = {
  refCode: string;
  referrals: number;
  rank: number | null;
  points: number;
  heldPoints: number;
  welcomePoints: number;
  referralPoints: number;
  xHandle: string | null;
  xTasks: {
    linked: XTask;
    followed: XTask;
    retweeted: XTask;
    commented: XTask;
    bitget: XTask;
  };
  activated: boolean;
  transactionTasks: {
    arcMainnet: { done: boolean };
    agent: { done: boolean };
    bridge: { done: boolean };
  };
} | null;

type Leader = { rank: number; wallet: string; referrals: number };
type XTaskKey = "link" | "follow" | "retweet" | "comment" | "bitget";

const X_HANDLE = "kaleido_finance";
// The launch post users repost for +100 $kPoint. Defaulted to the live announce
// tweet so the task works without a separate Vercel env step at launch; the
// NEXT_PUBLIC var still overrides it if we ever point the task at a different post.
const ANNOUNCE_TWEET_ID =
  process.env.NEXT_PUBLIC_WAITLIST_ANNOUNCE_TWEET_ID ?? "2099572698380730531";
const BITGET_TWEET_ID = "2101042491864629430";
const agentOpenedKey = (address: string) => `kaleido.waitlist.agent-opened:${address.toLowerCase()}`;
const bridgeOpenedKey = (address: string) => `kaleido.waitlist.bridge-opened:${address.toLowerCase()}`;

/** Must match the message the API rebuilds and verifies. */
const joinMessage = (address: string) =>
  `Join the Kaleido Pre-Season 1 Arc waitlist.\nWallet: ${address}`;

/** Must match xTaskMessage in /api/waitlist/x. */
const xTaskMessage = (address: string, task: XTaskKey) =>
  task === "link"
    ? `Link my X account to the Kaleido waitlist wallet ${address}.`
    : `Confirm my Kaleido waitlist X ${task} for wallet ${address}.`;
const transactionTaskMessage = (address: string, task: "arcMainnet" | "agent" | "bridge", txHash?: string) =>
  task === "arcMainnet"
    ? `Confirm my Kaleido Arc mainnet transaction for wallet ${address}.`
    : task === "agent"
      ? txHash
        ? `Confirm my first Kaleido agent transaction ${txHash} for wallet ${address}.`
        : `Confirm my first Kaleido agent transaction for wallet ${address}.`
      : `Confirm my first Kaleido bridge transaction for wallet ${address}.`;

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
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [xLinkedCookie, setXLinkedCookie] = useState(false);
  const [opened, setOpened] = useState<{
    follow: boolean;
    retweet: boolean;
    comment: boolean;
    bitget: boolean;
  }>({
    follow: false,
    retweet: false,
    comment: false,
    bitget: false,
  });
  const [xBusy, setXBusy] = useState<XTaskKey | null>(null);
  const [transactionBusy, setTransactionBusy] = useState<"arcMainnet" | "agent" | "bridge" | null>(null);
  const [agentOpened, setAgentOpened] = useState(false);
  const [bridgeOpened, setBridgeOpened] = useState(false);

  useEffect(() => {
    try {
      const r = new URLSearchParams(window.location.search).get("ref");
      if (r) setRef(r);
    } catch {
      /* no query */
    }
  }, []);

  useEffect(() => {
    fetch("/api/waitlist/leaderboard")
      .then((r) => r.json())
      .then((d) => setLeaders(d.leaders ?? []))
      .catch(() => {});
  }, [status]);

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
      const res = await fetch(`/api/waitlist?wallet=${addr}`, { cache: "no-store" });
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
      setAgentOpened(false);
      setBridgeOpened(false);
      return;
    }
    setAgentOpened(window.localStorage.getItem(agentOpenedKey(account.address)) === "1");
    setBridgeOpened(window.localStorage.getItem(bridgeOpenedKey(account.address)) === "1");
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
      await connect({ client, wallets: WALLETS, appMetadata: APP_METADATA });
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
        setError(/reject|denied/i.test(msg) ? "Signature rejected." : "Something went wrong.");
      } finally {
        setXBusy(null);
      }
    },
    [account, loadStatus, ensureArc],
  );

  const verifyTransactionTask = useCallback(async (task: "arcMainnet" | "agent" | "bridge") => {
    if (!account || transactionBusy) return;
    setTransactionBusy(task);
    setError(null);
    try {
      if (task === "arcMainnet") await ensureArc();
      const signature = await account.signMessage({ message: transactionTaskMessage(account.address, task) });
      const res = await fetch("/api/waitlist/transaction", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: account.address, signature, task, chainId: activeChain?.id }),
      });
      const d = await res.json();
      if (!res.ok) setError(d.error || "Transaction not verified.");
      else await loadStatus();
    } catch (e) {
      setError(e instanceof Error && /reject|denied/i.test(e.message) ? "Signature rejected." : "Could not verify transaction.");
    } finally {
      setTransactionBusy(null);
    }
  }, [account, activeChain?.id, ensureArc, loadStatus, transactionBusy]);

  const openKaleidoForAgentTask = useCallback(() => {
    if (!account?.address) return;
    window.localStorage.setItem(agentOpenedKey(account.address), "1");
    setAgentOpened(true);
    window.location.href = "/trade/agent";
  }, [account?.address]);

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
      window.location.href = "/api/auth/twitter?returnTo=/waitlist";
    }
  }, [xLinkedCookie, postXTask]);

  const openIntent = useCallback((task: "follow" | "retweet" | "comment" | "bitget") => {
    const url =
      task === "follow"
        ? `https://x.com/intent/follow?screen_name=${X_HANDLE}`
        : task === "retweet"
          ? `https://x.com/intent/retweet?tweet_id=${ANNOUNCE_TWEET_ID ?? ""}`
          : task === "comment"
            ? `https://x.com/intent/tweet?in_reply_to=${ANNOUNCE_TWEET_ID ?? ""}`
            : `https://x.com/kaleido_finance/status/${BITGET_TWEET_ID}`;
    window.open(url, "_blank", "noopener,noreferrer");
    setOpened((o) => ({ ...o, [task]: true }));
  }, []);

  const link =
    status && typeof window !== "undefined"
      ? `${window.location.origin}/waitlist?ref=${status.refCode}`
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
    <main className={s.page}>
      <header className={s.head}>
        <p className={s.eyebrow}>Kaleido Pre-Season 1 · Arc waitlist</p>
        <h1 className={`${s.h1} k-display`}>
          {status ? "You're in line for Arc." : "Get in line for Arc."}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={s.arcMark} src="/arc-mark.png" alt="Arc" width={64} height={64} />
        </h1>
        {/* The hero pitch is for visitors who haven't registered yet. Once
            someone has claimed (status set), the card below carries their
            balance and tasks, so drop the long description rather than repeat
            the sell — just confirm they're in. */}
        {!status ? (
          <p className={s.lede}>
            Agentic DeFi, live on Arc from Day&nbsp;1 (Sep&nbsp;16). Claim your
            welcome points, refer friends to earn more, and climb the board
            before mainnet. Points feed Season&nbsp;1, our pre-TGE points season.
          </p>
        ) : null}
      </header>

      <section className={`${s.card} k-glass`}>
        {account && !statusReady ? (
          <>
            <p className={s.cardLede}>{statusError ?? "Loading your waitlist balance…"}</p>
            {statusError ? <button className={s.primary} onClick={() => void loadStatus()}>Retry</button> : null}
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
            <button className={s.primary} onClick={onConnect} disabled={isConnecting}>
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
            <button className={s.primary} onClick={onClaim} disabled={loading}>
              {loading
                ? "Claiming…"
                : onArc
                  ? "Claim my points"
                  : "Switch to Arc & claim"}
            </button>
            {account && !onArc ? (
              <p className={s.split}>You&rsquo;ll be switched to Arc mainnet to sign.</p>
            ) : null}
            {error ? <p className={s.error}>{error}</p> : null}
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
            {status.heldPoints > 0 ? (
              <p className={s.held}>+{status.heldPoints} $kPoint from X tasks · counts within 5h</p>
            ) : null}

            <p className={s.refLabel}>Earn more $kPoint</p>
            {error ? <p className={s.error}>{error}</p> : null}
            <ul className={s.tasks}>
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
                  <button className={s.taskBtn} onClick={onLinkX} disabled={xBusy === "link"}>
                    {xBusy === "link" ? "…" : xLinkedCookie ? "Confirm" : "Link X"}
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
                  <button className={s.taskBtn} onClick={() => postXTask("follow")} disabled={xBusy === "follow"}>
                    {xBusy === "follow" ? "…" : "Claim"}
                  </button>
                ) : (
                  <button className={s.taskBtn} onClick={() => openIntent("follow")}>Follow</button>
                )}
              </li>

              <li className={s.task}>
                <div className={s.taskText}>
                  <span className={s.taskTitle}>Repost the launch post</span>
                  <span className={s.taskMeta}>
                    {status.xTasks.retweeted.done
                      ? status.xTasks.retweeted.counted
                        ? "Done"
                        : "Done · counts within 5h"
                      : !status.xTasks.linked.done
                        ? "Link X first"
                        : ANNOUNCE_TWEET_ID
                          ? "+100 $kPoint"
                          : "Coming soon"}
                  </span>
                </div>
                {status.xTasks.retweeted.done ? (
                  <span className={s.taskDone}>✓</span>
                ) : !status.xTasks.linked.done || !ANNOUNCE_TWEET_ID ? (
                  <span className={s.taskLock}>🔒</span>
                ) : opened.retweet ? (
                  <button className={s.taskBtn} onClick={() => postXTask("retweet")} disabled={xBusy === "retweet"}>
                    {xBusy === "retweet" ? "…" : "Claim"}
                  </button>
                ) : (
                  <button className={s.taskBtn} onClick={() => openIntent("retweet")}>Repost</button>
                )}
              </li>

              <li className={s.task}>
                <div className={s.taskText}>
                  <span className={s.taskTitle}>Comment on the launch post</span>
                  <span className={s.taskMeta}>
                    {status.xTasks.commented.done
                      ? status.xTasks.commented.counted
                        ? "Done"
                        : "Done · counts within 5h"
                      : !status.xTasks.linked.done
                        ? "Link X first"
                        : ANNOUNCE_TWEET_ID
                          ? "+50 $kPoint"
                          : "Coming soon"}
                  </span>
                </div>
                {status.xTasks.commented.done ? (
                  <span className={s.taskDone}>✓</span>
                ) : !status.xTasks.linked.done || !ANNOUNCE_TWEET_ID ? (
                  <span className={s.taskLock}>🔒</span>
                ) : opened.comment ? (
                  <button className={s.taskBtn} onClick={() => postXTask("comment")} disabled={xBusy === "comment"}>
                    {xBusy === "comment" ? "…" : "Claim"}
                  </button>
                ) : (
                  <button className={s.taskBtn} onClick={() => openIntent("comment")}>Comment</button>
                )}
              </li>

              <li className={s.task}>
                <div className={s.taskText}>
                  <span className={s.taskTitle}>Like &amp; repost the Bitget Wallet integration post</span>
                  <span className={s.taskMeta}>
                    {status.xTasks.bitget.done
                      ? status.xTasks.bitget.counted ? "Done" : "Done · counts within 5h"
                      : !status.xTasks.linked.done ? "Link X first" : "+100 $kPoint"}
                  </span>
                </div>
                {status.xTasks.bitget.done ? (
                  <span className={s.taskDone}>✓</span>
                ) : !status.xTasks.linked.done ? (
                  <span className={s.taskLock}>🔒</span>
                ) : opened.bitget ? (
                  <button className={s.taskBtn} onClick={() => postXTask("bitget")} disabled={xBusy === "bitget"}>
                    {xBusy === "bitget" ? "…" : "Claim"}
                  </button>
                ) : (
                  <button className={s.taskBtn} onClick={() => openIntent("bitget")}>Open post</button>
                )}
              </li>

              {/* Arc testnet is live today, but this stays a locked "Coming soon"
                  teaser like the rest until it's wired to a real on-chain status. */}
              <li className={s.task}>
                <div className={s.taskText}>
                  <span className={s.taskTitle}>Make 1st transaction on Arc Testnet</span>
                  <span className={s.taskMeta}>+500 $kPoint · Coming soon</span>
                </div>
                <span className={s.taskLock}>🔒</span>
              </li>

              <li className={s.task}>
                <div className={s.taskText}>
                  <span className={s.taskTitle}>Perform 1st transaction on Arc Mainnet</span>
                  <span className={s.taskMeta}>{status.transactionTasks.arcMainnet.done ? "Done" : "+300 $kPoint · Verify on-chain"}</span>
                </div>
                {status.transactionTasks.arcMainnet.done ? <span className={s.taskDone}>✓</span> : <button className={s.taskBtn} onClick={() => void verifyTransactionTask("arcMainnet")} disabled={transactionBusy !== null}>{transactionBusy === "arcMainnet" ? "Checking…" : "Verify"}</button>}
              </li>

              <li className={s.task}>
                <div className={s.taskText}>
                  <span className={s.taskTitle}>Make 1st transaction on Kaleido</span>
                  <span className={s.taskMeta}>{status.transactionTasks.agent.done ? "Done" : agentOpened ? "+500 $kPoint · Verify successful tx" : "+500 $kPoint · Make a trade in Kaleido first"}</span>
                </div>
                {status.transactionTasks.agent.done ? <span className={s.taskDone}>✓</span> : <button className={s.taskBtn} onClick={agentOpened ? () => void verifyTransactionTask("agent") : openKaleidoForAgentTask} disabled={transactionBusy !== null}>{transactionBusy === "agent" ? "Checking…" : agentOpened ? "Verify" : "Open Kaleido"}</button>}
              </li>

              <li className={s.task}>
                <div className={s.taskText}>
                  <span className={s.taskTitle}>Use Luca agent to Bridge assets in/out of Arc</span>
                  <span className={s.taskMeta}>{status.transactionTasks.bridge.done ? "Done" : bridgeOpened ? "+500 $kPoint · Verify on-chain" : "+500 $kPoint · Bridge in/out of Arc first"}</span>
                </div>
                {status.transactionTasks.bridge.done ? <span className={s.taskDone}>✓</span> : <button className={s.taskBtn} onClick={bridgeOpened ? () => void verifyTransactionTask("bridge") : openKaleidoForBridgeTask} disabled={transactionBusy !== null}>{transactionBusy === "bridge" ? "Checking…" : bridgeOpened ? "Verify" : "Open Kaleido"}</button>}
              </li>
            </ul>

            <p className={s.refLabel}>Your referral link — you both earn</p>
            <div className={s.refRow}>
              <input className={s.refInput} readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
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

            <p className={s.note}>
              Points are pending. They convert to Season&nbsp;1 points on your
              first trade on Arc mainnet — so they can&rsquo;t be farmed, and
              they&rsquo;re waiting for you at launch.
            </p>
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
            <button className={s.primary} onClick={onConnect} disabled={isConnecting}>
              {isConnecting ? "Connecting…" : "Connect wallet"}
            </button>
            <p className={s.split}>
              On mobile? Tap <strong>WalletConnect</strong> to open your
              MetaMask, Coinbase, or Rainbow app, or open this page in a
              desktop browser.
            </p>
          </>
        ) : null}
      </section>

      {leaders.length > 0 ? (
        <section className={s.board}>
          <h2 className={s.boardHead}>Top referrers</h2>
          <ol className={s.list}>
            {leaders.map((l) => (
              <li key={l.rank} className={s.row}>
                <span className={s.rank}>#{l.rank}</span>
                <span className={s.addr}>{l.wallet}</span>
                <span className={s.count}>{l.referrals}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </main>
  );
}
