/**
 * Tower Exchange Regional Stablecoin Registry on Arc (5042).
 *
 * Tower aggregates regional and international stablecoins against Circle StableFX
 * and native Arc DEX pools (Argus, Peach, Synthra).
 */

export interface RegionalStablecoin {
  symbol: string;
  name: string;
  fiatCurrency: string;
  region: string;
  decimals: number;
  address: string;
  chainId: number;
  logoURI?: string;
}

export const ARC_REGIONAL_STABLECOINS: readonly RegionalStablecoin[] = [
  {
    symbol: "USDC",
    name: "USD Coin",
    fiatCurrency: "USD",
    region: "Global",
    decimals: 6,
    address: "0x3600000000000000000000000000000000000000",
    chainId: 5042,
    logoURI: "/tokens/usdc.svg",
  },
  {
    symbol: "EURC",
    name: "Euro Coin",
    fiatCurrency: "EUR",
    region: "Europe",
    decimals: 6,
    address: "0x89B50855Aa8D8B6DDD16616428c05E989e27c02b",
    chainId: 5042,
    logoURI: "/tokens/eurc.svg",
  },
  {
    symbol: "MXNB",
    name: "Mexican Peso Coin",
    fiatCurrency: "MXN",
    region: "Latin America (Mexico)",
    decimals: 18,
    address: "0xb794f5ea0ba39494ce839613fffba74279579268",
    chainId: 5042,
    logoURI: "/tokens/mxnb.svg",
  },
  {
    symbol: "BRLA",
    name: "BRLA Digital Real",
    fiatCurrency: "BRL",
    region: "Latin America (Brazil)",
    decimals: 18,
    address: "0xe6a8027786efb605a2b168ffb36873b88b4383a8",
    chainId: 5042,
    logoURI: "/tokens/brla.svg",
  },
  {
    symbol: "cNGN",
    name: "Compliant Nigerian Naira",
    fiatCurrency: "NGN",
    region: "Africa (Nigeria)",
    decimals: 18,
    address: "0x25a4d46cf4de96839a9c97b21ec4686411fc4b95",
    chainId: 5042,
    logoURI: "/tokens/cngn.svg",
  },
  {
    symbol: "ZAR",
    name: "South African Rand Stablecoin",
    fiatCurrency: "ZAR",
    region: "Africa (South Africa)",
    decimals: 18,
    address: "0x98b8c2d5f0e9f6041a7d1883be783d7890b2014d",
    chainId: 5042,
    logoURI: "/tokens/zar.svg",
  },
];

export function isRegionalStablecoin(address: string, chainId: number): boolean {
  if (chainId !== 5042 && chainId !== 5042002) return false;
  const target = address.toLowerCase();
  return ARC_REGIONAL_STABLECOINS.some(
    (coin) => coin.address.toLowerCase() === target,
  );
}

export function getRegionalStablecoinBySymbol(
  symbol: string,
): RegionalStablecoin | undefined {
  const upper = symbol.toUpperCase();
  return ARC_REGIONAL_STABLECOINS.find((coin) => coin.symbol === upper);
}
