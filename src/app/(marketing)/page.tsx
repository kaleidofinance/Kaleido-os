import type { Metadata } from "next";
import LandingPageV3 from "./landing-v3/LandingPageV3";

export const metadata: Metadata = {
  title: "Kaleido Finance | Meet Luca, the AI agent for multi-chain DeFi.",
  description:
    "Turn natural language into live swaps, fixed-rate P2P loans, concentrated LP positions, and cross-chain bridges across five networks with Luca AI and Kaleido’s native V3 liquidity.",
  openGraph: {
    title: "Kaleido Finance | Meet Luca, the AI agent for multi-chain DeFi.",
    description:
      "Turn natural language into live swaps, fixed-rate P2P loans, concentrated LP positions, and cross-chain bridges across five networks with Luca AI and Kaleido’s native V3 liquidity.",
    images: ["/landing-v2-colosseum-dark.webp"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Kaleido Finance | Meet Luca, the AI agent for multi-chain DeFi.",
    description:
      "Turn natural language into live swaps, fixed-rate P2P loans, concentrated LP positions, and cross-chain bridges across five networks with Luca AI and Kaleido’s native V3 liquidity.",
    images: ["/landing-v2-colosseum-dark.webp"],
  },
};

export default function Page() {
  return <LandingPageV3 />;
}
