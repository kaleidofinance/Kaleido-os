"use client";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RadixTheme } from "@/context/radix";
import Web3Modal from "@/context/web3Modal";
import { Toaster } from "sonner";
import { ClientAnalytics } from "@/components/Analytics/ClientAnalytics";
import ExposedReferralHandler from "@/components/ReferralHandler";
import { NotificationsProvider } from "@/context/NotificationsContext";
import ProtocolEventListener from "@/components/ProtocolEventListener";
import { Provider as JotaiProvider } from "jotai";

/**
 * The app's query client, with defaults tuned for reading a chain rather than a
 * REST API.
 *
 * `@tanstack/react-query` shipped in package.json for a while with no provider
 * mounted, so every read hook rolled its own caching by hand — jotai atoms and a
 * `refreshNonce` — which is what let state go stale and refetch race the chain.
 * This is the layer those hooks were missing.
 *
 *  - `staleTime` 15s: chain reads do not need to refire on every render, and a
 *    balance a few seconds old is fine to show while a fresh one loads.
 *  - `retry` once: a throttled testnet RPC is worth one more try, but a genuine
 *    revert (a view that does not exist on this chain) should surface, not spin.
 *  - `refetchOnWindowFocus` off: tabbing back should not hammer five testnet
 *    endpoints; explicit `refetch` after a write, and the staleTime above, cover
 *    freshness without it.
 */
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export function ClientProviders({ children }: { children: React.ReactNode }) {
  /* One client per browser session, held in state so a re-render never swaps it
     (a new client on every render throws the whole cache away each time). */
  const [queryClient] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <JotaiProvider>
        <RadixTheme>
          <Web3Modal>
            <NotificationsProvider>
              <ClientAnalytics />
              <ProtocolEventListener />
              <main className="min-h-screen">
                <ExposedReferralHandler />
                {children}
              </main>
              <Toaster
                richColors
                position="top-right"
                toastOptions={{ style: { zIndex: 100000 } }}
              />
            </NotificationsProvider>
          </Web3Modal>
        </RadixTheme>
      </JotaiProvider>
    </QueryClientProvider>
  );
}
