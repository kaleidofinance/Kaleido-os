/**
 * The hero's background texture: a duotone dithered cloud, drawn entirely in
 * SVG + CSS with no client JavaScript and no image asset.
 *
 * It replaces HeroArc — the per-dot animated canvas dome that stood here — as
 * part of the move to a quieter, print-style hero. Everything below is static
 * markup, so it server-renders and needs no hydration; there is no client
 * component on this page any more besides the planner and the theme toggle.
 *
 * TWO LAYERS.
 *  - `.cloud` (the <svg>) is an feTurbulence fractal-noise field whose alpha is
 *    posterised into a few discrete bands — that step is what reads as a halftone
 *    / screen print rather than a smooth gradient — then flooded with the --k-t1
 *    token. feFlood's `flood-color` is a real CSS property, which is the whole
 *    reason the tint can be a variable and follow the theme, exactly as HeroArc
 *    tinted one white asset for both themes.
 *  - `.dots` is a fine radial-gradient dot grid in the same token, a faint grain
 *    laid over the cloud so the field reads as dithered rather than washed.
 *
 * POSITIONING lives in the stylesheet and anchors against `.hero`
 * (`position: relative; isolation: isolate`) exactly as the arc did — see
 * marketing.module.css. It sits at the foot of the hero on a negative z-index,
 * masked to fade upward, so it clears the sticky nav and never bands the glass
 * planner panel. `aria-hidden` because it is artwork with nothing to announce.
 */
import s from "./HeroTexture.module.css";

export default function HeroTexture() {
  return (
    <span className={s.texture} aria-hidden="true">
      <svg
        className={s.svg}
        xmlns="http://www.w3.org/2000/svg"
        role="presentation"
      >
        <filter
          id="k-hero-dither"
          x="0"
          y="0"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.008 0.012"
            numOctaves={4}
            seed={8}
            stitchTiles="stitch"
            result="noise"
          />
          {/* noise luminance → alpha, RGB zeroed */}
          <feColorMatrix
            in="noise"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.5 0.5 0.5 0 0"
            result="alpha"
          />
          {/* posterise the alpha into discrete bands — the screen-print step */}
          <feComponentTransfer in="alpha" result="stepped">
            <feFuncA type="discrete" tableValues="0 0 0 0.3 0.5 0.7 0.9" />
          </feComponentTransfer>
          {/* tint via a CSS-driven flood-color so it follows the theme token */}
          <feFlood className={s.tint} result="ink" />
          <feComposite in="ink" in2="stepped" operator="in" />
        </filter>
        <rect width="100%" height="100%" filter="url(#k-hero-dither)" />
      </svg>
      <span className={s.dots} />
    </span>
  );
}
