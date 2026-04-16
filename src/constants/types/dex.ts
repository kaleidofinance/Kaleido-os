export interface IToken {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  chainId?: number;
  logoURI?: string;
  verified: boolean;
  tags?: string[];
  isNative?: boolean;
  priceUrl?: string;
}

export interface ITokenBalance {
  token: IToken;
  balance: string;
  balanceFormatted: string;
  usdValue: number;
}

export interface ITokenPrice {
  address: string;
  price: number; // USD
  priceChange24h: number;
  volume24h: number;
  marketCap?: number;
  lastUpdated: number;
}

export interface ITradingPair {
  address: string;
  token0: IToken;
  token1: IToken;
  reserves: {
    reserve0: string | number;
    reserve1: string | number;
  };
  price: number;
  totalSupply: number;
  volume24h: number;
  volumeChange24h: number;
  liquidity: number;
  liquidityChange24h: number;
  fees24h: number;
  apr: number;
  stable: boolean;
  createdAt: number;
}

export type Address = `0x${string}`;
export type BigNumber = any; // Using any for now to avoid ethers dependency
export type ChainId = 11124 | 2741;
export type Wei = any;
export type TransactionHash = string;

export type TokenTag =
  | "native"
  | "stablecoin"
  | "wrapped"
  | "oracle"
  | "dex"
  | "governance"
  | "layer2"
  | "defi"
  | "synthetic";

export interface ILiquidityPosition {
  pairAddress: Address;
  pair: ITradingPair;
  lpTokenBalance: BigNumber;
  lpTokenBalanceFormatted: string;
  shareOfPool: number; // percentage (0-100)
  token0Amount: BigNumber;
  token1Amount: BigNumber;
  token0AmountFormatted: string;
  token1AmountFormatted: string;
  totalValue: number; // USD
  unclaimedFees: number; // USD
}

export interface ITransaction {
  hash: string;
  type: "swap" | "add_liquidity" | "remove_liquidity";
  status: "pending" | "confirmed" | "failed";
  timestamp: number;
  tokens: IToken[];
  amounts: string[];
  usdValue: number;
  gasUsed?: BigNumber;
  gasPrice?: BigNumber;
}

export interface IPoolStat {
  title: string;
  amount: string;
  token0?: {
    amount: string;
    symbol?: string;
  };
  token1?: {
    amount: string;
    symbol?: string;
  };
  change24h?: number;
}
