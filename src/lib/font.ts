import localFont from "next/font/local"

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

const shareTechMono = localFont({
  src: "../app/fonts/share-tech-mono-400.woff2",
  weight: "400",
  style: "normal",
  display: "swap",
  fallback: ["ui-monospace", "monospace"],
})

const zenDots = localFont({
  src: "../app/fonts/zen-dots-400.woff2",
  weight: "400",
  style: "normal",
  variable: "--font-zenDots",
  display: "swap",
  fallback: ["ui-sans-serif", "sans-serif"],
})

export { shareTechMono, zenDots }
