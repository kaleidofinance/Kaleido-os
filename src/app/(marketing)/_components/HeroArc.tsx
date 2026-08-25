"use client";

/**
 * The hero's dotted dome, animated per dot.
 *
 * ---------------------------------------------------------------------------
 * WHY A CANVAS
 * ---------------------------------------------------------------------------
 * The first version of this animation was pure CSS: the SVG mask with a radial
 * gradient sweeping outward over it. It worked, and its limit is structural — a
 * mask supplies one alpha per pixel of one element, so every dot inside the band
 * got the same treatment and no dot could have a life of its own. Anything
 * per-dot means addressing the dots individually, and 1100 individually animated
 * DOM nodes is not a trade worth making.
 *
 * So: one canvas, one clear and ~1100 arcs per frame, and each dot carries its own
 * phase.
 *
 * TWO MOTIONS, COMPOSED. A slow twinkle, where every dot breathes around its
 * resting alpha at its own rate and its own offset — that is the part CSS could
 * not do, and it is what makes the field read as alive rather than as a lit
 * shape. And over the top of it a ring sweep, a soft band travelling outward
 * through the arcs in the order they were drawn, so the field's own structure is
 * what is being revealed. The sweep runs for the first ~72% of a 9s cycle and
 * then stops; the twinkle never stops. A continuous sweep reads as a loading
 * state.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT COSTS AND WHAT IT REFUSES TO SPEND
 * ---------------------------------------------------------------------------
 * The field is built once, into flat typed arrays rather than an array of
 * objects, because the frame loop touches every element of every array in order
 * and that is the layout that suits it.
 *
 * Alpha is quantised to 48 levels per frame and the dots at each level are
 * batched into one path, so a frame is ~48 fills rather than ~1100. This is the
 * same trick the SVG uses for file size, applied to draw calls.
 *
 * There is a three-sigma cutoff on the sweep's exponential, and it earns less
 * than it looks like it should: the band is wide relative to the field, so while
 * the band is inside the rings it reaches every dot and the test skips nothing.
 * What it actually buys is the entry and exit, plus the 28% of the cycle with no
 * band at all, where the whole term is skipped by the `gain > 0` guard above it.
 * It stays because it is two comparisons; it is not what makes this cheap.
 *
 * The token colour is read on mount and again when the theme attribute changes,
 * never per frame — `getComputedStyle` forces a style recalculation, and doing
 * that 60 times a second to re-learn a value that changes twice a session would
 * cost more than the drawing does.
 *
 * The loop stops when the hero scrolls off screen, and never starts at all if the
 * visitor asked for reduced motion.
 *
 * ---------------------------------------------------------------------------
 * HYDRATION
 * ---------------------------------------------------------------------------
 * The canvas is rendered only after an effect has run, so the server's markup and
 * the client's first render agree: both are the wrapper and the still SVG layer
 * alone. The reduced-motion check has to happen in that effect for the same
 * reason — `matchMedia` on the server is not a thing, and guessing produces a
 * mismatch.
 */

import { useEffect, useRef, useState } from "react";

import {
  ARC_H,
  ARC_R_INNER,
  ARC_R_OUTER,
  ARC_W,
  buildArcField,
} from "./heroArcField";
import s from "./HeroArc.module.css";

const TAU = Math.PI * 2;

/** Cap the backing store at 2x. A 3x phone gains nothing visible for 2.25x the fill cost. */
const DPR_CAP = 2;

/** Quantised alpha levels per frame. See the batching note above. */
const LEVELS = 48;

/**
 * The twinkle. Each dot's period is TWINKLE_MS scaled by 0.7-1.3 from its own
 * seed, so the field has no common beat, and DEPTH is a fraction of the dot's
 * resting alpha rather than an absolute amount — a faint dot on the flank
 * flickers faintly, which is what keeps the crown reading as the bright part.
 */
const TWINKLE_MS = 5200;
const TWINKLE_DEPTH = 0.32;

/** How long the depth takes to ease in from zero, so frame one matches the SVG. */
const TWINKLE_EASE_MS = 1000;

