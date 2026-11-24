import { ethers } from "ethers";

/**
 * LayerZero's Zero L1 mainnet constants (verified via metadata.layerzero-api.com
 * and on-chain `peers(33002)` on the canonical $ZRO OFT contract).
 */
export const ZERO_CHAIN_ID = 33002;
export const ZERO_DST_EID = 33002;
export const ZERO_LAUNCH_DATE = "Nov 30";
export const ZERO_FEE_BPS = 25; // 0.25%

/** Canonical $ZRO LayerZero V2 OFT contract (same address across all 7 EVM chains). */
export const ZRO_OFT_ADDRESS = "0x6985884C4392D348587B19cb9eAAf157F13271cd";

/** Verified peer address on Zero (dstEid 33002) returned by `peers(33002)`. */
export const ZERO_OFT_PEER =
  "0x0000000000000000000000001ced7d571059a30db0fc9adc40346d2a1ce55b31";

/**
 * Public Zero RPC URL. Null until LayerZero publishes the public mainnet RPC on
 * Nov 30. Setting `NEXT_PUBLIC_ZERO_RPC_URL` automatically unlocks the
 * "Add Zero to Wallet" button and clears the pre-RPC one-way notice.
 */
export const ZERO_PUBLIC_RPC: string | null =
  process.env.NEXT_PUBLIC_ZERO_RPC_URL?.trim() || null;

export interface ZeroSourceChain {
  key: "ethereum" | "base" | "arbitrum" | "bsc" | "optimism" | "polygon" | "avalanche";
  chainId: number;
  name: string;
  shortName: string;
  nativeSymbol: string;
  explorerUrl: string;
  rpcUrls: string[];
  /** Suggested native deposit (in ether units) when enrolling in Auto-Bridge Queue. */
  defaultQueueDeposit: string;
  /** Suggested max LayerZero messaging nativeFee cap (in ether units). */
  defaultMaxNativeFee: string;
  /** Common tokens for 1-click "Any Token -> ZRO -> Zero" swap + bridge. */
  popularTokens: {
    symbol: string;
    name: string;
    address: string;
    decimals: number;
    isNative?: boolean;
  }[];
}

const NATIVE_ZERO = "0x0000000000000000000000000000000000000000";

