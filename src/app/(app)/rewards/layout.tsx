import type { ReactNode } from "react";
import type { Metadata } from "next";

/**
 * /rewards is the in-app home for the Season 1 task program (moved out of the
 * standalone /waitlist page, 2026-09-24). It lives in the (app) group, so the
 * group layout already provides the `.kaleido-v2` scope + tokens — this layout
 * only carries the OG/Twitter card, because referral links (now /rewards?ref=…)
 * are the whole viral loop and must unfurl richly.
 */
const OG_DESC =
  "Kaleido is live on Arc. Claim Season 1 welcome points, complete launch tasks, refer friends, and keep earning in the ongoing rewards program.";

export const metadata: Metadata = {
  title: "Kaleido Season 1 Rewards · Arc",
  description: OG_DESC,
  openGraph: {
    type: "website",
    title: "Kaleido Season 1 rewards — live on Arc",
    description: OG_DESC,
    url: "https://kaleidofi.xyz/rewards",
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
    title: "Kaleido Season 1 rewards — live on Arc",
    description: OG_DESC,
    images: ["https://kaleidofi.xyz/kaleido-og.png"],
  },
};

export default function RewardsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
