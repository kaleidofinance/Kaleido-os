"use client"
import { client } from "@/config/client"
import { AutoConnect } from "thirdweb/react"
import { createWallet, inAppWallet } from "thirdweb/wallets"

const wallets = [createWallet("io.metamask"), createWallet("me.rainbow")]

export function AutoConnectProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AutoConnect wallets={wallets} client={client} />
      {children}
    </>
  )
}
