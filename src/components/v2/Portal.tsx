"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Renders children into the `#k-portal` host at the end of the app shell.
 *
 * This exists because of one CSS rule that is easy to trip over: an element
 * with `backdrop-filter` becomes the containing block for `position: fixed`
 * descendants. Every glass surface in this app is therefore a trap — a modal
 * rendered inside the nav gets positioned against the nav, and one rendered
 * inside the agent card gets positioned against the card, so `inset: 0` on the
 * scrim covers the panel instead of the viewport. Both were visible bugs: the
 * network list appeared clipped to the nav strip, and Agent Settings appeared
 * inside the chat card.
 *
 * It is the same failure the old `html { -moz-transform: scale(.85) }` hack
 * caused, and removing that hack is why it resurfaced here — `transform`,
 * `filter`, `backdrop-filter`, `perspective`, `contain` and `will-change` all
 * create a containing block for fixed positioning.
 *
 * Fixing it by moving glass off the offending ancestors would mean giving up
 * the surface treatment; fixing the modals' CSS is impossible, because there
 * is no way to opt out of an ancestor's containing block. Portalling is the
 * only fix that survives someone adding glass to a new component later.
 *
 * The host is inside `.kaleido-v2` rather than on `<body>` because the design
 * tokens are scoped to that class.
 *
 * `mounted` gates the first render: the host does not exist during SSR, so
 * calling createPortal against it would throw. Returning null for the initial
 * client render keeps hydration matched, and modals are never open on first
 * paint anyway.
 */
export default function Portal({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(document.getElementById("k-portal"));
  }, []);

  if (!host) return null;
  return createPortal(children, host);
}
