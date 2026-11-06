import { getAddress } from "ethers";
import { createPublicClient, defineChain, http, type Address } from "viem";
import { CHAINS_BY_ID } from "@/constants/chains";
import { PEACH_CHAIN_ID, PEACH_FACTORY, PEACH_QUOTE_TOKEN } from "@/lib/peach/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RPC = CHAINS_BY_ID[PEACH_CHAIN_ID]?.rpcUrls?.[0];

/**
 * Build a Peach bonding-curve transaction from the official SDK. This is kept
 * server-side because it performs the launch-token verification and the SDK's
 * pinned state read; the browser receives only the signable request.
 */
export async function POST(req: Request) {
  let body: { tokenIn?: string; tokenOut?: string; amountInRaw?: string; slippageBps?: number; userAddress?: string };
  try { body = await req.json(); } catch { return Response.json({ error: "bad body" }, { status: 400 }); }
  const { tokenIn, tokenOut, amountInRaw, userAddress } = body;
  if (!tokenIn || !tokenOut || !amountInRaw || !userAddress)
    return Response.json({ error: "tokenIn, tokenOut, amountInRaw and userAddress are required" }, { status: 400 });
  if (!RPC) return Response.json({ error: "Arc RPC unavailable" }, { status: 503 });
  let account: Address;
  try { account = getAddress(userAddress) as Address; } catch { return Response.json({ error: "invalid wallet address" }, { status: 400 }); }

  try {
    const sdk = await import("@masterpeach/launchpad-sdk");
    const chain = sdk.defineLaunchpadChain({
      slug: "arc-mainnet",
      chainId: PEACH_CHAIN_ID,
      family: "evm",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: [RPC],
      explorerUrl: CHAINS_BY_ID[PEACH_CHAIN_ID]?.blockExplorer.url ?? "https://arcscan.app",
      deployment: sdk.arcMainnetLaunchpadDeployment,
      quoteTokens: sdk.arcMainnetLaunchpadDeployment.economics.quoteTokens,
      capabilities: { create: false, bondingTrade: true, partnerAttribution: false },
      confirmations: 2,
    });
    const publicClient = createPublicClient({
      chain: defineChain({ id: PEACH_CHAIN_ID, name: "Arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } }),
      transport: http(RPC),
    });
    const client = sdk.createLaunchpadFactoryClient({ publicClient, chain });
    const inAddr = getAddress(tokenIn) as Address;
    const outAddr = getAddress(tokenOut) as Address;
    const quote = getAddress(PEACH_QUOTE_TOKEN).toLowerCase();
    const inIsQuote = inAddr.toLowerCase() === quote;
    const outIsQuote = outAddr.toLowerCase() === quote;
    if (inIsQuote === outIsQuote) return Response.json({ peach: false, reason: "one side must be Arc USDC" });
    const token = (inIsQuote ? outAddr : inAddr) as Address;
    if (!(await client.isLaunchToken(token))) return Response.json({ peach: false, reason: "not a Peach launch token" });
    const state = await client.getTokenState(token);
    const curve = state.record.curve;
    const amount = BigInt(amountInRaw);
    if (amount <= 0n) return Response.json({ error: "amountInRaw must be positive" }, { status: 400 });
    const slip = Math.max(1, Math.min(Number(body.slippageBps ?? 200), 5000));
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    const prepared = inIsQuote
      ? await client.prepareBuy({ token, quoteInRaw: amount, slippage: { bps: slip }, deadline, tokenRecipient: account })
      : await client.prepareSell({ token, tokenIn: amount, slippage: { bps: slip }, deadline, quoteRecipient: account });
    const request = prepared.request as { to?: string; data?: string; value?: bigint | string };
    if (!request.to || !request.data) return Response.json({ error: "Peach returned no executable request" }, { status: 502 });
    const preview = prepared.preview as { tokenOut?: bigint; quoteSpent?: bigint; quoteOut?: bigint; minTokenOut?: bigint; minQuoteOut?: bigint };
    return Response.json({
      peach: true,
      side: inIsQuote ? "buy" : "sell",
      to: request.to,
      data: request.data,
      value: String(request.value ?? "0"),
      spender: curve,
      curve,
      quoteToken: PEACH_QUOTE_TOKEN,
      quoteDecimals: 6,
      amountOut: String(preview.tokenOut ?? preview.quoteOut ?? 0n),
      amountOutMinimum: String(preview.minTokenOut ?? preview.minQuoteOut ?? 0n),
      ...(inIsQuote ? { tokenOut: { address: token } } : { tokenIn: { address: token } }),
    });
  } catch {
    return Response.json({ peach: false, reason: "Peach launch read or quote failed" });
  }
}
