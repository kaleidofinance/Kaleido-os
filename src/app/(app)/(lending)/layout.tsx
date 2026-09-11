"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Nav from "@/components/v2/Nav";
import {
  PostOfferModal,
  PostRequestModal,
  CollateralModal,
} from "@/components/v2/BorrowModals";
import type { BorrowBookMode } from "@/components/v2/BorrowBookView";
import {
  LendingDataProvider,
  useLendingData,
} from "@/components/v2/LendingDataContext";
import { Stat, StatStrip } from "@/components/v2/StatStrip";
import { useMarketStats } from "@/hooks/market/useMarketStats";
import { useLenderPosition } from "@/hooks/v2/useLenderPosition";
import { DASH, qty, usd } from "@/lib/format/figures";
import s from "./borrow.module.css";

/**
 * Borrow / Lend shell.
 *
 * Each side of the P2P book is its own route (/borrow, /lend, /loans), so the
 * tab bar navigates rather than toggling in-component state — same pattern as
 * Trade's /trade/swap, /trade/agent, etc. Shareable URLs, a real back button,
 * and the title tracks the route instead of fighting stale Fast Refresh.
 */
const TABS: { href: string; label: string; mode: BorrowBookMode }[] = [
  { href: "/borrow", label: "Borrow", mode: "borrow" },
  { href: "/lend", label: "Lend", mode: "lend" },
  { href: "/mylends", label: "My lends", mode: "mylends" },
  { href: "/myloans", label: "My loans", mode: "mine" },
];

function modeFromPath(pathname: string | null): BorrowBookMode {
  if (pathname === "/lend") return "lend";
  if (pathname === "/mylends") return "mylends";
  if (pathname === "/myloans") return "mine";
  return "borrow";
}

export default function LendingLayout({ children }: { children: ReactNode }) {
  return (
    <LendingDataProvider>
      <LendingShell>{children}</LendingShell>
    </LendingDataProvider>
  );
}

function LendingShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const mode = modeFromPath(pathname);
  const { filters, borrow } = useLendingData();
  /* Only `stats` now. The whole state object was held as `market` so the strip's
     notes could ask it about `loading` and `degraded` — those notes are gone (see
     StatStrip), and with them the last reader of anything but the figures. */
  const { stats } = useMarketStats();
  /* The same computation the /mylends sidebar reads, so the two cannot
     disagree about a lender's position. */
  const lender = useLenderPosition(filters);
  const [offerOpen, setOfferOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [collateralOpen, setCollateralOpen] = useState(false);

  const title = useMemo(() => {
    if (mode === "mylends") return "My Lends";
    if (mode === "lend") return "Lend";
    if (mode === "mine") return "My loans";
    return "Borrow";
  }, [mode]);

  const refresh = () => filters?.refreshListings?.();

  const isLender = mode === "lend" || mode === "mylends";

  return (
    <>
      <Nav />
      <main className={s.wrap}>
        <div className={s.head}>
          <h1 className={s.h1}>{title}</h1>
          <div className={s.toggle}>
            {TABS.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className={`${s.tg} ${pathname === t.href ? s.on : ""}`}
                aria-current={pathname === t.href ? "page" : undefined}
              >
                {t.label}
              </Link>
            ))}
          </div>

          {mode !== "mine" && (
            <div className={s.headActions}>
              <button
                className={s.ghostBtn}
                onClick={() => setCollateralOpen(true)}
              >
                Collateral
              </button>
              {/*
               * /mylends lists the user's own lend offers, so its primary
               * action is another offer. Keying this off `mode === "lend"`
               * alone put "+ Post request" there — the borrower side of the
               * book, and the one thing that tab is not about.
               */}
              <button
                className={s.whiteBtn}
                onClick={() =>
                  isLender ? setOfferOpen(true) : setRequestOpen(true)
                }
              >
                {isLender ? "+ Post offer" : "+ Post request"}
              </button>
            </div>
          )}
        </div>

        {/*
          MARKET-SCOPED ON THE TWO BOOK TABS, WALLET-SCOPED ON THE TWO PERSONAL
          ONES, because the tabs are asking different questions. /borrow and
          /lend are two sides of one book and the useful thing to say there is
          how big it is and whether there is anything in it to act on. /mylends
          and /myloans are asking how YOU are doing, and four market figures
          answer a question those tabs are not asking.

          The earlier version of this comment argued the opposite - that a
          figure changing meaning on connect is worse than one that is missing,
          and that the sidebar carries the wallet's own numbers already. The
          first half still holds and is why the personal tiles fall back to the
          same DASH an absent figure gets anywhere. The second half was a
          desktop-only observation: `.side` stacks UNDER the table below 960px
          (borrow.module.css), so on a phone "Your position" sits past the whole
          book and the strip is the only thing above it. That is precisely where
          a lender or borrower most needs one line about themselves.

          The figures are not recomputed here. The lender's four come from the
          same useLenderPosition the sidebar reads and the borrower's from the
          same useBorrowV2, so the strip and the card cannot disagree - which is
          the rule that also keeps an APR tile off this strip, the sidebar's
          Market card already answering that from the rows on screen.
        */}
        {mode === "mylends" ? (
          <StatStrip>
            <Stat label="Open offers" value={qty(lender.myOpenCount)} />
            {/* "Open value", not "Lent": the borrow cursor asks for status
                OPEN, so this is what is still on offer rather than everything
                ever posted. */}
            <Stat label="Open value" value={usd(lender.openValueUsd)} />
            <Stat label="Funded" value={qty(lender.fundedCount)} />
            {/* Principal plus interest - `amount` alone understates a lender's
                position by exactly the rate they are lending at. */}
            <Stat label="Outstanding" value={usd(lender.outstandingUsd)} />
          </StatStrip>
        ) : mode === "mine" ? (
          <StatStrip>
            <Stat label="Open loans" value={qty(borrow.loans.length)} />
            <Stat label="Collateral" value={usd(borrow.collateralValueUsd)} />
            <Stat
              label="Health factor"
              value={
                borrow.healthFactor === null
                  ? DASH
                  : borrow.healthFactor.toFixed(2)
              }
            />
            {/* The one figure neither the sidebar nor a single row states: a
                row can say it is overdue, but only a count says how many are,
                and that is the thing worth seeing before the table. */}
            <Stat
              label="Overdue"
              value={qty(borrow.loans.filter((l) => l.overdue).length)}
            />
          </StatStrip>
        ) : (
          <StatStrip>
            <Stat label="Open offers" value={qty(stats?.openOffers)} />
            <Stat label="Open requests" value={qty(stats?.openRequests)} />
            {/* "Open book" rather than "Lending TVL", which is what /leaderboard
                calls the same field. On a page whose reader is about to take one
                of these rows, the useful thing to say is that the figure is the
                unfilled book — not capital deposited in a pool, which is what TVL
                means everywhere else in DeFi. */}
            <Stat label="Open book" value={usd(stats?.lendingTvlUsd)} />
            <Stat
              label="Loans outstanding"
              value={qty(stats?.loansOutstanding)}
            />
          </StatStrip>
        )}

        {children}
      </main>

      <PostOfferModal
        open={offerOpen}
        onClose={() => setOfferOpen(false)}
        borrow={borrow}
        onDone={refresh}
      />
      <PostRequestModal
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        borrow={borrow}
        onDone={refresh}
      />
      <CollateralModal
        open={collateralOpen}
        onClose={() => setCollateralOpen(false)}
        borrow={borrow}
        onDone={() => borrow.refreshPosition()}
      />
    </>
  );
}
