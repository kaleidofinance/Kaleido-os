import type { AgentCard, CardTone, NoticeCard, TokenCard } from "./types";

/**
 * Paste a contract → a token card whose buttons are agent commands.
 *
 * The Telegram-bot loop, as an agent surface: a user drops a contract (or a
 * chart / explorer link to one) into Luca and gets a live card — price, market
 * cap, the launch's taxes and status — with one-tap Buy / Sell presets. Each
 * button SENDS a pre-composed command (`buy 0x… with 5 usdc`) that runs the same
 * grammar → plan → audit → review → signature path as a typed one, so a tap
 * saves typing, never a decision. See TokenCard in types.ts for why this kind
 * may act at all (it is local-only, wire-forbidden).
 *
 * Pure: no fetch, no React. The page fetches `TokenFacts` from
 * /api/token/card and hands them here; tests drive this with fixtures.
 */

/** What /api/token/card returns. Numbers are raw here; this file formats them. */
export interface TokenFacts {
  ok: boolean;
  /** Why there is no tradable token: shown on the notice card. */
  reason?: string;
  /** argus = an Argus launch (full facts); listed = in this chain's registry;
   *  unknown = a readable ERC-20 we don't route yet. */
  source?: "argus" | "listed" | "unknown";
  /** Checksummed contract address. */
  address: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  /** USD per whole token (the quote is USDC on Arc), or null if unreadable. */
  priceUsd?: number | null;
  marketCapUsd?: number | null;
  buyTaxBps?: number;
  sellTaxBps?: number;
  /** Opening surcharge is live — buying now can cost up to ~99%. */
  snipeActive?: boolean;
  bonded?: boolean;
  /** True when the pasted address IS the chain's quote asset (USDC). */
  isQuote?: boolean;
}

/** Default one-tap sizes. USDC for buys; share of balance for sells. */
export const DEFAULT_BUY_USDC = [1, 5, 25] as const;
export const DEFAULT_SELL_PCT = [25, 50, 100] as const;

const ADDRESS = /0x[0-9a-fA-F]{40}/g;
const BARE_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * The contract a message is "just pasting", or null.
 *
 * Deliberately narrow: the WHOLE message must be one token — a bare address, or
 * an http(s) link carrying one (the last address in the path, which is where
 * explorers and chart sites put the token). Anything with a space is a sentence
 * and belongs to the grammar — "buy 0x… with 5 usdc" must reach the parser, not
 * be swallowed here. A link whose address turns out to be a pair or a wallet
 * resolves to "not a token" downstream and shows a notice; it never trades.
 */
export function pastedTokenAddress(text: string): string | null {
  const t = text.trim();
  if (!t || /\s/.test(t)) return null;
  if (BARE_ADDRESS.test(t)) return t;
  if (/^https?:\/\//i.test(t)) {
    const all = t.match(ADDRESS);
    return all ? all[all.length - 1] : null;
  }
  return null;
}

/** "0x08Ad…2A71". */
export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * A USD price with ~4 significant digits and never scientific notation — a
 * launch token at 4.1e-5 reads "$0.00004103", not "$4.103e-5".
 */
export function formatUsdPrice(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return "—";
  if (p >= 1) {
    return `$${p.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  }
  const decimals = Math.min(18, Math.max(2, -Math.floor(Math.log10(p)) + 3));
  const fixed = p.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "");
  return `$${fixed}`;
}

/** "$1.2K", "$3.4M" — market caps are read at a glance, not to the cent. */
export function formatUsdCompact(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "—";
  return `$${new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(v)}`;
}

/** 100 → "1%", 250 → "2.5%". */
export const formatBps = (bps: number) =>
  `${Number((bps / 100).toFixed(2))}%`;

/** A tax above this reads as a warning — round trips get expensive fast. */
const HIGH_TAX_BPS = 500;

function notice(tone: CardTone, title: string, body?: string): NoticeCard {
  return { kind: "notice", tone, title, ...(body ? { body } : {}) };
}

/**
 * Facts → the card to render. A TokenCard when the token is tradable here, a
 * NoticeCard saying why when it is not — never a card with buttons that would
 * route a token we can't price or whose decimals we'd be guessing.
 */
export function tokenCardFrom(
  facts: TokenFacts,
  presets: {
    buys?: readonly number[];
    sells?: readonly number[];
  } = {},
): AgentCard {
  if (!facts.ok) {
    return notice(
      "warn",
      "No card for that contract",
      facts.reason ?? "The contract didn't answer like a token on this chain.",
    );
  }
  const symbol = facts.symbol ?? shortAddress(facts.address);
  if (facts.isQuote) {
    return notice(
      "neutral",
      `${symbol} is the quote asset`,
      "That's what you buy launches with. Paste a token's contract to see its card.",
    );
  }
  if (facts.source === "unknown") {
    return notice(
      "neutral",
      `${symbol} isn't an Argus launch or a listed token`,
      "Luca trades Argus launches and listed tokens from a pasted contract for now.",
    );
  }

  /* An Argus launch is traded by address (the grammar resolves it on Arc); a
     listed token by its symbol, so it takes the same route a typed command does. */
  const ref = facts.source === "argus" ? facts.address : symbol;
  const buys = (presets.buys ?? DEFAULT_BUY_USDC).map((n) => ({
    label: `Buy ${n}`,
    command: `buy ${ref} with ${n} usdc`,
    ...(facts.snipeActive ? { disabled: true } : {}),
  }));
  const sells = (presets.sells ?? DEFAULT_SELL_PCT).map((pct) => ({
    label: pct >= 100 ? "Sell all" : `Sell ${pct}%`,
    command:
      pct >= 100 ? `sell all ${ref} for usdc` : `sell ${pct}% of ${ref} for usdc`,
  }));

  const rows: TokenCard["rows"] = [];
  if (facts.marketCapUsd != null) {
    rows.push({ label: "Market cap", value: formatUsdCompact(facts.marketCapUsd) });
  }
  if (facts.buyTaxBps != null) {
    rows.push({
      label: "Buy tax",
      value: formatBps(facts.buyTaxBps),
      ...(facts.buyTaxBps > HIGH_TAX_BPS ? { tone: "warn" as const } : {}),
    });
  }
  if (facts.sellTaxBps != null) {
    rows.push({
      label: "Sell tax",
      value: formatBps(facts.sellTaxBps),
      ...(facts.sellTaxBps > HIGH_TAX_BPS ? { tone: "warn" as const } : {}),
    });
  }
  if (facts.source === "argus") {
    rows.push(
      facts.snipeActive
        ? { label: "Status", value: "Opening surcharge", tone: "bad" }
        : facts.bonded
          ? { label: "Status", value: "Bonded", tone: "good" }
          : { label: "Status", value: "Live" },
    );
  }

  const card: TokenCard = {
    kind: "token",
    symbol,
    address: shortAddress(facts.address),
    ...(facts.name && facts.name !== symbol ? { name: facts.name } : {}),
    ...(facts.priceUsd != null && facts.priceUsd > 0
      ? { price: formatUsdPrice(facts.priceUsd) }
      : {}),
    badge:
      facts.source === "argus"
        ? { text: "Argus launch", tone: "neutral" }
        : { text: "Listed", tone: "good" },
    rows,
    ...(facts.snipeActive
      ? {
          note: "Opening surcharge is live — buys unlock in a few seconds. Paste it again then.",
        }
      : {}),
    buys,
    sells,
  };
  return card;
}
