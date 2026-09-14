"use client";

import { useCallback, useEffect, useState } from "react";
import { useActiveAccount, useConnectModal } from "thirdweb/react";

import { client } from "@/config/client";
import { WALLETS } from "@/config/wallets";
import s from "./waitlist.module.css";

type Status = {
  refCode: string;
  referrals: number;
  rank: number | null;
  pendingPoints: number;
  welcomePoints: number;
  referralPoints: number;
  activated: boolean;
} | null;

type Leader = { rank: number; wallet: string; referrals: number };

/** Must match the message the API rebuilds and verifies. */
const joinMessage = (address: string) =>
  `Join the Kaleido Pre-Season 1 Arc waitlist.\nWallet: ${address}`;

export default function WaitlistPage() {
  const account = useActiveAccount();
  const { connect, isConnecting } = useConnectModal();

  const [ref, setRef] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [leaders, setLeaders] = useState<Leader[]>([]);

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

  useEffect(() => {
    const addr = account?.address;
    if (!addr) {
      setStatus(null);
      return;
    }
    fetch(`/api/waitlist?wallet=${addr}`)
      .then((r) => r.json())
      .then((d) => setStatus(d && d.refCode ? d : null))
      .catch(() => {});
  }, [account?.address]);

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
      setError(/reject|denied/i.test(msg) ? "Signature rejected." : "Could not register.");
    } finally {
      setLoading(false);
    }
  }, [account, ref]);

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
        <h1 className={`${s.h1} k-display`}>Get in line for Arc.</h1>
        <p className={s.lede}>
          Agentic DeFi, live on Arc from Day&nbsp;1 (Sep&nbsp;16). Claim your
          welcome points, refer friends to earn more, and climb the board before
          mainnet. Points feed Season&nbsp;1, our pre-TGE points season.
        </p>
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
          </>
        ) : !status ? (
          <>
            <p className={s.cardLede}>
              You&rsquo;re one signature away. It&rsquo;s free — no gas, no
              deposit.{ref ? " Your referral bonus is applied." : ""}
            </p>
            <button className={s.primary} onClick={onClaim} disabled={loading}>
              {loading ? "Claiming…" : "Claim my points"}
            </button>
            {error ? <p className={s.error}>{error}</p> : null}
          </>
        ) : (
          <>
            <p className={s.pLabel}>Your pending balance</p>
            <p className={s.big}>
              {status.pendingPoints.toLocaleString()}
              <span className={s.unit}>$kPoint</span>
            </p>
            <p className={s.split}>
              {status.welcomePoints} welcome
              {status.referralPoints > 0
                ? ` · ${status.referralPoints} from ${status.referrals} referral${status.referrals === 1 ? "" : "s"}`
                : ""}
              {status.rank ? ` · rank #${status.rank}` : ""}
            </p>

            <p className={s.refLabel}>Your referral link — you both earn</p>
            <div className={s.refRow}>
              <input className={s.refInput} readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
              <button className={s.copy} onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>

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
