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
  return <div className="kaleido-v2">{children}</div>;
}
