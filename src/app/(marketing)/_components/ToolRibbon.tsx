import { ALL_TOOLS } from "./capabilities";
import s from "./ToolRibbon.module.css";

/**
 * All 27 tool names, drifting past in two rows.
 *
 * The closer to the capability section, and it is doing a different job from the
 * tabs above it. The tabs are for a reader who wants to check one product; this
 * is for the reader who scrolled and needs the *scale* in one glance. Eight tabs
 * only ever show one group at a time, which is what makes them work — so
 * something on the page still has to say "and there are twenty-seven of these".
 *
 * NO "use client" AND NO JAVASCRIPT AT ALL. The motion is two CSS animations, so
 * this ships as markup on a page whose LCP matters and whose whole point is that
 * the interactive parts are the product. A marquee that costs a hydration pass is
 * a decoration charging product prices.
 *
 * Names come from capabilities.ts, the same module the tabs read, so a tool
 * cannot appear down here without a tab above listing it.
 *
 * `aria-hidden` on the whole thing, deliberately. Every name is already reachable
 * above — the tab set puts one group in the DOM at a time and a screen reader
 * walks the strip to reach the rest — so without it the page would announce 54
 * identifiers (27 names, rendered twice per row for the seamless loop) that carry
 * no information the tabs did not already give. This row is the *visual* summary
 * of a list that is already stated accessibly.
 */

/**
 * Two rows, split rather than duplicated: the first fourteen drift left, the
 * rest drift right. Splitting keeps every name on screen once per cycle — two
 * rows of the same list would just say everything twice.
 */
const HALF = Math.ceil(ALL_TOOLS.length / 2);
const ROWS: ReadonlyArray<readonly string[]> = [
  ALL_TOOLS.slice(0, HALF),
  ALL_TOOLS.slice(HALF),
];

export default function ToolRibbon() {
  return (
    <div className={s.wrap} aria-hidden="true">
      {ROWS.map((row, i) => (
        <div className={s.viewport} key={i}>
          {/*
           * The list is rendered twice inside each track, and that is what makes
           * the loop seamless rather than snapping: the track translates by
           * exactly -50% of its own width, at which point copy two sits where
           * copy one started. Drop either copy and the animation jumps back to
           * an empty edge every cycle.
           */}
          <div className={`${s.track} ${i === 1 ? s.reverse : ""}`}>
            {[0, 1].map((copy) => (
              <ul className={s.row} key={copy}>
                {row.map((name) => (
                  <li className={s.pill} key={name}>
                    {name}
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
