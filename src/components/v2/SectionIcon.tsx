import type { ReactNode } from "react";

/**
 * One line icon per top-level section of the app.
 *
 * TWO CALLERS, ONE SET. The landing page's product rail draws five of these at 18px
 * beside each product name, and Nav's mobile tab bar and More sheet draw all eight
 * at 20px above or beside each label. They were separate before and both were weak:
 * the rail carried the products' real
 * token logos, which name a market rather than a product — Trade and Liquidity drew
 * the identical ETH/USDC pair — and the tab bar carried Unicode glyphs, `⇄ ◎ ⇢ ▲ $
 * ◈ ◍`, which are whatever the device's font decides they are. `◍` in particular is
 * a rounded compound glyph that a fair number of Android font stacks have no
 * coverage for at all, and the fallback for a missing glyph is a box.
 *
 * THE KEYS ARE MECHANISMS, NOT PAGE NAMES, for the five that have one. `swap`,
 * `range`, `book`, `wrap` and `mint` are exactly the members of `ArtKind` in the
 * marketing route group's products.ts, which is the key its panel figures dispatch
 * on — so a product's 18px mark, its ~200px diagram and its tab-bar icon are one
 * mechanism drawn at three scales and cannot drift into describing different things.
 * The union is duplicated rather than imported, deliberately: this module is app
 * chrome and must not depend on a marketing route group. A rename on either side is
 * a compile error at ProductRail's call site, which is where it should be.
 *
 * `leaderboard` and `portfolio` are named for their pages because they have no
 * mechanism — they are the two sections that show you the result of one. `faucet`
 * is named for its page too, and is the one key with no counterpart in `ArtKind`:
 * the landing page's product rail has no faucet card and should not have one, so
 * the two sets overlap in five places rather than being the same list. The test
 * asserts the direction that matters — every ArtKind is a key here — not equality.
 */
export type SectionIconKind =
  | "swap"
  | "range"
  | "book"
  | "wrap"
  | "mint"
  | "leaderboard"
  | "portfolio"
  | "faucet";

/**
 * 24-unit grid, one 1.5 stroke weight, round caps — the eight have to look like a
 * set at 18px, which means no filled shapes and no second weight.
 *
 * Absolute coordinates throughout. Relative shorthand packs tighter and makes an
 * arrowhead unreadable the next time somebody needs to nudge one.
 */
const PATHS: Record<SectionIconKind, ReactNode> = {
  /* Two arrows, opposite directions. This replaced `⇄`, which is what Nav gave
     /trade, so the tab bar keeps the mark it had and stops depending on the font
     shipping it. */
  swap: (
    <>
      <path d="M4 9H19M16 6L19 9L16 12" />
      <path d="M20 15H5M8 12L5 15L8 18" />
    </>
  ),

  /* A position between two tick bounds: the verticals are the range, the box is
     the liquidity in it. Not a curve — depth needs pool state the landing page
     does not have, and ProductArt's `range` figure withholds it for the same
     reason. */
  range: (
    <>
      <path d="M5 4V20" />
      <path d="M19 4V20" />
      <rect x="8.5" y="9" width="7" height="6" rx="1.5" />
    </>
  ),

  /* Both sides of one book, which is the whole claim: one arrow out, one in. */
  book: (
    <>
      <path d="M8 20V5M5 8L8 5L11 8" />
      <path d="M16 4V19M19 16L16 19L13 16" />
    </>
  ),

  /* A token inside its wrapper — stKLD holding KLD. The only rounded square in the
     set, so it stays distinct from `mint`'s circle at row size. */
  wrap: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5.5" />
      <circle cx="12" cy="12" r="4" />
    </>
  ),

  /* A coin with the peg drawn in it. The two bars are an equals sign, which is
     what a stablecoin's claim actually is. */
  mint: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8 10.5H16M8 13.5H16" />
    </>
  ),

  /* Three bars in podium order — second, first, third — rather than ascending.
     Ascending is a growth chart and this section is standings. */
  leaderboard: <path d="M6 20V14M12 20V6M18 20V11" />,

  /* A ring with one segment marked off: an allocation, which is what the section
     shows. Reuses `mint`'s circle radius so the two sit at the same weight in the
     tab bar, and the segment is what tells them apart. */
  portfolio: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5V12H20.5" />
    </>
  ),

  /* A spout and one drop under it. The only icon in the set drawn as an object
     rather than a mechanism, because the faucet is not one: it hands out testnet
     assets, and there is nothing about that worth abstracting into arrows.

     A drop and not a coin — `mint` and `portfolio` are both 8.5-radius circles
     already, and a third round shape at 18px would read as one of them. The
     teardrop is stroked like everything else here, so it stays line work at the
     set's one weight. */
  faucet: (
    <>
      <path d="M6 6.5H14.5V10.5" />
      <path d="M14.5 13C14.5 13 12.4 15.5 12.4 17A2.1 2.1 0 0 0 16.6 17C16.6 15.5 14.5 13 14.5 13Z" />
    </>
  ),
};

/**
 * EVERY STROKE IS `currentColor`, EVERY FILL IS NONE, and there is no size prop.
 * Both callers tint and size these from CSS — muted then brand green in the rail,
 * --k-t2 then --k-brand in the tab bar — and both ends of that invert between
 * light and dark. A hardcoded hex would look correct in whichever theme it was
 * authored in and wrong in the other, with nothing to report it.
 *
 * `aria-hidden` here rather than on either caller's wrapper: the icon restates the
 * label it sits with in both places. It travels with the component so a third
 * caller cannot forget it.
 *
 * No width or height attribute — a viewBox with no dimensions falls back to
 * 300×150 in a context that gets no CSS, which is loud enough to notice rather
 * than subtly wrong.
 */
export default function SectionIcon({ kind }: { kind: SectionIconKind }) {
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
      {PATHS[kind]}
    </svg>
  );
}
