export {}

declare global {
  interface Window {
    gtag: (...args: any[]) => void
    /**
     * Injected EIP-1193 provider. This used to reach TypeScript only as a side
     * effect of a wallet package imported by the legacy pages; declaring it
     * here keeps the DEX hooks compiling on their own terms. Typed loosely to
     * match the behaviour those hooks were written against — they pass it
     * straight to BrowserProvider without narrowing.
     */
    ethereum?: any
  }
}
