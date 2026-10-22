"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Nav from "@/components/v2/Nav";
import { Stat, StatStrip } from "@/components/v2/StatStrip";
import { qty, usd } from "@/lib/format/figures";
import { PositionSummaryContext, type PositionSummary } from "./positionSummaryContext";
import s from "./pool.module.css";

/**
 * Liquidity shell.
 *
 * Three kinds of route under /pool, and the chrome differs for each:
 *
 *  - the two tabs — all pools (the landing) and your own positions — get the full
 *    shell: title, New position button, protocol-wide strip, tab bar;
 *  - /pool/new is a form, so it keeps the head with a Cancel button and drops
 *    both the strip and the tabs;
 *  - /pool/[address] is one pair, and drops the head as well. Its own breadcrumb
 *    and pair title replace it, and the strip's four protocol-wide totals would
 *    otherwise sit directly above the same four figures for a single pool.
 *
 * Routed rather than client state, the same as Trade and Stable: shareable URLs,
 * a working back button, and a title that tracks the route instead of fighting
 * stale Fast Refresh.
 *
 * Labelled Liquidity in the nav while the route stays /pool — see Nav.tsx.
 */

const TABS = [
  { href: "/pool", label: "All pools" },
  { href: "/pool/positions", label: "Your positions" },
] as const;

/**
 * Which of the three shells this path takes.
 *
 * Detail is anything under /pool that is not a known tab or the form, rather than
 * an address pattern. A malformed address then lands on the detail page, which
 * already has to say "no pair at this address" for one that is well-formed but
 * unknown — and that is a better answer than the full section chrome wrapped
 * around the same message.
 */
const shellFor = (pathname: string): "list" | "new" | "detail" => {
  if (pathname === "/pool/new") return "new";
  if (TABS.some((t) => t.href === pathname)) return "list";
  return pathname.startsWith("/pool/") ? "detail" : "list";
};

export default function PoolLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const shell = shellFor(pathname);
  const onNew = shell === "new";

  const [positionSummary, setPositionSummary] = useState<PositionSummary | null>(null);

  return (
    <PositionSummaryContext.Provider value={{ summary: positionSummary, setSummary: setPositionSummary }}>
      <Nav />
      <main className={`${s.wrap} ${pathname === "/pool" ? s.listWrap : ""}`}>
        {/* The pair's own breadcrumb and title stand in for this head on a detail
            route, so it is dropped rather than duplicated. */}
        {shell !== "detail" && (
          <div className={s.head}>
            <h1 className={s.h1}>{onNew ? "New position" : "Liquidity"}</h1>
            {onNew ? (
              <Link href="/pool" className={s.bt}>
                Cancel
              </Link>
            ) : (
              <Link href="/pool/new" className={`${s.bt} ${s.btWhite}`}>
                + New position
              </Link>
            )}
          </div>
        )}

        {shell === "list" && (
          <>
            {pathname !== "/pool" && (<div className={s.statStrip}>
              <StatStrip>
                <Stat label="Positions" value={qty(positionSummary?.positions ?? null)} />
                <Stat label="Your liquidity" value={usd(positionSummary?.liquidityUsd ?? null)} />
                <Stat label="Unclaimed fees" value={usd(positionSummary?.feesUsd ?? null, 2)} />
                <Stat label="Networks" value={qty(positionSummary?.networks ?? null)} />
              </StatStrip>
            </div>)}

            <div className={s.tabs}>
              {TABS.map((t) => (
                <Link
                  key={t.href}
                  href={t.href}
                  className={`${s.tab} ${pathname === t.href ? s.tabOn : ""}`}
                >
                  {t.label}
                </Link>
              ))}
            </div>
          </>
        )}

        {children}
      </main>
    </PositionSummaryContext.Provider>
  );
}
