"use client";

import Link from "next/link";
import { toast } from "sonner";
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

  /*
   * Share and Deposit were markup with no handler — chrome from the first pass
   * at this header. Wiring them meant deciding what each one is for, and both
   * answers ruled out the obvious implementation:
   *
   * Share shares a SENTENCE, not this URL. /portfolio renders whichever wallet
   * is connected in the reader's own browser, so the bare link tells a recipient
   * nothing about the sender — it shows them their own empty portfolio. The
   * figures have to travel in the text, and the link points at the app entry.
   *
   * Deposit goes to /borrow because "deposit" already means one thing in this
   * app: the Deposit/Withdraw control in the lending Collateral modal. Opening
   * that modal here would need a second useBorrowV2 instance (usePortfolio does
   * not use it) plus the LendingDataProvider it reads from — a page of contract
   * calls for one button. The other candidates all have their own verb and their
   * own tab: add liquidity, mint, stake.
   *
   * Both are hidden until a wallet is connected, the way WalletMenu gates
   * /faucet: a control whose target is empty is worse than one that is absent.
   */
  const share = async () => {
    const url = window.location.origin;
    /* Figures only when they are real — usd(null) is an em dash, and "— net
       position" reads worse than an invitation with no numbers in it. */
    const text =
      p.netValue === null
        ? "My Kaleido portfolio — lending, swaps and kfUSD in one place."
        : `My Kaleido portfolio: ${usd(p.netValue)} net position, health factor ${healthText(p.health)}.`;

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Kaleido portfolio", text, url });
        return;
      } catch (err) {
        /* AbortError is the user closing the share sheet — an intentional no,
           and copying to the clipboard behind their back is not the answer to
           it. Any other rejection is the API failing (no transient activation,
           no share target), which is what the fallback below exists for. */
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      toast.success("Portfolio summary copied");
    } catch {
      /* Clipboard is permission-gated and throws on insecure origins. */
      toast.error(
        "Couldn't copy — the figures are on screen to share by hand.",
      );
    }
  };

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
          {isConnected && (
            <div className={s.hActions}>
              <button className={s.bt} onClick={share}>
                Share
              </button>
              <Link href="/borrow" className={`${s.bt} ${s.btWhite}`}>
                Deposit
              </Link>
            </div>
          )}
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
