/**
 * Generates every brand raster the app serves, from one component.
 *
 * ---------------------------------------------------------------------------
 * Why this is a script and not `src/app/opengraph-image.tsx`
 * ---------------------------------------------------------------------------
 * The idiomatic Next answer is a runtime `ImageResponse` route. It does not
 * work here, for two reasons that were both verified rather than assumed:
 *
 *  1. `next/og` throws on import on Windows at Next 14.2.35. It bundles
 *     @vercel/og 0.6.3, whose node build does
 *     `fileURLToPath(join(import.meta.url, "../noto-sans...ttf"))` — and
 *     `path.win32.join` mangles a file:// URL into `.\file:\C:\...`, so the
 *     module fails with ERR_INVALID_URL before any of our code runs. It is
 *     fixed upstream in @vercel/og >= 1 (`new URL(...)` instead of `join`),
 *     but that copy is compiled into Next and cannot be swapped.
 *  2. Taking @vercel/og as a direct dependency to get the fixed copy costs
 *     39 MB and 28 packages — satori, two wasm blobs, and sharp's native
 *     binaries — plus a rasterisation on cold start, for a card whose
 *     contents change roughly never.
 *
 * So the card is composed here, rasterised once, and the output is committed.
 * Next then picks the files up through its static metadata file conventions
 * (`favicon.ico`, `apple-icon.png`, `opengraph-image.png`) and emits the tags
 * itself, with real dimensions read off the real files. Zero runtime, and
 * identical in dev and production.
 *
 * ---------------------------------------------------------------------------
 * Running it
 * ---------------------------------------------------------------------------
 *   npm i --no-save --no-package-lock @vercel/og@1
 *   node scripts/generate-brand-assets.mjs
 *   npm rm --no-save --no-package-lock @vercel/og
 *
 * `--no-save --no-package-lock` is the point: the dependency is needed for the
 * length of one command and must not land in package.json or the lockfile.
 *
 * ---------------------------------------------------------------------------
 * Typeface
 * ---------------------------------------------------------------------------
 * The card renders in Geist, @vercel/og's own bundled default, which happens
 * to be this app's body face (src/lib/font.ts). It is NOT Lora, the display
 * face `.k-display` uses, and that is a limitation rather than a choice:
 * satori's OpenType parser rejects both of the repo's candidates —
 * `lora-var.woff2` with "Unsupported OpenType signature wOF2", and
 * `GeistVF.woff` (a variable WOFF) with an internal parse error. Only TTF and
 * OTF are readable. Shipping a Lora TTF purely for this one image would add a
 * ~500 KB binary to the repo; a grotesk headline on an OG card is the cheaper
 * trade, and the mark carries the brand either way.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement as h } from "react";
import { ImageResponse } from "@vercel/og";

/* Repo root, or --root=<path> to render somewhere else. */
const ROOT =
  process.argv.find((a) => a.startsWith("--root="))?.slice(7) ??
  resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The tokens this file is allowed to use, copied from
 * src/app/(app)/tokens.css and nothing else.
 *
 * Duplicated by hand because satori has no cascade and no custom properties —
 * it resolves a style object, so every value has to be literal. Two
 * consequences worth stating: this is the dark theme only (an OG card has no
 * theme, and a crawler thumbnail on a white timeline needs the dark one), and
 * these five values are the only place in the repo where a --k-* colour is
 * written twice. If the palette moves, they move.
 */
const T = {
  bg: "#141413",
  t1: "#ffffff",
  t2: "#a8a49b",
  t3: "#6b6760",
  brand: "#00b383",
  line: "rgba(255,255,255,0.075)",
};

/**
 * The logo, inlined as a data URI.
 *
 * public/newklogo2.png is the file the running app draws — Nav.module.css:68,
 * trade/agent/agent.module.css:196 and (marketing)/marketing.module.css:70 all
 * point at it, and public/kld.png is a crop of the same render. Inlined rather
 * than passed as a path because satori resolves an `img` src itself and will not
 * read from the filesystem; base64 keeps the whole render offline, which matters
 * for a script whose dependency is installed for the length of one command.
 */
const ART =
  "data:image/png;base64," +
  readFileSync(join(ROOT, "public/newklogo2.png")).toString("base64");

