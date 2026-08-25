import { createWallet, inAppWallet } from "thirdweb/wallets";

/**
 * The wallets we offer, in the order the connect modal shows them.
 *
 * One list, exported once, because `AutoConnect` and the connect modal have to
 * agree. AutoConnect can only resume a session for a wallet it was handed: if
 * the modal offers Coinbase but AutoConnect's list holds only MetaMask and
 * Rainbow, then connecting with Coinbase works and every reload afterwards
 * silently drops you back to disconnected. That is indistinguishable from a
 * broken connect button, which is what this app shipped with.
 *
 * `inAppWallet` last, deliberately. It is the escape hatch for someone with no
 * browser extension — email or social sign-in producing a real EOA — but an
 * external wallet is what a returning user expects to see first, and putting
 * the custodial option at the top of a DeFi app reads as the default.
 */
export const WALLETS = [
  createWallet("io.metamask"),
  createWallet("com.coinbase.wallet"),
  createWallet("me.rainbow"),
  createWallet("walletConnect"),
  inAppWallet({ auth: { options: ["google", "email", "passkey"] } }),
];
