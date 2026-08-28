"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import Portal from "./Portal";
import styles from "./Nav.module.css";

/**
 * Trade leads: it is the front door and the reason most people arrive.
 *
 * `primary` marks the five that earn a slot in the mobile tab bar. Seven tabs do
 * not fit a phone without becoming unreadable, so Stake and Stable get none —
 * they live behind the bar's sixth tab, "More", which opens a sheet. The sheet's
 * contents are derived from this array (everything not `primary`), so flipping
 * one flag moves a destination between the bar and the sheet and there is no
 * second list to keep in step.
 *
 * The top strip is not their route on a phone and must not be made one again. At
 * 390px it measured 0px wide against a 514px scrollWidth, so what it rendered was
 * a scroller no touch could open rather than a link row, and it is `display: none`
 * under 720px now (the measurement is in Nav.module.css). Nor was the old state a
 * quiet success for assistive tech: a zero-width scroller keeps its links
 * focusable while they are permanently invisible, which is a WCAG 2.4.7 failure
 * in its own right, not a saving grace.
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

/* One reading of "is this the page you are on", asked in four places now — the
   top strip, the tab bar, the More tab (of every secondary at once) and the
   sheet's own rows. It was written out inline three times; a fourth copy is the
   point at which one of them starts drifting. */
function isActive(l: (typeof LINKS)[number], pathname: string | null): boolean {
  return l.match?.(pathname ?? "") ?? pathname?.startsWith(l.href) ?? false;
}

/**
 * The More tab's mark, drawn here rather than added to <SectionIcon>.
 *
 * It copies that module's grid and stroke — 24 units, 1.5 weight, round caps,
 * `currentColor` — because it sits in the same row at the same size and a second
 * weight beside the other five would be visible. What it does not do is join the
 * union, and that is deliberate: `SectionIconKind` is exactly the seven top-level
 * sections, one per LINKS entry, and products.test.ts asserts both halves of that
 * (seven keys parsed from the dispatch table, every one of them used by a LINKS
 * `icon`). "More" is chrome — it names a control, not a section — so an eighth key
 * would either fail that check or force it to be loosened into asserting nothing.
 *
 * Three dots and not a chevron: the sheet holds destinations, and a chevron says
 * "expand this" about the tab it sits on. Stroked rings rather than filled circles,
 * for the same no-filled-shapes reason the seven have — at r=1.15 with a 1.5 stroke
 * the ring closes optically anyway, so they read as dots and measure as line work.
 */
function MoreIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="5.5" cy="12" r="1.15" />
      <circle cx="12" cy="12" r="1.15" />
      <circle cx="18.5" cy="12" r="1.15" />
    </svg>
  );
}

/**
 * The sheet behind the tab bar's More tab, and the answer to the hole the doc
 * comment above used to describe: Stake and Stable had no tab, and once the top
 * strip went `display: none` under 720px they had nowhere on a phone to be
 * reached from at all — not by touch, and not by assistive tech either, since
 * `display: none` takes them out of the accessibility tree rather than merely
 * hiding them.
 *
 * Bottom-anchored, unlike NetworkSelector's centred modal, and that is the whole
 * reason it is a sheet: it is opened from a control in the bottom bar by a thumb
 * that is already down there, so the panel meets the thumb instead of asking it
 * to travel to the middle of the screen. Everything else — Portal, scrim,
 * Escape, click-outside, `role="dialog"` — is that component's pattern, kept
 * identical on purpose.
 *
 * `items` is passed in rather than filtered here so this stays a renderer with no
 * opinion about which destinations are secondary. LINKS is the one place that
 * decides.
 *
 * FOCUS IS HANDLED HERE AND NOWHERE ELSE IN THIS CODEBASE, ON PURPOSE. The other
 * four dialogs (NetworkSelector, NotificationCenter, WalletMenu, the borrow
 * modals) do none of this. This one is the way Stake and Stable are reached on a
 * phone at all — that is the entire reason it exists — so a keyboard or
 * screen-reader user who cannot get into it is back to the hole it was built to
 * close, and "consistent with the others" would mean consistent with a dead end.
 * The three parts:
 *
 *   - the panel takes focus on open, which is what makes `aria-label` announce;
 *   - Tab cycles inside it, because `aria-modal="true"` claims the page behind is
 *     inert and tabbing out of the sheet would make that claim a lie;
 *   - focus returns to whatever had it, which is the More tab. Nav is in the app
 *     layout and survives the route change, so the button is still there to
 *     receive it even when the sheet closed by navigating.
 */
