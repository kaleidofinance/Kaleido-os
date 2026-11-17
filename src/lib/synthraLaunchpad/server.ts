import { Contract, Interface, getAddress, isAddress, parseUnits } from "ethers";
import { providerForChain } from "@/config/provider";
import { NATIVE_SENTINEL } from "@/constants/registry";

export const SYNTHRA_LAUNCHPAD_CHAINS = [4663, 5042] as const;
export type SynthraLaunchpadChainId = (typeof SYNTHRA_LAUNCHPAD_CHAINS)[number];

const API = "https://api-mainnet.synthra.org/api/v1/launchpad";
const LENS_ABI = [
  "function quoteBuy(address token,uint256 usdcIn) view returns (uint256 tokensOut,uint256 fee,uint256 refund)",
  "function quoteSell(address token,uint256 tokensIn) view returns (uint256 usdcOut,uint256 fee)",
  "function progressBps(address token) view returns (uint256)",
  "function marketCap(address token) view returns (uint256)",
];
const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
];

export interface SynthraLaunchpadChainConfig {
  chainId: number;
  launchPad: string;
  launchPadLens: string;
  quoteToken: string;
  quoteSymbol: string;
  quoteDecimals: number;
  nativeScale: string;
  quoteAssets?: Array<{
    address: string;
    symbol: string;
    decimals: number;
    isWrappedNative?: boolean;
  }>;
  enabled?: boolean;
}

export interface SynthraLaunchpadToken {
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  launchpadId: "synthra";
  launchpadLabel: "Synthra launch";
  status?: string;
  progressBps?: number;
  priceUsd?: number | null;
  marketCapUsd?: number | null;
  imageUrl?: string;
  metadataURI?: string;
  quoteToken: string;
  quoteDecimals: number;
  launchPad: string;
  active: boolean;
}

export interface SynthraLaunchpadTradeExecution {
  to: string;
  data: string;
  value: string;
  spender: string;
  amountOut: string;
  minimumOut: string;
  nativeIn: boolean;
  nativeOut: boolean;
  gasLimit?: string;
}

let configCache: {
  expiresAt: number;
  chains: Map<number, SynthraLaunchpadChainConfig>;
} | null = null;

async function getConfig(
  chainId: number,
): Promise<SynthraLaunchpadChainConfig | null> {
  if (configCache && configCache.expiresAt > Date.now())
    return configCache.chains.get(chainId) ?? null;
  const response = await fetch(`${API}/config`, { cache: "no-store" });
  if (!response.ok) return null;
  const body = (await response.json()) as {
    data?: { chains?: SynthraLaunchpadChainConfig[] };
  };
  const chains = new Map<number, SynthraLaunchpadChainConfig>();
  for (const raw of body.data?.chains ?? []) {
    if (
      Number.isInteger(raw.chainId) &&
      raw.launchPad &&
      raw.launchPadLens &&
      raw.quoteToken
    ) {
      chains.set(raw.chainId, raw);
    }
  }
  configCache = { expiresAt: Date.now() + 60_000, chains };
  return chains.get(chainId) ?? null;
}

