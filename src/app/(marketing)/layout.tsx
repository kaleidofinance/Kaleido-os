import "../(app)/tokens.css";
import type { ReactNode } from "react";

/**
 * The marketing shell — the front door at `/`.
 *
 * Two route groups now sit side by side: (app) serves the product and this
 * serves the page that sells it. Neither contributes a URL segment, so `/` is
 * this group's page.tsx and /trade is still (app)'s. `/` used to 307 to /trade;
 * see next.config.mjs for why that redirect is gone and must not come back
 * while this file exists.
 *
 * It loads the same tokens.css and wraps in the same .kaleido-v2 as
 * src/app/(app)/layout.tsx:1,19, and that is the whole point of doing it as a
 * route group rather than a standalone site: every --k-* variable, the glass
 * utilities, the Lora display face pinned to 400, both themes and the ambient
 * lens layer are scoped to that class, so the landing page inherits the app's
 * design language instead of maintaining a second one that drifts from it.
 *
 * What it deliberately does NOT mirror: no <Nav>, and no #k-portal. Nav reads
 * the connected wallet and the notification context; a public page has neither
 * and needs neither. The portal host exists for modals, and there are none
 * here — every interactive part is inline.
 *
 * Note that the wallet provider is still mounted, because ClientProviders sits
 * in the *root* layout (src/app/client-provider.tsx) above both groups. That is
 * pre-existing and not worth restructuring for this page; what matters is that
 * nothing under this layout calls a wallet hook, so the page renders identically
 * with no extension installed. Keep it that way — the moment something here
 * reaches for useWalletV2 or useResolverContext, the landing page starts having
 * a connected and a disconnected state, and it should have exactly one.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <div className="kaleido-v2">{children}</div>;
}
