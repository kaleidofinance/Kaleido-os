import { CHAINS } from "@/constants/chains";
import { providerForChain } from "@/config/provider";
import { runReadTool } from "@/lib/ai/readTools";
import { getPrices } from "@/lib/points/prices";
import { dexTokenPrices } from "@/lib/swap/dexPrices";
import { decimalsForAddress } from "@/constants/tokens";

/**
 * A wallet's token value right now, computed on the server from the chain:
 * getBalances on every mainnet chain (the same read Luca's tool runs) priced by
 * the points price table (Pyth → CoinGecko, dollar stables at par) and, for what
 * that cannot price, the DEX price (KyberSwap; Argus pools on Arc).
 *
 * Wallet balances only — collateral, liquidity and staked tokens have left the
 * wallet and are not counted. Unpriced holdings are named, not counted as zero
 * silently: the caller stores the list beside the figure.
 */
export async function walletValueUsd(wallet: string): Promise<{ valueUsd: number; unpriced: string[]; chains: number }> {
  const chains = CHAINS.filter((c) => c.network === "mainnet" && providerForChain(c.id));
  const holdings: { chainId: number; symbol: string; address: string; amount: number }[] = [];
  let read = 0;
  for (const c of chains) {
    const r = (await runReadTool("getBalances", { address: wallet }, c.id)) as {
      error?: string;
      holdings?: { symbol: string; address: string; amount: string }[];
    };
    if (r.error) continue;
    read++;
    for (const h of r.holdings ?? []) {
      const n = Number(h.amount);
      if (Number.isFinite(n) && n > 0) holdings.push({ chainId: c.id, symbol: h.symbol, address: h.address, amount: n });
    }
  }
  if (read === 0) throw new Error("no chain could be read");

  const symbols = [...new Set(holdings.map((h) => h.symbol))];
  let spot = new Map<string, { usd: number | null }>();
  try {
    spot = await getPrices(symbols);
  } catch {
    /* fall through to the DEX price for everything */
  }
  const par = (s: string) => (/^W?USDC$/i.test(s) ? 1 : null);

  const missing = holdings.filter((h) => (spot.get(h.symbol)?.usd ?? par(h.symbol)) === null);
  const dex = new Map<string, number>();
  for (const chainId of [...new Set(missing.map((m) => m.chainId))]) {
    const toks = missing
      .filter((m) => m.chainId === chainId && /^0x[0-9a-fA-F]{40}$/.test(m.address))
      /* Real decimals from the registry; a token whose decimals are unknown is
         left unpriced rather than quoted at a guess (a 6-dec token quoted as 18
         is a 10^12 error). */
      .flatMap((m) => {
        const d = decimalsForAddress(chainId, m.address);
        return d === undefined ? [] : [{ address: m.address, decimals: d }];
      });
    if (!toks.length) continue;
    try {
      const px = await dexTokenPrices(chainId, toks);
      for (const [a, p] of Object.entries(px)) dex.set(`${chainId}:${a.toLowerCase()}`, p);
    } catch {
      /* unpriced stays named */
    }
  }

  let value = 0;
  const unpriced: string[] = [];
  for (const h of holdings) {
    const p = spot.get(h.symbol)?.usd ?? par(h.symbol) ?? dex.get(`${h.chainId}:${h.address.toLowerCase()}`) ?? null;
    if (p === null) unpriced.push(h.symbol);
    else value += h.amount * p;
  }
  return { valueUsd: Math.round(value * 100) / 100, unpriced: [...new Set(unpriced)], chains: read };
}