/**
 * The ring sweep. A Gaussian band in distance-from-centre, travelling outward.
 *
 * IT STARTS A SIGMA INSIDE THE FIELD AND ENDS JUST PAST THE RIM. Measured, the
 * dots span radius 697.9 to 978.5 once jitter is counted, so 632 and 1020 put the
 * band's centre outside the field at both ends of its travel and it enters and
 * leaves rather than appearing or dying mid-picture.
 *
 * THE GAIN IS CAPPED BY HEADROOM, not by taste, and this is the one number here
 * that cannot be raised on a whim. The brightest resting dot is at ARC_ALPHA_MAX
 * = 0.62, so the largest multiplier that does not clip at alpha 1 is 1/0.62 =
 * 1.613, and the twinkle has already spent 0.32 of it. That leaves 0.293, and
 * 0.28 is that with a margin. Clipping is not a graceful failure here: only the
 * outer rings reach 0.62, they reach it together, and they would all saturate at
 * once as the band passed — so the crown would go FLATTER inside the band than
 * outside it while the mid-brightness dots around it lifted by the full factor.
 * An inverted contrast ramp travelling through the rim, which is worse than no
 * sweep at all.
 *
 * The sigma is what buys the effect back: 78 units is about five ring gaps, ~65px
 * at the hero's width, so a broad soft swell lifts several rings at once. A wide
 * gentle band reads better than a narrow one straining against the ceiling.
 */
const SWEEP_MS = 9000;
const SWEEP_DUTY = 0.72;
const SWEEP_FROM = ARC_R_INNER - 70;
const SWEEP_TO = ARC_R_OUTER + 40;
const SWEEP_SIGMA = 78;
const SWEEP_GAIN = 0.28;

/** Fractions of the travel spent ramping the band in and back out. */
const SWEEP_IN = 0.12;
const SWEEP_OUT = 0.25;

function readTokenColour(): string {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue("--k-t1")
    .trim();
  /* Only ever empty if the stylesheet has not applied yet, which would mean
     drawing with an invalid fillStyle and silently painting nothing. */
  return v || "#ffffff";
}

