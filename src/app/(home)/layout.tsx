import { Header } from "@/components/shared/Header"
import { Metadata } from "next"

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

export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return (
    <section className="relative mx-auto min-h-screen w-full max-w-[1600px] px-3 text-white sm:px-4 md:px-8">
      <Header />
      <main className="min-w-0 pt-3 sm:pt-0">{children}</main>
    </section>
  )
}