async function readLive(
  chainId: number,
  token: string,
): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${API}/live/${chainId}/${token}`, {
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Synthra live feed unavailable");
  const body = (await response.json()) as { data?: Record<string, unknown> };
  return body.data ?? null;
}

function numeric(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function nativeQuote(
  config: SynthraLaunchpadChainConfig,
  address: string,
): boolean {
  if (address.toLowerCase() === NATIVE_SENTINEL.dex.toLowerCase()) return true;
  if (address.toLowerCase() === config.quoteToken.toLowerCase()) {
    const asset = config.quoteAssets?.find(
      (a) => a.address.toLowerCase() === config.quoteToken.toLowerCase(),
    );
    return (
      Boolean(asset?.isWrappedNative) ||
      Boolean(config.nativeScale && config.nativeScale !== "0")
    );
  }
  return false;
}

function quoteSide(
  config: SynthraLaunchpadChainConfig,
  address: string,
): boolean {
  return (
    address.toLowerCase() === config.quoteToken.toLowerCase() ||
    nativeQuote(config, address)
  );
}

export async function readSynthraLaunchpadToken(
  address: string,
  chainId: number,
): Promise<SynthraLaunchpadToken | null> {
  if (
    !SYNTHRA_LAUNCHPAD_CHAINS.includes(chainId as SynthraLaunchpadChainId) ||
    !isAddress(address)
  )
    return null;
  const config = await getConfig(chainId);
  if (!config || config.enabled === false) return null;
  const checksummed = getAddress(address);
  const live = await readLive(chainId, checksummed);
  if (!live) return null;
  const provider = providerForChain(chainId);
  if (!provider) return null;
  const token = new Contract(checksummed, ERC20_ABI, provider);
  const [symbol, name, decimals] = await Promise.all([
    token.symbol().then(String),
    token.name().then(String),
    token.decimals().then(Number),
  ]);
  const metadataURI =
    typeof live.metadataURI === "string" ? live.metadataURI : undefined;
  let imageUrl: string | undefined;
  if (metadataURI) {
    try {
      const metaRes = await fetch(
        `${API}/metadata/${encodeURIComponent(metadataURI)}`,
        { cache: "no-store" },
      );
      if (metaRes.ok) {
        const meta = (await metaRes.json()) as {
          data?: {
            image?: { full?: string; thumb?: string };
            name?: string;
            symbol?: string;
          };
        };
        imageUrl = meta.data?.image?.thumb ?? meta.data?.image?.full;
      }
    } catch {
      /* identity remains usable without metadata */
    }
  }
  const progressBps = numeric(live.progressBps) ?? undefined;
  const status = typeof live.status === "string" ? live.status : undefined;
  const active =
    progressBps == null
      ? status?.toUpperCase() === "LIVE"
      : progressBps < 10_000;
  return {
    chainId,
    address: checksummed,
    symbol,
    name,
    decimals,
    launchpadId: "synthra",
    launchpadLabel: "Synthra launch",
    ...(status ? { status } : {}),
    ...(progressBps != null ? { progressBps } : {}),
    ...(numeric(live.price) != null
      ? { priceUsd: numeric(live.price) }
      : { priceUsd: null }),
    ...(numeric(live.marketCapUsdc) != null
      ? { marketCapUsd: numeric(live.marketCapUsdc) }
      : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(metadataURI ? { metadataURI } : {}),
    quoteToken: config.quoteToken,
    quoteDecimals: config.quoteDecimals,
    launchPad: config.launchPad,
    active,
  };
}

/** Build a direct wallet-signed LaunchPad buy/sell. No API key or server wallet is used. */
export async function resolveSynthraLaunchpadTrade(args: {
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  amountUnits: string;
  address: string;
  slippageBps: number;
}): Promise<SynthraLaunchpadTradeExecution | null> {
  if (
    !SYNTHRA_LAUNCHPAD_CHAINS.includes(args.chainId as SynthraLaunchpadChainId)
  )
    return null;
  const valid = (value: string) =>
    value.toLowerCase() === NATIVE_SENTINEL.dex.toLowerCase() ||
    Boolean(isAddress(value));
  if (!isAddress(args.address) || !valid(args.tokenIn) || !valid(args.tokenOut))
    return null;
  const config = await getConfig(args.chainId);
  const provider = providerForChain(args.chainId);
  if (!config || !provider) return null;
  const inIsQuote = quoteSide(config, args.tokenIn);
  const outIsQuote = quoteSide(config, args.tokenOut);
  if (inIsQuote === outIsQuote) return null;
  const launchToken = getAddress(inIsQuote ? args.tokenOut : args.tokenIn);
  const launch = await readSynthraLaunchpadToken(launchToken, args.chainId);
  if (!launch || !launch.active) return null;
  const amount = BigInt(args.amountUnits);
  if (amount <= 0n) return null;
  const slip = Math.max(1, Math.min(5000, Math.floor(args.slippageBps)));
  const lens = new Contract(config.launchPadLens, LENS_ABI, provider);
  const launchPad = new Interface([
    "function buy(address token,uint256 usdcIn,uint256 minTokensOut,uint256 deadline)",
    "function sell(address token,uint256 tokensIn,uint256 minUsdcOut,uint256 deadline,bool nativeOut)",
  ]);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  const scale = BigInt(config.nativeScale || "1");
  if (inIsQuote) {
    const quoted = await lens.quoteBuy(launchToken, amount);
    const amountOut = BigInt(quoted[0] ?? quoted.tokensOut ?? 0);
    if (amountOut <= 0n) return null;
    const minimumOut = (amountOut * BigInt(10_000 - slip)) / 10_000n;
    const value = nativeQuote(config, args.tokenIn) ? amount * scale : 0n;
    const live = await readLive(args.chainId, launchToken);
    let realReserve = 0n;
    try {
      realReserve = parseUnits(
        String(live?.realTokenReserves ?? "0"),
        launch.decimals,
      );
    } catch {
      /* if the snapshot is malformed, omit the optional gas floor */
    }
    return {
      to: config.launchPad,
      data: launchPad.encodeFunctionData("buy", [
        launchToken,
        amount,
        minimumOut,
        deadline,
      ]),
      value: value.toString(),
      spender: config.launchPad,
      amountOut: amountOut.toString(),
      minimumOut: minimumOut.toString(),
      nativeIn: value > 0n,
      nativeOut: false,
      ...(realReserve > 0n && amountOut >= realReserve
        ? { gasLimit: "1500000" }
        : {}),
    };
  }
  const quoted = await lens.quoteSell(launchToken, amount);
  const amountOut = BigInt(quoted[0] ?? quoted.usdcOut ?? 0);
  if (amountOut <= 0n) return null;
  const minimumOut = (amountOut * BigInt(10_000 - slip)) / 10_000n;
  return {
    to: config.launchPad,
    data: launchPad.encodeFunctionData("sell", [
      launchToken,
      amount,
      minimumOut,
      deadline,
      nativeQuote(config, args.tokenOut),
    ]),
    value: "0",
    spender: config.launchPad,
    amountOut: amountOut.toString(),
    minimumOut: minimumOut.toString(),
    nativeIn: false,
    nativeOut: nativeQuote(config, args.tokenOut),
  };
}

export async function isSynthraLaunchpadAddress(
  chainId: number | undefined,
  address: string,
): Promise<boolean> {
  if (chainId == null) return false;
  const config = await getConfig(chainId);
  return Boolean(
    config?.launchPad &&
      config.launchPad.toLowerCase() === address.toLowerCase(),
  );
}
