"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useConnectModal } from "thirdweb/react";
import { toast } from "sonner";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import { useNotifications } from "@/context/NotificationsContext";
import { getChainMeta } from "@/constants/chains";
import { client } from "@/config/client";
import { envVars } from "@/constants/envVars";
import { WALLETS } from "@/config/wallets";
import ChainIcon from "./ChainIcon";
import LinkX from "./LinkX";
import NetworkSelector from "./NetworkSelector";
import NotificationBell from "./NotificationBell";
import NotificationCenter from "./NotificationCenter";
import SectionIcon, { type SectionIconKind } from "./SectionIcon";
import ThemeToggle from "./ThemeToggle";
import WalletMenu from "./WalletMenu";
import styles from "./Nav.module.css";

/**
 * Trade leads: it is the front door and the reason most people arrive.
 *
 * `primary` marks the five that earn a slot in the mobile tab bar. Seven tabs do
 * not fit a phone without becoming unreadable, so Stake and Stable get none —
 * and as of 2026-08-27 that leaves them reachable on a phone by URL alone, since
 * the top strip that used to carry them is `display: none` under 720px. That is
 * a known hole rather than the intended end state, and the strip is not the way
 * back: at 390px it measured 0px wide against a 514px scrollWidth, so what it
 * rendered was a scroller no touch could open, not a link row (the measurement
 * is in Nav.module.css). They need a home the tab bar or a sheet can give them.
 *
 * `icon` IS A DRAWN SVG NOW, NOT A CHARACTER. These were Unicode glyphs — `⇄ ◎ ⇢
 * ▲ $ ◈ ◍` — and a glyph is whatever the device's font stack decides it is. `◍`
 * (U+25CD) and `◈` (U+25C8) are the exposed cases: coverage for them is patchy
 * outside desktop, and a font with no glyph renders the tofu box. They are also
 * two different weights and two different optical sizes from each other, because
 * they come from whichever fallback family happens to have each one. <SectionIcon>
 * draws all seven on one grid at one stroke weight, and the landing page's product
 * rail draws the same set — so the icon over "Trade" in the tab bar is the icon
 * beside "Trade" on the front door.
 *
 * The type annotation is the point of writing it out: `icon` is a
 * `SectionIconKind`, so a typo fails to compile here at the data rather than
 * rendering an empty 20px square in the tab bar.
 */
const LINKS: {
  href: string;
  label: string;
  icon: SectionIconKind;
  primary: boolean;
  match?: (p: string) => boolean;
}[] = [
  { href: "/trade", label: "Trade", icon: "swap", primary: true },
  /* Labelled Liquidity, routed at /pool. The label names what the section is
     for — providing liquidity, across every pool and your own positions — while
     the route stays put: /pool/positions is what usePortfolio's out-of-range
     alert deep-links to, and the sub-pages below it are already named after it. */
  { href: "/pool", label: "Liquidity", icon: "range", primary: true },
  {
    href: "/borrow",
    label: "Borrow",
    icon: "book",
    primary: true,
    match: (p: string) =>
      p === "/borrow" ||
      p === "/lend" ||
      p === "/loans" ||
      p === "/mylends" ||
      p === "/myloans",
  },
  { href: "/stake", label: "Stake", icon: "wrap", primary: false },
  { href: "/stable", label: "Stable", icon: "mint", primary: false },
  /* Was Explore, which was a copy of Uniswap's page and named a job it had
     stopped doing: both of its tables moved to /pool, and what a reader arrives
     for now is standings. Named after that. /explore redirects — see
     next.config.mjs, because the old label shipped and gets bookmarked. */
  {
    href: "/leaderboard",
    label: "Leaderboard",
    icon: "leaderboard",
    primary: true,
  },
  { href: "/portfolio", label: "Portfolio", icon: "portfolio", primary: true },
];

