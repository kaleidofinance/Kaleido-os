// layout.tsx (Server Component)
import type { Metadata } from "next";
import "./globals.css";
import Script from "next/script";
import { envVars } from "@/constants/envVars";
import { ClientProviders } from "@/app/client-provider";
import { geist, lora, zenDots } from "@/lib/font";
import { Analytics } from "@vercel/analytics/next";

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
  metadataBase: new URL("https://kaleidofi.xyz"),
  /* Keep the share image explicit and on the public domain. The old file-based
     fallback pointed crawlers at app.kaleidofinance.xyz, which is not the host
     users share and can be protected separately from the public site. */
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
    images: [
      {
        url: "https://kaleidofi.xyz/kaleido-og.png",
        width: 1200,
        height: 630,
        alt: "Kaleido — Agentic DeFi. Live on Arc.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Kaleido OS — an agent that transacts across the whole DeFi stack",
    description:
      "Tell it what you want. It builds the plan — swaps, lending, liquidity, staking, stablecoins — prices and audits every step, and hands it to you to sign.",
    images: ["https://kaleidofi.xyz/kaleido-og.png"],
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
        <Analytics />
      </body>
    </html>
  );
}
