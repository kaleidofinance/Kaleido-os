import { getAddress, Interface, ZeroHash } from "ethers";
import {
  createPublicClient,
  defineChain,
  http,
  type Address,
  type WalletClient,
} from "viem";
import { CHAINS_BY_ID } from "@/constants/chains";
import {
  PEACH_CHAIN_ID,
  PEACH_FACTORY,
  PEACH_QUOTE_TOKEN,
} from "@/lib/peach/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RPC = CHAINS_BY_ID[PEACH_CHAIN_ID]?.rpcUrls?.[0];

/**
 * Build a Peach bonding-curve transaction from the official SDK. This is kept
 * server-side because it performs the launch-token verification and the SDK's
 * pinned state read; the browser receives only the signable request.
 */
export async function POST(req: Request) {
  let body: {
    tokenIn?: string;
    tokenOut?: string;
    amountInRaw?: string;
    slippageBps?: number;
    userAddress?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad body" }, { status: 400 });
  }
  const { tokenIn, tokenOut, amountInRaw, userAddress } = body;
  if (!tokenIn || !tokenOut || !amountInRaw || !userAddress)
    return Response.json(
      { error: "tokenIn, tokenOut, amountInRaw and userAddress are required" },
      { status: 400 },
    );
  if (!RPC)
    return Response.json({ error: "Arc RPC unavailable" }, { status: 503 });
  let account: Address;
  try {
    account = getAddress(userAddress) as Address;
  } catch {
    return Response.json({ error: "invalid wallet address" }, { status: 400 });
  }

  try {
    const sdk = await import("@masterpeach/launchpad-sdk");
    const chain = sdk.defineLaunchpadChain({
      slug: "arc-mainnet",
      chainId: PEACH_CHAIN_ID,
      family: "evm",
      nativeCurrency: { symbol: "USDC", decimals: 18 },
      rpcUrls: [RPC],
      explorerUrl:
        CHAINS_BY_ID[PEACH_CHAIN_ID]?.blockExplorer.url ??
        "https://arcscan.app",
      apiBaseUrl: "https://api.peach.ag",
      realtimeUrl: "wss://api.peach.ag",
      deployment: sdk.arcMainnetLaunchpadDeployment,
      quoteTokens: sdk.arcMainnetLaunchpadDeployment.economics.quoteTokens,
      capabilities: {
        create: false,
        bondingTrade: true,
        partnerAttribution: false,
      },
      confirmations: 2,
    });
    const viemChain = defineChain({
      id: PEACH_CHAIN_ID,
      name: "Arc",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: { default: { http: [RPC] } },
    });
    const publicClient = createPublicClient({
      chain: viemChain,
      transport: http(RPC),
    });
    /* The SDK requires a wallet client to prepare write calldata, but this is
       only an address-backed context: no private key is present or used here.
       The connected wallet signs the returned request in the browser. */
    const walletClient = {
      account: { address: account, type: "json-rpc" as const },
      getChainId: async () => PEACH_CHAIN_ID,
      getAddresses: async () => [account],
    } as unknown as WalletClient;
    const writeContext = {
      publicClient,
      walletClient,
      deployment: sdk.arcMainnetLaunchpadDeployment,
    };
    const inAddr = getAddress(tokenIn) as Address;
    const outAddr = getAddress(tokenOut) as Address;
    const quote = getAddress(PEACH_QUOTE_TOKEN).toLowerCase();
    const inIsQuote = inAddr.toLowerCase() === quote;
    const outIsQuote = outAddr.toLowerCase() === quote;
    if (inIsQuote === outIsQuote)
      return Response.json({
        peach: false,
        reason: "one side must be Arc USDC",
      });
    const token = (inIsQuote ? outAddr : inAddr) as Address;
    if (
      !(await sdk.isLaunchpadToken(
        { publicClient, deployment: sdk.arcMainnetLaunchpadDeployment },
        token,
      ))
    )
      return Response.json({
        peach: false,
        reason: "not a Peach launch token",
      });
    const amount = BigInt(amountInRaw);
    if (amount <= 0n)
      return Response.json(
        { error: "amountInRaw must be positive" },
        { status: 400 },
      );
    const slip = Math.max(1, Math.min(Number(body.slippageBps ?? 200), 5000));
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    let to: string;
    let data: string;
    let amountOut: bigint;
    let amountOutMinimum: bigint;
    if (inIsQuote) {
      const q = await sdk.quoteLaunchpadBuy(writeContext, {
        token,
        quoteInRaw: amount,
        tokenRecipient: account,
      });
      amountOut = q.tokenOut;
      amountOutMinimum = sdk.applySlippageToMinimumOut(q.tokenOut, {
        bps: slip,
      });
      to = q.target.curve;
      data = new Interface([
        "function buyExactIn(uint256,address,uint256,uint256,bytes32)",
      ]).encodeFunctionData("buyExactIn", [
        amount,
        account,
        amountOutMinimum,
        deadline,
        ZeroHash,
      ]);
    } else {
      const q = await sdk.quoteLaunchpadSell(writeContext, {
        token,
        tokenIn: amount,
      });
      amountOut = q.netQuoteOut;
      amountOutMinimum = sdk.applySlippageToMinimumOut(q.netQuoteOut, {
        bps: slip,
      });
      to = q.target.curve;
      data = new Interface([
        "function sellExactIn(uint256,address,uint256,uint256,bytes32)",
      ]).encodeFunctionData("sellExactIn", [
        amount,
        account,
        amountOutMinimum,
        deadline,
        ZeroHash,
      ]);
    }
    return Response.json({
      peach: true,
      side: inIsQuote ? "buy" : "sell",
      to,
      data,
      value: "0",
      spender: to,
      curve: to,
      quoteToken: PEACH_QUOTE_TOKEN,
      quoteDecimals: 6,
      amountOut: String(amountOut),
      amountOutMinimum: String(amountOutMinimum),
      ...(inIsQuote
        ? { tokenOut: { address: token } }
        : { tokenIn: { address: token } }),
    });
  } catch {
    return Response.json({
      peach: false,
      reason: "Peach launch read or quote failed",
    });
  }
}
