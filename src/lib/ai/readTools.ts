import { ethers } from "ethers";
import { readOnlyProvider } from "@/config/provider";
import { envVars } from "@/constants/envVars";
import protocolAbi from "@/abi/ProtocolFacet.json";
import { ABSTRACT_TOKENS } from "@/constants/tokens";
import { supabase } from "@/lib/supabase/supabaseClient";
import { getTokenDecimals } from "@/constants/utils/formatTokenDecimals";
import { fetchOmniAssetBalance } from "@/constants/utils/omniChainBalances";

/**
 * Server-side execution of Luca's READ tools.
 *
 * These run in the agent loop (not the browser), so they use readOnlyProvider —
 * plain JSON-RPC, no signer, no wallet. That's why they can't reuse the React
 * hooks: useQuote/usePortfolio are client-only. The contract calls are the same.
 *
 * Every handler returns a plain object that gets fed back to the model as the
 * tool result. Failures return { error } rather than throwing — the model can
 * reason about a failed lookup ("I couldn't fetch your positions") far better
 * than the loop can recover from an exception.
 */

type Json = Record<string, unknown>;

const HEALTH_SCALE = 1e-18;
const USD_SCALE = 1e16;

async function getQuote(args: Json): Promise<Json> {
  const diamond = envVars.lendbitDiamondAddress;
  if (!diamond) return { error: "Diamond address not configured" };
  try {
    const contract = new ethers.Contract(diamond, protocolAbi, readOnlyProvider);
    const amount = ethers.parseUnits(String(args.amount ?? "0"), 18);
    const [totalRepayment, interestAmount, durationSeconds] =
      await contract.getQuote(
        amount,
        Number(args.interestBps ?? 0),
        Number(args.returnDate ?? 0),
      );
    return {
      totalRepayment: ethers.formatUnits(totalRepayment, 18),
      interestAmount: ethers.formatUnits(interestAmount, 18),
      durationDays: Number(durationSeconds) / 86_400,
    };
  } catch (err) {
    return { error: `getQuote failed: ${(err as Error).message}` };
  }
}

async function getPortfolio(args: Json): Promise<Json> {
  const diamond = envVars.lendbitDiamondAddress;
  const address = String(args.address ?? "");
  if (!diamond) return { error: "Diamond address not configured" };
  if (!ethers.isAddress(address)) return { error: "A valid wallet address is required" };

  try {
    const contract = new ethers.Contract(diamond, protocolAbi, readOnlyProvider);
    const [collateralRaw, healthRaw] = await Promise.all([
      contract.getAccountCollateralValue(address).catch(() => null),
      contract.getHealthFactor(address).catch(() => null),
    ]);

    const health =
      healthRaw === null ? null : Number(healthRaw) * HEALTH_SCALE;

    return {
      collateralUsd:
        collateralRaw === null ? null : Number(collateralRaw) / USD_SCALE,
      healthFactor:
        health === null || !Number.isFinite(health)
          ? null
          : Number(health.toFixed(4)),
      note:
        "Liquidation occurs at health factor 1.0. Liquidity, staking and vault positions are read client-side and may not appear here.",
    };
  } catch (err) {
    return { error: `getPortfolio failed: ${(err as Error).message}` };
  }
}

/** Resolves a token address to its symbol; falls back to a short address. */
function symbolFor(address: string): string {
  const match = ABSTRACT_TOKENS.find(
    (t) => t.address?.toLowerCase() === address?.toLowerCase(),
  );
  return match?.symbol ?? `${address?.slice(0, 6)}…${address?.slice(-4)}`;
}

/**
 * Reads the indexed offer book from Supabase.
 *
 * `kaleido_listings` are lender offers (what you can borrow from);
 * `kaleido_requests` are borrower asks (what you can fund). Sorting is
 * side-aware: a borrower wants the lowest APR, a lender the highest — the
 * same polarity rule the Borrow page's rate colouring uses.
 */