export default function Nav() {
  const pathname = usePathname();
  const { chainId, chainName, isConnected } = useWalletV2();
  const [networkOpen, setNetworkOpen] = useState(false);
  const chainMeta = getChainMeta(chainId);

  /* The connect modal is thirdweb's own, driven from here rather than rendered
     inline: it mounts its own portal, so the button only has to ask. `WALLETS`
     is the shared list AutoConnect also reads — see src/config/wallets.ts for
     why the two must not diverge. */
  const { connect, isConnecting } = useConnectModal();

  const openConnect = async () => {
    try {
      await connect({ client, wallets: WALLETS, size: "compact" });
    } catch {
      /* Closing the modal rejects, and so does a wallet declining. Neither is
         worth a toast — the user did it on purpose. The one case worth naming
         is a deployment with no client ID, where the modal cannot work at all
         and the user would otherwise click into silence. Read from envVars,
         not client.clientId: config/client.ts substitutes a placeholder there
         so the app boots, which means it is never falsy. */
      if (!envVars.thirdwebClientId) {
        toast.error("Wallet connection isn't configured on this deployment.");
      }
    }
  };

  /* Panel open/closed lives in the context, not here: a click on an OS
     notification and a postMessage from the service worker both need to open
     this panel, and neither has a route into Nav's local state. */
  const { panelOpen, closePanel } = useNotifications();

  /*
   * The nav is transparent until something is behind it, so the header shares
   * the page's background instead of sitting on a bar with a rule under it.
   * Frosting a strip with nothing underneath just blurs the ambient dot grid
   * into a rectangle the exact size of the nav — the seam we removed, restored
   * in softer form. This makes the glass earn its place.
   *
   * `passive: true` because the handler never calls preventDefault; without it
   * the browser has to wait for us before it can scroll. The state is written
   * only on transitions across the threshold, so a scroll fires one render, not
   * one per frame. Read once on mount too — a reload restoring scroll position
   * would otherwise start transparent over content.
   */
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <nav className={`${styles.nav} ${scrolled ? styles.scrolled : ""}`}>
        {/* The logo goes home, and home is `/` — the landing page, not /trade.
            It pointed at /trade back when `/` only 307'd there and a logo link
            to `/` would have been a redirect hop to the page you were already
            on. src/app/(marketing)/page.tsx serves a real page there now, so
            the ordinary convention applies again.
            Nobody is stranded by this: /trade is the first item in LINKS below
            and stays one click away, which is the reason the logo can afford to
            leave the app at all. */}
        <Link href="/" className={styles.logo}>
          <span className={styles.mark} />
          {/* One span around both halves. `.logo` is a flex row with an 8px gap
              for the mark, and a bare text node beside a <span> becomes its own
              flex item — "Kaleido" and "fi" would render 8px apart. */}
          <span>
            Kaleido<span className={styles.logoFi}>fi</span>
          </span>
        </Link>

        <div className={styles.menu}>
          {LINKS.map((l) => {
            const active =
              l.match?.(pathname ?? "") ?? pathname?.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                /* `itemPrimary` exists only so mobile can drop these five: they
                   are the tab bar's contents, so the strip repeats them there,
                   and their width is what pushed Connect off the right edge. */
                className={`${styles.item} ${l.primary ? styles.itemPrimary : ""} ${active ? styles.on : ""}`}
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
          <NotificationBell />
          <ThemeToggle />
          {/* Disconnected, this button names no chain and draws no mark: it is
              an invitation to pick one, not a report of where you are. Both
              used to fall back to Abstract, which told a user with no wallet
              that they were on a chain we read balances from and nothing else. */}
          <button
            className={`${styles.net} ${chainMeta ? styles.netHasIcon : ""}`}
            onClick={() => setNetworkOpen(true)}
            aria-label={
              chainName ? `Network: ${chainName}` : "Select a network"
            }
          >
            {chainMeta && (
              <span className={styles.netIcon}>
                <ChainIcon
                  id={chainMeta.iconId}
                  variant="branded"
                  size={16}
                  fallback={<i style={{ background: chainMeta.color }} />}
                />
              </span>
            )}
            {/* Wrapped so mobile can hide the name and keep the mark — a bare
                text node is unaddressable from CSS. `netHasIcon` gates that:
                with no chain there is no mark, so the word has to stay or the
                button would be an empty circle. The aria-label above carries
                the full name either way. */}
            <span className={styles.netName}>{chainName ?? "Network"}</span>
            <span className={styles.caret}>▾</span>
          </button>
          <NetworkSelector
            open={networkOpen}
            onClose={() => setNetworkOpen(false)}
          />
          <NotificationCenter open={panelOpen} onClose={closePanel} />
          {/* Beside Connect, not behind a route. The /verify page this replaces
              is gone; its backend is not — see LinkX.tsx. */}
          <LinkX />
          {isConnected ? (
            <WalletMenu />
          ) : (
            <button
              className={styles.connect}
              onClick={openConnect}
              disabled={isConnecting}
            >
              {isConnecting ? "Connecting…" : "Connect"}
            </button>
          )}
        </div>
      </nav>

      {/* Bottom tab bar — phones only. Thumb-reachable, and it survives the
          top strip scrolling out of view. */}
      <div className={styles.tabbar} role="navigation" aria-label="Primary">
        {LINKS.filter((l) => l.primary).map((l) => {
          const active =
            l.match?.(pathname ?? "") ?? pathname?.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`${styles.tab} ${active ? styles.tabOn : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <span className={styles.tabIcon}>
                <SectionIcon kind={l.icon} />
              </span>
              {l.label}
            </Link>
          );
        })}
      </div>
    </>
  );
}
