"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NetworkIcon } from "@web3icons/react/dynamic";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import { getChainMeta } from "@/constants/chains";
import NetworkSelector from "./NetworkSelector";
import styles from "./Nav.module.css";

const LINKS = [
  { href: "/v2/portfolio", label: "Portfolio" },
  { href: "/v2/trade", label: "Trade" },
  { href: "/v2/borrow", label: "Borrow" },
  { href: "/v2/pool", label: "Pool" },
  { href: "/v2/stake", label: "Stake" },
  { href: "/v2/stable", label: "Stable" },
  { href: "/v2/explore", label: "Explore" },
];

export default function Nav() {
  const pathname = usePathname();
  const { shortAddress, chainId, chainName, isConnected } = useWalletV2();
  const [networkOpen, setNetworkOpen] = useState(false);
  const chainMeta = getChainMeta(chainId);

  return (
    <nav className={styles.nav}>
      <Link href="/v2/portfolio" className={styles.logo}>
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
  );
}
