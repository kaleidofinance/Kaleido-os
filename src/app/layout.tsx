// layout.tsx (Server Component)
import type { Metadata } from "next"
import "./globals.css"
import Script from "next/script"
import { envVars } from "@/constants/envVars"
import { ClientProviders } from "@/app/client-provider"
import { shareTechMono, zenDots } from "@/lib/font"

export const metadata: Metadata = {
  title: "Kaleido Agentic OS",
  description: "The Autonomous Financial Layer: Where Luca AI meets deep DeFi liquidity.",
  icons: "./favicon.ico",
  keywords: "kaleido, agentic os, luca ai, defi, autonomous finance, lending, trading",
  applicationName: "Kaleido Agentic OS",
  authors: [{ name: "Kaleido Team" }],
  openGraph: {
    type: "website",
    url: "https://app.kaleidofinance.xyz",
    title: "Kaleido Agentic OS | The Autonomous Financial Layer",
    siteName: "Kaleido Agentic OS",
    description:
      "Kaleido Agentic OS is the world’s first DeFi Operating System designed for both humans and autonomous agents, powered by the Luca AI engine.",
    images: ["https://app.kaleidofinance.xyz/logo.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Kaleido Agentic OS | Autonomous DeFi",
    description:
      "Transforming passive DeFi into active execution with Luca AI. Deploy, Stake, and Reason with Kaleido Agentic OS.",
    images: ["https://app.kaleidofinance.xyz/logo.png"],
  },
}

export const viewport = {
  width: "device-width",
  initialScale: 1.0,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
        <body className={`${shareTechMono.className} ${zenDots.variable}`}>
          <ClientProviders>{children}</ClientProviders>
        </body>
    </html>
  )
}