function MoreSheet({
  items,
  pathname,
  open,
  onClose,
}: {
  items: (typeof LINKS)[number][];
  pathname: string | null;
  open: boolean;
  onClose: () => void;
}) {
  /* `| null` in the type argument, not just the initial value: without it this is
     a RefObject whose `current` is readonly, and `takePanel` below writes it. */
  const panel = useRef<HTMLDivElement | null>(null);

  /*
   * A callback ref, and it has to be one — `panel.current?.focus()` in the effect
   * below silently did nothing.
   *
   * Portal gates its first render on a `useState` host it only sets in its own
   * mount effect (see Portal.tsx: the `#k-portal` node does not exist during SSR),
   * so the sheet's subtree does not exist on the render that opens it. Effects run
   * on that render, find `panel.current === null`, and never run again — `open` and
   * `onClose` have not changed. And because MoreSheet returns null when closed,
   * Portal unmounts and its host state resets, so this was not a first-open-only
   * miss: it was every open.
   *
   * A callback ref fires when the node actually attaches, which is the render
   * after. It also keeps `panel.current` populated for the Tab handler, which
   * reads it lazily at keypress time and so does not care that it was null when
   * the listener was bound.
   */
  const takePanel = useCallback((node: HTMLDivElement | null) => {
    panel.current = node;
    node?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    /* Read before focus moves, restored in the cleanup. `onClose` must be stable
       for this to be safe — see the useCallback in Nav: an inline arrow would
       make a new dep on every render, re-running this effect and restoring focus
       to the More tab from whichever row the user had tabbed to. */
    const returnTo = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      /* Queried live rather than held in a ref array: the rows come from LINKS
         and this reads whatever is actually rendered. Every row is an <a href>,
         and the panel itself is the only other tab stop. */
      const rows = panel.current?.querySelectorAll<HTMLElement>("a[href]");
      if (!rows || rows.length === 0) return;
      const first = rows[0];
      const last = rows[rows.length - 1];
      const here = document.activeElement;
      if (e.shiftKey && (here === first || here === panel.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && here === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      /* The trigger is conditional on `secondary.length`, and a row click can
         land on a route that re-renders the bar, so confirm the node is still in
         the document before focusing it — focus() on a detached element silently
         moves focus to <body>, which is worse than leaving it be. */
      if (returnTo?.isConnected) returnTo.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <Portal>
      <div
        className={styles.sheetOverlay}
        onClick={onClose}
        role="presentation"
      >
        <div
          className={styles.sheet}
          role="dialog"
          aria-modal="true"
          aria-label="More sections"
          /* -1, not 0: the panel is a focus target for `takePanel` above, not a
             stop in the page's own tab order. */
          tabIndex={-1}
          ref={takePanel}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Names the panel for a screen reader, since `aria-label` on the
              dialog is not announced by every combination, and gives the sheet a
              visible edge to be dragged from by the thumb that opened it. */}
          <div className={styles.sheetHead}>More</div>
          {items.map((l) => {
            const active = isActive(l, pathname);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`${styles.sheetRow} ${active ? styles.sheetRowOn : ""}`}
                aria-current={active ? "page" : undefined}
                /* Navigation does not unmount this — Nav is in the app layout,
                   so it survives the route change and the sheet would still be
                   sitting over the page you just asked for. */
                onClick={onClose}
              >
                <span className={styles.sheetIcon}>
                  <SectionIcon kind={l.icon} />
                </span>
                {l.label}
              </Link>
            );
          })}
        </div>
      </div>
    </Portal>
  );
}

export default function Nav() {
  const pathname = usePathname();
  const { chainId, chainName, isConnected } = useWalletV2();
  const [networkOpen, setNetworkOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const chainMeta = getChainMeta(chainId);

  /* Derived, not a second list — see the note on LINKS. `secondary` is what the
     More sheet holds, and `moreActive` is what keeps the bar honest: standing on
     /stake with no tab lit would tell a reader the tab bar does not know where
     they are, which is worse than the crowding this whole arrangement fixes. */
  const secondary = LINKS.filter((l) => !l.primary);
  const moreActive = secondary.some((l) => isActive(l, pathname));

  /* Stable identity, and it is load-bearing rather than a tidiness point: it is a
     dependency of the sheet's focus effect, which focuses the panel when it runs.
     An inline arrow is a new function every Nav render — and Nav re-renders on
     scroll — so the sheet would keep stealing focus back from the row the user
     tabbed to. */
  const closeMore = useCallback(() => setMoreOpen(false), []);

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
            const active = isActive(l, pathname);
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
          const active = isActive(l, pathname);
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
              <span className={styles.tabLabel}>{l.label}</span>
            </Link>
          );
        })}
        {/* The sixth column, and it is conditional on there being something to
            put in it: with every link marked `primary` this would open an empty
            sheet, and a bar of six where one does nothing is worse than a bar of
            five. `.tabBtn` only carries the resets a <button> needs to sit beside
            five <a>s — the geometry is `.tab`, shared, so the columns stay equal. */}
        {secondary.length > 0 && (
          <button
            type="button"
            className={`${styles.tab} ${styles.tabBtn} ${moreActive ? styles.tabOn : ""}`}
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
          >
            <span className={styles.tabIcon}>
              <MoreIcon />
            </span>
            <span className={styles.tabLabel}>More</span>
          </button>
        )}
      </div>
      <MoreSheet
        items={secondary}
        pathname={pathname}
        open={moreOpen}
        onClose={closeMore}
      />
    </>
  );
}
