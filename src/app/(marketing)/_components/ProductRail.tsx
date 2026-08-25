"use client";

import { useState } from "react";
import Link from "next/link";
import SectionIcon from "@/components/v2/SectionIcon";
import { PRODUCTS } from "./products";
import ProductArt from "./ProductArt";
import s from "./ProductRail.module.css";

/**
 * The five products — a rail of names beside one panel of detail.
 *
 * WHAT THIS REPLACED, AND WHY. The section was a live price chart in the left
 * column and the five product names as a flat row list in the right one. Two
 * things were wrong with it. The chart is a *trade* surface, so pairing it with
 * all five names implied it belonged to all five; and a row list gives every
 * product the same six words, which is enough to name them and not enough to say
 * anything. Five products with one line each is a directory, not an argument.
 *
 * A rail plus a detail panel fixes both: the names stay visible as a set, and one
 * of them is expanded at a time with three checkable facts under it.
 *
 * The shape is the one the current production landing page uses for its module
 * grid — a vertical column of buttons beside an animated detail panel. It is the
 * best-working component on that page and the reason is structural rather than
 * decorative: it is the only place a visitor can see the whole product surface and
 * one product in depth without scrolling between them.
 *
 * NO PRICE CHART IN HERE, AND DO NOT PUT ONE BACK. It was here — `PriceChart`
 * embedded inside the Trade tab, mounted on all five tabs behind `hidden` so the
 * `/api/prices` fetch survived tab switches. Three things were wrong with it, and
 * the first one is the one that matters:
 *
 *   1. It showed a false number. With NEXT_PUBLIC_MOCK_DATA=1 the mock series
 *      runs a random walk with far too much variance — the day it was cut,
 *      `/api/prices?symbol=ETH&range=1D` went 1921.51 → 2295.14, and the panel
 *      read "ETH up 19.44%" as the first hard figure on the front door. Same trap
 *      as the four-tile stat strip: a landing-page figure has to be checked with
 *      the flag off, and this one is a market number nobody here controls even
 *      when it is true.
 *   2. A chart of ETH says nothing about Kaleido. Every DeFi front door has one.
 *      The three facts under each product are falsifiable claims about this
 *      protocol; a price line is furniture.
 *   3. It was on one tab of five, so the panel grew about 300px when you clicked
 *      Trade and collapsed again when you left — the section's whole height
 *      problem, for decoration.
 *
 * NO HEIGHT FLOOR ON THE PANEL either. The panel is whatever the selected product
 * needs. Five products with three facts each are close enough in length that the
 * movement is small, and a click is not an animation — height changing when you
 * ask for different content is legible, where a permanent empty box is not. The
 * capability selector that once carried a 296px floor is the precedent.
 *
 * WHAT WENT BACK IN, AND WHY IT IS NOT THE CHART AGAIN. The panel now carries a
 * small figure beside the three facts, and each rail row carries a drawn icon of
 * the same mechanism. That is the same instinct the chart came from — five products
 * argued entirely in prose is a directory — met without the thing that made the
 * chart wrong. The distinction is sourcing, not decoration: <ProductArt> draws only
 * values this repo controls (the app's own icon map, the tick spacings the pool
 * contract enforces, the fee tiers /pool/new offers, the borrow and lend examples
 * `#can` types out one section above), and it fetches nothing. Its docblock has the
 * full list and names the two numbers it deliberately withholds. The chart's sin
 * was a market figure nobody here controls, printed on the front door with the mock
 * flag on; a figure with no live input cannot repeat it.
 *
 * The row icons and the panel figure are keyed on the same `art` field, so the mark
 * at 18px and the diagram at ~200px are one mechanism at two scales rather than two
 * separate editorial picks. The rows used to carry the products' real token logos
 * instead, which read as asset art where product art was wanted —
 * components/v2/SectionIcon.tsx states that at length.
 *
 * It also costs no height. It sits in a 300px side column beside the facts, which
 * were the taller of the two, and fills space the panel already had — see
 * ProductRail.module.css on `.body`.
 *
 * THE WAYS IN ARE A ROW AT THE FOOT OF THE PANEL, NOT ONE "Open →" AT THE TOP.
 * The link used to sit top-right beside the heading, which put it above every
 * reason to press it — a visitor met the invitation before the three facts and
 * the figure that argue for it, and the one place they were ready to act had
 * nothing to act on. Moving it under the content is the small half of the change.
 *
 * The real half is that it stopped being *one* link. Every product here is a
 * routed shell with its own tab strip, so "Open" had to pick one of them and
 * quietly did: `/trade` is a redirect to `/trade/agent`, so the Trade panel's
 * button skipped past the swap surface its own facts describe. A row names the
 * modes instead — Agent, Swap, Sell for Trade — and the labels are the app's own
 * tab words, so pressing one lands on a screen whose highlighted tab is the word
 * that was pressed. `products.ts` holds the lists and states the sourcing rule.
 *
 * ALL FIVE PANELS GET THE ROW, including Stake, which has exactly one route. The
 * user asked for it on Trade; giving Trade a footer row and leaving four panels
 * with a top-right link would mean the panel had two layouts that swap as the
 * rail moves, which is the kind of thing that reads as a rendering bug. A row of
 * one is still the row.
 *
 * The content lives in `products.ts`, not here: the page also reads
 * `PRODUCTS.length` for the section heading and the hero's stat row, and one copy
 * is what stops those three disagreeing.
 */

