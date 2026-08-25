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
 * What a headline total leaves out.
 *
 * A sum over pools silently drops the ones it cannot measure — no price for
 * either leg, or no usable block window to sample volume from — and the
 * difference between an incomplete figure and a wrong one is whether the reader
 * can see the gap. Same reasoning as the coverage note on the lending TVL tile.
 */
const excludeNote = (total: number, counted: number, missing: string) => {
  /* Nothing to exclude from a total there are no pools for. That case is
     annotated once, on the Pools tile, rather than repeated under all three
     sums. */
  if (total === 0 || counted >= total) return null;
  return `Excludes ${total - counted} ${missing} of ${total} pools`;
};

/** Sum of a nullable column, or null when nothing in it was measurable. Never 0:
    a column of em dashes does not add up to zero. */
const sumOf = (values: (number | null)[]) => {
  const known = values.filter((v): v is number => v !== null);
  return known.length === 0
    ? { total: null, counted: 0 }
    : { total: known.reduce((a, b) => a + b, 0), counted: known.length };
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
              <Stat
                label="Pools"
                value={qty(poolCount)}
                /* The one tile that names the strip's scope for all four. It
                   matters most next to the Your positions tab, which lists V3
                   NFTs from the wallet's chain — without this line a reader has
                   no way to tell that "Pools: 3" is not counting theirs. Scope,
                   not chain: naming the read chain would put its network label
                   in front of the reader for no gain, and would go stale the
                   moment READ_ONLY_CHAIN_ID becomes an env value (#18). */
                note={
                  poolCount === 0
                    ? "The factory has no pairs — the three sums beside this one have nothing to measure"
                    : "Every KaleidoSwap V2 pair, not just yours"
                }
              />
              <Stat
                label="Liquidity"
                value={usd(liquidity.total)}
                note={excludeNote(pools.length, liquidity.counted, "unpriced")}
              />
              <Stat
                label="24h volume"
                value={usd(volume.total)}
                note={excludeNote(pools.length, volume.counted, "unsampled")}
              />
              <Stat
                label="24h fees"
                value={usd(fees.total, 2)}
                note={excludeNote(pools.length, fees.counted, "unsampled")}
              />
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
