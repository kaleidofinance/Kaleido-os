/** A provider transaction suitable for inspection, not an authorization to sign. */
export interface SynthraTransaction {
  from: string;
  to: string;
  data: string;
  value: string;
  chainId: number;
}

/**
 * Preserve provider ordering and reject unrecognized step types. This parser
 * does not validate spender, calldata semantics or quote freshness; callers
 * must perform those checks before a transaction can enter a signing plan.
 */
export function inspectSynthraSteps(
  steps: unknown[],
  wallet: string,
  chainId: number,
): SynthraTransaction[] | null {
  if (
    !/^0x[0-9a-fA-F]{40}$/.test(wallet) ||
    steps.length === 0 ||
    steps.length > 8
  )
    return null;
  const transactions: SynthraTransaction[] = [];
  for (const step of steps) {
    if (!step || typeof step !== "object") return null;
    const entry = step as { kind?: unknown; items?: unknown };
    if (
      entry.kind !== "transaction" ||
      !Array.isArray(entry.items) ||
      entry.items.length === 0
    )
      return null;
    for (const item of entry.items) {
      if (!item || typeof item !== "object") return null;
      const row = item as { kind?: unknown; data?: unknown };
      if (
        row.kind !== "transaction" ||
        !row.data ||
        typeof row.data !== "object"
      )
        return null;
      const tx = row.data as Record<string, unknown>;
      if (
        typeof tx.from !== "string" ||
        tx.from.toLowerCase() !== wallet.toLowerCase() ||
        typeof tx.to !== "string" ||
        !/^0x[0-9a-fA-F]{40}$/.test(tx.to) ||
        /^0x0{40}$/i.test(tx.to) ||
        typeof tx.data !== "string" ||
        !/^0x(?:[0-9a-fA-F]{2})+$/.test(tx.data) ||
        typeof tx.value !== "string" ||
        !/^\d+$/.test(tx.value) ||
        tx.chainId !== chainId
      )
        return null;
      transactions.push({
        from: tx.from,
        to: tx.to,
        data: tx.data,
        value: tx.value,
        chainId,
      });
      if (transactions.length > 8) return null;
    }
  }
  return transactions;
}