export default function HeroArc() {
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [animate, setAnimate] = useState(false);
  const [live, setLive] = useState(false);

  /* Mount gate. Splitting this out from the drawing effect is what keeps the
     first client render identical to the server's. */
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setAnimate(true);
  }, []);

  useEffect(() => {
    if (!animate) return;
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    /* ---------------------------------------------------------------- field */
    const field = buildArcField();
    const n = field.length;
    const px = new Float32Array(n);
    const py = new Float32Array(n);
    const pr = new Float32Array(n);
    const pa = new Float32Array(n);
    const prad = new Float32Array(n);
    /* Angular rate and starting offset, precomputed so the frame loop is one
       multiply, one add and one sin per dot. */
    const pw = new Float32Array(n);
    const pp = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      const d = field[i];
      px[i] = d.x;
      py[i] = d.y;
      pr[i] = d.r;
      pa[i] = d.a;
      prad[i] = d.rad;
      pw[i] = TAU / (TWINKLE_MS * (0.7 + 0.6 * d.phase));
      pp[i] = TAU * d.phase;
    }

    /* Reused every frame; allocating 48 arrays per frame would hand the GC a
       job it does not need. */
    const levels: number[][] = Array.from({ length: LEVELS }, () => []);

    /* ----------------------------------------------------------- dimensions */
    let scale = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0) return false;
      const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      /* One factor for both axes: aspect-ratio in the stylesheet holds the box at
         the generator's ratio, so the units are square. */
      scale = w / ARC_W;
      return true;
    };

    /* ---------------------------------------------------------------- colour */
    let colour = readTokenColour();
    const themeObserver = new MutationObserver(() => {
      colour = readTokenColour();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    /* ------------------------------------------------------------------ loop */
    let raf = 0;
    let running = false;
    let firstFrameAt = 0;
    let painted = false;

    const draw = (t: number) => {
      if (scale === 0 && !resize()) return;
      if (firstFrameAt === 0) firstFrameAt = t;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.fillStyle = colour;

      const depth =
        TWINKLE_DEPTH * Math.min(1, (t - firstFrameAt) / TWINKLE_EASE_MS);

      /* Where the band is, and how strong, this frame.

         Measured from the FIRST FRAME, not from the absolute clock. On the
         absolute clock a visitor lands at an arbitrary point in the cycle, so
         perhaps a third of loads would hydrate with the band already mid-field at
         full gain — the field jumping brighter at the instant the canvas takes
         over from the SVG, which is the one thing the snap-not-cross-fade
         arrangement exists to prevent. From the first frame the cycle always
         begins at gain zero, and the band ramps in over roughly the same second
         the twinkle does. */
      const cycle = ((t - firstFrameAt) % SWEEP_MS) / SWEEP_MS;
      let bandR = 0;
      let gain = 0;
      if (cycle < SWEEP_DUTY) {
        const q = cycle / SWEEP_DUTY;
        /* Eased out, so the band leaves the field slower than it entered — a
           linear travel reads as a wipe, this reads as a ripple. */
        const eased = 1 - (1 - q) * (1 - q);
        bandR = SWEEP_FROM + (SWEEP_TO - SWEEP_FROM) * eased;
        gain =
          SWEEP_GAIN *
          Math.max(0, Math.min(1, Math.min(q / SWEEP_IN, (1 - q) / SWEEP_OUT)));
      }
      const reach = SWEEP_SIGMA * 3;

      for (let i = 0; i < LEVELS; i++) levels[i].length = 0;

      for (let i = 0; i < n; i++) {
        let mult = 1 + depth * Math.sin(pw[i] * t + pp[i]);

        if (gain > 0) {
          const dr = prad[i] - bandR;
          if (dr > -reach && dr < reach) {
            const k = dr / SWEEP_SIGMA;
            mult += gain * Math.exp(-k * k);
          }
        }

        const alpha = pa[i] * mult;
        /* One level is 1/48 of full alpha, and both ends of the range are checked
           against the measured field. Faintest dot: rests at 0.089, bottoms out at
           0.060 under the twinkle, lands on level 2 — so the canvas never loses a
           dot the SVG has. Brightest: 0.62 x (1 + 0.32 + 0.28) = 0.992, level 47,
           which is why the gain above is capped where it is. */
        const level = alpha >= 1 ? LEVELS - 1 : (alpha * LEVELS) | 0;
        if (level === 0) continue;
        levels[level].push(i);
      }

      for (let l = 1; l < LEVELS; l++) {
        const list = levels[l];
        if (list.length === 0) continue;
        ctx.globalAlpha = (l + 0.5) / LEVELS;
        ctx.beginPath();
        for (let j = 0; j < list.length; j++) {
          const i = list[j];
          /* moveTo before each arc, or the path connects one circle to the next
             with a straight line. */
          ctx.moveTo(px[i] + pr[i], py[i]);
          ctx.arc(px[i], py[i], pr[i], 0, TAU);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      if (!painted) {
        painted = true;
        setLive(true);
      }
    };

    const frame = (t: number) => {
      draw(t);
      if (running) raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(frame);
    };

    const stop = () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    /* ------------------------------------------------------------ observers */
    const ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            /* Setting canvas.width clears it, so redraw rather than waiting for
               the next frame — which may never come if the loop is stopped. */
            if (resize() && !running) requestAnimationFrame(draw);
          });
    ro?.observe(canvas);

    if (typeof IntersectionObserver === "undefined") {
      resize();
      start();
    } else {
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) start();
          else stop();
        },
        /* The hero is at the top of the document, so this fires immediately on
           load. Low threshold because it is deciding whether to keep a running
           animation running, not whether to arm a one-shot. */
        { threshold: 0.05 },
      );
      io.observe(host);
      return () => {
        io.disconnect();
        themeObserver.disconnect();
        ro?.disconnect();
        stop();
      };
    }

    return () => {
      themeObserver.disconnect();
      ro?.disconnect();
      stop();
    };
  }, [animate]);

  return (
    <span
      ref={hostRef}
      className={s.arc}
      aria-hidden="true"
      data-live={live ? "true" : undefined}
    >
      <span className={s.still} />
      {animate ? (
        <canvas
          ref={canvasRef}
          className={s.live}
          /* Intrinsic size only, so the element has the right ratio before the
             first resize measurement lands. CSS drives the rendered size and the
             effect drives the backing store. */
          width={ARC_W}
          height={ARC_H}
        />
      ) : null}
    </span>
  );
}
