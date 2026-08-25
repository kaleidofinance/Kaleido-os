/**
 * The hero's dotted dome, as data.
 *
 * ---------------------------------------------------------------------------
 * Why this is its own module
 * ---------------------------------------------------------------------------
 * TWO THINGS RENDER THIS FIELD and they must not drift apart:
 *
 *   - `scripts/gen-hero-arc.mjs` writes it to public/hero-arc.svg, which is what
 *     paints before hydration, with JavaScript off, and for a visitor who asked
 *     for reduced motion.
 *   - `HeroArc.tsx` draws it to a canvas and animates each dot individually.
 *
 * Those two have to agree dot for dot, because the canvas fades in over the SVG
 * and any disagreement shows up as the field shifting under itself at the moment
 * of the swap. The geometry therefore lives here, once, and neither renderer owns
 * it. The generator emits what this returns; the canvas draws what this returns.
 *
 * ---------------------------------------------------------------------------
 * How the shape is built
 * ---------------------------------------------------------------------------
 * Concentric arcs about one centre below the box, and the single detail that
 * makes it read as a field rather than as spokes is that the dot count per ring
 * scales with the radius — constant spacing along the arc, not constant angular
 * spacing. Equal angles per ring would fan the dots outward into rays.
 *
 * THE CROP IS BAKED INTO THE BOX, on purpose. The dome is 980 units at its widest
 * inside a 1400-wide box, so what the box holds is the crown of something much
 * larger and the flanks leave through the sides. That is what lets the element be
 * exactly 100% of the hero with no overflow, no negative margins and no risk of a
 * horizontal scrollbar: a whole dome scaled down to fit would sit inside it as a
 * visible semicircle, which reads as a drawn circle rather than as an horizon.
 * Dots outside the box are dropped here rather than clipped by a renderer, which
 * is most of the SVG's file-size saving and most of the canvas's frame budget.
 *
 * THE UNITS ARE CHOSEN AGAINST THE RENDERED WIDTH. The element is 100% of the
 * hero's 1160px content box, so the scale factor is 1160/1400 = 0.83, and
 * DOT_SPACING 16 lands at 13px on screen with dots of 0.6–1.4px. The first
 * version was an 880-unit box sized to the 626px copy column — scale 0.71, the
 * same 13px of rendered spacing. Widening it in CSS alone would have multiplied
 * both the gaps and the dot radii by 1.85 and turned a fine field into a coarse
 * one, so the box grew and the spacing constants grew with it.
 *
 * Jitter is not decoration either. Dots placed exactly on each ring at exactly
 * even spacing produce visible concentric banding and a moiré beat against the
 * ambient 64px line grid; ±28% of the ring gap breaks both up.
 *
 * The field is DENSEST AT ITS BASE, and that is geometry rather than a choice:
 * the rings nest, so a row near the bottom of the box is crossed by all eighteen
 * of them while the crown is crossed by one. The element is anchored to the
 * BOTTOM of the hero, so unattenuated that would put the thickest part of the
 * artwork across the stat row and the seam below it. FADE_START takes the bottom
 * third to nothing — the same decision tokens.css already made for the ambient
 * 64px grid, which is masked to `transparent 92%` rather than being allowed to
 * run into content.
 *
 * ---------------------------------------------------------------------------
 * Determinism
 * ---------------------------------------------------------------------------
 * A seeded PRNG, not `Math.random()`, and that is load-bearing twice over. The
 * generator has to produce the same file byte for byte or re-running it on a
 * clean checkout is a spurious diff. And the canvas has to produce the same
 * field as the generator did, in a different process, months later — which it
 * only does because nothing here reads a clock or an entropy source.
 *
 * EVERY CANDIDATE DOT DRAWS ITS FIVE RANDOMS UNCONDITIONALLY, before any of the
 * drop tests. It is tempting to skip the ones a dropped dot will not use, and
 * the first version did; the cost is that the PRNG sequence then depends on the
 * drop rules, so tuning FADE_START or MARGIN silently reshuffles every dot after
 * the first drop. Drawing them up front makes the field stable under exactly the
 * kind of tweak this file invites.
 */

/** The box every coordinate below is in. An aspect ratio, not a pixel size. */
export const ARC_W = 1400;
export const ARC_H = 362;

/**
 * Centre of every ring, 992 below the top of the box and so 630 below its bottom
 * edge. The further down this goes the flatter the horizon reads. The canvas
 * needs it too — the ring sweep is expressed in distance from this point, which
 * is the only way a highlight travels *through* the arcs rather than across them.
 */
export const ARC_CX = ARC_W / 2;
export const ARC_CY = 992;

/**
 * R_OUTER is 1.4x the box half-width, which is what sends the widest ring out
 * through the sides instead of curving back inside the frame. R_INNER is set so
 * the innermost ring crowns at ~0.8H — below that the nest starts to look like a
 * solid cap rather than a field with depth.
 */
export const ARC_R_INNER = 702;
export const ARC_R_OUTER = 980;

