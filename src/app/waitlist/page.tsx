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
import { WALLETS } from "@/config/wallets";
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
  xTasks: { linked: XTask; followed: XTask; retweeted: XTask };
  activated: boolean;
} | null;

type Leader = { rank: number; wallet: string; referrals: number };
type XTaskKey = "link" | "follow" | "retweet";

const X_HANDLE = "kaleido_finance";
// The launch post users repost for +100 $kPoint. Defaulted to the live announce
// tweet so the task works without a separate Vercel env step at launch; the
// NEXT_PUBLIC var still overrides it if we ever point the task at a different post.
const ANNOUNCE_TWEET_ID =
  process.env.NEXT_PUBLIC_WAITLIST_ANNOUNCE_TWEET_ID ?? "2099572698380730531";

/** Must match the message the API rebuilds and verifies. */
const joinMessage = (address: string) =>
  `Join the Kaleido Pre-Season 1 Arc waitlist.\nWallet: ${address}`;

/** Must match xTaskMessage in /api/waitlist/x. */
const xTaskMessage = (address: string, task: XTaskKey) =>
  task === "link"
    ? `Link my X account to the Kaleido waitlist wallet ${address}.`
    : `Confirm my Kaleido waitlist X ${task} for wallet ${address}.`;

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [xLinkedCookie, setXLinkedCookie] = useState(false);
  const [opened, setOpened] = useState<{ follow: boolean; retweet: boolean }>({
    follow: false,
    retweet: false,
  });
  const [xBusy, setXBusy] = useState<XTaskKey | null>(null);

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
      return;
    }
    try {
      const d = await fetch(`/api/waitlist?wallet=${addr}`).then((r) => r.json());
      setStatus(d && d.refCode ? d : null);
    } catch {
      /* keep last */
    }
  }, [account?.address]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

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
      await connect({ client, wallets: WALLETS });
    } catch {
      /* user closed the modal */
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

  // Link X: start OAuth if no X session in this browser yet, otherwise the
  // account is known and we just need the wallet's confirming signature.
  const onLinkX = useCallback(() => {
    if (xLinkedCookie) {
      void postXTask("link");
    } else {
      window.location.href = "/api/auth/twitter?returnTo=/waitlist";
    }
  }, [xLinkedCookie, postXTask]);

  const openIntent = useCallback((task: "follow" | "retweet") => {
    const url =
      task === "follow"
        ? `https://x.com/intent/follow?screen_name=${X_HANDLE}`
        : `https://x.com/intent/retweet?tweet_id=${ANNOUNCE_TWEET_ID ?? ""}`;
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

              {/* The big one: converting the pending balance happens on the first
                  real Arc mainnet action (see the waitlist migration). Shown as a
                  locked "Coming soon" teaser until mainnet is live and the action
                  is wired to a real status. */}
              <li className={s.task}>
                <div className={s.taskText}>
                  <span className={s.taskTitle}>Perform 1st transaction on Arc Mainnet</span>
                  <span className={s.taskMeta}>+500 $kPoint · Coming soon</span>
                </div>
                <span className={s.taskLock}>🔒</span>
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
                ? "No referrals yet — share your link to earn 50 $kPoint per friend."
                : `${status.referrals} friend${status.referrals === 1 ? "" : "s"} joined · ${status.referralPoints.toLocaleString()} $kPoint earned${status.referralPoints >= 5000 ? " (max)" : ""}`}
            </p>

            <p className={s.note}>
              Points are pending. They convert to Season&nbsp;1 points on your
              first trade on Arc mainnet — so they can&rsquo;t be farmed, and
              they&rsquo;re waiting for you at launch.
            </p>
          </>
        )}
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
