import "./tokens.css";
import type { ReactNode } from "react";

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
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="kaleido-v2">
      {children}
      {/* Portal host for modals. See src/components/v2/Portal.tsx: a
          backdrop-filter ancestor becomes the containing block for
          `position: fixed` descendants, so every glass surface silently
          traps any modal rendered inside it. Modals mount here instead.

          Inside .kaleido-v2, not on <body>, because the design tokens are
          scoped to that class — a modal portalled to the body would lose
          every --k-* variable and render unstyled. Last child, so it stacks
          above the page without needing a z-index arms race, and a direct
          child so it can never sit under a glass surface. */}
      <div id="k-portal" />
    </div>
  );
}
