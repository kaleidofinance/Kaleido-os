"use client"
import { RadixTheme } from "@/context/radix"
import Background from "@/components/shared/background/background"
import Web3Modal from "@/context/web3Modal"
import { Toaster } from "sonner"
import { AbstractContext } from "@/context/AbstractProvider"
import { ClientAnalytics } from "@/components/Analytics/ClientAnalytics"
import { WelcomeDialog } from "@/components/modals/Dialog"
import ExposedReferralHandler from "@/components/ReferralHandler"
import { ChatbotLoader } from "@/components/chatbot/ChatbotLoader"
import { NotificationsProvider } from "@/context/NotificationsContext"
import { Provider as JotaiProvider } from "jotai"

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <JotaiProvider>
      <AbstractContext>
        <RadixTheme>
          <Web3Modal>
            <NotificationsProvider>
              <ClientAnalytics />
              <main className="min-h-screen">
                <ExposedReferralHandler />
                <WelcomeDialog />
                <Background />
                {children}
                <ChatbotLoader />
              </main>
              <Toaster richColors position="top-right" toastOptions={{ style: { zIndex: 100000 } }} />
            </NotificationsProvider>
          </Web3Modal>
        </RadixTheme>
      </AbstractContext>
    </JotaiProvider>
  )
}
