import { useId } from "react";

import TokenIcon from "./TokenIcon";

/**
 * A token's real logo, sitting on a glossy tinted coin with a small stack
 * behind it — the "a pile of this asset" motif, for stat cards (pool TVL, kfUSD
 * supply, KLD staked), the agents tab, lending rows and the leaderboard.
 *
 * WHY THIS WRAPS TokenIcon RATHER THAN DRAWING ITS OWN LOGOS
 *
 * TokenIcon is already the one place that resolves token art, and its header
 * argues at length against the alternative: it draws real marks from
 * @web3icons (named build-time imports, never the 2,200-icon runtime map) plus
 * a handful of same-origin raster files for our own tokens (KLD, kfUSD, kafUSD,
 * USDG, cirBTC), and it deliberately does NOT hotlink `logoURI` — "a third-party
 * request per row that leaks the user's token list, breaks offline, and 404s
 * silently". Re-sourcing logos here would reintroduce exactly that. So the coin
 * is a frame: the SVG draws the stack + tinted disc + gloss, and the real logo
 * is a TokenIcon laid on the face. Every alias TokenIcon knows (WETH→ETH,
 * cbBTC→BTC, stKLD→KLD, …) and every asset it can draw is covered for free.
 *
 * The tint is the only thing this file owns — the coin colour for a symbol. It
 * falls back to Kaleido emerald, so an unknown token still renders a clean coin
 * (with TokenIcon's monogram, if a fallback is passed, or a bare disc).
 */

/** Coin tint per symbol (base colour; the dark rim and light gloss are derived).
 *  Keyed on the UPPERCASED symbol, including the wrapped forms so WETH gets ETH's
 *  indigo without a second lookup. Add a token = add one line here. */
const TINT: Record<string, string> = {
  // Kaleido-native
  KLD: "#00b383",
  STKLD: "#00b383",
  KFUSD: "#14b8a6",
  KAFUSD: "#b6a179",
  // stables
  USDC: "#2775ca",
  WUSDC: "#2775ca",
  USDG: "#2f9e6e",
  USDT: "#26a17b",
  USDE: "#4b7bec",
  DAI: "#f4b731",
  EURC: "#2f6bd4",
  // majors
  ETH: "#627eea",
  WETH: "#627eea",
  BTC: "#f7931a",
  WBTC: "#f7931a",
  CBBTC: "#f7931a",
  BTCB: "#f7931a",
  CIRBTC: "#f7931a",
  BNB: "#f3ba2f",
  WBNB: "#f3ba2f",
  TBNB: "#f3ba2f",
  POL: "#8247e5",
  WPOL: "#8247e5",
  HYPE: "#12d19e",
};

const DEFAULT_TINT = "#00b383"; // Kaleido emerald

/** Darken (f<0, toward black) or lighten (f>0, toward white) a #rrggbb by a
 *  fraction. Lets the map hold one colour per token instead of three shades. */
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16,
    g = (n >> 8) & 255,
    b = n & 255;
  if (f < 0) {
    const k = 1 + f;
    r *= k;
    g *= k;
    b *= k;
  } else {
    r += (255 - r) * f;
    g += (255 - g) * f;
    b += (255 - b) * f;
  }
  const h = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/* Coin geometry in the 0..48 viewBox, shared by the SVG and the logo overlay so
   the two stay locked together at any size. The front coin is face-on and
   slightly left; the stack peeks out top-right behind it. */
const FCX = 19;
const FCY = 26;
const FR = 15;
const LOGO_INSET = 3; // tint rim left visible around the logo

export default function TokenCoin({
  symbol,
  size = 44,
  chainId,
  className,
}: {
  symbol: string | null | undefined;
  size?: number;
  /** Passed through to TokenIcon to badge the asset's chain, where it helps. */
  chainId?: number;
  className?: string;
}) {
  const key = typeof symbol === "string" ? symbol.trim().toUpperCase() : "";
  const base = TINT[key] ?? DEFAULT_TINT;
  const dark = shade(base, -0.4);
  const light = shade(base, 0.5);
  const gid = `tc-${useId().replace(/:/g, "")}`;

  const u = size / 48; // px per viewBox unit
  const logoD = 2 * (FR - LOGO_INSET) * u;
  const logoLeft = FCX * u - logoD / 2;
  const logoTop = FCY * u - logoD / 2;

  const disc = (cy: number) => (
    <g key={cy}>
      <path d={`M24.6 ${cy} v4 a8.4 2.9 0 0 0 16.8 0 v-4`} fill={dark} />
      <ellipse cx={33} cy={cy} rx={8.4} ry={2.9} fill={base} />
    </g>
  );

  return (
    <span
      className={className}
      style={{
        position: "relative",
        display: "inline-block",
        width: size,
        height: size,
        lineHeight: 0,
        flexShrink: 0,
      }}
    >
      <svg
        viewBox="0 0 48 48"
        width={size}
        height={size}
        aria-hidden="true"
        style={{ display: "block" }}
      >
        <defs>
          <radialGradient id={gid} cx="36%" cy="30%" r="80%">
            <stop offset="0" stopColor={light} />
            <stop offset="0.62" stopColor={base} />
            <stop offset="1" stopColor={dark} />
          </radialGradient>
        </defs>
        <ellipse cx="23" cy="43.4" rx="16" ry="2.5" fill={dark} opacity="0.32" />
        {[31, 26.5, 22].map(disc)}
        <circle cx={FCX} cy={FCY} r={FR} fill={`url(#${gid})`} />
        <circle cx={FCX} cy={FCY} r={FR} fill="none" stroke={dark} strokeWidth="1.2" />
        <path
          d="M9 20.5 A15 15 0 0 1 28 16.6"
          fill="none"
          stroke="#fff"
          strokeOpacity="0.4"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: logoLeft,
          top: logoTop,
          width: logoD,
          height: logoD,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "50%",
          overflow: "hidden",
        }}
      >
        <TokenIcon symbol={symbol} size={logoD} chainId={chainId} chainLabel={false} />
      </span>
    </span>
  );
}
