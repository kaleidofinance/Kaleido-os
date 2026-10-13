/**
 * Tokens a wallet actually holds that our registry does not list — so Luca can
 * read "sell 100% of GLITCH" as the GLITCH in the user's wallet.
 *
 * The registry is a curated allow-list (constants/registry.ts), and the
 * grammar resolves symbols against it alone. A token bought on an Argus launch,
 * or anywhere else, is real and sitting in the wallet, but the grammar answered
 * "I don't know a token called GLITCH" because the registry has never heard of
 * it. The wallet is the one authority on what the user holds, so a held token
 * becomes nameable — and only a held one: an unlisted symbol the wallet does NOT
 * hold still resolves to nothing, because guessing a contract from a ticker is
 * how people buy the wrong token.
 *
 * Discovery is thirdweb Insight (the public client key the app already ships),
 * called from the browser, so it costs no Vercel request.
 */
import type { IToken } from "@/constants/types/dex";

const INSIGHT = "https://insight.thirdweb.com/v1/tokens";
const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

interface InsightRow {
  token_address?: string;
  balance?: string;
  decimals?: number;
  name?: string;
  symbol?: string;
}

/** Every ERC-20 the owner holds a non-zero balance of on `chainId`. Empty on any failure. */
export async function fetchHeldTokens(
  owner: string,
  chainId: number,
  clientId: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<IToken[]> {
  if (!clientId || !/^0x[0-9a-fA-F]{40}$/.test(owner)) return [];
  const qs = new URLSearchParams({
    owner_address: owner,
    chain_id: String(chainId),
    metadata: "true",
    include_spam: "false",
    limit: "100",
  });
  try {
    const r = await fetcher(`${INSIGHT}?${qs}`, { headers: { "x-client-id": clientId } });
    if (!r.ok) return [];
    const j = (await r.json()) as { data?: InsightRow[] };
    return fromInsight(j.data ?? [], chainId);
  } catch {
    return [];
  }
}

/** Insight rows → tokens. Drops the native row, zero balances and rows missing a usable symbol or decimals. */
export function fromInsight(rows: InsightRow[], chainId: number): IToken[] {
  const out: IToken[] = [];
  for (const r of rows) {
    const address = r.token_address ?? "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(address) || address.toLowerCase() === NATIVE) continue;
    if (!r.balance || /^0+$/.test(r.balance)) continue;
    const symbol = (r.symbol ?? "").trim();
    if (!/^[A-Za-z0-9.$_-]{1,16}$/.test(symbol)) continue;
    if (typeof r.decimals !== "number" || !Number.isInteger(r.decimals) || r.decimals < 0 || r.decimals > 36) continue;
    out.push({
      address,
      name: (r.name ?? symbol).trim() || symbol,
      symbol,
      decimals: r.decimals,
      chainId,
      verified: false,
      tags: ["held"],
    });
  }
  return out;
}

/**
 * The held tokens the parser may resolve by symbol: those whose symbol (or
 * address) the registry does not already cover, and whose symbol is unique
 * among them. Two held tokens both called "PEPE" are left out — the parser then
 * says it doesn't know the name, and the user can paste the address — rather
 * than picking one.
 */
export function heldVocabulary(registry: IToken[], held: IToken[]): IToken[] {
  const regSymbols = new Set(registry.map((t) => t.symbol.toLowerCase()));
  const regAddrs = new Set(registry.map((t) => t.address.toLowerCase()));
  const candidates = held.filter(
    (t) => !regAddrs.has(t.address.toLowerCase()) && !regSymbols.has(t.symbol.toLowerCase()),
  );
  const count = new Map<string, number>();
  for (const t of candidates) count.set(t.symbol.toLowerCase(), (count.get(t.symbol.toLowerCase()) ?? 0) + 1);
  return candidates.filter((t) => count.get(t.symbol.toLowerCase()) === 1);
}
