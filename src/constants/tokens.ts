import { IToken } from "./types/dex";

export const ABSTRACT_MAINNET_CHAIN_ID = 11124;

export const ABSTRACT_TOKENS: IToken[] = [
  {
    address: "0x0c61dbCF1e8DdFF0E237a256257260fDF6934505",
    name: "Kaleido",
    symbol: "KLD",
    decimals: 18,
    chainId: 11124,
    logoURI: "/klogo.png",
    verified: true,
    tags: ["native"],
  },
  {
    address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    name: "Ethereum",
    symbol: "ETH",
    decimals: 18,
    chainId: 11124,
    logoURI: "/eth.svg", // Standard ETH logo
    verified: true,
    tags: ["native"],
    isNative: true,
    priceUrl: "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true",
  },
  {
    address: "0x572f4901f03055ffC1D936a60Ccc3CbF13911BE3",
    name: "USD Coin",
    symbol: "USDC",
    decimals: 6,
    chainId: 11124,
    logoURI: "/USDC.svg",
    verified: true,
    tags: ["stablecoin"],
    priceUrl: "https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=usd&include_24hr_change=true",
  },
  {
    address: "0x769EBD1dc2470186f0a4911113754DfD13f2CDA3",
    name: "USD Reserve",
    symbol: "USDR",
    decimals: 18,
    chainId: 11124,
    logoURI: "/drakov4.png", // From Collateral dashboard
    verified: true,
    tags: ["stablecoin"],
    priceUrl: "https://api.coingecko.com/api/v3/simple/price?ids=real-usd&vs_currencies=usd&include_24hr_change=true",
  },
  {
    address: "0x618B1561b189972482168fd31f5B5a3B5A10Ce33",
    name: "Wrapped Ether",
    symbol: "WETH",
    decimals: 18,
    chainId: 11124,
    logoURI: "/eth.svg",
    verified: true,
    tags: ["wrapped"],
    priceUrl: "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true",
  },
  {
    address: "0x717A36E56b33585Bd00260422FfCc3270af34D3E",
    name: "Tether USD",
    symbol: "USDT",
    decimals: 6,
    chainId: 11124,
    logoURI: "/usdt.svg",
    verified: true,
    tags: ["stablecoin"],
    priceUrl: "https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=usd&include_24hr_change=true",
  },
  {
    address: "0x2F7744E8fcc75F8F26Ea455968556591091cb46F",
    name: "Ethena USD",
    symbol: "USDe",
    decimals: 18,
    chainId: 11124,
    logoURI: "/stable/USDe.jpeg",
    verified: true,
    tags: ["stablecoin"],
    priceUrl: "https://api.coingecko.com/api/v3/simple/price?ids=ethena-usde&vs_currencies=usd&include_24hr_change=true",
  },
  {
    address: "0x913f3354942366809A05e89D288cCE60d87d7348",
    name: "Kaleido USD",
    symbol: "kfUSD",
    decimals: 18,
    chainId: 11124,
    logoURI: "/stable/kfUSD.png",
    verified: true,
    tags: ["stablecoin"],
  },
];

// Filter out placeholder tokens (addresses starting with 0x000...)
// Only show tokens with real deployed addresses
export const ACTIVE_TOKENS = ABSTRACT_TOKENS.filter(token => {
  // Keep tokens that don't have placeholder addresses
  // Placeholder addresses are 0x0000000000000000000000000000000000000000 through 0x000000000000000000000000000000000000000e
  const address = token.address.toLowerCase();
  return !address.match(/^0x0{39}[0-9a-f]$/);
});

// Helper function to search tokens
export const searchTokens = (query: string): IToken[] => {
  const searchTerm = query.toLowerCase();
  return ACTIVE_TOKENS.filter(token => 
    token.name.toLowerCase().includes(searchTerm) ||
    token.symbol.toLowerCase().includes(searchTerm) ||
    token.address.toLowerCase().includes(searchTerm)
  );
};
