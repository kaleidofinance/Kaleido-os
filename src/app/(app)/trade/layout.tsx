"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Nav from "@/components/v2/Nav";
import s from "./trade.module.css";

/**
 * Trade shell.
 *
 * Each mode is its own route (/v2/trade/swap, /agent, /limit, /buy, /sell), so
 * the tab bar navigates rather than toggling in-component state. This gives
 * each mode a shareable URL, its own compile boundary, and a real back button —
 * and keeps the mode files small and independent.
 *
 * Order puts Agent first: it's the signature of the product, the way you're
 * meant to trade here, sitting beside Swap the way Limit and Buy do.
 */
const TABS = [
  { href: "/trade/agent", label: "Agent" },
  { href: "/trade/swap", label: "Swap" },
  { href: "/trade/limit", label: "Limit" },
  { href: "/trade/buy", label: "Buy" },
  { href: "/trade/sell", label: "Sell" },
];

export default function TradeLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <>
      <Nav />
      <main className={s.hero}>
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
      </main>
    </>
  );
}
