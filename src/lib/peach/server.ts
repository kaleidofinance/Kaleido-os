import { getAddress } from "ethers";
import { createPublicClient, defineChain, http, type Address } from "viem";
import { CHAINS_BY_ID } from "@/constants/chains";
import { PEACH_CHAIN_ID, PEACH_QUOTE_TOKEN } from "./route";

export interface PeachTradeExecution {
  to: string; data: string; value: string; spender: string; amountOut: string;
}

const RPC = CHAINS_BY_ID[PEACH_CHAIN_ID]?.rpcUrls?.[0];

/** Server-only Peach resolver used by the planner and the browser proxy. */
export async function resolvePeachTrade(args: {
  tokenIn: string; tokenOut: string; amountUnits: string; address: string; slippageBps: number;
}): Promise<PeachTradeExecution | null> {
  if (!RPC || args.tokenIn.toLowerCase() === args.tokenOut.toLowerCase()) return null;
  try {
    const sdk = await import("@masterpeach/launchpad-sdk");
    const deployment = sdk.arcMainnetLaunchpadDeployment;
    const chain = sdk.defineLaunchpadChain({
      slug: "arc-mainnet", chainId: PEACH_CHAIN_ID, family: "evm",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: [RPC],
      explorerUrl: CHAINS_BY_ID[PEACH_CHAIN_ID]?.blockExplorer.url ?? "https://arcscan.app",
      deployment, quoteTokens: deployment.economics.quoteTokens,
      capabilities: { create: false, bondingTrade: true, partnerAttribution: false }, confirmations: 2,
    });
    const publicClient = createPublicClient({
      chain: defineChain({ id: PEACH_CHAIN_ID, name: "Arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } }),
      transport: http(RPC),
    });
    const client = sdk.createLaunchpadFactoryClient({ publicClient, chain });
    const tokenIn = getAddress(args.tokenIn) as Address;
    const tokenOut = getAddress(args.tokenOut) as Address;
    const quote = getAddress(PEACH_QUOTE_TOKEN).toLowerCase();
    const inIsQuote = tokenIn.toLowerCase() === quote;
    const outIsQuote = tokenOut.toLowerCase() === quote;
    if (inIsQuote === outIsQuote) return null;
    const token = (inIsQuote ? tokenOut : tokenIn) as Address;
    if (!(await client.isLaunchToken(token))) return null;
    const state = await client.getTokenState(token);
    const curve = state.record.curve;
    const amount = BigInt(args.amountUnits);
    if (amount <= 0n) return null;
    const prepared = inIsQuote
      ? await client.prepareBuy({ token, quoteInRaw: amount, slippage: { bps: Math.max(1, Math.min(args.slippageBps, 5000)) }, deadline: BigInt(Math.floor(Date.now() / 1000) + 300), tokenRecipient: getAddress(args.address) as Address })
      : await client.prepareSell({ token, tokenIn: amount, slippage: { bps: Math.max(1, Math.min(args.slippageBps, 5000)) }, deadline: BigInt(Math.floor(Date.now() / 1000) + 300), quoteRecipient: getAddress(args.address) as Address });
    const request = prepared.request as { to?: string; data?: string; value?: bigint | string };
    if (!request.to || !request.data) return null;
    const preview = prepared.preview as { tokenOut?: bigint; quoteOut?: bigint };
    return { to: request.to, data: request.data, value: String(request.value ?? "0"), spender: curve, amountOut: String(preview.tokenOut ?? preview.quoteOut ?? 0n) };
  } catch { return null; }
}
