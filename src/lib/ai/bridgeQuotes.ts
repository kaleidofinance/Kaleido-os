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
 * Two callers, two depths. `getBridgeQuote` is quote-only — it answers "what
 * would this cost" for the read tool and points the user at the provider, and
 * that framing still holds for it. `getBridgeExecution`, added below, is the
 * aggregator half of the execute path: it pulls a provider's OWN executable
 * calldata out of a quote so the resolver in lib/bridge/route.ts can hand it to
 * the wallet. It builds no transaction of its own — it extracts a real one or
 * returns null.
 *
 * ERC20 as well as native, since the approve pin that used to block a token leg
 * has learned about bridge routers — `isKnownBridgeSpender` in lib/bridge/route.ts
 * is the one address it learned, and the resolver cross-checks four separate
 * things the provider says before an approve can carry it. What stays native-only
 * is the CANONICAL portal, for a reason about OP's token pairing rather than about
 * approvals; the header of route.ts has it.
 */

import { CHAINS, type ChainMeta } from "@/constants/chains";
import {
  lifiMonetizationParams,
  lifiAuthHeaders,
} from "@/lib/bridge/lifiServer";

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

/* Common names people use that the registry stores differently, keyed by the
   lower-cased alias → chain id. The registry's own name/shortName are matched
   first, so these only fill genuine gaps: Binance calls chain 56 "BNB Chain"
   while the registry (and BscScan) call it "BNB Smart Chain" / "BSC", and it is
   the label the app's own network switcher shows. No testnet aliases — a testnet
   must be named explicitly so it can never be reached by a mainnet shorthand. */
const CHAIN_ALIASES: Record<string, number> = {
  bnb: 56,
  "bnb chain": 56,
  binance: 56,
  "binance smart chain": 56,
  eth: 1,
  ether: 1,
};

