/**
 * Cross-chain bridge quotes via Relay and LI.FI.
 *
 * Ported from the legacy chatbot's bridgeService, which is being retired. The
 * API integration was worth keeping; several of its behaviours were not, and
 * are corrected here:
 *
 *   - it reported `estimatedFee: "0.00"` and `estimatedTime: "Sub-3s"` for
 *     every Relay quote as literals, never reading the response
 *   - it fell back to a fabricated `"1.50"` fee when LI.FI omitted one
 *   - it scaled every amount by 1e6, so bridging 1 ETH asked for 1,000,000 wei
 *   - it mapped "abstract" to 11124, the testnet, and silently defaulted
 *     unknown chain names to Base → Abstract rather than failing
 *
 * Quoting only. Kaleido does not execute the bridge, so no transaction is
 * built or returned — the user is pointed at the provider. Making this an
 * EXECUTE tool would need a resolver and a much harder look at approvals.
 */

import { CHAINS, type ChainMeta } from "@/constants/chains";

const RELAY_API = "https://api.relay.link";
const LIFI_API = "https://li.quest/v1";

/** Decimals for the assets we quote. Bridging is stablecoin-and-ETH shaped. */
const DECIMALS: Record<string, number> = {
  ETH: 18,
  WETH: 18,
  USDC: 6,
  USDT: 6,
  // 6, per USDR's own decimals() — see BORROW_CURRENCIES in constants/registry.ts.
  USDR: 6,
  kfUSD: 18,
  BNB: 18,
};

export interface BridgeQuote {
  provider: "RELAY" | "LIFI";
  fromChain: string;
  toChain: string;
  fromChainId: number;
  toChainId: number;
  asset: string;
  amount: string;
  /** USD fee if the provider reported one. Null means unknown — never guessed. */
  feeUsd: number | null;
  /** Seconds, if reported. Null means unknown. */
  etaSeconds: number | null;
  note: string;
}

/** Resolve a chain by name, shortName or id, against the real registry. */
function resolveChain(input: string | number): ChainMeta | undefined {
  if (typeof input === "number") return CHAINS.find((c) => c.id === input);
  const q = String(input).trim().toLowerCase();
  if (/^\d+$/.test(q)) return CHAINS.find((c) => c.id === Number(q));
  return CHAINS.find(
    (c) => c.name.toLowerCase() === q || c.shortName.toLowerCase() === q,
  );
}

/** Smallest-unit amount for an asset, using its real decimals. */
function toBaseUnits(amount: string, asset: string): string | null {
  const decimals = DECIMALS[asset.toUpperCase()] ?? DECIMALS[asset];
  if (decimals === undefined) return null;
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  // String concatenation rather than BigInt exponentiation, which the repo's
  // ES5 target rejects. Padding the fraction to `decimals` and appending it to
  // the whole part is exact for 18-decimal amounts where floats are not.
  const [whole, frac = ""] = String(n).split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole + padded).toString();
}

async function relayQuote(
  from: ChainMeta,
  to: ChainMeta,
  asset: string,
  amount: string,
  units: string,
  user: string,
): Promise<BridgeQuote | null> {
  const res = await fetch(`${RELAY_API}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user,
      originChainId: from.id,
      destinationChainId: to.id,
      originCurrency: asset,
      destinationCurrency: asset,
      amount: units,
      tradeType: "EXACT_INPUT",
    }),
  });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    fees?: { relayer?: { amountUsd?: string } };
    details?: { timeEstimate?: number };
  };

  const feeRaw = data.fees?.relayer?.amountUsd;
  const eta = data.details?.timeEstimate;

  return {
    provider: "RELAY",
    fromChain: from.name,
    toChain: to.name,
    fromChainId: from.id,
    toChainId: to.id,
    asset,
    amount,
    feeUsd:
      feeRaw !== undefined && Number.isFinite(Number(feeRaw))
        ? Number(feeRaw)
        : null,
    etaSeconds: typeof eta === "number" ? eta : null,
    note: "Quote from Relay. Kaleido does not execute the bridge — the user completes it with the provider.",
  };
}

async function lifiQuote(
  from: ChainMeta,
  to: ChainMeta,
  asset: string,
  amount: string,
  units: string,
  user: string,
): Promise<BridgeQuote | null> {
  const qs = new URLSearchParams({
    fromChain: String(from.id),
    toChain: String(to.id),
    fromToken: asset,
    toToken: asset,
    fromAmount: units,
    fromAddress: user,
  });
  const res = await fetch(`${LIFI_API}/quote?${qs}`);
  if (!res.ok) return null;

  const data = (await res.json()) as {
    estimate?: {
      feeCosts?: Array<{ amountUSD?: string }>;
      executionDuration?: number;
    };
  };

  const fee = data.estimate?.feeCosts?.reduce(
    (sum, f) => sum + (Number(f.amountUSD) || 0),
    0,
  );
  const dur = data.estimate?.executionDuration;

  return {
    provider: "LIFI",
    fromChain: from.name,
    toChain: to.name,
    fromChainId: from.id,
    toChainId: to.id,
    asset,
    amount,
    feeUsd: fee !== undefined && fee > 0 ? fee : null,
    etaSeconds: typeof dur === "number" ? dur : null,
    note: "Quote from LI.FI. Kaleido does not execute the bridge — the user completes it with the provider.",
  };
}

/**
 * Best available bridge quote. Relay is tried first (it routes Abstract well),
 * LI.FI second as the broader aggregator. Returns an error object rather than
 * throwing so one dead provider degrades the answer instead of the turn.
 */
export async function getBridgeQuote(args: {
  fromChain: string | number;
  toChain: string | number;
  asset: string;
  amount: string;
  address?: string;
}): Promise<BridgeQuote | { error: string }> {
  const from = resolveChain(args.fromChain);
  const to = resolveChain(args.toChain);

  if (!from) return { error: `Unknown source chain: ${args.fromChain}` };
  if (!to) return { error: `Unknown destination chain: ${args.toChain}` };
  if (from.id === to.id)
    return { error: "Source and destination are the same chain" };

  const asset = args.asset.trim().toUpperCase();
  const units = toBaseUnits(args.amount, asset);
  if (units === null) {
    return {
      error: `Cannot quote ${args.asset}: unknown decimals or invalid amount. Supported: ${Object.keys(DECIMALS).join(", ")}`,
    };
  }

  const user = args.address ?? "0x0000000000000000000000000000000000000000";

  try {
    const relay = await relayQuote(from, to, asset, args.amount, units, user);
    if (relay) return relay;
  } catch {
    // fall through to LI.FI
  }

  try {
    const lifi = await lifiQuote(from, to, asset, args.amount, units, user);
    if (lifi) return lifi;
  } catch {
    // fall through to the error below
  }

  return {
    error: `No route found for ${args.amount} ${asset} from ${from.name} to ${to.name}. Say so plainly rather than estimating a cost.`,
  };
}
