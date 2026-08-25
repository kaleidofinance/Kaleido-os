"use client";
import { client } from "@/config/client";
import { WALLETS } from "@/config/wallets";
import { AutoConnect } from "thirdweb/react";

/**
 * Resumes the previous session on load, so a returning user is not asked to
 * connect again on every navigation.
 *
 * The wallet list is imported rather than declared here: AutoConnect can only
 * restore a wallet it was given, so a list that drifts from the connect modal's
 * turns a successful connect into a session that vanishes on reload. See
 * `src/config/wallets.ts`.
 */
export function AutoConnectProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <AutoConnect wallets={WALLETS} client={client} />
      {children}
    </>
  );
}
