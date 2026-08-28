import "./tokens.css";
import type { ReactNode } from "react";

import BetaGate from "@/components/v2/BetaGate";
import { HTML_ATTR, OPEN_VALUE, SHELL_ID, STORAGE_KEY } from "@/lib/beta";

import g from "@/components/v2/BetaGate.module.css";

/**
 * Applies the stored private-testnet unlock before first paint.
 *
 * The same technique, and for the same reason, as `themeScript` in the root
 * layout: the flag is in localStorage, which the server cannot read, so doing
 * this in an effect means React paints the locked state first and an already
 * unlocked tester watches the app blur and then un-blur on every navigation.
 * A blocking inline script has set the attribute by the time the shell below is
 * parsed, so the first frame is correct.
 *
 * Placed here rather than in the root layout because only this route group is
 * gated — `(marketing)` has no use for it. Errors are swallowed so a Safari
 * private-mode localStorage throw cannot stop the app rendering.
 */
const betaScript = `
(function(){try{
  if (localStorage.getItem('${STORAGE_KEY}') === '${OPEN_VALUE}') {
    document.documentElement.setAttribute('${HTML_ATTR}', '${OPEN_VALUE}');
  }
}catch(e){}})();
`;

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
 * IT IS ALSO WHERE THE PRIVATE-TESTNET GATE MOUNTS, and this is the only file
 * that decides what is gated. Every product route is a descendant of this
 * layout, and the marketing route group is not, so putting the gate here gates
 * the app and leaves the landing page and /docs open — which is required, not
 * incidental: the waitlist form that hands out the codes is reached from the
 * marketing site, so gating that too would lock the door and post the key
 * inside.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="kaleido-v2">
      <script dangerouslySetInnerHTML={{ __html: betaScript }} />

      {/* The blur, and nothing else, lives on this wrapper. `#k-portal` and the
          gate are deliberately outside it: `filter` on an element makes it the
          containing block for `position: fixed` descendants, so a gate rendered
          inside would position its own full-screen overlay against a blurred
          box instead of the viewport — and would be blurred itself. */}
      <div id={SHELL_ID} className={g.shell}>
        {children}
      </div>

      {/* Portal host for modals. See src/components/v2/Portal.tsx: a
          backdrop-filter ancestor becomes the containing block for
          `position: fixed` descendants, so every glass surface silently
          traps any modal rendered inside it. Modals mount here instead.

          Inside .kaleido-v2, not on <body>, because the design tokens are
          scoped to that class — a modal portalled to the body would lose
          every --k-* variable and render unstyled. After the shell, so it
          stacks above the page without needing a z-index arms race, and a
          direct child so it can never sit under a glass surface.

          It was the last child until the gate arrived, and the gate is after
          it on purpose: while the app is locked, a modal opened by something
          in the blurred shell must not paint over the card. */}
      <div id="k-portal" />

      <BetaGate />
    </div>
  );
}
