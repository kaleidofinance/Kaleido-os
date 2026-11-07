import { getAddress, Interface, ZeroHash } from "ethers";
import {
  createPublicClient,
  defineChain,
  http,
  type Address,
  type WalletClient,
} from "viem";
import { CHAINS_BY_ID } from "@/constants/chains";
import { PEACH_CHAIN_ID, PEACH_QUOTE_TOKEN } from "./route";

export interface PeachTradeExecution {
  to: string;
  data: string;
  value: string;
  spender: string;
  amountOut: string;
}

const RPC = CHAINS_BY_ID[PEACH_CHAIN_ID]?.rpcUrls?.[0];

/** Server-only Peach resolver used by the planner and the browser proxy. */
export async function resolvePeachTrade(args: {
  tokenIn: string;
  tokenOut: string;
  amountUnits: string;
  address: string;
  slippageBps: number;
}): Promise<PeachTradeExecution | null> {
  if (!RPC || args.tokenIn.toLowerCase() === args.tokenOut.toLowerCase())
    return null;
  try {
    const sdk = await import("@masterpeach/launchpad-sdk");
    const deployment = sdk.arcMainnetLaunchpadDeployment;
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
      deployment,
      quoteTokens: deployment.economics.quoteTokens,
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
    /* Peach's prepareBuy/prepareSell helpers encode a write through the SDK's
       wallet-client context even though they do not sign. Supplying the user's
       address as a non-signing wallet client lets the server build the exact
       transaction card without ever holding a private key. */
    const account = getAddress(args.address) as Address;
    const walletClient = {
      account: { address: account, type: "json-rpc" as const },
      getChainId: async () => PEACH_CHAIN_ID,
      getAddresses: async () => [account],
    } as unknown as WalletClient;
    const writeContext = { publicClient, walletClient, deployment };
    const tokenIn = getAddress(args.tokenIn) as Address;
    const tokenOut = getAddress(args.tokenOut) as Address;
    const quote = getAddress(PEACH_QUOTE_TOKEN).toLowerCase();
    const inIsQuote = tokenIn.toLowerCase() === quote;
    const outIsQuote = tokenOut.toLowerCase() === quote;
    if (inIsQuote === outIsQuote) return null;
    const token = (inIsQuote ? tokenOut : tokenIn) as Address;
    const isLaunchToken = await sdk.isLaunchpadToken(
      { publicClient, deployment },
      token,
    );
    if (!isLaunchToken) return null;
    const amount = BigInt(args.amountUnits);
    if (amount <= 0n) return null;
    const recipient = getAddress(args.address) as Address;
    const slip = Math.max(1, Math.min(args.slippageBps, 5000));
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    if (inIsQuote) {
      const q = await sdk.quoteLaunchpadBuy(writeContext, {
        token,
        quoteInRaw: amount,
        tokenRecipient: recipient,
      });
      const minOut = sdk.applySlippageToMinimumOut(q.tokenOut, { bps: slip });
      const data = new Interface([
        "function buyExactIn(uint256,address,uint256,uint256,bytes32)",
      ]).encodeFunctionData("buyExactIn", [
        amount,
        recipient,
        minOut,
        deadline,
        ZeroHash,
      ]);
      return {
        to: q.target.curve,
        data,
        value: "0",
        spender: q.target.curve,
        amountOut: String(q.tokenOut),
      };
    }
    const q = await sdk.quoteLaunchpadSell(writeContext, {
      token,
      tokenIn: amount,
    });
    const minOut = sdk.applySlippageToMinimumOut(q.netQuoteOut, { bps: slip });
    const data = new Interface([
      "function sellExactIn(uint256,address,uint256,uint256,bytes32)",
    ]).encodeFunctionData("sellExactIn", [
      amount,
      recipient,
      minOut,
      deadline,
      ZeroHash,
    ]);
    return {
      to: q.target.curve,
      data,
      value: "0",
      spender: q.target.curve,
      amountOut: String(q.netQuoteOut),
    };
  } catch {
    return null;
  }
}
