import type { ReactNode } from "react";

import TokenBNB from "@web3icons/react/icons/tokens/TokenBNB";
import TokenBTC from "@web3icons/react/icons/tokens/TokenBTC";
import TokenDAI from "@web3icons/react/icons/tokens/TokenDAI";
import TokenETH from "@web3icons/react/icons/tokens/TokenETH";
import TokenHYPE from "@web3icons/react/icons/tokens/TokenHYPE";
import TokenPOL from "@web3icons/react/icons/tokens/TokenPOL";
import TokenUSDC from "@web3icons/react/icons/tokens/TokenUSDC";
import TokenUSDE from "@web3icons/react/icons/tokens/TokenUSDE";
import TokenUSDT from "@web3icons/react/icons/tokens/TokenUSDT";
import TokenWBTC from "@web3icons/react/icons/tokens/TokenWBTC";

import { getChainMeta } from "@/constants/chains";
import ChainIcon from "./ChainIcon";
import m from "./TokenIcon.module.css";

/**
 * Token logo, resolved at build time.
 *
 * The sibling of ChainIcon and built the same way, for the same reason: the
 * library's runtime `<TokenIcon name={...}>` reaches for `dynamicIconImports`,
 * a generated map of ~2,200 `() => import(...)` thunks. A bundler cannot know
 * which one a runtime string picks, so it builds all of them — measured at
 * 4,360 modules for the network variant alone. This package ships 1,844 token
 * icons; we render ten. Naming them keeps the other 1,834 out of the graph.
 *
 * Kaleido's own tokens are not in that package and never will be, so they are
 * served from files in `public/` — see RASTER below.
 *
 * WHY SYMBOLS AND NOT `logoURI`
 *
 * `TokenEntry.logoURI` has existed since the registry was written and has never
 * been populated by anything, which is why tokens in this app render as a
 * three-letter monogram wherever neither table below has an entry. Filling it in
 * would mean hotlinking a CDN per token: a third-party request per row that
 * leaks the user's token list to whoever hosts it, breaks offline, and 404s
 * silently into a broken-image glyph. Note that this objection is to the
 * hotlinking, not to raster art — a file we ship is same-origin, cached with the
 * app, and tells nobody anything.
 *
 * WHY WRAPPED ASSETS FOLD TO THEIR UNDERLYING
 *
 * The library ships no WETH, WBNB, WPOL, cbBTC or BTCB asset, and drawing a
 * monogram beside eight real logos looks like a bug rather than a distinction.
 * Wrapped tokens are already shown as their underlying everywhere it is safe to
 * — see feeds.ts, which prices WETH as ether — and a logo is a weaker claim
 * than a price: it says "this is about ether", not "this is ether". The symbol
 * text sits next to the icon in every one of these surfaces and is what
 * actually names the asset, so nothing here is the only thing distinguishing
 * WETH from ETH.
 *
 * The one place that does NOT hold is decimals and identity, which is why this
 * map is display-only. Never resolve a token through it.
 */

/** Derived from a real icon: the library's own prop types, not a guess. */
type IconComponent = typeof TokenETH;

const ICONS: Record<string, IconComponent> = {
  BNB: TokenBNB,
  BTC: TokenBTC,
  DAI: TokenDAI,
  ETH: TokenETH,
  HYPE: TokenHYPE,
  POL: TokenPOL,
  USDC: TokenUSDC,
  USDE: TokenUSDE,
  USDT: TokenUSDT,
  WBTC: TokenWBTC,
};

/**
 * Symbols that render as another asset's logo.
 *
 * Split from ICONS rather than pointed at the same component so the aliasing is
 * legible: this table is a list of claims ("tBNB looks like BNB"), and each one
 * is a judgement someone might want to revisit.
 *
 * tBNB is BNB's testnet face and BSC ships no separate mark for it. Arc's
 * native asset genuinely is USDC — at 18 decimals rather than 6, which is a
 * fact about arithmetic and not about the logo.
 *
 * stKLD is the staked receipt for KLD and there is no separate art for it, so it
 * borrows KLD's. Same reasoning as the wrapped assets above: the symbol text
 * beside the icon is what names it, and "this is about KLD" is true.
 */
const ALIASES: Record<string, string> = {
  WETH: "ETH",
  WBNB: "BNB",
  TBNB: "BNB",
  WPOL: "POL",
  CBBTC: "BTC",
  BTCB: "BTC",
  STKLD: "KLD",
};

/**
 * Our own tokens, drawn from files we ship.
 *
 * All three are square art on a circular subject, so one CSS rule covers them
 * and the map is just a path. `/kld.png` is a 300px crop of `/newklogo2.png`,
 * the mark Nav and the agent avatar already draw: that file is a 500px render
 * whose glyph sits small and off-centre, which those two work around with
 * `background-size: 240%`. Cropping once means this can be an `<img>` like the
 * others instead of a background-image — the only element that can be zoomed and
 * clipped at the same time, and the one shape `.tkiArt > img` rules in other
 * stylesheets do not know how to size.
 *
 * USDT and USDe also have files under `public/stable/`, deliberately unused:
 * @web3icons ships real vector marks for both, and a PNG is the worse of the two
 * once one exists.
 */
const RASTER: Record<string, string> = {
  KFUSD: "/stable/kfUSD.png",
  KAFUSD: "/stable/kafUSD.png",
  KLD: "/kld.png",
};

/** True when we can draw a real logo. Callers use it to skip the monogram. */
export function hasTokenIcon(symbol: string | null | undefined): boolean {
  if (typeof symbol !== "string") return false;
  const key = symbol.trim().toUpperCase();
  const resolved = ALIASES[key] ?? key;
  return Boolean(ICONS[resolved] ?? RASTER[resolved]);
}