async function getMarkets(args: Json): Promise<Json> {
  const asset = String(args.asset ?? "").toUpperCase();
  const side = String(args.side ?? "borrow").toLowerCase();
  const wantLend = side === "lend";

  const token = asset
    ? ABSTRACT_TOKENS.find((t) => t.symbol.toUpperCase() === asset)
    : undefined;
  if (asset && !token) {
    return {
      error: `Unknown asset "${asset}"`,
      knownAssets: ABSTRACT_TOKENS.map((t) => t.symbol),
    };
  }

  try {
    let query = supabase
      .from(wantLend ? "kaleido_requests" : "kaleido_listings")
      .select("*")
      .eq("status", "OPEN")
      // Borrowers want the cheapest rate first; lenders the richest.
      .order("interest", { ascending: !wantLend })
      .limit(40);

    if (token) query = query.eq("tokenAddress", token.address);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const nowSec = Math.floor(Date.now() / 1000);
    const offers = (data ?? [])
      .map((row: Record<string, unknown>) => {
        const tokenAddress = String(row.tokenAddress ?? "");
        const returnDate = Number(row.returnDate ?? 0);
        let amount: string | null = null;
        try {
          amount = ethers.formatUnits(
            String(row.amount ?? "0"),
            getTokenDecimals(tokenAddress),
          );
        } catch {
          amount = null;
        }
        return {
          id: row.listingId ?? row.requestId ?? null,
          asset: symbolFor(tokenAddress),
          amount,
          aprBps: row.interest !== undefined ? Number(row.interest) : null,
          maturesUnix: returnDate || null,
          termDays:
            returnDate > nowSec
              ? Number(((returnDate - nowSec) / 86_400).toFixed(1))
              : null,
          counterparty: String(row.sender ?? row.author ?? ""),
        };
      })
      // Drop anything already past maturity — it isn't fillable.
      .filter((o) => o.termDays !== null)
      .slice(0, 12);

    return {
      venue: "Kaleido",
      side: wantLend ? "lend" : "borrow",
      asset: token?.symbol ?? "all",
      offers,
      note:
        offers.length === 0
          ? "No open offers match. Suggest the user post their own offer at the rate they want."
          : "aprBps is an annual rate in basis points (100 bps = 1%). Use getQuote with a specific amount and maturity to compute the real cost over the term before comparing offers.",
      coverage:
        "Only Kaleido's own order book is indexed here. You may reason about external protocols in general terms, but never state a specific external rate as fact.",
    };
  } catch (err) {
    return { error: `getMarkets failed: ${(err as Error).message}` };
  }
}

/**
 * Chains swept by the balance indexer. Matches the set Collateral.tsx uses,
 * plus Abstract testnet so dev wallets resolve, plus the new mainnet/testnet
 * pairs from the chain registry (src/constants/chains.ts).
 */
const INDEXED_CHAINS = [
  2741, 11124, // Abstract
  1, 11155111, // Ethereum / Sepolia
  8453, 84532, // Base / Base Sepolia
  56, 97, // BSC / BSC Testnet
  4663, 46630, // Robinhood Chain / Testnet
  5042002, // Arc Testnet
  137, 42161, 999, // Polygon, Arbitrum, Hyperliquid
];

/**
 * Cross-chain balance read.
 *
 * Reuses fetchOmniAssetBalance — the same indexer the Collateral card uses. It
 * is pure ethers against read-only RPCs per chain, so it runs server-side
 * unchanged. Failed chains resolve to "0" inside the indexer rather than
 * rejecting, so one dead RPC degrades a single row instead of the whole read.
 */
async function getChains(args: Json): Promise<Json> {
  const address = String(args.address ?? "");
  const asset = String(args.asset ?? "").toUpperCase();

  if (!ethers.isAddress(address)) {
    return { error: "A valid wallet address is required" };
  }

  // The indexer only knows ETH plus its stablecoin config.
  const SUPPORTED = ["ETH", "USDC", "USDT", "USDR", "kfUSD"];
  const match = SUPPORTED.find((s) => s.toUpperCase() === asset);
  if (!match) {
    return {
      error: `Cross-chain balances are not indexed for "${asset}"`,
      indexedAssets: SUPPORTED,
    };
  }

  try {
    const result = await fetchOmniAssetBalance(address, match, INDEXED_CHAINS);
    const byChain = result.chains.map((c) => ({
      chain: c.chainName,
      chainId: c.chainId,
      balance: c.balance,
    }));

    return {
      asset: result.token,
      totalBalance: result.totalBalance,
      // The indexer filters out zero balances, so this is where funds actually are.
      byChain,
      note:
        byChain.length === 0
          ? "No balance found for this asset on any indexed chain."
          : byChain.length > 1
            ? "Holdings span multiple chains. Kaleido cannot execute a bridge itself — if a plan needs one, say the bridge step is manual and describe it rather than proposing it as a signable action."
            : "All holdings for this asset are on a single chain.",
    };
  } catch (err) {
    return { error: `getChains failed: ${(err as Error).message}` };
  }
}

const HANDLERS: Record<string, (args: Json) => Promise<Json>> = {
  getQuote,
  getPortfolio,
  getMarkets,
  getChains,
};

export function isReadTool(name: string): boolean {
  return name in HANDLERS;
}

export async function runReadTool(name: string, args: Json): Promise<Json> {
  const handler = HANDLERS[name];
  if (!handler) return { error: `Unknown read tool: ${name}` };
  try {
    return await handler(args);
  } catch (err) {
    return { error: `${name} threw: ${(err as Error).message}` };
  }
}