export const ZERO_SOURCE_CHAINS: ZeroSourceChain[] = [
  {
    key: "base",
    chainId: 8453,
    name: "Base",
    shortName: "Base",
    nativeSymbol: "ETH",
    explorerUrl: "https://basescan.org",
    rpcUrls: [
      "https://mainnet.base.org",
      "https://base-rpc.publicnode.com",
      "https://base.drpc.org",
    ],
    defaultQueueDeposit: "0.0025",
    defaultMaxNativeFee: "0.0015",
    popularTokens: [
      { symbol: "ZRO", name: "LayerZero", address: ZRO_OFT_ADDRESS, decimals: 18 },
      { symbol: "ETH", name: "Ether", address: NATIVE_ZERO, decimals: 18, isNative: true },
      { symbol: "USDC", name: "USD Coin", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    ],
  },
  {
    key: "arbitrum",
    chainId: 42161,
    name: "Arbitrum One",
    shortName: "Arbitrum",
    nativeSymbol: "ETH",
    explorerUrl: "https://arbiscan.io",
    rpcUrls: [
      "https://arb1.arbitrum.io/rpc",
      "https://arbitrum-one-rpc.publicnode.com",
      "https://arbitrum.drpc.org",
    ],
    defaultQueueDeposit: "0.0025",
    defaultMaxNativeFee: "0.0015",
    popularTokens: [
      { symbol: "ZRO", name: "LayerZero", address: ZRO_OFT_ADDRESS, decimals: 18 },
      { symbol: "ETH", name: "Ether", address: NATIVE_ZERO, decimals: 18, isNative: true },
      { symbol: "USDC", name: "USD Coin", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
      { symbol: "USDT", name: "Tether", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
    ],
  },
  {
    key: "ethereum",
    chainId: 1,
    name: "Ethereum",
    shortName: "Ethereum",
    nativeSymbol: "ETH",
    explorerUrl: "https://etherscan.io",
    rpcUrls: [
      "https://ethereum-rpc.publicnode.com",
      "https://eth.llamarpc.com",
      "https://eth.drpc.org",
    ],
    defaultQueueDeposit: "0.008",
    defaultMaxNativeFee: "0.004",
    popularTokens: [
      { symbol: "ZRO", name: "LayerZero", address: ZRO_OFT_ADDRESS, decimals: 18 },
      { symbol: "ETH", name: "Ether", address: NATIVE_ZERO, decimals: 18, isNative: true },
      { symbol: "USDC", name: "USD Coin", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
      { symbol: "USDT", name: "Tether", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
    ],
  },
  {
    key: "bsc",
    chainId: 56,
    name: "BNB Chain",
    shortName: "BNB",
    nativeSymbol: "BNB",
    explorerUrl: "https://bscscan.com",
    rpcUrls: [
      "https://bsc-rpc.publicnode.com",
      "https://bsc-dataseed.binance.org",
      "https://bsc.drpc.org",
    ],
    defaultQueueDeposit: "0.01",
    defaultMaxNativeFee: "0.006",
    popularTokens: [
      { symbol: "ZRO", name: "LayerZero", address: ZRO_OFT_ADDRESS, decimals: 18 },
      { symbol: "BNB", name: "BNB", address: NATIVE_ZERO, decimals: 18, isNative: true },
      { symbol: "USDT", name: "Tether", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
      { symbol: "USDC", name: "USD Coin", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
    ],
  },
  {
    key: "optimism",
    chainId: 10,
    name: "Optimism",
    shortName: "Optimism",
    nativeSymbol: "ETH",
    explorerUrl: "https://optimistic.etherscan.io",
    rpcUrls: [
      "https://mainnet.optimism.io",
      "https://optimism-rpc.publicnode.com",
    ],
    defaultQueueDeposit: "0.0025",
    defaultMaxNativeFee: "0.0015",
    popularTokens: [
      { symbol: "ZRO", name: "LayerZero", address: ZRO_OFT_ADDRESS, decimals: 18 },
      { symbol: "ETH", name: "Ether", address: NATIVE_ZERO, decimals: 18, isNative: true },
      { symbol: "USDC", name: "USD Coin", address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6 },
    ],
  },
  {
    key: "polygon",
    chainId: 137,
    name: "Polygon",
    shortName: "Polygon",
    nativeSymbol: "POL",
    explorerUrl: "https://polygonscan.com",
    rpcUrls: [
      "https://polygon-bor-rpc.publicnode.com",
      "https://polygon-rpc.com",
    ],
    defaultQueueDeposit: "8",
    defaultMaxNativeFee: "5",
    popularTokens: [
      { symbol: "ZRO", name: "LayerZero", address: ZRO_OFT_ADDRESS, decimals: 18 },
      { symbol: "POL", name: "POL", address: NATIVE_ZERO, decimals: 18, isNative: true },
      { symbol: "USDC", name: "USD Coin", address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 },
    ],
  },
  {
    key: "avalanche",
    chainId: 43114,
    name: "Avalanche",
    shortName: "Avalanche",
    nativeSymbol: "AVAX",
    explorerUrl: "https://snowtrace.io",
    rpcUrls: [
      "https://avalanche-c-chain-rpc.publicnode.com",
      "https://api.avax.network/ext/bc/C/rpc",
    ],
    defaultQueueDeposit: "0.15",
    defaultMaxNativeFee: "0.1",
    popularTokens: [
      { symbol: "ZRO", name: "LayerZero", address: ZRO_OFT_ADDRESS, decimals: 18 },
      { symbol: "AVAX", name: "AVAX", address: NATIVE_ZERO, decimals: 18, isNative: true },
      { symbol: "USDC", name: "USD Coin", address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", decimals: 6 },
    ],
  },
];

export const ZERO_SOURCE_BY_ID: Record<number, ZeroSourceChain> = Object.fromEntries(
  ZERO_SOURCE_CHAINS.map((c) => [c.chainId, c]),
);

/**
 * Per-chain deployed ownerless ZeroAutoBridge contract addresses.
 * Base, Arbitrum, and BNB are live on mainnet (2026-11-24); env vars can
 * override or add additional chains without a code edit.
 */
const DEFAULT_ZERO_AUTOBRIDGE: Record<number, string> = {
  8453: "0x4b8F2CC0272250Fb8c219a85c10a0FDe71F4b382",
  42161: "0xd27eB978D2a018F5E23FA2D2CA4a70122A3a669C",
  56: "0x36EB9A3D87f9cEd18cBcfBF35836762f840149C9",
};

export function getZeroAutoBridgeAddress(chainId: number): string | null {
  const envMap: Record<number, string | undefined> = {
    1: process.env.NEXT_PUBLIC_ZERO_AUTOBRIDGE_ETHEREUM,
    8453: process.env.NEXT_PUBLIC_ZERO_AUTOBRIDGE_BASE,
    42161: process.env.NEXT_PUBLIC_ZERO_AUTOBRIDGE_ARBITRUM,
    56: process.env.NEXT_PUBLIC_ZERO_AUTOBRIDGE_BSC,
    10: process.env.NEXT_PUBLIC_ZERO_AUTOBRIDGE_OPTIMISM,
    137: process.env.NEXT_PUBLIC_ZERO_AUTOBRIDGE_POLYGON,
    43114: process.env.NEXT_PUBLIC_ZERO_AUTOBRIDGE_AVALANCHE,
  };
  const raw = (envMap[chainId] || DEFAULT_ZERO_AUTOBRIDGE[chainId])?.trim();
  if (!raw || !ethers.isAddress(raw) || raw === ethers.ZeroAddress) return null;
  return raw;
}

export const ZRO_OFT_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function peers(uint32 eid) view returns (bytes32)",
  "function quoteSend((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam, bool payInLzToken) view returns ((uint256 nativeFee, uint256 lzTokenFee) msgFee)",
  "function send((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam, (uint256 nativeFee, uint256 lzTokenFee) fee, address refundAddress) payable returns ((bytes32 guid, uint64 nonce, (uint256 nativeFee, uint256 lzTokenFee) fee) msgReceipt, (uint256 amountSentLD, uint256 amountReceivedLD) oftReceipt)",
] as const;

export const ZERO_AUTOBRIDGE_ABI = [
  "function zro() view returns (address)",
  "function dstEid() view returns (uint32)",
  "function feeBps() view returns (uint16)",
  "function queueLength() view returns (uint256)",
  "function isEnrolled(address user) view returns (bool)",
  "function refunds(address user) view returns (uint256)",
  "function orders(address user) view returns (uint256 amount, uint128 deposit, uint128 maxNativeFee, uint64 maxGasPrice, uint40 validUntil, uint32 queuePos)",
  "function quoteBridge(address user, uint256 grossAmount) view returns (uint256 nativeFee, uint256 netAmount, uint256 feeAmount)",
  "function bridgeDirect(uint256 amount) payable",
  "function enroll(uint256 amount, uint128 maxNativeFee, uint64 maxGasPrice, uint40 validUntil) payable",
  "function cancel()",
  "function withdrawRefund()",
] as const;

export function buildZeroSendParam(recipient: string, amountLD: bigint) {
  const minAmountLD = (amountLD * 995n) / 1000n;
  return {
    dstEid: ZERO_DST_EID,
    to: ethers.zeroPadValue(recipient, 32),
    amountLD,
    minAmountLD,
    extraOptions: "0x",
    composeMsg: "0x",
    oftCmd: "0x",
  };
}
