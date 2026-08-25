"use client";

import useProtocolEvents from "@/hooks/events/useProtocolEvents";

/**
 * Mounts the chain-event subscriptions once, for the whole app.
 *
 * A component rather than a hook call in ClientProviders because the hook needs
 * `useActiveAccount()`, and ClientProviders *renders* the thirdweb provider —
 * calling it there would read the wallet from outside the provider that supplies
 * it. This has to sit inside Web3Modal, and it renders nothing.
 *
 * Mounted here rather than in the (app) layout so it is not remounted when a user
 * crosses a route-group boundary, and because a subscription that has to be
 * unique belongs at the one place that is guaranteed to render exactly once.
 */
export default function ProtocolEventListener() {
  useProtocolEvents();
  return null;
}
