import { READ_ONLY_CHAIN_ID } from "@/config/provider";
import { CHAINS, getChainMeta } from "@/constants/chains";
import { isDeployed } from "@/constants/registry";

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
 * Every chain whose lending market the book should sweep.
 *
 * Lending is going multi-chain the way the Pool page did: the book shows offers
 * and requests from every deployment at once, each row tagged with its chain,
 * rather than one chain's book pinned by LENDING_CHAIN_ID. The diamonds are
 * deployed and their assets registered on all five testnets, and readBookRows
 * already takes a chainId — so the only thing that was single-chain was the
 * caller passing this constant.
 *
 * Mirrors dex/poolDiscovery's `discoveryChains`: the read chain leads (it is the
 * default view before a wallet connects), then every other deployed chain, in
 * registry order. A chain with no diamond is skipped — there is no book to read
 * there — which is what `isDeployed` gates on.
 *
 * READ chain first is deliberate and pairs with the disconnected-wallet default:
 * the book is browsable with no wallet, and the connected chain only decides
 * where a NEW offer posts and which rows count as "mine".
 */
export function lendingChains(): number[] {
  const ids: number[] = [];
  if (isDeployed(READ_ONLY_CHAIN_ID)) ids.push(READ_ONLY_CHAIN_ID);
  for (const chain of CHAINS) {
    if (isDeployed(chain.id) && !ids.includes(chain.id)) ids.push(chain.id);
  }
  return ids;
}

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
