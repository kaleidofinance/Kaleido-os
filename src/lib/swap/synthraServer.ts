import {
  validateSynthraQuote,
  type SynthraValidatedQuote,
} from "./synthraQuote";
import { inspectSynthraSteps, type SynthraTransaction } from "./synthraSteps";
import { validateSynthraKyberCall } from "./synthraKyber";
import { verifySynthraPoolRoute } from "./synthraPoolSafety";
import { verifySynthraInternalCall } from "./synthraInternalCall";
import { exceedsQuoteLoss } from "./quoteSafety";
import { ethers } from "ethers";
import { providerForChain } from "@/config/provider";

if (typeof window !== "undefined") {
  throw new Error(
    "Synthra server client must not be imported into the browser.",
  );
}

/** Synthra's mainnet endpoint; credentials must never enter a browser bundle. */
const API = "https://ghost-trading-api.synthra.org";
const CHAINS = new Set([56, 4663, 5042, 99901]);
const ELYSIUM_FACTORY = "0x6307fc239C7964942c1BfFE51930E55606619c74";
const ELYSIUM_ROUTER = "0xa50eDe66a573eE5bB37E28AF5789B76aE5FEb828";
const ZERO = ethers.ZeroAddress.toLowerCase();
let chainCache: { expiresAt: number; ids: Set<number> } | undefined;