/**
 * The Kaleido mark, at whatever size is asked for.
 *
 * This is the real art from public/newklogo2.png — the same file the nav, the
 * agent page and the landing page all draw — framed the way Nav.module.css:60-72
 * frames it: zoomed onto the glyph and clipped to a circle, because the source
 * carries its own dark backdrop and its own soft edges.
 *
 * An earlier version of this file rebuilt the mark from five rounded bars and a
 * green hub, on the theory that vector geometry stays crisp at 32px where a soft
 * 500px render turns to mush. The geometry was right about crispness and wrong
 * about the logo: the real mark is a chiral pinwheel whose arms spring from a
 * pale ring around a dark lens, and five symmetric bars around a flat disc read
 * as an asterisk instead. A sharp icon that isn't the logo is worse than a
 * slightly soft one that is, so fidelity wins and the zoom stays conservative
 * enough that the glyph survives a 32px downsample.
 *
 * The framing is measured, not guessed. The mark is NOT centred in its own file
 * — its centre sits at (253.5, 239) of 500 — and it is close to twice as tall as
 * it is wide, so eyeballing a zoom clips an arm, which is exactly what the first
 * attempt here did. GLYPH was read off the pixels: threshold the file at
 * luminance > 140, take the bounding box of what survives, then take the
 * greatest distance from that box's centre to any lit pixel (119.2px — the
 * radius that provably contains every arm tip). Everything below is derived from
 * those three numbers, so if the art is ever re-exported, re-measure and nothing
 * else has to move.
 */
const SRC = 500; /* newklogo2.png is 500x500 */
const GLYPH = { x: 253.5, y: 239, r: 119.2 };

/**
 * Share of the mark's circle the glyph spans across.
 *
 * 0.88 leaves ~12% of air, which is what keeps the arm tips off the edge of the
 * clip. Raising it toward 1 starts cutting them: the arms reach the extremes of
 * that radius, so the margin here *is* the safety factor.
 */
const FILL = 0.88;

/** Source pixels visible across the mark box, and the resulting scale factor. */
const WINDOW = (GLYPH.r * 2) / FILL;

function mark(size) {
  /* Destination px per source px, then the offset that puts the glyph's
     measured centre — not the file's centre — in the middle of the box. */
  const scale = size / WINDOW;
  const art = SRC * scale;
  return h("div", {
    style: {
      width: size,
      height: size,
      display: "flex",
      /* A background rather than an <img>, which is both what Nav.module.css:64
         does and the only version that clips: satori honours borderRadius on a
         background but paints an absolutely-positioned child straight over it,
         so the <img> form left the source's backdrop — a dark green-grey,
         measurably lighter than T.bg — showing as a square patch. */
      borderRadius: size,
      background: T.bg,
      backgroundImage: `url(${ART})`,
      backgroundSize: `${art}px ${art}px`,
      backgroundPosition: `${size / 2 - GLYPH.x * scale}px ${size / 2 - GLYPH.y * scale}px`,
      backgroundRepeat: "no-repeat",
    },
  });
}

/**
 * The icon, at whatever size is asked for.
 *
 * The mark sits at 72% on a plain token background rather than filling the
 * frame, because Android crops a maskable icon to a circle: anything outside
 * the middle 80% can be cut. 72% clears that and still reads at 16px in a
 * browser tab, where the mark is the only thing on screen.
 */
function icon(size) {
  return h(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: T.bg,
      },
    },
    mark(size * 0.72),
  );
}

/**
 * The 1200x630 link-preview card.
 *
 * Read at thumbnail size in a timeline, so it holds four things and no more:
 * the mark, the claim, one line of substance, and the three pillars. No
 * pre-launch chip — crawlers cache a card for months and the chip would
 * outlive the state it describes, which is the one way an honest notice turns
 * into a dishonest one.
 */