/**
 * The chain badge — a network mark clipped into the token mark's bottom-right.
 *
 * WHY IT LIVES HERE and not in each surface. Two places had already built it by
 * hand and the two had drifted: TokenSelector's row put a real <ChainIcon> inside
 * its ring, while the swap form's pill drew the ring and left it EMPTY, so the
 * one screen where a token's chain is least obvious showed an unlabelled coloured
 * dot. Both are now this function, which means the ring geometry, the fallback
 * and the accessible name are decided once.
 *
 * RENDERED AS A SIBLING OF THE TOKEN MARK, not wrapped around it. Every plate in
 * the app styles the mark with a direct-child selector — `.tkiArt > svg` in
 * TokenSelector.module.css and trade.module.css, `.tkiArt > img` in the borrow
 * modals — so introducing a wrapper element would silently unstyle the logo in
 * roughly ten stylesheets. The badge is positioned instead against the caller's
 * own plate, which is what the hand-rolled version already did.
 *
 * THE ONE THING A CALLER MUST PROVIDE is `position: relative` on that plate.
 * Without it the badge escapes to the nearest positioned ancestor, which is
 * visible immediately rather than subtly, and both current callers already set it
 * — it is what their own badge needed.
 *
 * Half the mark's diameter, with the ring eating 2px on each side (box-sizing is
 * border-box under Tailwind's preflight), so a 34px token gets a 17px badge
 * drawing a 13px network mark. Scaling with the mark rather than taking a fixed
 * size is what keeps it legible at 20px and unobtrusive at 46px.
 *
 * A chain the icon library has no asset for — Hyperliquid, today — falls back to
 * `ChainMeta.color`, the same flat dot NetworkFilter uses. It carries less
 * information than a logo, but "some chain, consistently that colour" beats a gap
 * in a list where every other row is badged.
 */
function ChainBadge({
  chainId,
  size,
  labelled,
}: {
  chainId: number;
  size: number;
  labelled: boolean;
}) {
  const meta = getChainMeta(chainId);
  if (!meta) return null;

  const outer = Math.max(12, Math.round(size * 0.5));

  return (
    <span
      className={m.badge}
      style={{ width: outer, height: outer }}
      /* Named only where nothing else names the chain. In a list row that
         already prints "USDC · Ethereum" beside the mark, a label here makes a
         screen reader say the chain twice; on the swap pill it is the only thing
         that says it at all, so there it must be announced. */
      {...(labelled
        ? { role: "img", "aria-label": `on ${meta.name}` }
        : { "aria-hidden": true as const })}
      title={meta.name}
    >
      <ChainIcon
        id={meta.iconId}
        size={outer - 4}
        variant="branded"
        fallback={
          <i className={m.badgeDot} style={{ background: meta.color }} />
        }
      />
    </span>
  );
}

export default function TokenIcon({
  symbol,
  size = 28,
  variant = "branded",
  className,
  fallback = null,
  chainId,
  chainLabel = true,
}: {
  symbol: string | null | undefined;
  size?: number;
  variant?: "branded" | "mono" | "background";
  className?: string;
  /** Rendered when the asset has no logo — normally the monogram it replaces. */
  fallback?: ReactNode;
  /**
   * Draws the chain badge. Opt-in, and deliberately so: in a single-chain
   * surface every row carries the same badge, which is decoration rather than
   * information — /portfolio and the borrow modals name their chain once in the
   * header instead. Pass it where rows can differ, or where a selection made
   * elsewhere might not be on the chain this screen acts against.
   *
   * The badge needs `position: relative` on the plate that contains this icon.
   * See ChainBadge above.
   */
  chainId?: number;
  /**
   * Whether the badge announces its chain to assistive tech. Leave it on unless
   * the surrounding text already names the chain, as a token-list row does.
   */
  chainLabel?: boolean;
}) {
  const key = typeof symbol === "string" ? symbol.trim().toUpperCase() : "";
  const resolved = ALIASES[key] ?? key;

  /* The badge is appended to whichever of the three arms rendered, the monogram
     fallback included. Badging only the rows with real art would make the badge
     look like a property of the logo rather than of the asset. */
  const badge =
    chainId === undefined ? null : (
      <ChainBadge chainId={chainId} size={size} labelled={chainLabel} />
    );

  const Icon = ICONS[resolved];
  if (Icon)
    return (
      <>
        <Icon size={size} variant={variant} className={className} />
        {badge}
      </>
    );

  const src = RASTER[resolved];
  if (src) {
    return (
      <>
        {/* `width`/`height` as attributes, NOT inline style. They give the same
           intrinsic size and the same protection from layout shift, but sit at the
           bottom of the cascade rather than the top — so a caller whose plate is a
           different size to the `size` it passes still wins. BorrowModals is
           exactly that caller: an 18px plate, `size={20}`, and a
           `.tkiArt > img { width: 100% }` rule that an inline width would silently
           beat, overflowing the plate by 2px.

           alt="" because every surface that draws a token icon prints the symbol
           beside it, so a name here would only be read out twice. `variant` is
           ignored: there is one file per token, with no mono or background cut.

           next/image is deliberately not used — a 28px same-origin PNG does not
           need an optimiser round-trip, and plain <img> is what the sibling
           raster path in BorrowModals already does. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          className={`${m.mark}${className ? ` ${className}` : ""}`}
        />
        {badge}
      </>
    );
  }

  return (
    <>
      {fallback}
      {badge}
    </>
  );
}
