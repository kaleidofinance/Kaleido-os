"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import PriceChart from "./PriceChart";
import s from "./ChartPanel.module.css";

/**
 * The chart's open/closed state, and which pair it is looking at.
 *
 * Context rather than props because the two halves live on opposite sides of the
 * route boundary: the toggle belongs beside each tab's own settings gear (inside
 * the page), and the chart itself belongs beside the card as a sibling of
 * `{children}` (inside the layout). A page cannot hand a prop to its own layout,
 * and lifting the chart into every page would mean three copies of the same
 * panel drifting apart — the thing NotificationRow exists to prevent elsewhere.
 *
 * The pair is *published by the page* rather than derived here. Swap knows its
 * two sides and they change as you pick tokens; Agent and Limit have no live
 * selection. A provider that tried to guess would be wrong on all three.
 */

export interface ChartPair {
  base: string | null;
  quote: string | null;
}

interface ChartPanelValue {
  open: boolean;
  toggle: () => void;
  /** False until localStorage has been read, so nothing renders mid-hydration. */
  ready: boolean;
  pair: ChartPair;
  publish: (pair: ChartPair) => void;
  /** 0 charts `base`, 1 charts `quote`. */
  side: 0 | 1;
  setSide: (side: 0 | 1) => void;
}

const NO_PAIR: ChartPair = { base: null, quote: null };

const ChartPanelContext = createContext<ChartPanelValue | null>(null);

const STORAGE_KEY = "kaleido.v2.trade.chart";

export function useChartPanel(): ChartPanelValue {
  const ctx = useContext(ChartPanelContext);
  if (!ctx) {
    throw new Error("useChartPanel must be used inside <ChartPanelProvider>");
  }
  return ctx;
}

export function ChartPanelProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  /*
   * Starts closed and is corrected after mount, rather than reading
   * localStorage in the initializer. The initializer runs during SSR where
   * `window` does not exist, and a value that differs between server and first
   * client render is a hydration mismatch — which React resolves by throwing
   * away the server HTML for that subtree. `ready` is what the layout waits on,
   * so a user who left the chart open does not see it flash shut.
   */
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [pair, setPair] = useState<ChartPair>(NO_PAIR);
  const [side, setSide] = useState<0 | 1>(0);

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // Private mode, or storage disabled. Closed is the safe default.
    }
    setReady(true);
  }, []);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Preference is lost on reload; the toggle still works this session.
      }
      return next;
    });
  }, []);

  const publish = useCallback((next: ChartPair) => {
    setPair((prev) =>
      prev.base === next.base && prev.quote === next.quote ? prev : next,
    );
  }, []);

  const value = useMemo(
    () => ({ open, toggle, ready, pair, publish, side, setSide }),
    [open, toggle, ready, pair, publish, side],
  );

  return (
    <ChartPanelContext.Provider value={value}>
      {children}
    </ChartPanelContext.Provider>
  );
}

/**
 * Tells the panel which asset this tab is about.
 *
 * Symbols, not tokens: the feed is keyed by symbol (see feeds.ts on why price is
 * not chain-scoped the way identity is), and passing primitives keeps the effect
 * from re-firing on every render the way a fresh object literal would.
 */
export function usePublishChartPair(
  base: string | null | undefined,
  quote?: string | null | undefined,
) {
  const { publish } = useChartPanel();

  useEffect(() => {
    publish({ base: base ?? null, quote: quote ?? null });
  }, [publish, base, quote]);

  /*
   * Clears on unmount, in an effect of its own so the cleanup fires when the
   * page leaves and not on every token change. The provider outlives the route —
   * that is the point of it — so without this, stepping from Swap to Buy would
   * leave the chart showing the pair from the tab you just left. Buy and Sell
   * publish nothing, and a panel is only shown for what the current tab claims.
   */
  useEffect(() => () => publish(NO_PAIR), [publish]);
}

/**
 * The toggle, sized to sit beside a settings gear.
 *
 * Shown even when the current symbol has no feed. The alternative — hiding it —
 * makes a control appear and vanish as you change tokens, and leaves no way to
 * find out *why* there is no chart. Open it and the panel says so.
 */
export function ChartToggle({ className }: { className?: string }) {
  const { open, toggle } = useChartPanel();
  return (
    <button
      type="button"
      className={`${s.toggle} ${open ? s.toggleOn : ""} ${className ?? ""}`}
      onClick={toggle}
      aria-pressed={open}
      aria-label={open ? "Hide price chart" : "Show price chart"}
      title={open ? "Hide chart" : "Show chart"}
    >
      {/* Inline rather than a glyph: there is no chart character that renders
          consistently across platforms, and the gear beside it is a glyph only
          because ⚙ does. */}
      <svg viewBox="0 0 16 16" aria-hidden focusable="false">
        <polyline
          points="1.5,11.5 5.5,7 8.5,9.5 14.5,3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          points="11,3 14.5,3 14.5,6.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

/**
 * The panel itself, rendered by the trade layout beside the card.
 *
 * Three conditions before it draws, and each removes a way this could mislead:
 * `ready` so the first paint matches the server's and a saved-open chart does not
 * flash shut; `open` for the obvious reason; and a symbol, because a tab that
 * publishes no pair — Buy and Sell — has nothing for the panel to be about.
 *
 * Below the layout's breakpoint the CSS hides it outright. A chart squeezed
 * beside a 520px card on a phone is neither readable nor worth the height, and
 * the trade shell is locked to the viewport with none to spare.
 */
export function ChartSlot() {
  const { open, ready, pair, side, setSide } = useChartPanel();
  if (!ready || !open) return null;

  // Falls back to base when the second side is absent, so a one-token tab cannot
  // land on an empty panel by having `side` left at 1 by the tab before it.
  const symbol = side === 1 ? (pair.quote ?? pair.base) : pair.base;
  if (!symbol) return null;

  return (
    <div className={s.slot}>
      <PriceChart symbol={symbol} pair={pair} side={side} onSide={setSide} />
    </div>
  );
}
