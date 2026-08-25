/**
 * The five products, as data.
 *
 * Its own module rather than a constant inside `ProductRail.tsx` because two
 * places quote it and they must not disagree: the rail renders it, and the page
 * puts `PRODUCTS.length` in the section heading and in the hero's stat row. A
 * sixth product added here corrects both without either being edited — which is
 * the same discipline `capabilities.ts` applies to the 23 in `#can`, and for the
 * same reason. A count is the one kind of copy a reader can falsify by scrolling.
 *
 * `ProductRail` is a client component and this file is not marked `"use client"`,
 * which is correct and deliberate: a module imported by a client component is
 * bundled for the client, and imported by a server component it is evaluated on
 * the server. Plain data with no hooks and no imports travels to both. Do not add
 * a runtime dependency here without checking what it drags into the browser.
 */

/**
 * The mechanism this product is, named once and drawn twice.
 *
 * `ProductArt` reads it for the ~200px figure in the panel and `SectionIcon` for
 * the 18px mark in the rail's row, so the two are the same claim at two scales
 * rather than two independent editorial picks that can come to disagree.
 *
 * `ProductArt` dispatches over a `Record<ArtKind, …>`, so a sixth product cannot
 * ship without a figure — TypeScript requires the key. `SectionIcon` is a
 * `Record` over its own seven-member union instead, because Nav's mobile tab bar
 * draws the same set and app chrome must not import from a route group; adding a
 * sixth `ArtKind` therefore fails at ProductRail's `kind={p.art}` rather than in
 * the icon module. Either way it is a compile error and not a blank square. The
 * subset is asserted in products.test.ts section 1.
 *
 * An explicit key rather than a switch on `name`, so renaming "Trade" to "Swap"
 * is a copy edit and not a silently missing diagram.
 */
export type ArtKind = "swap" | "range" | "book" | "wrap" | "mint";

/**
 * One way into a product, in the panel's footer row.
 *
 * `label` IS THE APP'S OWN TAB WORD FOR THAT ROUTE, never a phrase written for
 * this page. Trade's strip reads `Agent | Swap | Limit | Buy | Sell`
 * (trade/layout.tsx), Stable's reads `Mint | Redeem | Earn` (stable/layout.tsx),
 * the lending shell reads `Borrow | Lend`, and /pool/new titles itself "New
 * position" — so somebody who presses "Redeem" here lands on a screen whose
 * highlighted tab says the word they just pressed. A nicer label written here
 * spends that recognition on copy nobody asked for.
 *
 * It is also why "Sell" is not relabelled "Off-ramp" or "Cash out", which is what
 * it is: /trade/sell is a MoonPay fiat off-ramp, and the app calls it Sell.
 */
export interface ProductLink {
  /** A verified in-app route — a real `page.tsx`, checked, not assumed. */
  href: string;
  /** The word the app's own tab strip or heading uses for it. */
  label: string;
}

export interface Product {
  /** Rail label, and the panel heading's subject. */
  name: string;
  /** Six words or fewer — it sits under the name in a 340px column. */
  note: string;
  /**
   * Where this product can be entered, in the order the app's own tab strip
   * lists them. The first is the front door and the panel draws it as the solid
   * button; the rest are outlined.
   *
   * NOT EVERY ROUTE THE PRODUCT HAS, and the cut is deliberate: the personal
   * views — /mylends, /myloans, /pool/positions' sibling reads — are where you
   * go to check on something you already did, and nobody arriving from a landing
   * page has done it yet. Trade's `Limit` and `Buy` are left out for the same
   * reason a rail note is six words: three is the most a footer row can offer
   * before it stops being a choice and becomes a menu.
   */
  links: readonly ProductLink[];
  title: string;
  /** One line. If it needs a second sentence, the first one was not the point. */
  body: string;
  /**
   * Which figure the panel draws, and which icon the rail's row draws.
   *
   * THERE IS NO TOKEN FIELD HERE ANY MORE. `mark: ["ETH", "USDC"]` used to sit in
   * this slot and put the product's real asset logos in the rail's row. Two rows
   * drew the identical pair of discs, because ETH/USDC identifies a market and not
   * a product, and the row's job is to say which of five things you are looking
   * at. `SectionIcon` draws the mechanism instead. The token art did not leave the
   * page — the panel's figure is full of it, and a pair is the subject there.
   */
  art: ArtKind;
  /**
   * Three facts, each checkable against the product or the contracts. These are
   * deliberately not benefit copy: "MEV Shield" and "Auto-Rebalance" are the kind
   * of pill the current production page carries with nothing behind them, and a
   * claim a reader cannot verify costs more than it buys.
   */
  points: readonly string[];
}

