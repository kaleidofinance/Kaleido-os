// layout.tsx (Server Component)
import type { Metadata } from "next"
import "./globals.css"
import Script from "next/script"
import { envVars } from "@/constants/envVars"
import { ClientProviders } from "@/app/client-provider"
import { shareTechMono, zenDots } from "@/lib/font"

export const metadata: Metadata = {
  title: "Kaleido Agentic DeFI OS",
  description: "Lend, Borrow, and Thrive with Kaleido: Where Ai Agent Meets DeFi on Abstract Chain.",
  icons: "./favicon.ico",
  keywords: "lend, blockchain, kaleido, defi, dapp, abstract finance",
  applicationName: "Kaleido Agentic DeFI OS",
  authors: [{ name: "Kaleido Agentic DeFI OS" }],
  openGraph: {
    type: "website",
    url: "https://app.kaleidofinance.xyz",
    title: "Kaleido Agentic DeFI OS | AI DeFi Platform",
    siteName: "Kaleido Agentic DeFI OS",
    description:
      "Kaleido Agentic DeFI OS is a decentralized lending platform where users can lend and borrow assets powered by AI agents on the Abstract blockchain.",
    images: ["https://app.kaleidofinance.xyz/logo.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Kaleido Agentic DeFI OS | AI DeFi Platform",
    description:
      "Kaleido Agentic DeFI OS is a decentralized lending platform where users can lend and borrow assets powered by AI agents on the Abstract blockchain.",
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
