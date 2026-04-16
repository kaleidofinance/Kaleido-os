export const envVars = {
  lendbitDiamondAddress: process.env.NEXT_PUBLIC_KALEIDO_DIAMOND_ADDRESS,

  httpRPC: process.env.NEXT_PUBLIC_HTTP_RPC,

  wssRPC: process.env.NEXT_PUBLIC_WEBSOCKET_RPC,

  httpRPCab: process.env.NEXT_PUBLIC_HTTP_RPC_AB,

  privateKey: process.env.NEXT_PUBLIC_PRIVATE_KEY,

  measurementId: process.env.NEXT_PUBLIC_MEASUREMENT_ID,

  faucetAddress: process.env.NEXT_PUBLIC_TOKENFAUCET_ADDRESS,

  vaultAddress: process.env.NEXT_PUBLIC_KLD_VAULT_ADDRESS,

  masterChefAddress: process.env.NEXT_PUBLIC_MASTER_CHEF_ADDRESS || "0x6E5dA192512E58eb13dEF6815f4E46Ac58172eFE",

  pythContractAddress: process.env.NEXT_PUBLIC_PYTH_ORACLE_ADDRESS,

  protocolAddress: process.env.NEXT_PUBLIC_PROTOCOL_ADDRESS,

  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,

  supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_KEY,

  twitterClientId: process.env.NEXT_PUBLIC_TWITTER_CLIENT_ID,

  twitterRedirectUri: process.env.NEXT_PUBLIC_TWITTER_REDIRECT_URI,

  twitterApiKey: process.env.NEXT_PUBLIC_TWITTER_KEY,

  thirdwebClientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_KEY,

  // contractAddress: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS,
}
