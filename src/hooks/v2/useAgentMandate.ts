"use client";

import { useQuery } from "@tanstack/react-query";
import { ethers } from "ethers";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import { getContracts } from "@/constants/registry";
import { readContracts, type Call } from "@/lib/chain/multicall";
import AgentPermissionAbi from "@/abi/AgentPermissionFacet.json";

/**
 * The on-chain agent mandate for (connected wallet, `agentAddress`), read from
 * the connected chain in one multicall.
 *
 * This is the client half of `getAgentMandate` (the read TOOL) and the piece the
 * "Agent" signing mode needs to be honest: the mode is only real while a grant
 * exists on chain, so the UI has to be able to ask the chain rather than trust a
 * flag in localStorage that a grant's expiry or a revoke can silently outdate.
 * `active` is the whole answer most callers want — a grant that exists, is
 * unrevoked, and has not expired.
 */

const FACET = new ethers.Interface(
  AgentPermissionAbi as unknown as ethers.InterfaceAbi,
);

export interface AgentMandate {
  /** A grant exists, is unrevoked, and has not expired. */
  active: boolean;
  /** Unix expiry of the grant, or null when there is none / it can't be read. */
  expiryUnix: number | null;
  /** USD the agent may still spend this epoch, or null when unread. */
  remainingBudgetUsd: number | null;
  /** Still reading the first answer for a valid agent. */
  loading: boolean;
  /** Whether the query has settled at least once (not loading, not refetching). */
  settled: boolean;
  /** Re-read now — call after signing or revoking a grant. */
  refetch: () => void;
}

export function useAgentMandate(agentAddress?: string): AgentMandate {
  const { address, chainId } = useWalletV2();
  const diamond = chainId ? getContracts(chainId).diamond : undefined;
  const valid = !!agentAddress && ethers.isAddress(agentAddress);
  const enabled = !!address && !!diamond && valid;

  const query = useQuery({
    queryKey: [
      "agentMandate",
      chainId ?? null,
      address ?? null,
      agentAddress ?? null,
    ],
    enabled,
    queryFn: async () => {
      const calls: Call[] = [
        {
          target: diamond!,
          iface: FACET,
          method: "getAgentPermission",
          args: [address, agentAddress],
        },
        {
          target: diamond!,
          iface: FACET,
          method: "agentRemainingBudget",
          args: [address, agentAddress],
        },
      ];
      const [perm, budget] = await readContracts(chainId, calls);

      let expiry = 0;
      let revoked = false;
      if (perm.success && perm.value) {
        // A single struct return, unwrapped by readContracts — read by name.
        const p = perm.value as { expiry: bigint; revoked: boolean };
        expiry = Number(p.expiry);
        revoked = Boolean(p.revoked);
      }
      const nowSec = Math.floor(Date.now() / 1000);
      // expiry === 0 is the facet's "no grant" sentinel.
      const active = expiry > nowSec && !revoked;

      return {
        active,
        expiryUnix: expiry > 0 ? expiry : null,
        remainingBudgetUsd:
          budget.success && budget.value !== null
            ? Number(ethers.formatUnits(budget.value as bigint, 18))
            : null,
      };
    },
  });

  const d = query.data;
  return {
    active: d?.active ?? false,
    expiryUnix: d?.expiryUnix ?? null,
    remainingBudgetUsd: d?.remainingBudgetUsd ?? null,
    loading: enabled && query.isLoading,
    settled: enabled && query.isFetched && !query.isFetching,
    refetch: () => {
      query.refetch();
    },
  };
}
