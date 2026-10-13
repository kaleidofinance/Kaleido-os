"use client";

import { useEffect } from "react";

/**
 * Error boundary for the (app) route group.
 *
 * Without this file a thrown render error takes the whole app to Next's bare
 * "Application error: a client-side exception has occurred" white screen, with
 * no way back but a reload. This catches it and renders a recoverable message
 * inside the app shell instead; `reset()` re-renders the crashed segment.
 *
 * It handles two quite different failures, and the difference is load-bearing —
 * the old version treated every crash as the first kind, which is why a stale
 * bundle read as "the leaderboard isn't live on mainnet" to anyone who hit it:
 *
 *  1. A STALE BUNDLE after a deploy. A tab open across a redeploy holds an HTML
 *     shell that references chunk hashes the new deploy no longer serves, so the
 *     next lazy import throws `ChunkLoadError` / "Loading chunk failed". `reset()`
 *     cannot fix that — it re-runs the same dead code. Only a full reload fetches
 *     the fresh shell, so we reload ONCE automatically (guarded against a loop by
 *     a session flag, so a genuinely broken build shows the message instead of
 *     reloading forever).
 *
 *  2. A READ AGAINST A NETWORK KALEIDO ISN'T LIVE ON. `getKaleidoContract` throws
 *     by design when a chain has no Diamond recorded — Arc mainnet (5042) and the
 *     other coming-soon mainnets have none — so a wallet on one of those, plus a
 *     read path that reached the contract without gating on `isDeployed`, lands
 *     here. That copy is shown ONLY for this class now, not for every crash.
 */

/** A stale-bundle chunk load, across the shapes bundlers throw it in. */
function isChunkLoadError(error: (Error & { name?: string }) | null): boolean {
  const text = `${error?.name ?? ""} ${error?.message ?? ""}`;
  return /ChunkLoadError|Loading chunk\s+[\w-]+\s+failed|Loading CSS chunk|error loading dynamically imported module|Importing a module script failed|Failed to fetch dynamically imported module/i.test(
    text,
  );
}

/** The "chain has no Diamond deployed" class this boundary was first written for. */
function isNetworkNotLive(error: Error | null): boolean {
  return /not deployed|no (?:diamond|contract)\b|getKaleidoContract|isDeployed|unsupported chain|no contract recorded/i.test(
    error?.message ?? "",
  );
}

/** Session flag: one auto-reload per tab session, so a broken build can't loop. */
const RELOAD_KEY = "kaleido.chunk-reload";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const chunk = isChunkLoadError(error);
  const networky = !chunk && isNetworkNotLive(error);

  useEffect(() => {
    // Surfaced rather than swallowed, so it still reaches the console and any
    // error reporter — the boundary changes what the user sees, not visibility.
    console.error("[app] client-side exception:", error);

    if (!chunk) return;
    // Stale bundle: reload once to fetch the fresh shell. The session guard means
    // if the reload lands on the same error (a real build break, not skew), we
    // fall through to the message instead of reloading in a loop.
    try {
      if (sessionStorage.getItem(RELOAD_KEY) === "1") return;
      sessionStorage.setItem(RELOAD_KEY, "1");
      window.location.reload();
    } catch {
      // Private mode / storage blocked: don't risk a loop, just show the message.
    }
  }, [error, chunk]);

  const heading = chunk
    ? "Updating to the latest version…"
    : "Something went wrong on this page";
  const body = chunk
    ? "A new version just shipped. Reloading to pick it up — if this doesn't clear on its own, reload the page."
    : networky
      ? "A read may have hit a network Kaleido isn't live on yet. Try again, or switch to a supported network from the switcher."
      : "This page hit an unexpected error. Reloading usually clears it.";

  return (
    <div
      role="alert"
      style={{
        minHeight: "60vh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: "30rem" }}>
        <h2
          style={{
            font: "600 1.25rem/1.3 var(--k-font, system-ui, sans-serif)",
            color: "var(--k-t1, #0b1411)",
            marginBottom: "0.5rem",
          }}
        >
          {heading}
        </h2>
        <p
          style={{
            font: "400 0.95rem/1.5 var(--k-font, system-ui, sans-serif)",
            color: "var(--k-t2, #5b6b64)",
            marginBottom: "1.25rem",
          }}
        >
          {body}
        </p>
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          {/* `reset()` re-renders the crashed segment — the right recovery for a
              transient render error, useless for a stale bundle. Both buttons are
              offered so the user always has the one that fits: reload fetches a
              fresh shell, which is what a chunk error actually needs. */}
          {!chunk ? (
            <button
              onClick={reset}
              style={{
                font: "600 0.95rem/1 var(--k-font, system-ui, sans-serif)",
                color: "var(--k-brand-fg, #04170f)",
                background: "var(--k-brand, #00b383)",
                border: "0",
                borderRadius: "var(--k-r-pill, 999px)",
                padding: "10px 22px",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          ) : null}
          <button
            onClick={() => {
              try {
                sessionStorage.removeItem(RELOAD_KEY);
              } catch {
                /* storage blocked — the reload below still runs */
              }
              window.location.reload();
            }}
            style={{
              font: "600 0.95rem/1 var(--k-font, system-ui, sans-serif)",
              color: chunk ? "var(--k-brand-fg, #04170f)" : "var(--k-t1, #0b1411)",
              background: chunk ? "var(--k-brand, #00b383)" : "transparent",
              border: chunk ? "0" : "1px solid var(--k-line, #d6e0db)",
              borderRadius: "var(--k-r-pill, 999px)",
              padding: "10px 22px",
              cursor: "pointer",
            }}
          >
            Reload page
          </button>
        </div>
      </div>
    </div>
  );
}
