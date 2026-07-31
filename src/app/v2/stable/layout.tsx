"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Nav from "@/components/v2/Nav";
import { StableProvider, useStable } from "./StableContext";
import s from "./stable.module.css";

const TABS = [
  { href: "/v2/stable/mint", label: "Mint" },
  { href: "/v2/stable/redeem", label: "Redeem" },
  { href: "/v2/stable/earn", label: "Earn" },
];

/**
 * Stable shell. Same routed-sub-page pattern as Trade: each mode is its own URL.
 * The chrome a stablecoin page must lead with — the peg and what backs it —
 * lives here so it's constant across modes; only the form column changes.
 */
export default function StableLayout({ children }: { children: ReactNode }) {
  return (
    <StableProvider>
      <Nav />
      <StableChrome>{children}</StableChrome>
    </StableProvider>
  );
}

function StableChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { stats, balances, userRewards, withdrawalInfo } = useStable();

  return (
    <main className={s.wrap}>
      <div className={s.peg}>
        <span className={s.pegIcon}>kfUSD</span>
        <div>
          <div className={s.pegName}>Kaleido USD</div>
          <div className={s.pegSub}>Fully backed · redeemable 1:1</div>
        </div>
        <div className={s.pegRight}>
          <div className={`${s.pegPrice} tabular`}>$1.00</div>
          <div className={s.pegNote}>
            {stats?.backingRatio ? `${stats.backingRatio}% backed` : "On peg"}
          </div>
        </div>
      </div>

      <div className={s.strip}>
        <Stat label="Supply" value={stats?.kfUSDSupply} prefix="$" />
        <Stat label="Backing" value={stats?.backingRatio} suffix="%" />
        <Stat label="Vault APY" value={stats?.totalYieldAPY} suffix="%" />
        <Stat label="Your kfUSD" value={balances?.kfUSD} />
      </div>

      <div className={s.cols}>
        <div className={s.left}>
          <div className={s.tabs}>
            {TABS.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className={`${s.tb} ${pathname === t.href ? s.on : ""}`}
              >
                {t.label}
              </Link>
            ))}
          </div>
          {children}
        </div>

        <aside className={s.side}>
          <div className={s.sideTitle}>Your position</div>
          <div className={s.card}>
            <Row label="kfUSD" value={balances?.kfUSD} />
            <Row label="In vault (kafUSD)" value={balances?.kafUSD} />
            <Row label="Unclaimed yield" value={userRewards?.totalRewards} raw />
          </div>

          {withdrawalInfo?.hasWithdrawal && (
            <div className={s.pending}>
              <div className={s.pendingTop}>
                <span className={s.pendingIcon}>↓</span>
                Withdrawal pending
              </div>
              <div className={s.pendingNote}>Ready in {withdrawalInfo.unlockTime}</div>
            </div>
          )}

          <div className={s.card}>
            <div className={s.explainTitle}>Where yield comes from</div>
            <p className={s.explainBody}>
              Lending interest and pool fees on the collateral backing kfUSD.
              Deposit in Earn to receive it; the vault has a withdrawal notice.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
  prefix = "",
  suffix = "",
}: {
  label: string;
  value?: string;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <div className={s.stat}>
      <span className={s.statLabel}>{label}</span>
      <span className={`${s.statValue} tabular`}>
        {value ? `${prefix}${value}${suffix}` : "—"}
      </span>
    </div>
  );
}

function Row({ label, value, raw }: { label: string; value?: string; raw?: boolean }) {
  return (
    <div className={s.kv}>
      <span>{label}</span>
      <b className="tabular">{value ? (raw ? value : Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })) : "—"}</b>
    </div>
  );
}
