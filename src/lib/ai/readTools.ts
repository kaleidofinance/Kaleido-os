import { ethers } from "ethers";
import { readOnlyProvider } from "@/config/provider";
import { envVars } from "@/constants/envVars";
import protocolAbi from "@/abi/ProtocolFacet.json";
import { ABSTRACT_TOKENS } from "@/constants/tokens";

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

async function getMarkets(args: Json): Promise<Json> {
  const asset = String(args.asset ?? "").toUpperCase();
  const token = ABSTRACT_TOKENS.find((t) => t.symbol.toUpperCase() === asset);
  if (!token) {
    return {
      error: `Unknown asset "${asset}"`,
      knownAssets: ABSTRACT_TOKENS.map((t) => t.symbol),
    };
  }
  // Live offers are indexed off-chain (Supabase) and surfaced client-side via
  // useDataFilterPanel. Returning the address + a clear capability note keeps
  // the model honest rather than inventing rates.
  return {
    asset: token.symbol,
    address: token.address,
    side: args.side ?? "both",
    offers: [],
    note:
      "Live offer data is not yet wired into the server-side agent. Do not invent rates — tell the user to check the Borrow page, or ask them for a rate to quote against.",
  };
}

async function getChains(args: Json): Promise<Json> {
  return {
    address: args.address,
    asset: args.asset,
    chains: [],
    note:
      "Cross-chain balance indexing is not yet wired server-side. You may reason about bridging in general terms, but do not state specific balances or bridge quotes as fact.",
  };
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
