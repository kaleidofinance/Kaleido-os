"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { envVars } from "@/constants/envVars";
import s from "./LinkX.module.css";

/**
 * "Link X" — the header control that connects an X account to this session.
 *
 * This replaces the /verify page, which is gone. Its backend never was: the OAuth
 * start (/api/auth/twitter), the callback and /api/auth/user all survived, so
 * what was missing was somewhere to press. A page for one button was the wrong
 * shape for it anyway — linking X is an account action like connecting a wallet,
 * so it belongs beside the wallet rather than at a route you have to be sent to.
 *
 * `/api/auth/user` is the only source of link state, and it reads one httpOnly
 * cookie holding `{username, name}`. Deliberately not localStorage: httpOnly
 * means the browser cannot forge it, and the handle is displayed as a fact about
 * the session rather than a client-side preference.
 *
 * Pressing it while already linked restarts the same flow, which is how you
 * switch accounts — /api/auth/twitter sends `prompt=consent`, so X asks again
 * rather than silently reusing the previous grant. There is no unlink, because
 * the cookie carries a public handle and no token, and it expires on its own.
 *
 * An <a> and not a <button>: this is a navigation to a route that 302s to x.com.
 * The click handler only intercepts the one case where navigating cannot work.
 */
export default function LinkX() {
  const [handle, setHandle] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/user")
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => {
        /* 401 is the ordinary "not linked" answer, not an error — the route
           returns it whenever the cookie is absent. */
        if (!cancelled) setHandle(u?.username ?? null);
      })
      .catch(() => {
        /* Offline or the route is down. Unlinked is the safe reading: it offers
           the flow, and the flow's own failure is legible. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const linked = Boolean(handle);

  return (
    <a
      href="/api/auth/twitter"
      className={`${s.btn} ${linked ? s.linked : ""}`}
      title={
        linked
          ? `Linked as @${handle} — press to link a different account`
          : "Link your X account"
      }
      aria-label={linked ? `Linked as @${handle}` : "Link X account"}
      onClick={(e) => {
        /* Without a client id the redirect reaches x.com as
           `client_id=undefined` and the user lands on X's own error page, which
           reads as our fault and gives them nothing to act on. Same guard, and
           the same wording, as the Connect button in Nav.tsx. */
        if (!envVars.twitterClientId) {
          e.preventDefault();
          toast.error("X sign-in isn't configured on this deployment.");
        }
      }}
    >
      <svg className={s.mark} viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
        />
      </svg>
      <span className={s.label}>{linked ? `@${handle}` : "Link X"}</span>
    </a>
  );
}
