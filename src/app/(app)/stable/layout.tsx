"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Nav from "@/components/v2/Nav";
import ChainGate, { useChainGate } from "@/components/v2/ChainGate";
import TokenIcon, { hasTokenIcon } from "@/components/v2/TokenIcon";
import { StableProvider, useStable } from "./StableContext";
import s from "./stable.module.css";

const TABS = [
  { href: "/stable/mint", label: "Mint" },
  { href: "/stable/redeem", label: "Redeem" },
  { href: "/stable/earn", label: "Earn" },
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

  /* Gated in the layout, once, rather than in each of mint/redeem/earn: all
     three read the same three contracts, so the answer cannot differ between
     them, and three copies of it would be three chances to drift. */
  const gate = useChainGate();
  return (
    <main className={s.wrap}>
      <div className={s.peg}>
        <span
          className={`${s.pegIcon} ${hasTokenIcon("kfUSD") ? s.pegIconArt : ""}`}
        >
          <TokenIcon symbol="kfUSD" size={46} fallback="kfUSD" />
        </span>
        <div>
          <div className={s.pegName}>Kaleido USD</div>
          {/* Not "redeemable 1:1" — redeem() takes its fee out of the amount
              burned, so a redemption returns less collateral than the kfUSD it
              consumes. The exact rate is on the Redeem form. */}
          <div className={s.pegSub}>Fully collateralised · redeem anytime</div>
        </div>
        <div className={s.pegRight}>
          <div className={`${s.pegPrice} tabular`}>$1.00</div>
          <div className={s.pegNote}>
            {/* `backingRatio` is a bare number now. It used to be the literal
                "100%", so this appended a second one and read "100%% backed" —
                and it was hardcoded, so it said that whatever the collateral. */}
            {stats?.backingRatio ? `${stats.backingRatio}% backed` : "On peg"}
          </div>
        </div>
      </div>

      {!gate.ready ? (
        /* The peg card above stays — it says what this product *is*, which is
           still true, and is the heading the gate's message sits under. The
           strip and the form column both read contracts, so they go together:
           four dashes over an inert Mint button is the exact ambiguity the gate
           exists to remove. */
        <ChainGate product="kfUSD position" state={gate} />
      ) : (
        <>
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
                <Row
                  label="Unclaimed yield"
                  value={userRewards?.totalRewards}
                  raw
                />
              </div>

              {withdrawalInfo?.hasWithdrawal && (
                <div className={s.pending}>
                  <div className={s.pendingTop}>
                    <span className={s.pendingIcon}>↓</span>
                    Withdrawal pending
                  </div>
                  <div className={s.pendingNote}>
                    {/* `unlockTime` is the literal "Ready" once the notice is
                        up, which made this read "Ready in Ready". */}
                    {withdrawalInfo.isReady
                      ? `${Number(withdrawalInfo.pendingAmount).toLocaleString(undefined, { maximumFractionDigits: 2 })} kafUSD ready to withdraw`
                      : `Ready in ${withdrawalInfo.unlockTime}`}
                  </div>
                </div>
              )}

              <div className={s.card}>
                <div className={s.explainTitle}>Where yield comes from</div>
                <p className={s.explainBody}>
                  Lending interest and pool fees on the collateral backing
                  kfUSD. Deposit in Earn to receive it; the vault has a
                  withdrawal notice.
                </p>
              </div>
            </aside>
          </div>
        </>
      )}
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
  /**
   * Null is "not known", and renders as a dash. The stats it carries — the
   * backing ratio, the vault rate — are nullable precisely so that an unread
   * or unmeasurable value cannot be displayed as a confident number.
   */
  value?: string | null;
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

function Row({
  label,
  value,
  raw,
}: {
  label: string;
  value?: string;
  raw?: boolean;
}) {
  return (
    <div className={s.kv}>
      <span>{label}</span>
      <b className="tabular">
        {value
          ? raw
            ? value
            : Number(value).toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })
          : "—"}
      </b>
    </div>
  );
}
