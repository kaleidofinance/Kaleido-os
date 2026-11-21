import type { Metadata } from "next";
import LandingPage from "./landing-v2/LandingPage";

export const metadata: Metadata = {
  title: "Kaleido Finance | Onchain finance, made clear.",
  description:
    "Trade, lend and manage liquidity across chains. Tell Luca what you want to do, review the plan, and sign from your own wallet.",
  openGraph: {
    title: "Kaleido Finance | Onchain finance, made clear.",
    description:
      "Trade, lend and manage liquidity across chains. Tell Luca what you want to do, review the plan, and sign from your own wallet.",
    images: ["/landing-v2-colosseum-dark.webp"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Kaleido Finance | Onchain finance, made clear.",
    description:
      "Trade, lend and manage liquidity across chains. Tell Luca what you want to do, review the plan, and sign from your own wallet.",
    images: ["/landing-v2-colosseum-dark.webp"],
  },
};

export default function Page() {
  return <LandingPage />;
}