/** A configured chain is only eligible when this API host advertises it too. */
async function advertisedChains(): Promise<Set<number>> {
  if (chainCache && chainCache.expiresAt > Date.now()) return chainCache.ids;
  const response = await fetch(`${API}/v1/chains`, {
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok)
    throw new Error(`Synthra chain registry failed (HTTP ${response.status})`);
  const data: unknown = await response.json();
  const chains = (data as { chains?: unknown })?.chains;
  if (!Array.isArray(chains)) throw new Error("Invalid Synthra chain registry");
  const ids = new Set<number>(
    chains.map((chain) => chain?.chainId).filter(Number.isSafeInteger),
  );
  chainCache = { ids, expiresAt: Date.now() + 60_000 };
  return ids;
}

/** Ask Synthra which execution family won before accepting a low-TVL internal
 * route. The transaction endpoint alone does not prove that the internal pool
 * beat the external execution network. */
async function selectedInternalQuote(
  input: SynthraQuoteRequest,
  key: string,
): Promise<boolean> {
  const response = await fetch(`${API}/v1/swap/quote`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify({ ...input, tradeType: "EXACT_INPUT" }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) return false;
  const raw = await response.json();
  const selected = raw?.quote;
  return (
    raw?.state === "Success" &&
    (raw?.chosen === "internal" || raw?.chosen === "synthra-internal") &&
    (selected?.source === "internal" ||
      selected?.source === "synthra-internal") &&
    selected?.state === "Success" &&
    selected?.amountIn === input.amount &&
    /^\d+$/.test(selected?.amountOut ?? "") &&
    BigInt(selected.amountOut) > 0n
  );
}

export interface SynthraQuoteRequest {
  user: string;
  sourceChainId: number;
  destinationChainId: number;
  tokenIn: { address: string; decimals: number; symbol?: string };
  tokenOut: { address: string; decimals: number; symbol?: string };
  amount: string;
  slippageBps: number;
}

/** Research-only first slice. Returned calldata is untrusted and must not be
 * made signable until targets, amounts, expiry and simulation are audited. */
export async function requestSynthraQuote(
  input: SynthraQuoteRequest,
): Promise<SynthraValidatedQuote | null> {
  const key = process.env.SYNTHRA_API_KEY ?? process.env.SYNTRA_API_KEY;
  if (!key) throw new Error("Synthra API key is not configured");
  if (
    !CHAINS.has(input.sourceChainId) ||
    !CHAINS.has(input.destinationChainId)
  ) {
    throw new Error("Synthra chain is not enabled for Kaleido");
  }
  if (
    !/^0x[0-9a-fA-F]{40}$/.test(input.user) ||
    !/^\d+$/.test(input.amount) ||
    BigInt(input.amount) <= 0n ||
    !Number.isInteger(input.slippageBps) ||
    input.slippageBps < 0 ||
    input.slippageBps > 5000 ||
    ![input.tokenIn, input.tokenOut].every(
      (token) =>
        /^0x[0-9a-fA-F]{40}$/.test(token.address) &&
        Number.isInteger(token.decimals) &&
        token.decimals >= 0 &&
        token.decimals <= 36,
    )
  ) {
    throw new Error("Invalid Synthra quote request");
  }
  const advertised = await advertisedChains();
  if (
    !advertised.has(input.sourceChainId) ||
    !advertised.has(input.destinationChainId)
  ) {
    throw new Error("Synthra API host does not advertise the requested chain");
  }
  const response = await fetch(`${API}/v1/swap/quote`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify({ ...input, tradeType: "EXACT_INPUT" }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok)
    throw new Error(`Synthra quote failed (HTTP ${response.status})`);
  const raw: unknown = await response.json();
  return validateSynthraQuote(raw, input);
}

/** Same-chain transaction metadata for audit development, never a signable plan. */
export async function inspectSynthraSwap(input: SynthraQuoteRequest): Promise<{
  quote: SynthraValidatedQuote;
  transactions: SynthraTransaction[];
} | null> {
  if (input.sourceChainId !== input.destinationChainId) return null;
  const quote = await requestSynthraQuote(input);
  if (!quote) return null;
  const transactions = inspectSynthraSteps(
    quote.steps,
    input.user,
    input.sourceChainId,
  );
  return transactions ? { quote, transactions } : null;
}

/** Narrow initial eligibility check; multi-step and non-Kyber routes remain unavailable. */
export async function inspectSynthraKyberSwap(
  input: SynthraQuoteRequest,
): Promise<{
  quote: SynthraValidatedQuote;
  transaction: SynthraTransaction;
} | null> {
  const inspected = await inspectSynthraSwap(input);
  if (!inspected || inspected.transactions.length !== 1) return null;
  const transaction = inspected.transactions[0];
  if (
    !validateSynthraKyberCall(transaction, {
      wallet: input.user,
      chainId: input.sourceChainId,
      tokenIn: input.tokenIn.address,
      tokenOut: input.tokenOut.address,
      amountIn: input.amount,
      minimumAmountOut: inspected.quote.minimumAmountOut,
    })
  )
    return null;
  return { quote: inspected.quote, transaction };
}

/** Inspect one narrow native-HYPE internal route. This remains read-only;
 * it does not grant approval or create a signable plan. */
export async function inspectSynthraInternalHypeSwap(
  input: SynthraQuoteRequest,
): Promise<{
  to: string;
  data: string;
  value: string;
  amountOut: string;
  minimumOut: string;
} | null> {
  const key = process.env.SYNTHRA_API_KEY ?? process.env.SYNTRA_API_KEY;
  if (
    !key ||
    input.sourceChainId !== 99901 ||
    input.destinationChainId !== 99901 ||
    input.tokenIn.address.toLowerCase() !== ZERO ||
    input.tokenIn.decimals !== 18 ||
    !ethers.isAddress(input.user) ||
    !ethers.isAddress(input.tokenOut.address) ||
    input.tokenOut.address.toLowerCase() === ZERO ||
    !Number.isInteger(input.tokenOut.decimals) ||
    input.tokenOut.decimals < 0 ||
    input.tokenOut.decimals > 36 ||
    !/^\d+$/.test(input.amount) ||
    BigInt(input.amount) <= 0n ||
    !Number.isInteger(input.slippageBps) ||
    input.slippageBps < 0 ||
    input.slippageBps > 5000
  )
    return null;
  if (!(await advertisedChains()).has(99901)) return null;
  if (!(await selectedInternalQuote(input, key))) return null;
  const response = await fetch(`${API}/v1/swap`, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify({
      chainId: 99901,
      tokenIn: input.tokenIn.address,
      tokenOut: input.tokenOut.address,
      tokenInDecimals: input.tokenIn.decimals,
      tokenOutDecimals: input.tokenOut.decimals,
      amount: input.amount,
      tradeType: "EXACT_INPUT",
      sender: input.user,
      recipient: input.user,
      slippageBps: input.slippageBps,
      approvalMode: "erc20",
    }),
  });
  if (!response.ok) return null;
  const raw = await response.json();
  if (
    raw?.amountIn !== input.amount ||
    !/^\d+$/.test(raw?.amountOut ?? "") ||
    BigInt(raw.amountOut) <= 0n ||
    raw?.transaction?.chainId !== 99901 ||
    raw?.transaction?.to?.toLowerCase() !== ELYSIUM_ROUTER.toLowerCase() ||
    !/^0x(?:[0-9a-fA-F]{2})+$/.test(raw?.transaction?.data ?? "") ||
    !/^\d+$/.test(raw?.transaction?.value ?? "")
  )
    return null;
  const amountInUsd = raw.amountInUsd == null ? null : Number(raw.amountInUsd);
  const amountOutUsd =
    raw.amountOutUsd == null ? null : Number(raw.amountOutUsd);
  if ((amountInUsd === null) !== (amountOutUsd === null)) return null;
  if (
    amountInUsd !== null &&
    amountOutUsd !== null &&
    (!Number.isFinite(amountInUsd) ||
      !Number.isFinite(amountOutUsd) ||
      exceedsQuoteLoss(amountInUsd, amountOutUsd))
  )
    return null;
  const provider = providerForChain(99901);
  if (!provider) return null;
  const tokenOut = new ethers.Contract(
    input.tokenOut.address,
    ["function decimals() view returns(uint8)"],
    provider,
  );
  if (Number(await tokenOut.decimals()) !== input.tokenOut.decimals)
    return null;
  const factory = new ethers.Contract(
    ELYSIUM_FACTORY,
    ["function getPool(address,address,uint24) view returns(address)"],
    provider,
  );
  const legs = await verifySynthraPoolRoute(
    raw,
    99901,
    async (a, b, fee) => {
      const poolAddress: string = await factory.getPool(a, b, fee);
      if (
        poolAddress === ethers.ZeroAddress ||
        (await provider.getCode(poolAddress)) === "0x"
      )
        throw new Error("Pool is not deployed");
      const pool = new ethers.Contract(
        poolAddress,
        ["function liquidity() view returns (uint128)"],
        provider,
      );
      if (BigInt(await pool.liquidity()) <= 0n)
        throw new Error("Pool has no active liquidity");
      return poolAddress;
    },
    { allowLowTvl: true },
  );
  if (
    !legs ||
    raw.route?.[0]?.amountIn !== input.amount ||
    raw.route?.[0]?.amountOut !== raw.amountOut ||
    legs[0].tokenIn.address.toLowerCase() !==
      "0xba876237b0f021a6c6d852d6c26e107997cc5e81" ||
    legs[legs.length - 1].tokenOut.address.toLowerCase() !==
      input.tokenOut.address.toLowerCase()
  )
    return null;
  const minimumOut = (
    (BigInt(raw.amountOut) * BigInt(10_000 - input.slippageBps)) /
    10_000n
  ).toString();
  if (
    !verifySynthraInternalCall({
      chainId: 99901,
      to: raw.transaction.to,
      data: raw.transaction.data,
      value: raw.transaction.value,
      wallet: input.user,
      amountIn: input.amount,
      minimumOut,
      nativeInput: true,
      legs,
    })
  )
    return null;
  try {
    const simulated = await provider.call({
      from: input.user,
      to: raw.transaction.to,
      data: raw.transaction.data,
      value: BigInt(raw.transaction.value),
    });
    const [results] = new ethers.Interface([
      "function multicall(uint256 deadline,bytes[] data) payable returns(bytes[] results)",
    ]).decodeFunctionResult("multicall", simulated);
    if (!Array.isArray(results) || results.length !== 1) return null;
    const [simulatedOut] = new ethers.Interface([
      "function exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum) params) payable returns(uint256 amountOut)",
    ]).decodeFunctionResult("exactInput", results[0]);
    if (simulatedOut < BigInt(minimumOut)) return null;
  } catch {
    return null;
  }
  return {
    to: raw.transaction.to,
    data: raw.transaction.data,
    value: raw.transaction.value,
    amountOut: raw.amountOut,
    minimumOut,
  };
}
