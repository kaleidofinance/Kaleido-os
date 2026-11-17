/**
 * Explicit allowlist for Synthra execution-network deposit contracts.
 *
 * The quote endpoint returns the exact source transaction, but an ERC-20
 * approval survives the transaction that created it. We therefore require the
 * provider's deposit target to be configured per source chain before allowing
 * an ERC-20 external bridge. Native deposits do not create an allowance and do
 * not use this list.
 *
 * Format: `4663:0xabc...,5042:0xdef...`.
 * The server variable is authoritative; the public mirror is needed by the
 * browser auditor because the addresses are not secrets.
 */
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function configured(): ReadonlyMap<number, ReadonlySet<string>> {
  const raw =
    process.env.SYNTHRA_EXTERNAL_SPENDERS ??
    process.env.NEXT_PUBLIC_SYNTHRA_EXTERNAL_SPENDERS ??
    "";
  const byChain = new Map<number, Set<string>>();
  for (const entry of raw.split(",")) {
    const [chain, address] = entry.trim().split(":");
    const chainId = Number(chain);
    if (!Number.isSafeInteger(chainId) || !ADDRESS.test(address ?? ""))
      continue;
    const id = chainId as number;
    const set = byChain.get(id) ?? new Set<string>();
    set.add(address.toLowerCase());
    byChain.set(id, set);
  }
  return byChain;
}

export function isKnownSynthraExternalSpender(
  chainId: number | undefined,
  address: string,
): boolean {
  if (!Number.isSafeInteger(chainId) || !ADDRESS.test(address)) return false;
  return configured()
    .get(chainId as number)
    ?.has(address.toLowerCase()) ?? false;
}
