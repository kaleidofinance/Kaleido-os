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
  /* Bitget Wallet — partner integration (DApp Center listing + connect). Kept in
     the top row per their listing requirement; thirdweb resolves the id to the
     Bitget entry, shows it even when the extension is absent (with a download
     prompt on their metadata), and carries the icon. */
  createWallet("com.bitget.web3"),
  createWallet("com.coinbase.wallet"),
  createWallet("me.rainbow"),
  createWallet("walletConnect"),
  /* RESTORED 2026-09-15 — thirdweb's paid plan is now provisioned, so the
     embedded/social wallet service is back. Email or social sign-in producing a
     real EOA, for someone with no browser extension. (The connect modal surfaces
     Social Login at the top regardless of this array position; the top-of-file
     note explains why the entry itself is kept last.) Under the current client id
     7ae3508f the embedded address differs from the pre-switch one — see the
     wallet-provider-abstraction memory. */
  inAppWallet({ auth: { options: ["google", "email", "passkey"] } }),
];

/**
 * The app identity handed to WalletConnect when connecting an external wallet.
 *
 * WalletConnect needs dapp metadata to open a pairing session. Without it the
 * session can fail to initialise — and because both connect() call sites catch
 * and swallow the rejection, that surfaced on mobile as "tap MetaMask/Rainbow
 * and nothing happens: no app, no QR." `name` and `url` are load-bearing; the
 * logo is what the wallet shows on the approval screen. Passed to the connect
 * modal, which propagates it to every wallet including the WC deep link.
 */
export const APP_METADATA = {
  name: "Kaleido",
  url: "https://kaleidofi.xyz",
  description: "Agentic DeFi on Arc",
  logoUrl: "https://kaleidofi.xyz/icon-192.png",
};
