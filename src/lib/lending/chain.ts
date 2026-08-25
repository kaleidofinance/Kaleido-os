import { READ_ONLY_CHAIN_ID } from "@/config/provider";
import { getChainMeta } from "@/constants/chains";

/**
 * The one chain the lending / P2P surface reads and writes.
 *
 * Lending is single-chain by schema, not by preference: the Supabase mirror
 * tables behind /borrow (`kaleido_listings`, `kaleido_requests`) have no chainId
 * column, so a row cannot say which deployment it belongs to. Every position read
 * already pins itself to the read chain for that reason —
 * `useGetValueAndHealth.ts` builds its contract from `getKaleidoContract(
 * readOnlyProvider, READ_ONLY_CHAIN_ID)`.
 *
 * The write path did not, and the mismatch was silent. A wallet on Base Sepolia
 * deposited collateral into Base's diamond and then read its health factor from
 * Sepolia's — two different protocol deployments, one screen, no error. The
 * deposit was real and the UI could not see it.
 *
 * So the writes pin here too, and `lendingChainMismatch()` is what asks the user
 * to switch rather than signing against a deployment the rest of the page is not
 * describing. This constant is where to start when the mirror tables gain a
 * chainId column and lending becomes genuinely multi-chain: it should stop
 * existing, not be reassigned.
 */
export const LENDING_CHAIN_ID = READ_ONLY_CHAIN_ID;

/**
 * Null when `chainId` is the lending chain, otherwise the message to show.
 *
 * Names both chains, because "switch network" alone is not actionable when the
 * wallet is on one of five testnets that all look alike in a wallet UI.
 */
export function lendingChainMismatch(
  chainId: number | undefined,
): string | null {
  if (chainId === LENDING_CHAIN_ID) return null;

  const target = getChainMeta(LENDING_CHAIN_ID)?.name ?? `chain ${LENDING_CHAIN_ID}`;
  const current = chainId
    ? (getChainMeta(chainId)?.name ?? `chain ${chainId}`)
    : "no chain";

  return `Lending runs on ${target}. Your wallet is on ${current} — switch to ${target} to continue.`;
}