export default function ProductRail() {
  const [i, setI] = useState(0);
  const sel = PRODUCTS[i];

  /* Arrow keys move within the rail, which is what `role="tablist"` promises.
     Both axes step by one — the rail is a single column, so Left/Right and
     Up/Down are the same motion and binding only one half would leave the other
     silently dead. */
  const move = (e: React.KeyboardEvent, at: number) => {
    const step =
      e.key === "ArrowDown" || e.key === "ArrowRight"
        ? 1
        : e.key === "ArrowUp" || e.key === "ArrowLeft"
          ? -1
          : 0;
    if (!step) return;
    e.preventDefault();
    const to = (at + step + PRODUCTS.length) % PRODUCTS.length;
    setI(to);
    document.getElementById(`prod-${to}`)?.focus();
  };

  return (
    <div className={s.wrap}>
      <div className={s.rail} role="tablist" aria-label="Products">
        {PRODUCTS.map((p, at) => {
          const on = at === i;
          return (
            <button
              key={p.name}
              type="button"
              role="tab"
              id={`prod-${at}`}
              aria-selected={on}
              aria-controls="prod-panel"
              /* Only the selected tab is a tab stop; the arrow keys are the
                 in-rail navigation. Five separate Tab presses to cross a
                 five-item selector is what this role exists to avoid. */
              tabIndex={on ? 0 : -1}
              className={`${s.tab} ${on ? s.tabOn : ""}`}
              onClick={() => setI(at)}
              onKeyDown={(e) => move(e, at)}
            >
              {/* The indicator is a real element rather than a border, so it can
                  sit inside the row's radius without clipping the hairline. */}
              <span className={s.bar} aria-hidden="true" />
              {/* A drawn icon of the mechanism, not the product's token logos.
                  Two 16px <TokenIcon> discs used to sit here, and Trade and
                  Liquidity drew the same two of them — ETH/USDC names a market,
                  and what this row has to say is which of five products you are
                  looking at. The token art is still on the page, in the figure,
                  where the pair is the subject.

                  <SectionIcon> is app chrome rather than a component of this route
                  group: Nav's mobile tab bar draws the same seven icons, so a
                  product's mark here and its tab-bar icon in the app are the same
                  drawing. `kind={p.art}` is the same key the panel's figure
                  dispatches on — SectionIcon.tsx has why the union is duplicated
                  rather than imported. */}
              <span className={s.tabIcon}>
                <SectionIcon kind={p.art} />
              </span>
              <span className={s.tabText}>
                <span className={s.tabName}>{p.name}</span>
                <span className={s.tabNote}>{p.note}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div
        className={s.panel}
        id="prod-panel"
        role="tabpanel"
        aria-labelledby={`prod-${i}`}
      >
        <div className={s.panelHead}>
          <h3 className={s.panelTitle}>{sel.title}</h3>
          <p className={s.panelBody}>{sel.body}</p>
        </div>

        <div className={s.body}>
          <ul className={s.points}>
            {sel.points.map((pt) => (
              <li key={pt}>{pt}</li>
            ))}
          </ul>

          {/* Wrapped so this module can place it, because the grid placement is
              the whole height fix — ProductArt owns its own root class and this
              stylesheet cannot reach it. Keyed on the product, so switching tabs
              replaces the figure rather than reconciling one shape's children
              into another's. Nothing here animates or holds state, but the
              diagrams share class names and a stale node would be a subtle
              wrong-figure bug rather than a crash. */}
          <div className={s.figure}>
            <ProductArt key={sel.name} kind={sel.art} />
          </div>

          {/*
           * The ways in, under the facts they follow.
           *
           * Inside the grid rather than below it, which is what keeps them free:
           * the figure is the taller column on three of the five tabs, so a row
           * placed under the whole grid sat 20px below the *figure* and left up
           * to 110px of dead space beneath the facts — while making the panel
           * overrun the rail beside it. Placed in column one, row two, the row
           * lands in space the panel already had.
           *
           * `aria-label` names the product, because "Agent, Swap, Sell" read out
           * of a bare nav is three words with no subject — and the panel's own
           * heading is a claim ("Concentrated-liquidity swaps") rather than the
           * product's name, so it cannot be the label by reference.
           *
           * A <nav> rather than a bare div: a set of links to elsewhere is what
           * the landmark is for, and it gives a screen-reader user a way to jump
           * straight to them from a panel that is otherwise all prose.
           */}
          <nav className={s.ways} aria-label={`Open ${sel.name}`}>
            {sel.links.map((l, at) => (
              <Link
                key={l.href}
                href={l.href}
                /* First is solid, the rest outlined — the same primary/secondary
                   pair the hero and the closing section use, at panel scale.
                   Every destination equally weighted would leave a visitor
                   choosing between three things they have no basis to choose
                   between; the order in `products.ts` is the app's own tab order,
                   so the first one is the front door rather than an editorial
                   pick. */
                className={at === 0 ? s.wayPrimary : s.way}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}
