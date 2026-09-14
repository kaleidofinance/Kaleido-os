import "../(app)/tokens.css";
import type { ReactNode } from "react";
import type { Metadata } from "next";

/**
 * The waitlist lives at the root (not in the (app) or (marketing) groups), so it
 * gets the root layout's ClientProviders (thirdweb) but neither group's chrome.
 * It only needs the design tokens and the .kaleido-v2 scope the rest of the app
 * styles against.
 */
const OG_DESC =
  "Claim your welcome points, refer friends to earn more, and get Day-1 access when Arc goes mainnet.";

export const metadata: Metadata = {
  title: "Kaleido Pre-Season 1 · Arc Waitlist",
  description: OG_DESC,
  // Referral links are the whole viral loop, so they must unfurl a rich card.
  openGraph: {
    type: "website",
    title: "Get in line for Arc — Kaleido",
    description: OG_DESC,
    url: "https://kaleidofi.xyz/waitlist",
    images: [
      { url: "https://kaleidofi.xyz/waitlist-og.png", width: 1200, height: 630 },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Get in line for Arc — Kaleido",
    description: OG_DESC,
    images: ["https://kaleidofi.xyz/waitlist-og.png"],
  },
};

export default function WaitlistLayout({ children }: { children: ReactNode }) {
  return <div className="kaleido-v2">{children}</div>;
}
