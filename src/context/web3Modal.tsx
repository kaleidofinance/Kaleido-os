import { ThirdwebProvider } from "thirdweb/react"
import React from "react"
import { AutoConnectProvider } from "./AutoConnectProvider"

export const SUPPORTED_CHAIN_ID = [11124]

export default function Web3Modal({ children }: { children: React.ReactNode }) {
  return (
    <ThirdwebProvider>
      <AutoConnectProvider>{children}</AutoConnectProvider>
    </ThirdwebProvider>
  )
}
