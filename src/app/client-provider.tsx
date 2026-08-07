"use client"
import { RadixTheme } from "@/context/radix"
import Web3Modal from "@/context/web3Modal"
import { Toaster } from "sonner"
import { ClientAnalytics } from "@/components/Analytics/ClientAnalytics"
import ExposedReferralHandler from "@/components/ReferralHandler"
import { NotificationsProvider } from "@/context/NotificationsContext"
import { Provider as JotaiProvider } from "jotai"

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <JotaiProvider>
      <RadixTheme>
        <Web3Modal>
          <NotificationsProvider>
            <ClientAnalytics />
            <main className="min-h-screen">
              <ExposedReferralHandler />
              {children}
            </main>
            <Toaster richColors position="top-right" toastOptions={{ style: { zIndex: 100000 } }} />
          </NotificationsProvider>
        </Web3Modal>
      </RadixTheme>
    </JotaiProvider>
  )
}
