export const envVars = {
  lendbitDiamondAddress: process.env.NEXT_PUBLIC_KALEIDO_DIAMOND_ADDRESS,

  httpRPC: process.env.NEXT_PUBLIC_HTTP_RPC,

  wssRPC: process.env.NEXT_PUBLIC_WEBSOCKET_RPC,

  httpRPCab: process.env.NEXT_PUBLIC_HTTP_RPC_AB,

  // NOTE: no private key here. Signing keys must never be exposed via a
  // NEXT_PUBLIC_ variable — Next.js inlines those into the browser bundle.
  // Server-side signing reads process.env.PRIVATE_KEY directly; see
  // src/app/api/referral/route.ts.

  measurementId: process.env.NEXT_PUBLIC_MEASUREMENT_ID,

  faucetAddress: process.env.NEXT_PUBLIC_TOKENFAUCET_ADDRESS,

  /*
   * `vaultAddress: process.env.NEXT_PUBLIC_KLD_VAULT_ADDRESS` stood here and is
   * deleted, not emptied.
   *
   * It was never set, so `getKLDVaultContract` threw "Missing contract address
   * for KLD Vault" on every call and /stake was unreachable on every chain.
   * There was nothing to set it to — KLD had no ERC20 in the repository, so no
   * vault deployment existed. It also could not have been right for more than
   * one chain at a time: the vault is deployed per chain, like the diamond and
   * the faucet before it, both of which moved off their env vars for the same
   * reason.
   *
   * `kldVault` now comes from DEPLOYMENTS via `stakingContracts(chainId)`,
   * alongside the token and the receipt. Removing the variable rather than
   * leaving it unread is deliberate: a second source for an address that is
   * already generated is the drift registry.ts's header warns about.
   */

  /**
   * No fallback, unlike every other address here once did.
   *
   * This used to be `process.env.NEXT_PUBLIC_MASTER_CHEF_ADDRESS ||
   * "0x6E5dA192512E58eb13dEF6815f4E46Ac58172eFE"` — an Abstract Testnet literal
   * from a deployment that no longer exists. A default made the variable
   * impossible to switch off: leaving it unset did not disable MasterChef, it
   * silently aimed every farm call at a codeless address on whatever chain the
   * wallet was on. The auditor (lib/ai/auditor.ts) also treated that literal as
   * one of "our" addresses, so a send to it would have been described to the user
   * as a send to the MasterChef contract.
   *
   * Undefined now, which getKaleidoMasterChefContract turns into "Missing
   * contract address for Kaleido MasterChef" at the call. MasterChef is still
   * undeployed: KLD exists and is deployed now, so the blocker is no longer the
   * token — nothing this wave deploys the farm.
   */
  masterChefAddress: process.env.NEXT_PUBLIC_MASTER_CHEF_ADDRESS,

  pythContractAddress: process.env.NEXT_PUBLIC_PYTH_ORACLE_ADDRESS,

  protocolAddress: process.env.NEXT_PUBLIC_PROTOCOL_ADDRESS,

  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,

  supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_KEY,

  twitterClientId: process.env.NEXT_PUBLIC_TWITTER_CLIENT_ID,

  twitterRedirectUri: process.env.NEXT_PUBLIC_TWITTER_REDIRECT_URI,

  // NOTE: no X/Twitter client secret here either, for the same reason as the
  // signing key above. This was `twitterApiKey:
  // process.env.NEXT_PUBLIC_TWITTER_KEY`, and the name undersold it: the only
  // thing that ever read it was the HTTP Basic header on X's token exchange
  // (src/app/api/auth/callback/route.ts), which makes it the OAuth *client
  // secret*, not an API key. NEXT_PUBLIC_ inlines it, so every browser that
  // loaded any page carrying envVars was served a credential that can mint
  // access tokens for the app's X client. It reads
  // process.env.TWITTER_CLIENT_SECRET at that route now.
  //
  // The client ID and redirect URI above are deliberately still public: neither
  // is a secret (both travel in the authorize URL in the clear).

  thirdwebClientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_KEY,

  /**
   * Where the private-testnet waitlist form lives.
   *
   * Public on purpose, and the one part of the access gate that is: this is a
   * URL handed to anyone who reaches the card without a code. The code itself is
   * `BETA_ACCESS_CODE`, server-only, read in src/app/api/beta/unlock/route.ts —
   * a NEXT_PUBLIC_ form of that would ship the code to every visitor and there
   * would be no gate.
   *
   * Unset means the gate renders without the link rather than with a broken one.
   */
  waitlistUrl: process.env.NEXT_PUBLIC_WAITLIST_URL,

  // contractAddress: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS,
};
