"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Nav from "@/components/v2/Nav";
import { Stat, StatStrip } from "@/components/v2/StatStrip";
import { usePoolData } from "@/hooks/dex/usePoolData";
import { qty, usd } from "@/lib/format/figures";
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

/**
 * The strip is four figures and four labels, with no sub-lines under them.
 *
 * It had them: a scope note on Pools ("Every KaleidoSwap V2 pair, not just
 * yours") and, under each of the three sums, an `excludeNote` naming how many
 * pools the total could not measure. Both are true and both are gone, because of
 * where they landed rather than what they said — StatStrip is a 2×2 grid on a
 * phone, so a sentence under a number wraps to three or four lines and each tile
 * becomes mostly prose with a figure on top. Four of those stacked is a screen of
 * caveats before the first pool row.
 *
 * What replaces them is the em dash the sums already render: `sumOf` returns null
 * rather than 0 when nothing was measurable, so an unmeasured total reads as "—"
 * and not as a confident zero. That is the part of the caveat that mattered.
 * `Number.isFinite`-style precision about *how many* pools were excluded belongs
 * in the table, next to the rows it is about.
 */
/** Sum of a nullable column, or null when nothing in it was measurable. Never 0:
    a column of em dashes does not add up to zero. It also used to return the
    count of measurable values, which only `excludeNote` above ever read. */
const sumOf = (values: (number | null)[]) => {
  const known = values.filter((v): v is number => v !== null);
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
};

export default function PoolLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const shell = shellFor(pathname);
  const onNew = shell === "new";

  /* The same hook the pools table below mounts. Not lifted into a context on
     purpose: usePoolData caches at module scope and collapses concurrent calls
     into one `activeFetchPromise`, so a second consumer costs no extra RPC — and
     a provider here would mean the strip and the table could no longer be read
     as two views of one fetch. The detail page is a third consumer of the same
     fetch for the same reason. */
  const { pools, loading } = usePoolData();

  const liquidity = sumOf(pools.map((p) => p.liquidity));
  const volume = sumOf(pools.map((p) => p.volume24h));
  const fees = sumOf(pools.map((p) => p.fees24h));

  /* A count of 0 is a real measurement, unlike a total of 0 — but only once the
     first read has landed. Until then it is an em dash, not "0 pools". */
  const poolCount = loading && pools.length === 0 ? null : pools.length;

  return (
    <>
      <Nav />
      <main className={s.wrap}>
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

        {/* Protocol-wide across every V2 pool on READ_ONLY_CHAIN_ID, so no tile
            is wallet-scoped: the section's one wallet-scoped figure lives on the
            Your positions tab, and mixing it in here would make a strip whose
            fourth number changed meaning depending on whether you had connected.
            Every label names its own scope for the same reason. */}
        {shell === "list" && (
          <>
            <StatStrip>
              <Stat label="Pools" value={qty(poolCount)} />
              <Stat label="Liquidity" value={usd(liquidity)} />
              <Stat label="24h volume" value={usd(volume)} />
              <Stat label="24h fees" value={usd(fees, 2)} />
            </StatStrip>

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
    </>
  );
}
