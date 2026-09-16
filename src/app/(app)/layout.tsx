import "./tokens.css";
import type { ReactNode } from "react";
import CctpCompletionBanner from "@/components/v2/CctpCompletionBanner";

/**
 * The application shell.
 *
 * (app) is a route group, so it contributes nothing to the URL — /trade,
 * /pool, /borrow and the rest sit at the top level. It exists to give every
 * page one place to load the design tokens and the .kaleido-v2 class those
 * tokens are scoped under.
 *
 * That class is no longer isolating anything (the legacy app is gone), but
 * every selector in tokens.css and the CSS modules is written against it, so
 * it stays until they are rewritten — renaming it is a mechanical change worth
 * doing on its own rather than in the middle of a route migration.
 *
 * This used to mount the private-testnet BetaGate — a blur over the shell plus a
 * code card that gated every product route while `(marketing)` stayed open. That
 * gate is removed: the app is public for the mainnet launch, so there is nothing
 * to unlock and nothing to blur. The mainnet/testnet split is the network
 * switcher's job now (see NetworkSelector), not an access wall.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="kaleido-v2">
      {children}

      {/* Global CCTP "finish your transfer" bar — floats over the shell on every
          app page (a mint is completed from wherever the user is), renders
          nothing until there is a pending burn, which stays empty in production
          until the CCTP corridor is enabled. */}
      <CctpCompletionBanner />

      {/* Portal host for modals. See src/components/v2/Portal.tsx: a
          backdrop-filter ancestor becomes the containing block for
          `position: fixed` descendants, so every glass surface silently traps
          any modal rendered inside it. Modals mount here instead.

          Inside .kaleido-v2, not on <body>, because the design tokens are scoped
          to that class — a modal portalled to the body would lose every --k-*
          variable and render unstyled. Last child so it stacks above the page
          without a z-index arms race. */}
      <div id="k-portal" />
    </div>
  );
}