const RING_GAP = 16;
const DOT_SPACING = 16; // along the arc, not angular

/**
 * How far outside the box a dot may sit before it is dropped. A few units of
 * margin, so a dot straddling the edge is still drawn and the boundary does not
 * read as a straight cut.
 */
const MARGIN = 4;

/**
 * Resting alpha is quantised to 8 levels. The SVG wants that — it groups circles
 * under one `fill-opacity` each, so a dot costs `<circle cx cy r/>` and nothing
 * more, about a third off the file. The canvas does not need it and takes the
 * quantised value anyway, because the two renderings have to be identical at the
 * moment one fades into the other.
 */
export const ARC_OPACITY_STEPS = 8;
export const ARC_ALPHA_MAX = 0.62;

/**
 * Where the vertical falloff starts, as a fraction of ARC_H. Everything above
 * this line is at full strength; below it alpha runs to zero at the bottom edge,
 * so the field ends by thinning out instead of by being cut off. 0.62 of a
 * 362-unit box is y=224, which at the hero's 1160px width is ~186px down — below
 * the CTA row, so the stat strip and the seam with the section underneath sit in
 * the part that is already dissolving.
 */
const FADE_START = 0.62;

/** "KALE". Changing this reshuffles the entire field. */
const SEED = 0x4b414c45;

export interface ArcDot {
  /** Position in ARC_W x ARC_H units. */
  x: number;
  y: number;
  /** Dot radius, same units. */
  r: number;
  /** Resting alpha, 0..ARC_ALPHA_MAX, already quantised to ARC_OPACITY_STEPS. */
  a: number;
  /**
   * Distance from (ARC_CX, ARC_CY). The canvas's ring sweep is a band in this
   * value, which is what makes it travel outward through the arcs in the order
   * they were drawn rather than sliding across the picture.
   */
  rad: number;
  /**
   * 0..1, fixed per dot. The canvas offsets each dot's twinkle by this so no two
   * breathe together — without it 1100 dots pulse in unison and the field reads
   * as one flashing shape.
   */
  phase: number;
}

/**
 * mulberry32. Thirty-two bits of state and one line of arithmetic — enough for
 * dot placement, and the reason the output is reproducible.
 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The field. Same input every time, same array every time — see the determinism
 * note above.
 */
export function buildArcField(): ArcDot[] {
  const rand = rng(SEED);
  const dots: ArcDot[] = [];
  const ringCount =
    Math.floor((ARC_R_OUTER - ARC_R_INNER) / RING_GAP) + 1; /* 18 */
  const fadeFrom = ARC_H * FADE_START;

  for (let ring = 0; ring < ringCount; ring++) {
    const r = ARC_R_INNER + ring * RING_GAP;
    const steps = Math.round((Math.PI * r) / DOT_SPACING);

    /* Outer rings slightly brighter than inner ones, so the top of the dome
       reads as an edge the field falls away from rather than as a blur. */
    const ringWeight = 0.55 + 0.45 * (ring / (ringCount - 1));

    for (let i = 0; i <= steps; i++) {
      /* All five up front — see the note on PRNG stability above. */
      const rJit = rand();
      const aJit = rand();
      const aRand = rand();
      const rRand = rand();
      const phase = rand();

      const angle = (Math.PI * i) / steps; // 0 = due left, PI/2 = crown
      const rr = r + (rJit - 0.5) * RING_GAP * 0.56;
      const aa = angle + ((aJit - 0.5) * DOT_SPACING * 0.6) / r;

      const x = ARC_CX - rr * Math.cos(aa);
      const y = ARC_CY - rr * Math.sin(aa);

      if (y < -MARGIN || y > ARC_H + MARGIN) continue;
      if (x < -MARGIN || x > ARC_W + MARGIN) continue;

      /* Brightest at the crown and falling to the flanks. sin(angle) is already
         that curve; the exponent steepens it so the sides thin out rather than
         ending abruptly at the box edge. */
      const crown = Math.sin(angle) ** 1.4;

      /* And falling again toward the bottom edge. Squared so the top of the fade
         is gradual — a linear ramp starts visibly, as a horizontal line where
         the field changes rate. */
      const fade =
        y <= fadeFrom ? 1 : (1 - (y - fadeFrom) / (ARC_H - fadeFrom)) ** 2;

      const raw =
        ARC_ALPHA_MAX * crown * fade * ringWeight * (0.45 + 0.55 * aRand);
      const bucket = Math.min(
        ARC_OPACITY_STEPS - 1,
        Math.max(
          0,
          Math.round((raw / ARC_ALPHA_MAX) * (ARC_OPACITY_STEPS - 1)),
        ),
      );
      if (bucket === 0) continue; // invisible at rest; not worth the bytes

      dots.push({
        x,
        y,
        r: 0.75 + rRand * 1.0,
        a: (bucket / (ARC_OPACITY_STEPS - 1)) * ARC_ALPHA_MAX,
        rad: rr,
        phase,
      });
    }
  }

  return dots;
}
