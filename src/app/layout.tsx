// layout.tsx (Server Component)
import type { Metadata } from "next";
import "./globals.css";
import Script from "next/script";
import { envVars } from "@/constants/envVars";
import { ClientProviders } from "@/app/client-provider";
import { geist, lora, zenDots } from "@/lib/font";

export const metadata: Metadata = {
  title: "Kaleido Agentic OS",
  description:
    "The Autonomous Financial Layer: Where Luca AI meets deep DeFi liquidity.",
  /*
   * Required so Next can make the file-convention images below absolute. OG and
   * Twitter images must be absolute URLs — a crawler has no page to resolve a
   * relative path against — and without this Next warns and falls back to
   * localhost:3000, which silently ships link previews that only work on the
   * developer's machine.
   */
  metadataBase: new URL("https://app.kaleidofinance.xyz"),
  /*
   * No `icons` key, and no `openGraph.images` / `twitter.images` either. All
   * three come from files instead:
   *
   *   src/app/favicon.ico            -> <link rel="icon">
   *   src/app/apple-icon.png         -> <link rel="apple-touch-icon">
   *   src/app/opengraph-image.png    -> og:image, with width/height/type read
   *   src/app/opengraph-image.alt.txt   off the real file
   *
   * Do not add an `icons` key back. It does not merely lose to the files, it
   * suppresses them: accumulateMetadata only attaches the collected apple icon
   * `if (!resolvedMetadata.icons)`, so any declared `icons` — at this segment or
   * a child — silently deletes <link rel="apple-touch-icon"> from every page.
   * The favicon survives because Next special-cases it, which is what made the
   * old bug so quiet: `icons: "./favicon.ico"` pointed at a path with no file
   * (the real one was buried in src/app/favicons/) and emitted a second, broken
   * icon link while killing the apple one, and both image arrays pointed at
   * /logo.png, deleted in the redesign — so link previews and the PWA install
   * prompt were both broken, each failing silently.
   *
   * There is deliberately no twitter-image file. Next already fills twitter's
   * image from the openGraph one — postProcessMetadata copies og:image across
   * whenever `twitter` declares no `images` of its own — so the emitted head
   * carries twitter:image, its width, height and type without a second file. A
   * duplicate 1200x630 PNG would add 64 KB to the repo and change no output.
   *
   * The alt text comes from opengraph-image.alt.txt, which the image loader
   * reads with existsSync at loader time *without* registering it as a webpack
   * dependency (next-metadata-image-loader.js:126-131). Editing the alt file
   * alone therefore invalidates nothing: touch opengraph-image.png to make a
   * running dev server pick up a new one. A cold `next build` always reads it.
   *
   * The rasters are generated and committed, not hand-exported:
   * scripts/generate-brand-assets.mjs composes them from the --k-* tokens
   * around the real logo (public/newklogo2.png, the file the nav draws) and
   * writes all five in one pass, so the favicon, the apple icon, the PWA pair
   * and the OG card cannot drift apart. Read that file's header before
   * regenerating; it explains why this is a script rather than the idiomatic
   * runtime `opengraph-image.tsx` route.
   */
  /*
   * Required for web push, and specifically required on iOS: Safari only
   * delivers push to a site the user has added to their Home Screen, and it
   * will not offer to install one without a manifest. Without this line
   * pushManager.subscribe() throws on iOS with nothing explaining why.
   */
  manifest: "/manifest.webmanifest",
  keywords:
    "kaleido, agentic os, luca ai, defi, autonomous finance, lending, trading",
  applicationName: "Kaleido Agentic OS",
  authors: [{ name: "Kaleido Team" }],
  /*
   * The share copy lives here, at the root, and deliberately nowhere else.
   *
   * Next merges these two keys by replacement, not by extension: a child
   * segment that declares `openGraph` overwrites this whole object rather than
   * adding to it — and the file-convention image above is attached to *this*
   * segment, so the overwrite silently takes the image with it. Verified in
   * next/dist/lib/metadata/resolve-metadata.js: mergeMetadata's `openGraph`
   * case assigns `target.openGraph = resolveOpenGraph(source.openGraph, ...)`,
   * and the mergeStaticMetadata call that would put the image back returns
   * early on `if (!staticFilesMetadata) return` for any segment that has no
   * image file of its own.
   *
   * So a per-page openGraph block costs that page its preview image. Keeping
   * one set of copy here is what makes the image reach every route, and the
   * copy is the landing page's because that is the URL people share.
   *
   * `url` is relative on purpose: metadataBase resolves it, which makes the
   * emitted tag absolute and doubles as a check that metadataBase is live — if
   * og:url ever renders as a bare "/", metadataBase is not being seen
   * (resolve-url.js:106 returns the input untouched when it is missing).
   */
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Kaleido Agentic OS",
    title:
      "Kaleido OS — the DeFi operating system with an agent that transacts",
    description:
      "An agent that performs transactions across the whole stack, moves funds, and plans a money strategy. Every plan is yours to sign.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Kaleido OS — an agent that transacts across the whole DeFi stack",
    description:
      "Tell it what you want. It builds the plan — swaps, lending, liquidity, staking, stablecoins — prices and audits every step, and hands it to you to sign.",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1.0,
};

/**
 * Applies the stored theme before first paint.
 *
 * This has to be a blocking inline script in <head>. Doing it in an effect
 * means React has already painted the default (dark) theme, so a light-mode
 * user sees a dark flash on every navigation — the thing that makes an app
 * feel cheap regardless of how good the theme itself is.
 *
 * Falls back to the OS preference when nothing is stored, and swallows errors
 * so a Safari private-mode localStorage throw cannot block rendering.
 */
const themeScript = `
(function(){try{
  var t = localStorage.getItem('kaleido-theme');
  if (t !== 'light' && t !== 'dark') {
    t = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  document.documentElement.setAttribute('data-theme', t);
}catch(e){}})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${envVars.measurementId}`}
        strategy="afterInteractive"
      />
      <Script id="gtag-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${envVars.measurementId}');
        `}
      </Script>
      <body
        className={`${geist.variable} ${lora.variable} ${zenDots.variable}`}
      >
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}
