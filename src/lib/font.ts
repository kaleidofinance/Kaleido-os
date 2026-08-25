import localFont from "next/font/local";

/**
 * Fonts are self-hosted rather than fetched from Google at compile time.
 *
 * `next/font/google` downloads each family during compilation and aborts after
 * 3 seconds. On a connection that resolves IPv6 first the CSS request took
 * ~5.6s here, so every build failed with "The user aborted a request" and the
 * page never rendered. Reading the woff2 from disk removes the network from the
 * build entirely and works offline.
 *
 * To refresh: grab the latin woff2 from the family's css2 stylesheet (request
 * it with a modern browser User-Agent, or Google serves ttf) and replace the
 * files in ./src/app/fonts.
 */

/**
 * The app typeface.
 *
 * Variable, with the full 100–900 weight axis exposed. That matters here: the
 * design tokens ask for `--k-fw-body: 485` and `--k-fw-med: 535`, weights that
 * only exist on a continuous axis. Against a static font they round to 400/500
 * and the intended texture is lost.
 *
 * Before this existed, `--k-font` named "Inter" and Inter was never loaded, so
 * every screen fell through to system-ui.
 */
const geist = localFont({
  src: "../app/fonts/GeistVF.woff",
  variable: "--font-geist",
  weight: "100 900",
  style: "normal",
  display: "swap",
  fallback: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});

/**
 * The display face — titles and empty-state headlines only, never data.
 *
 * Lora rather than Claude's own display serif because Copernicus, Tiempos
 * Headline and Styrene B are all commercially licensed and cannot be vendored
 * into a public repo. Anthropic's published brand guidelines substitute Lora
 * for exactly this reason, so this is their stand-in rather than our guess.
 *
 * Variable, like Geist: the 400–700 axis is real here (confirmed by finding an
 * `fvar` table in the woff2), which matters because a static instance would
 * quantise any weight the tokens ask for. `.k-display` in tokens.css pins it to
 * 400 — Claude's display type is never bold, and that restraint is most of the
 * difference between a serif that reads as a book and one that reads as a
 * newspaper.
 *
 * This is the latin subset (37KB) from the css2 stylesheet, per the refresh
 * note above. Latin-ext and Cyrillic are not shipped; the app has no localised
 * copy today, and a title falling back to Georgia is a better trade than 4x the
 * font weight on every first paint.
 */
const lora = localFont({
  src: "../app/fonts/lora-var.woff2",
  variable: "--font-lora",
  weight: "400 700",
  style: "normal",
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
});

const shareTechMono = localFont({
  src: "../app/fonts/share-tech-mono-400.woff2",
  weight: "400",
  style: "normal",
  display: "swap",
  fallback: ["ui-monospace", "monospace"],
});
const zenDots = localFont({
  src: "../app/fonts/zen-dots-400.woff2",
  weight: "400",
  style: "normal",
  variable: "--font-zenDots",
  display: "swap",
  fallback: ["ui-sans-serif", "sans-serif"],
});

export { geist, lora, shareTechMono, zenDots };