function card() {
  const row = {
    display: "flex",
    alignItems: "center",
  };
  return h(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: T.bg,
        /* The lens glow from tokens.css, flattened to one stop. Placed
           top-right, behind nothing, so it reads as depth rather than as a
           gradient someone applied to a box. */
        backgroundImage: `radial-gradient(900px 520px at 92% -14%, rgba(0,179,131,0.20), rgba(20,20,19,0) 68%)`,
        padding: "68px 72px",
        fontFamily: "Geist",
      },
    },
    h(
      "div",
      { style: { ...row, gap: 16 } },
      mark(46),
      h(
        "div",
        {
          style: {
            color: T.t1,
            fontSize: 34,
            fontWeight: 500,
            letterSpacing: "-0.01em",
          },
        },
        "Kaleido",
      ),
    ),

    h("div", { style: { display: "flex", flexGrow: 1 } }),

    h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          color: T.t1,
          fontSize: 68,
          lineHeight: 1.08,
          letterSpacing: "-0.025em",
        },
      },
      h("div", { style: { display: "flex" } }, "Tell it what you want."),
      h("div", { style: { display: "flex" } }, "It builds the plan."),
    ),

    h(
      "div",
      {
        style: {
          display: "flex",
          marginTop: 24,
          maxWidth: 900,
          color: T.t2,
          fontSize: 27,
          lineHeight: 1.45,
        },
      },
      "An agent that transacts across the whole DeFi stack — swaps, lending, liquidity, staking, stablecoins.",
    ),

    h("div", { style: { display: "flex", flexGrow: 1 } }),

    h(
      "div",
      {
        style: {
          ...row,
          justifyContent: "space-between",
          borderTop: `1px solid ${T.line}`,
          paddingTop: 26,
          fontSize: 23,
        },
      },
      h(
        "div",
        { style: { ...row, gap: 14, color: T.t2 } },
        "Transacts",
        h("span", { style: { color: T.brand } }, "·"),
        "Moves funds",
        h("span", { style: { color: T.brand } }, "·"),
        "Plans strategy",
      ),
      h(
        "div",
        { style: { display: "flex", color: T.t3 } },
        "app.kaleidofinance.xyz",
      ),
    ),
  );
}

/**
 * Wraps a 32x32 PNG in an ICO container.
 *
 * A .ico is a 6-byte header, one 16-byte directory entry per image, then the
 * payloads. Since Vista the payload may be a whole PNG rather than a raw DIB,
 * which every browser in use reads and which is the only form reachable from
 * here — satori's pipeline emits PNG. Written by hand because pulling an
 * encoder in for 22 bytes of header would be absurd.
 *
 * The point of shipping an .ico at all is that browsers request /favicon.ico
 * unprompted, before parsing any markup, so a site without one takes a 404 on
 * every cold load no matter how many <link rel="icon"> tags it emits.
 */
function ico(png, size) {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); // reserved
  head.writeUInt16LE(1, 2); // 1 = icon
  head.writeUInt16LE(1, 4); // one image
  head.writeUInt8(size, 6); // width
  head.writeUInt8(size, 7); // height
  head.writeUInt8(0, 8); // palette size, 0 = truecolour
  head.writeUInt8(0, 9); // reserved
  head.writeUInt16LE(1, 10); // colour planes
  head.writeUInt16LE(32, 12); // bits per pixel
  head.writeUInt32LE(png.length, 14);
  head.writeUInt32LE(22, 18); // payload offset
  return Buffer.concat([head, png]);
}

async function png(element, width, height) {
  const res = new ImageResponse(element, { width, height });
  return Buffer.from(await res.arrayBuffer());
}

function put(relPath, buf) {
  writeFileSync(join(ROOT, relPath), buf);
  console.log(`${String(buf.length).padStart(7)} B  ${relPath}`);
}

const outputs = [
  /* Next's file conventions. src/app/ placement is what makes Next emit the
     tags; these are not fetched by path. */
  ["src/app/favicon.ico", ico(await png(icon(32), 32, 32), 32)],
  ["src/app/apple-icon.png", await png(icon(180), 180, 180)],
  ["src/app/opengraph-image.png", await png(card(), 1200, 630)],

  /* The PWA manifest lives in public/ and its icons must resolve as plain
     URLs, so these two are not app-dir conventions. Both sizes are required:
     Chrome's install prompt wants a 192 and a 512. */
  ["public/icon-192.png", await png(icon(192), 192, 192)],
  ["public/icon-512.png", await png(icon(512), 512, 512)],
];

for (const [p, buf] of outputs) put(p, buf);