/** Resolve a chain by name, shortName, id or common alias, against the registry. */
export function resolveChain(input: string | number): ChainMeta | undefined {
  if (typeof input === "number") return CHAINS.find((c) => c.id === input);
  const q = String(input).trim().toLowerCase();
  if (/^\d+$/.test(q)) return CHAINS.find((c) => c.id === Number(q));

  const match = (s: string) =>
    CHAINS.find(
      (c) => c.name.toLowerCase() === s || c.shortName.toLowerCase() === s,
    );
  const byId = (id: number | undefined) =>
    id === undefined ? undefined : CHAINS.find((c) => c.id === id);

  /* People say "Arc chain" and "BNB network" as often as the bare name, and the
     registry stores neither suffix. So try the input as given, then again with a
     trailing generic word removed — but only the truly generic ones:
     "mainnet"/"testnet" are NOT stripped, because "Arc testnet" and "Arc" are
     different chains and dropping the word would resolve a testnet request to the
     mainnet. Aliases are consulted last, on both spellings. */
  const stripped = q.replace(/\s+(chain|network)$/, "").trim();
  return (
    match(q) ??
    match(stripped) ??
    byId(CHAIN_ALIASES[q]) ??
    byId(CHAIN_ALIASES[stripped])
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

/**
 * The executable transaction for a bridge, from LI.FI's quote.
 *
 * Where getBridgeQuote answers "what would this cost" for the read tool, this
 * answers "what do I sign" for the resolver in lib/bridge/route.ts. It is the
 * aggregator half of that resolver; the canonical-portal half needs no provider
 * at all, being a fixed contract call route.ts encodes itself.
 *
 * LI.FI only. Its /quote returns a `transactionRequest` with the exact
 * { to, data, value } to send — the same response object `lifiQuote` above
 * already reads its fee and duration from — so this extracts a real transaction
 * or returns null; it assembles nothing. Relay stays quote-only here: its
 * executable step sits nested under steps[].items[] in a shape not worth
 * guessing at while no mainnet deployment exercises it.
 *
 * Native AND ERC20, which is what the extra fields are for. Everything past
 * { to, data, value } is reported so the resolver can cross-check the provider
 * rather than trust it — read the four checks there for what each one stops.
 * Two measurements shaped this:
 *
 *  - `estimate.approvalAddress` is the LI.FI diamond, and equals
 *    `transactionRequest.to`, on every corridor sampled (1→10, 1→137, 137→1,
 *    42161→8453) across four different underlying bridges. The resolver pins
 *    both facts rather than assuming either.
 *  - It is ALSO present on a native quote, where nothing needs approving. So it
 *    is not a signal that an approve is required — `isNative` decides that, and
 *    this field only says which address to name if one is.
 *
 * `action.fromToken` is LI.FI's own resolution of the SYMBOL we sent, on its own
 * token list for that chain, which is a different resolution from ours and can
 * legitimately disagree. It is reported for exactly that reason.
 *
 * Returns null on a dead provider, a testnet the aggregators do not index
 * (measured: all five testnets return 4xx), a symbol its list does not carry on
 * one side of the corridor (measured: `USDT` on 42161 is a 404, code 1003), or a
 * response carrying no usable transactionRequest. The resolver turns null into
 * an honest refusal rather than a fabricated route — the units are pre-scaled by
 * the caller, because route.ts has already parsed the amount at the asset's real
 * decimals.
 */
export async function getBridgeExecution(args: {
  fromChainId: number;
  toChainId: number;
  asset: string;
  /** Smallest-unit amount, already scaled by the caller. */
  units: string;
  address: string;
}): Promise<{
  to: string;
  data: string;
  /** Decimal wei, converted from LI.FI's hex quantity. */
  value: string;
  etaSeconds: number | null;
  /**
   * `estimate.approvalAddress` — the contract that would pull an ERC20. Null
   * when the quote does not name one, which the resolver treats as a refusal
   * for a token leg and ignores for a native one.
   */
  spender: string | null;
  /** `transactionRequest.chainId`, for the source-chain cross-check. */
  txChainId: number | null;
  /** How LI.FI resolved the symbol on the source chain. Nulls where absent. */
  fromToken: { address: string | null; decimals: number | null };
} | null> {
  try {
    const params: Record<string, string> = {
      fromChain: String(args.fromChainId),
      toChain: String(args.toChainId),
      fromToken: args.asset,
      toToken: args.asset,
      fromAmount: args.units,
      fromAddress: args.address,
      /* Swift by default. FASTEST picks a sub-minute route where one exists
         — Arc’s Polymer Fast lands in ~10s — instead of the ~18-minute Standard
         the unordered call returns. lifiIntents is denied because it is a
         solver network whose spread runs ~2.7%, an order of magnitude over
         Polymer’s ~0.26% for the sake of a few seconds; every Arc corridor
         still has a Polymer route, so denying it costs availability nowhere
         measured. */
      order: "FASTEST",
      denyBridges: "lifiIntents",
    };

    /* The integrator fee is authorised by an API key that is a server secret,
       and this function runs in the browser too (useLocalPlanner). So the two
       environments reach LI.FI by different doors: on the server we call
       li.quest directly, adding our integrator + fee and the key header; in the
       browser we call our own /api/bridge/quote, which adds all three
       server-side so the key never ships in the bundle. Both return the same
       quote shape parsed below — see src/app/api/bridge/quote/route.ts and
       lib/bridge/lifiServer.ts. */
    let res: Response;
    if (typeof window === "undefined") {
      const qs = new URLSearchParams({ ...params, ...lifiMonetizationParams() });
      res = await fetch(`${LIFI_API}/quote?${qs}`, { headers: lifiAuthHeaders() });
    } else {
      const qs = new URLSearchParams(params);
      res = await fetch(`/api/bridge/quote?${qs}`);
    }
    if (!res.ok) return null;

    const data = (await res.json()) as {
      estimate?: { executionDuration?: number; approvalAddress?: string };
      action?: { fromToken?: { address?: string; decimals?: number } };
      transactionRequest?: {
        to?: string;
        data?: string;
        value?: string;
        chainId?: number;
      };
    };

    const tx = data.transactionRequest;
    if (!tx?.to || !tx.data) return null;

    // LI.FI returns value as a hex quantity; the Intent carries decimal wei.
    // A malformed value throws in BigInt and is caught as "no route".
    const value = BigInt(tx.value ?? "0").toString();
    const dur = data.estimate?.executionDuration;
    const from = data.action?.fromToken;

    return {
      to: tx.to,
      data: tx.data,
      value,
      etaSeconds: typeof dur === "number" ? dur : null,
      spender: data.estimate?.approvalAddress ?? null,
      txChainId: typeof tx.chainId === "number" ? tx.chainId : null,
      fromToken: {
        address: from?.address ?? null,
        decimals: typeof from?.decimals === "number" ? from.decimals : null,
      },
    };
  } catch {
    return null;
  }
}
