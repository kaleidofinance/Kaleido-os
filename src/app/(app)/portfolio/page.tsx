"use client";

import Nav from "@/components/v2/Nav";
import ChainGate, { useChainGate } from "@/components/v2/ChainGate";
import { usePortfolio, type Position } from "@/hooks/usePortfolio";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import TokenIcon, { hasTokenIcon } from "@/components/v2/TokenIcon";
import s from "./portfolio.module.css";

const usd = (n: number | null, dp = 2) =>
  n === null
    ? "—"
    : n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: dp,
        maximumFractionDigits: dp,
      });

const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(2)}%`);

const healthText = (h: number | null) =>
  h === null ? "—" : h === Infinity ? "∞" : h.toFixed(2);

/** Row shared by the Borrowing and Earning tables. */
function PositionRow({ p }: { p: Position }) {
  const toneClass =
    p.state.tone === "bad" ? s.bad : p.state.tone === "warn" ? s.warn : "";
  return (
    <div className={s.row}>
      <div className={s.asset}>
        <span className={`${s.icon} ${hasTokenIcon(p.label) ? s.iconArt : ""}`}>
          <TokenIcon
            symbol={p.label}
            size={34}
            fallback={p.label.slice(0, 3)}
          />
        </span>
        <div>
          <div className={s.aName}>{p.label}</div>
          <div className={s.aSub}>{p.sublabel}</div>
        </div>
      </div>
      <div className={`${s.cell} tabular`}>
        <span className={s.cVal}>{usd(p.valueUsd)}</span>
        {p.amount && <span className={s.cSub}>{p.amount}</span>}
      </div>
      <div className={`${s.cell} tabular`}>
        <span className={p.apy !== null && p.apy > 0 ? s.pos : s.cVal}>
          {pct(p.apy)}
        </span>
      </div>
      <span className={`${s.badge} ${toneClass}`}>{p.state.text}</span>
    </div>
  );
}

export default function PortfolioPage() {
  const { isConnected, shortAddress, chainName } = useWalletV2();
  const p = usePortfolio();
  const gate = useChainGate();

  return (
    <>
      <Nav />
      <main className={s.wrap}>
        <div className={s.head}>
          <span className={s.pav} />
          <div>
            <div className={s.paddr}>
              {isConnected ? shortAddress : "Not connected"}
            </div>
            <div className={s.pnet}>{chainName ?? "No network"}</div>
          </div>
          <div className={s.hActions}>
            <button className={s.bt}>Share</button>
            <button className={`${s.bt} ${s.btWhite}`}>Deposit</button>
          </div>
        </div>

        {/* The header stays above the gate on purpose — the address and network
            are the two facts that explain *why* the gate is showing, so hiding
            them behind it would remove the evidence. Everything below reads
            positions, so all of it is gated together rather than left as four
            dashes and two empty tables. */}
        {!gate.ready ? (
          <ChainGate product="portfolio" state={gate} />
        ) : (
          <>
            <div>
              <div className={`${s.value} tabular`}>{usd(p.netValue)}</div>
              <div className={s.eyebrow}>Net position</div>
            </div>

            <div className={s.strip}>
              <div className={s.stat}>
                <span className={s.sLabel}>Health factor</span>
                <span className={`${s.sVal} tabular`}>
                  {healthText(p.health)}
                </span>
              </div>
              <div className={s.stat}>
                <span className={s.sLabel}>Collateral</span>
                <span className={`${s.sVal} tabular`}>
                  {usd(p.collateralUsd, 0)}
                </span>
              </div>
              <div className={s.stat}>
                <span className={s.sLabel}>Borrowed</span>
                <span className={`${s.sVal} tabular`}>{usd(p.debtUsd, 0)}</span>
              </div>
              <div className={s.stat}>
                <span className={s.sLabel}>Unclaimed</span>
                <span className={`${s.sVal} tabular`}>
                  {usd(p.unclaimedYieldUsd)}
                </span>
              </div>
            </div>

            <div className={s.cols}>
              <div className={s.main}>
                <PositionGroup
                  title="Borrowing"
                  rows={p.borrowing}
                  loading={p.isLoading}
                  empty="No collateral or loans yet."
                />
                <PositionGroup
                  title="Earning"
                  rows={p.earning}
                  loading={p.isLoading}
                  empty="Nothing earning yet."
                />
              </div>

              <aside className={s.side}>
                <div className={s.sideTitle}>Needs attention</div>
                {p.alerts.length === 0 && (
                  <div className={s.calm}>Nothing needs attention.</div>
                )}
                {p.alerts.map((a) => (
                  <a key={a.id} href={a.href ?? "#"} className={s.alert}>
                    <span
                      className={`${s.aIcon} ${
                        a.severity === "info" ? "" : s.aWarn
                      }`}
                    >
                      {a.severity === "info" ? "↑" : "!"}
                    </span>
                    <div>
                      <div className={s.alTitle}>{a.title}</div>
                      <div className={s.alDetail}>{a.detail}</div>
                    </div>
                  </a>
                ))}
              </aside>
            </div>
          </>
        )}
      </main>
    </>
  );
}

function PositionGroup({
  title,
  rows,
  loading,
  empty,
}: {
  title: string;
  rows: Position[];
  loading: boolean;
  empty: string;
}) {
  return (
    <section className={s.group}>
      <div className={s.gHead}>{title}</div>
      <div className={s.table}>
        {loading && rows.length === 0 ? (
          <div className={s.rowSkeleton}>
            <span className={s.skCircle} />
            <span className={s.skLine} />
          </div>
        ) : rows.length === 0 ? (
          <div className={s.empty}>{empty}</div>
        ) : (
          rows.map((r) => <PositionRow key={r.id} p={r} />)
        )}
      </div>
    </section>
  );
}
