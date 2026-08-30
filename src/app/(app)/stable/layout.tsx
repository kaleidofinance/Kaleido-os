"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Nav from "@/components/v2/Nav";
import ChainGate, { useChainGate } from "@/components/v2/ChainGate";
import TokenIcon, { hasTokenIcon } from "@/components/v2/TokenIcon";
import { DASH, qty } from "@/lib/format/figures";
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

/**
 * The one fragile step both readouts below share: turning what `useStablecoin`
 * hands over into a number.
 *
 * It is shared because the two disagreed about the same figure. `balances.kfUSD`
 * is a bare `ethers.formatUnits(x, 18)` result, so the sidebar's `Row` rounded it
 * to 1,397.75 while `Stat` printed the string verbatim —
 * "1397.749624812406203104", twenty-two characters that no line-breaking rule in
 * any stylesheet here will break, because a run of digits has nowhere to break.
 * In a two-column strip on a 390px phone that column is about 171px wide, so the
 * value simply left the box and stopped the strip being width-bound.
 *
 * The comma strip is load-bearing, not defensive. The hook emits two shapes:
 * `kfUSDSupply` arrives already grouped ("2,481,904.55") while `backingRatio`
 * and `totalYieldAPY` arrive bare ("100.00"), and `Number("2,481,904.55")` is
 * NaN — which would turn the supply into a dash. `lib/mock/market.ts` reads the
 * same field the same way.
 *
 * Rounding stays with each caller rather than moving in here, and that is a real
 * distinction rather than drift: the strip is a headline and holds two decimals
 * whatever the value, while the position card lists quantities and lets a whole
 * number stay whole.
 */
function parseFigure(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
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
  const n = parseFigure(value);
  return (
    <div className={s.stat}>
      <span className={s.statLabel}>{label}</span>
      <span className={`${s.statValue} tabular`}>
        {/* The affixes go on the figure, never on the dash: "$—" and "—%" both
            read as a number that failed to render rather than as one nobody
            claimed. `qty` already answers DASH for a null. */}
        {n === null ? DASH : `${prefix}${qty(n, 2)}${suffix}`}
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
  const n = raw ? null : parseFigure(value);
  return (
    <div className={s.kv}>
      <span>{label}</span>
      <b className="tabular">
        {/* `raw` means the hook already formatted it — `totalRewards` arrives as
            "$500.00" — so re-parsing it would drop the currency it came with. */}
        {raw
          ? value || DASH
          : n === null
            ? DASH
            : n.toLocaleString(undefined, { maximumFractionDigits: 2 })}
      </b>
    </div>
  );
}
