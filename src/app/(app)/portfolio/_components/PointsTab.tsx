"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { WaitlistStatus } from "@/lib/waitlist/status";
import t from "./PortfolioTabs.module.css";

export type PointsState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "error" }
  | { kind: "ok"; status: WaitlistStatus };

/**
 * The wallet's Season 1 standing, read from the same /api/waitlist payload the
 * Rewards page uses — so this tab and /rewards cannot show two numbers. A wallet
 * with no row is "none" (a real state, with a way in), distinct from a failed read.
 */
export function usePointsStanding(address: string | undefined): PointsState {
  const [state, setState] = useState<PointsState>({ kind: "loading" });
  useEffect(() => {
    if (!address) {
      setState({ kind: "none" });
      return;
    }
    let live = true;
    setState({ kind: "loading" });
    fetch(`/api/waitlist?wallet=${address}`, { cache: "no-store" })
      .then(async (r) => {
        if (!live) return;
        if (r.status === 404) return setState({ kind: "none" });
        if (!r.ok) return setState({ kind: "error" });
        setState({ kind: "ok", status: (await r.json()) as WaitlistStatus });
      })
      .catch(() => live && setState({ kind: "error" }));
    return () => {
      live = false;
    };
  }, [address]);
  return state;
}

/** Points shown on the card and the Points tab: the Season 1 ledger once
 *  activated, otherwise the waitlist balance waiting to convert. */
export function pointsTotal(s: WaitlistStatus): number {
  return s.season1?.total ?? s.points;
}

export function referralLink(s: WaitlistStatus, origin: string): string {
  return `${origin}/rewards?ref=${encodeURIComponent(s.refCode)}`;
}

const pts = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

const SOURCES: { key: "tasks" | "trading" | "liquidity" | "other"; label: string; color: string }[] = [
  { key: "tasks", label: "Tasks & referrals", color: "#1de6a4" },
  { key: "trading", label: "Trading", color: "#5b8cff" },
  { key: "liquidity", label: "Liquidity", color: "#b18cff" },
  { key: "other", label: "Bonuses", color: "#f0b64a" },
];

export function PointsTab({ state }: { state: PointsState }) {
  if (state.kind === "loading")
    return (
      <div className={t.list}>
        <div className={t.skel} />
      </div>
    );
  if (state.kind === "error")
    return <div className={t.calm}>Couldn&rsquo;t read your points right now.</div>;
  if (state.kind === "none")
    return (
      <Link href="/rewards" className={t.emptyBox}>
        Earn Season 1 $kPoint for swapping, lending and liquidity. Start on Rewards →
      </Link>
    );

  const s = state.status;
  const total = pointsTotal(s);
  const b = s.season1;
  const parts = b ? SOURCES.map((x) => ({ ...x, v: b[x.key] })).filter((x) => x.v > 0) : [];
  const sum = parts.reduce((a, x) => a + x.v, 0);
  const copy = () => {
    navigator.clipboard
      ?.writeText(referralLink(s, window.location.origin))
      .then(() => toast.success("Referral link copied"))
      .catch(() => toast.error("Couldn't copy the link"));
  };

  return (
    <div className={t.points}>
      <section className={t.pHero}>
        <span className={t.cTitle}>Season 1 · $kPoint</span>
        <span className={`${t.pTotal} tabular`}>{pts(total)}</span>
        <span className={t.cSub}>
          {s.rank ? `Rank #${s.rank.toLocaleString("en-US")}` : "Unranked"}
          {!s.activated && " · activate on Rewards to convert"}
          {s.heldPoints > 0 && ` · ${pts(s.heldPoints)} still counting`}
        </span>
      </section>

      {sum > 0 && (
        <section className={t.alloc} aria-label="Points by source">
          <div className={t.bar}>
            {parts.map((x) => (
              <span key={x.key} style={{ width: `${((x.v / sum) * 100).toFixed(2)}%`, background: x.color }} />
            ))}
          </div>
          <div className={t.legend}>
            {parts.map((x) => (
              <span key={x.key} className={t.lg}>
                <i style={{ background: x.color }} />
                {x.label}
                <b className="tabular">{pts(x.v)}</b>
              </span>
            ))}
          </div>
        </section>
      )}

      <div className={t.cards}>
        <div className={t.card}>
          <span className={t.cTitle}>Referrals</span>
          <span className={`${t.cVal} tabular`}>{s.referrals}</span>
          <span className={t.cSub}>{pts(s.referralPoints)} $kPoint from friends</span>
        </div>
        <div className={t.card}>
          <span className={t.cTitle}>Swap volume</span>
          <span className={`${t.cVal} tabular`}>
            {(s.swapVolume?.volumeUsd ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
          </span>
          <span className={t.cSub}>Credited on Kaleido</span>
        </div>
      </div>

      <div className={t.acts}>
        <button className={t.act} onClick={copy}>
          Copy referral link
        </button>
        <Link href="/rewards" className={t.act}>
          Rewards
        </Link>
        <Link href="/leaderboard" className={t.act}>
          Leaderboard
        </Link>
      </div>
    </div>
  );
}
