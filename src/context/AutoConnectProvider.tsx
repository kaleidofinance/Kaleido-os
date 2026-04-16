"use client"
import { client } from "@/config/client"
import { AutoConnect } from "thirdweb/react"
import { createWallet, inAppWallet } from "thirdweb/wallets"
import { abstractWallet } from "@abstract-foundation/agw-react/thirdweb"

const wallets = [createWallet("io.metamask"), createWallet("me.rainbow"), abstractWallet()]

export function AutoConnectProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AutoConnect wallets={wallets} client={client} />
      {children}
    </>
  )
}
