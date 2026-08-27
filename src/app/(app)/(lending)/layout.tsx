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
import { qty, usd } from "@/lib/format/figures";
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
          Market-scoped in every tile, and deliberately so. The sidebar beside
          the book already carries this wallet's own collateral, health factor
          and open loans (BorrowBookView's "Your position" card, which is why
          nothing moved out of it), and the Liquidity strip avoids a wallet-scoped
          tile for the reason that applies here too: a figure that changes meaning
          depending on whether you have connected is worse than one that is
          missing. What these four add is the thing neither the table nor the
          sidebar says — how big the book is, and whether there is anything in it
          to act on. That holds on all four tabs, which the same strip has to
          serve.

          Also why there is no APR tile: the sidebar's "Market" card already
          shows the best rate and the term range, read from the rows on screen,
          and a second APR computed from a different query would be a second
          answer to the same question.
        */}
        <StatStrip>
          <Stat label="Open offers" value={qty(stats?.openOffers)} />
          <Stat label="Open requests" value={qty(stats?.openRequests)} />
          {/* "Open book" rather than "Lending TVL", which is what /leaderboard
              calls the same field. On a page whose reader is about to take one of
              these rows, the useful thing to say is that the figure is the
              unfilled book — not capital deposited in a pool, which is what TVL
              means everywhere else in DeFi. */}
          <Stat label="Open book" value={usd(stats?.lendingTvlUsd)} />
          <Stat
            label="Loans outstanding"
            value={qty(stats?.loansOutstanding)}
          />
        </StatStrip>

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
