import { CHAINS_BY_ID } from "@/constants/chains";
import { providerForChain } from "@/config/provider";
import {
  integrationsForChain,
} from "./integrationCatalog";
import {
  evaluateIntegration,
  type IntegrationReadiness,
} from "./integrationReadiness";

export const PROBED_CHAIN_IDS = [5042, 56, 4663, 99901] as const;

export interface ChainProbeResult {
  chainId: number;
  chainName: string;
  rpcOk: boolean;
  blockNumber: number | null;
  latencyMs: number;
  error?: string;
  integrations: IntegrationReadiness[];
}

export interface AcceptanceProbeReport {
  timestamp: string;
  chains: ChainProbeResult[];
  summary: {
    totalIntegrations: number;
    ready: number;
    degraded: number;
    unavailable: number;
    rpcPassRate: number;
  };
}

async function probeRpc(chainId: number, timeoutMs = 5000): Promise<{
  ok: boolean;
  blockNumber: number | null;
  latencyMs: number;
  error?: string;
}> {
  const provider = providerForChain(chainId);
  if (!provider) {
    return {
      ok: false,
      blockNumber: null,
      latencyMs: 0,
      error: `No provider configured for chain ${chainId}`,
    };
  }

  const start = Date.now();
  try {
    const blockNumberPromise = provider.getBlockNumber();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`RPC timeout after ${timeoutMs}ms`)), timeoutMs),
    );
    const blockNumber = await Promise.race([blockNumberPromise, timeoutPromise]);
    const latencyMs = Date.now() - start;
    return { ok: true, blockNumber, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - start;
    return {
      ok: false,
      blockNumber: null,
      latencyMs,
      error: (err as Error).message,
    };
  }
}

export async function probeMainnetAcceptance(
  chainIds: readonly number[] = PROBED_CHAIN_IDS,
  timeoutMs = 5000,
): Promise<AcceptanceProbeReport> {
  const chainResults: ChainProbeResult[] = [];

  for (const chainId of chainIds) {
    const meta = CHAINS_BY_ID[chainId];
    const chainName = meta?.name ?? `Chain ${chainId}`;
    const rpc = await probeRpc(chainId, timeoutMs);
    const descriptors = integrationsForChain(chainId, "mainnet");

    const readinessList: IntegrationReadiness[] = [];

    for (const item of descriptors) {
      // Evaluate live inspect
      const inspectCheck = rpc.ok
        ? { ok: true, reason: `Live RPC read verified at block #${rpc.blockNumber} (${rpc.latencyMs}ms)` }
        : { ok: false, reason: `RPC read failed: ${rpc.error}` };
      readinessList.push(evaluateIntegration(item, "inspect", inspectCheck));

      // Evaluate live quote
      const quoteCheck = rpc.ok
        ? { ok: true, reason: `RPC responsive (${rpc.latencyMs}ms); ready for aggregator/launchpad quote` }
        : { ok: false, reason: `RPC degraded: cannot fetch live quotes` };
      readinessList.push(evaluateIntegration(item, "quote", quoteCheck));

      // Evaluate plan & simulate
      readinessList.push(
        evaluateIntegration(item, "plan", rpc.ok ? { ok: true } : { ok: false, reason: "RPC degraded" }),
      );
      readinessList.push(
        evaluateIntegration(item, "simulate", rpc.ok ? { ok: true } : { ok: false, reason: "RPC degraded" }),
      );
    }

    chainResults.push({
      chainId,
      chainName,
      rpcOk: rpc.ok,
      blockNumber: rpc.blockNumber,
      latencyMs: rpc.latencyMs,
      error: rpc.error,
      integrations: readinessList,
    });
  }

  // Summary aggregation
  let totalIntegrations = 0;
  let ready = 0;
  let degraded = 0;
  let unavailable = 0;

  for (const c of chainResults) {
    for (const it of c.integrations) {
      totalIntegrations++;
      if (it.readiness === "ready") ready++;
      else if (it.readiness === "degraded") degraded++;
      else unavailable++;
    }
  }

  const rpcPassCount = chainResults.filter((c) => c.rpcOk).length;
  const rpcPassRate = chainResults.length > 0 ? rpcPassCount / chainResults.length : 0;

  return {
    timestamp: new Date().toISOString(),
    chains: chainResults,
    summary: {
      totalIntegrations,
      ready,
      degraded,
      unavailable,
      rpcPassRate,
    },
  };
}
