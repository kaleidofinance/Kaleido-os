import "../(app)/tokens.css";
import type { ReactNode } from "react";
import type { Metadata } from "next";

/**
 * The waitlist lives at the root (not in the (app) or (marketing) groups), so it
 * gets the root layout's ClientProviders (thirdweb) but neither group's chrome.
 * It only needs the design tokens and the .kaleido-v2 scope the rest of the app
 * styles against.
 */
export const metadata: Metadata = {
  title: "Kaleido Arc Waitlist",
  description:
    "Agentic DeFi, live on Arc Day 1. Claim your welcome points, refer friends, and climb the board.",
};

export default function WaitlistLayout({ children }: { children: ReactNode }) {
  return <div className="kaleido-v2">{children}</div>;
}
