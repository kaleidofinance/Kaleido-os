"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NetworkIcon } from "@web3icons/react/dynamic";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import { getChainMeta } from "@/constants/chains";
import NetworkSelector from "./NetworkSelector";
import styles from "./Nav.module.css";

/**
 * Trade leads: it is the front door and the reason most people arrive.
 *
 * `primary` marks the five that earn a slot in the mobile tab bar. Seven tabs
 * do not fit a phone without becoming unreadable, so Stake and Stable stay in
 * the top strip on mobile and appear in full on desktop.
 */
const LINKS = [
  { href: "/trade", label: "Trade", icon: "⇄", primary: true },
  { href: "/pool", label: "Pool", icon: "◎", primary: true },
  { href: "/borrow", label: "Borrow", icon: "⇢", primary: true },
  { href: "/stake", label: "Stake", icon: "▲", primary: false },
  { href: "/stable", label: "Stable", icon: "$", primary: false },
  { href: "/explore", label: "Explore", icon: "◈", primary: true },
  { href: "/portfolio", label: "Portfolio", icon: "◍", primary: true },
];

export default function Nav() {
  const pathname = usePathname();
  const { shortAddress, chainId, chainName, isConnected } = useWalletV2();
  const [networkOpen, setNetworkOpen] = useState(false);
  const chainMeta = getChainMeta(chainId);

  return (
    <>
      <nav className={styles.nav}>
      <Link href="/trade" className={styles.logo}>
        <span className={styles.mark} />
        Kaleido
      </Link>

      <div className={styles.menu}>
        {LINKS.map((l) => {
          const active = pathname?.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`${styles.item} ${active ? styles.on : ""}`}
            >
              {l.label}
            </Link>
          );
        })}
      </div>

      <div className={styles.right}>
        <button className={styles.icon} aria-label="Search">
          ⌕
        </button>
        <button className={styles.net} onClick={() => setNetworkOpen(true)}>
          <span className={styles.netIcon}>
            <NetworkIcon
              id={chainMeta?.iconId ?? "abstract-sepolia"}
              variant="branded"
              size={16}
              fallback={<i style={{ background: chainMeta?.color ?? "var(--k-chain-abstract)" }} />}
            />
          </span>
          {chainName}
          <span className={styles.caret}>▾</span>
        </button>
        <NetworkSelector open={networkOpen} onClose={() => setNetworkOpen(false)} />
        {isConnected ? (
          <button className={styles.addr}>
            <span className={styles.avatar} />
            {shortAddress}
          </button>
        ) : (
          <button className={styles.connect}>Connect</button>
        )}
      </div>
      </nav>

      {/* Bottom tab bar — phones only. Thumb-reachable, and it survives the
          top strip scrolling out of view. */}
      <div className={styles.tabbar} role="navigation" aria-label="Primary">
        {LINKS.filter((l) => l.primary).map((l) => {
          const active = pathname?.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`${styles.tab} ${active ? styles.tabOn : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <span className={styles.tabIcon} aria-hidden="true">
                {l.icon}
              </span>
              {l.label}
            </Link>
          );
        })}
      </div>
    </>
  );
}
