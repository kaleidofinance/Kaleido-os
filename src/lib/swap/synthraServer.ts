import {
  validateSynthraQuote,
  type SynthraValidatedQuote,
} from "./synthraQuote";
import { inspectSynthraSteps, type SynthraTransaction } from "./synthraSteps";
import { validateSynthraKyberCall } from "./synthraKyber";
import { verifySynthraPoolRoute } from "./synthraPoolSafety";
import { verifySynthraInternalCall } from "./synthraInternalCall";
import {
  isSynthraExecutor,
  isSynthraInternalRouter,
  synthraInternalFactoriesFor,
} from "./synthraDeployments";
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
/* 999 is HyperEVM, the execution-side corridor used when Synthra settles
 * Elysium HYPE cross-chain. It is not an internal Synthra V3 deployment, but
 * it is a valid external execution network in the quote API. */
const CHAINS = new Set([56, 999, 4663, 5042, 99901]);
const ELYSIUM_CHAIN_ID = 99901;
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

/** Read the provider's durable execution status without exposing the API key
 * to the browser. The request id is returned in Synthra's external execution
 * quote and is intentionally treated as opaque. */
export async function requestSynthraSwapStatus(
  requestId: string,
): Promise<unknown> {
  const key = process.env.SYNTHRA_API_KEY ?? process.env.SYNTRA_API_KEY;
  if (!key || !/^[A-Za-z0-9._:-]{8,256}$/.test(requestId)) return null;
  const response = await fetch(
    `${API}/v1/swap/status?requestId=${encodeURIComponent(requestId)}`,
    {
      headers: { "x-api-key": key },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok) return null;
  return response.json();
}

/** Read-only SynRoute integrator earnings. Payouts stay dashboard/server
 * actions; exposing a balance read here lets analytics report Synthra volume
 * without ever putting the project key in the browser. */
export async function requestSynthraIntegratorStats(
  days?: number,
): Promise<unknown> {
  const key = process.env.SYNTHRA_API_KEY ?? process.env.SYNTRA_API_KEY;
  if (!key) return null;
  const windowDays = days;
  if (
    windowDays != null &&
    (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 3650)
  )
    return null;
  const query = windowDays == null ? "" : `?days=${windowDays}`;
  const response = await fetch(`${API}/v1/integrator/stats${query}`, {
    headers: { "x-api-key": key },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return null;
  return response.json();
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

/**
 * Validate the first executable shape for Synthra's external network.
 *
 * The external quote is deliberately not folded into the ordinary aggregator
 * intent yet: it may be a cross-chain deposit whose destination settles later.
 * This boundary admits one source-chain deposit transaction and keeps the
 * execution request id beside it for durable status tracking. An ERC-20 deposit
 * carries zero native value; the bridge builder adds the matching approval.
 * Quotes with multiple source transactions remain refused rather than being
 * flattened into a partial bridge row.
 */
export async function inspectSynthraExternalSwap(
  input: SynthraQuoteRequest,
): Promise<{
  quote: SynthraValidatedQuote;
  transaction: SynthraTransaction;
  spender?: string;
  executionRequestId: string;
} | null> {
  if (input.sourceChainId === input.destinationChainId) return null;
  /* inspectSynthraSwap is intentionally same-chain-only. External execution
     uses the same quote and step-shape checks, but must inspect the provider's
     cross-chain deposit transaction directly. */
  const quote = await requestSynthraQuote(input);
  const transactions = quote
    ? inspectSynthraSteps(quote.steps, input.user, input.sourceChainId)
    : null;
  if (
    !quote ||
    !transactions ||
    transactions.length !== 1 ||
    !quote.executionRequestId
  )
    return null;
  const transaction = transactions[0];
  if (transaction.chainId !== input.sourceChainId) return null;
  const nativeInput = input.tokenIn.address.toLowerCase() === ZERO;
  if (nativeInput && BigInt(transaction.value) !== BigInt(input.amount))
    return null;
  if (!nativeInput && BigInt(transaction.value) !== 0n) return null;
  return {
    quote,
    transaction,
    ...(nativeInput ? {} : { spender: transaction.to }),
    executionRequestId: quote.executionRequestId,
  };
}

/** Narrow internal-route check for a same-chain Synthra router call. */
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

/**
 * Inspect Synthra's documented Elysium launchpad/third-party execution path.
 *
 * Synthra labels this route `external` because it is outside Synthra's own V3
 * pools, even though it is same-chain and returns one direct transaction to
 * the fixed SynthraExecutor.  It is deliberately separate from the generic
 * cross-chain deposit adapter: the executor is a documented, chain-scoped
 * contract and the quote binds the wallet, recipient, raw amount, minimum
 * output and expiry.  No configurable spender list is consulted here.
 */
async function inspectSynthraElysiumExecutorSwap(
  input: SynthraQuoteRequest,
): Promise<{
  to: string;
  data: string;
  value: string;
  amountOut: string;
  minimumOut: string;
} | null> {
  if (input.sourceChainId !== ELYSIUM_CHAIN_ID) return null;
  const quote = await requestSynthraQuote(input);
  if (!quote || quote.chosen !== "external") return null;
  const quotedTransactions = inspectSynthraSteps(
    quote.steps,
    input.user,
    ELYSIUM_CHAIN_ID,
  );
  if (
    !quotedTransactions ||
    quotedTransactions.length !== 1 ||
    !isSynthraExecutor(ELYSIUM_CHAIN_ID, quotedTransactions[0].to)
  )
    return null;
  const quotedTransaction = quotedTransactions[0];
  const response = await fetch(`${API}/v1/swap`, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
    headers: {
      "content-type": "application/json",
      "x-api-key":
        process.env.SYNTHRA_API_KEY ?? process.env.SYNTRA_API_KEY ?? "",
    },
    body: JSON.stringify({
      chainId: input.sourceChainId,
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
  const transaction = raw?.transaction;
  if (
    raw?.amountIn !== input.amount ||
    !/^\d+$/.test(raw?.amountOut ?? "") ||
    BigInt(raw.amountOut) <= 0n ||
    BigInt(raw.amountOut) < BigInt(quote.minimumAmountOut) ||
    transaction?.chainId !== ELYSIUM_CHAIN_ID ||
    !isSynthraExecutor(ELYSIUM_CHAIN_ID, transaction?.to ?? "") ||
    (transaction?.to ?? "").toLowerCase() !==
      quotedTransaction.to.toLowerCase() ||
    (transaction?.data ?? "").toLowerCase() !==
      quotedTransaction.data.toLowerCase() ||
    transaction?.value !== quotedTransaction.value ||
    !/^0x(?:[0-9a-fA-F]{2})+$/.test(transaction?.data ?? "") ||
    !/^\d+$/.test(transaction?.value ?? "")
  )
    return null;
  if (
    transaction.from &&
    transaction.from.toLowerCase() !== input.user.toLowerCase()
  )
    return null;
  if (
    raw?.recipient &&
    raw.recipient.toLowerCase() !== input.user.toLowerCase()
  )
    return null;
  const nativeInput = input.tokenIn.address.toLowerCase() === ZERO;
  if (nativeInput && BigInt(transaction.value) !== BigInt(input.amount))
    return null;
  if (!nativeInput && BigInt(transaction.value) !== 0n) return null;
  return {
    to: transaction.to,
    data: transaction.data,
    value: transaction.value,
    amountOut: raw.amountOut,
    minimumOut: quote.minimumAmountOut,
  };
}

/** Inspect a same-chain internal Synthra route on Arc, Robinhood Chain, or
 * Elysium. This remains read-only; it does not grant approval or create a
 * signable plan. */
export async function inspectSynthraInternalSwap(
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
    input.sourceChainId !== input.destinationChainId ||
    !synthraInternalFactoriesFor(input.sourceChainId).length ||
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
  if (!(await advertisedChains()).has(input.sourceChainId)) return null;
  const executor = await inspectSynthraElysiumExecutorSwap(input);
  if (executor) return executor;
  // Arc's native balance is USDC gas accounting, not a wrapped-native swap
  // input. Require the ERC-20 face there; native HYPE/ETH remains supported on
  // Elysium and Robinhood through Synthra's zero-address input.
  const nativeInput = input.tokenIn.address.toLowerCase() === ZERO;
  if (nativeInput && input.sourceChainId === 5042) return null;
  if (!(await selectedInternalQuote(input, key))) return null;
  const response = await fetch(`${API}/v1/swap`, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify({
      chainId: input.sourceChainId,
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
    raw?.transaction?.chainId !== input.sourceChainId ||
    !isSynthraInternalRouter(input.sourceChainId, raw?.transaction?.to ?? "") ||
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
  const provider = providerForChain(input.sourceChainId);
  if (!provider) return null;
  const tokenOut = new ethers.Contract(
    input.tokenOut.address,
    ["function decimals() view returns(uint8)"],
    provider,
  );
  if (Number(await tokenOut.decimals()) !== input.tokenOut.decimals)
    return null;
  const legs = await verifySynthraPoolRoute(
    { ...raw, chainId: raw?.chainId ?? input.sourceChainId },
    input.sourceChainId,
    async (a, b, fee) => {
      for (const factoryAddress of synthraInternalFactoriesFor(
        input.sourceChainId,
      )) {
        try {
          const factory = new ethers.Contract(
            factoryAddress,
            ["function getPool(address,address,uint24) view returns(address)"],
            provider,
          );
          const poolAddress: string = await factory.getPool(a, b, fee);
          if (
            poolAddress === ethers.ZeroAddress ||
            (await provider.getCode(poolAddress)) === "0x"
          )
            continue;
          const pool = new ethers.Contract(
            poolAddress,
            ["function liquidity() view returns (uint128)"],
            provider,
          );
          if (BigInt(await pool.liquidity()) > 0n) return poolAddress;
        } catch {
          // Try the next documented factory generation.
        }
      }
      throw new Error("Pool is not deployed or has no active liquidity");
    },
    { allowLowTvl: true },
  );
  if (
    !legs ||
    raw.route?.[0]?.amountIn !== input.amount ||
    raw.route?.[0]?.amountOut !== raw.amountOut ||
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
      chainId: input.sourceChainId,
      to: raw.transaction.to,
      data: raw.transaction.data,
      value: raw.transaction.value,
      wallet: input.user,
      amountIn: input.amount,
      minimumOut,
      nativeInput,
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
    const simulationInterface = new ethers.Interface([
      "function multicall(uint256 deadline,bytes[] data) payable returns(bytes[] results)",
      "function exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum) params) payable returns(uint256 amountOut)",
    ]);
    const parsed = simulationInterface.parseTransaction({
      data: raw.transaction.data,
    });
    let encodedOutput = simulated;
    if (parsed?.name === "multicall") {
      const [results] = simulationInterface.decodeFunctionResult(
        "multicall",
        simulated,
      );
      if (!Array.isArray(results) || results.length !== 1) return null;
      encodedOutput = results[0];
    } else if (parsed?.name !== "exactInput") {
      return null;
    }
    const [simulatedOut] = simulationInterface.decodeFunctionResult(
      "exactInput",
      encodedOutput,
    );
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

/** Backwards-compatible name for callers and tests that still describe the
 * original Elysium-only slice. */
export const inspectSynthraInternalHypeSwap = inspectSynthraInternalSwap;
