#!/usr/bin/env node
/**
 * Build public/email-logo.png from public/newklogo2.png.
 *
 *   node scripts/crop-email-logo.mjs
 *
 * The invite email draws the brand mark at 48px. The mark it should draw lives in
 * newklogo2.png, which the nav and the marketing header also use — but that file is
 * a 500x500 *plate*: a photographic dark-green background with the mark small and
 * off-centre. The app copes by cropping it in CSS. An email cannot: there is no
 * `background-position` on an `<img>` that Gmail respects, so the plate sent whole
 * reads at 48px as a grey-green swatch with a small white glyph in it, and the green
 * fights the near-black panel underneath.
 *
 * So the crop happens here instead, once, and the email ships a square asset. It is
 * the same treatment the app applies, moved from render time to build time.
 *
 * Committed rather than run in CI because it has one input that changes rarely and a
 * committed output the email depends on being live at a stable URL. Run it by hand
 * when the plate changes, and commit what it writes.
 */
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "public", "newklogo2.png");
const OUT = path.join(ROOT, "public", "email-logo.png");

/**
 * How bright a pixel has to be to count as the mark rather than the plate.
 *
 * The mark is near-white and the plate's lightest band is a mid grey-green, so the
 * gap is wide and the exact number does not matter much — 170 sits in the middle of
 * it. Asserted below by refusing a box that covers most of the frame, which is what
 * a threshold low enough to catch the plate would produce.
 */
const MARK_LUMA = 170;

/** Breathing room around the mark, as a share of its longest side. */
const PAD = 0.12;

/** 192 for a 48px slot: sharp on a 3x display, and still a small file. */
const SIZE = 192;

const src = PNG.sync.read(fs.readFileSync(SRC));

let x0 = src.width;
let y0 = src.height;
let x1 = -1;
let y1 = -1;
for (let y = 0; y < src.height; y++) {
  for (let x = 0; x < src.width; x++) {
    const i = (src.width * y + x) << 2;
    if (src.data[i + 3] < 8) continue; // transparent
    const luma =
      0.299 * src.data[i] + 0.587 * src.data[i + 1] + 0.114 * src.data[i + 2];
    if (luma < MARK_LUMA) continue;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
}

if (x1 < 0) {
  console.error(`${SRC}: found no pixel brighter than ${MARK_LUMA}.`);
  process.exit(1);
}

const w = x1 - x0;
const h = y1 - y0;
/* A box that fills the frame means the threshold caught the plate, not the mark, and
   the "crop" would be a no-op that silently ships the thing this script exists to
   avoid. Fail instead. */
if (w > src.width * 0.9 || h > src.height * 0.9) {
  console.error(
    `Mark bounding box is ${w}x${h} of ${src.width}x${src.height} — that is the whole ` +
      `plate, so MARK_LUMA (${MARK_LUMA}) is too low for this image.`,
  );
  process.exit(1);
}

const cx = Math.round((x0 + x1) / 2);
const cy = Math.round((y0 + y1) / 2);
const half = Math.round((Math.max(w, h) / 2) * (1 + PAD));

/* Nearest-neighbour would alias the mark's thin arms, so this is a box filter: every
   destination pixel averages the source pixels it covers. Downscaling 258 -> 192 is
   a small ratio and the arms are the whole subject, so the difference is visible. */
const out = new PNG({ width: SIZE, height: SIZE });
const span = half * 2;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const sx0 = cx - half + Math.floor((x * span) / SIZE);
    const sx1 = cx - half + Math.floor(((x + 1) * span) / SIZE);
    const sy0 = cy - half + Math.floor((y * span) / SIZE);
    const sy1 = cy - half + Math.floor(((y + 1) * span) / SIZE);
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    let n = 0;
    for (let sy = sy0; sy < Math.max(sy1, sy0 + 1); sy++) {
      for (let sx = sx0; sx < Math.max(sx1, sx0 + 1); sx++) {
        if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue;
        const i = (src.width * sy + sx) << 2;
        r += src.data[i];
        g += src.data[i + 1];
        b += src.data[i + 2];
        a += src.data[i + 3];
        n++;
      }
    }
    const o = (SIZE * y + x) << 2;
    out.data[o] = n ? Math.round(r / n) : 0;
    out.data[o + 1] = n ? Math.round(g / n) : 0;
    out.data[o + 2] = n ? Math.round(b / n) : 0;
    out.data[o + 3] = n ? Math.round(a / n) : 0;
  }
}

fs.writeFileSync(OUT, PNG.sync.write(out));
console.log(
  `mark at (${x0},${y0})-(${x1},${y1}) in ${src.width}x${src.height}\n` +
    `cropped to ${span}x${span} around (${cx},${cy}), resampled to ${SIZE}px\n` +
    `wrote ${path.relative(ROOT, OUT)} (${Math.round(fs.statSync(OUT).size / 1024)}KB)`,
);
