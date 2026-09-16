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
 * The crash it exists for today is a read against a contract that is not deployed
 * on the connected chain. `getKaleidoContract` throws by design when a chain has
 * no Diamond recorded — and Arc mainnet (5042) has none yet, as do the other
 * coming-soon mainnets — so a wallet sitting on one of those, plus any read path
 * that reaches the contract without gating on `isDeployed`, would otherwise white
 * out the page. A network the protocol has not launched on is a normal place for
 * a wallet to be, not a fault, so it must degrade rather than crash.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaced rather than swallowed, so it still reaches the console and any
    // error reporter — the boundary changes what the user sees, not visibility.
    console.error("[app] client-side exception:", error);
  }, [error]);

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
          Something went wrong on this page
        </h2>
        <p
          style={{
            font: "400 0.95rem/1.5 var(--k-font, system-ui, sans-serif)",
            color: "var(--k-t2, #5b6b64)",
            marginBottom: "1.25rem",
          }}
        >
          A read may have hit a network Kaleido isn&rsquo;t live on yet. Try
          again, or switch to a supported network from the switcher.
        </p>
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
      </div>
    </div>
  );
}
