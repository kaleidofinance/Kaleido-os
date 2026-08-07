import { ThirdwebProvider } from "thirdweb/react"
import React from "react"
import { AutoConnectProvider } from "./AutoConnectProvider"

/**
 * The chain the legacy lending hooks check against, still Abstract Testnet.
 *
 * BLOCKED ON GATE A, and load-bearing: twelve files import this, several
 * indexing it positionally (`SUPPORTED_CHAIN_ID[0]`, and `[1]` in
 * getUsdcBalance, which has no second element — that read is already
 * undefined). Emptying it or reordering it changes behaviour in all of them,
 * so it is left alone until there is a real deployment to point it at.
 *
 * Nothing is deployed on 11124 any more, so these checks currently amount to
 * "are you on the old dead testnet". They gate legacy hooks only — the agent's
 * plan path is gated properly on `isDeployed()` instead. Replace this with a
 * per-chain check derived from DEPLOYMENTS at Gate A rather than growing the
 * array.
 */
export const SUPPORTED_CHAIN_ID = [11124]

export default function Web3Modal({ children }: { children: React.ReactNode }) {
  return (
    <ThirdwebProvider>
      <AutoConnectProvider>{children}</AutoConnectProvider>
    </ThirdwebProvider>
  )
}
