import React from "react";
import { WalletRoot } from "@/lib/wallet";

/**
 * Mounts the active wallet provider's React root near the top of the tree.
 *
 * Provider-agnostic: `WalletRoot` resolves to the selected adapter's root (the
 * thirdweb context plus session auto-resume today), so this mount point does not
 * change when the provider does. Kept at this path and name because
 * `client-provider` and the ProtocolEventListener note both refer to it.
 */
export default function Web3Modal({ children }: { children: React.ReactNode }) {
  return <WalletRoot>{children}</WalletRoot>;
}
