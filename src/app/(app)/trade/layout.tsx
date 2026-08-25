"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Nav from "@/components/v2/Nav";
import { ChartPanelProvider, ChartSlot } from "@/components/v2/ChartPanel";
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
 *
 * The shell is height-locked to the viewport. Trade is the front door and it
 * should read as one composed screen, not a document you scroll — so the nav
 * takes its natural height, `.hero` takes the rest, and whatever does not fit
 * scrolls inside the card. Every other route keeps normal page scrolling;
 * this is deliberately local to Trade.
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
    <ChartPanelProvider>
      <div className={s.shell}>
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
          {/* The chart is a sibling of the card, not a wrapper around it, and it
              is here rather than in each page for two reasons: the panel would
              otherwise exist in three copies free to drift, and the toggle that
              opens it lives inside the page, beside that tab's own settings
              gear. The provider is what joins the two halves. */}
          <div className={s.stage}>
            <ChartSlot />
            {children}
          </div>
        </main>
      </div>
    </ChartPanelProvider>
  );
}