export const PRODUCTS: readonly Product[] = [
  {
    name: "Trade",
    note: "Swap, limit, fiat on-ramp",
    /* Three of Trade's five tabs. `Sell` is the fiat off-ramp — /trade/sell posts
       `mode: "sell"` to /api/moonpay, which signs the widget URL server-side and
       settles to a bank. `/trade` itself is only a redirect to `/trade/agent`, so
       Agent is named directly rather than pointed at the index. */
    links: [
      { href: "/trade/agent", label: "Agent" },
      { href: "/trade/swap", label: "Swap" },
      { href: "/trade/sell", label: "Sell" },
    ],
    title: "Concentrated-liquidity swaps",
    body: "A V3 core with real tick ranges and real fee tiers, quoted before you sign.",
    art: "swap",
    points: [
      "Quotes priced server-side, not assembled in the browser",
      "A swap is an approve and then the swap — two transactions, shown as two",
      "Limit orders and a fiat on-ramp on the same page",
    ],
  },
  {
    name: "Liquidity",
    note: "Tick ranges, fee collection",
    links: [
      { href: "/pool", label: "All pools" },
      { href: "/pool/new", label: "New position" },
    ],
    title: "Positions you actually control",
    body: "Choose the range, mint the position, collect what it earned without closing it.",
    art: "range",
    points: [
      "Real tick math, not a risk slider over someone else's range",
      "Collecting fees is its own action, any time",
      "Closing a position is a decrease and then a collect",
    ],
  },
  {
    name: "Borrow",
    note: "Your rate, your term",
    /* Both sides of one book, which is the product's whole claim — the shell at
       (lending)/layout.tsx routes them as sibling tabs over the same listings. */
    links: [
      { href: "/borrow", label: "Borrow" },
      { href: "/lend", label: "Lend" },
    ],
    title: "Peer-to-peer, both directions",
    body: "Post the rate and term you want, or take one somebody has already posted.",
    art: "book",
    points: [
      "You set the interest and the number of days",
      "Lend into a request, or borrow against a listing",
      "A health factor enforced on chain, not in the interface",
    ],
  },
  {
    name: "Stake",
    note: "KLD for liquid stKLD",
    /* One route, and one button is correct rather than a gap to be filled: /stake
       has no tab strip because staking and unstaking are the same form. A second
       destination here would have to be invented. */
    links: [{ href: "/stake", label: "Stake KLD" }],
    title: "Liquid staking",
    body: "Stake KLD, hold stKLD, stay liquid — the yield is the exchange rate moving.",
    art: "wrap",
    /* "No advertised APY" is a copy rule rather than modesty: the app quotes no
       rate for this, so neither does the page. capabilities.ts states it too. */
    points: [
      "stKLD is transferable while it earns",
      "No advertised APY — the exchange rate is the whole disclosure",
      "One transaction in, one out",
    ],
  },
  {
    name: "Stable",
    note: "kfUSD and the kafUSD vault",
    /* Stable's own three tabs, in its own order. `Earn` is the kafUSD vault — the
       facts below describe unlocking it, so the way in belongs here. */
    links: [
      { href: "/stable/mint", label: "Mint" },
      { href: "/stable/redeem", label: "Redeem" },
      { href: "/stable/earn", label: "Earn" },
    ],
    title: "kfUSD, and somewhere to put it",
    body: "Mint against USDC, USDT or USDe. Lock it in the kafUSD vault to earn on it.",
    art: "mint",
    points: [
      "Three collateral assets, redeemable back to any of them",
      "Unlocking is a request and then a withdrawal, by design",
      "The vault pays out in kfUSD — it refuses to pay collateral",
    ],
  },
];
