import { ethers } from "ethers";
import ProtocolFacetAbi from "@/abi/ProtocolFacet.json";
import { providerForChain } from "@/config/provider";
import { getContracts } from "@/constants/registry";
import { readContracts, type Call } from "@/lib/chain/multicall";
import { retryRpc } from "@/lib/dex/rpcRetry";
import { dexTokenPrices } from "@/lib/swap/dexPrices";
import { supabaseAdmin } from "@/lib/supabase/serverClient";
import { accrueInterval, type Snapshot } from "@/lib/points/accrual";
import { loadRate, loadCampaignMultiplier, withCampaignBoost } from "@/lib/points/credit";
import {
  LENDING_SOURCES,
  lendingUsd,
  type FreeBalance,
  type LendingSource,
  type ServicedLoan,
  type TokenInfo,
} from "@/lib/points/lendingSnapshot";

/**
 * Accrues the time-based LENDING points — `lend`, `borrow`, `collateral_idle` —
 * for positions in the Arc lending diamond. The same snapshot → min(then, now)
 * → `point_epochs` pipeline as `/api/cron/points-lp` (read that file's header for
 * the anti-gaming rule); the materializer trigger turns epochs into balances.
 *
 * Who is snapshotted: every wallet with a previous lending snapshot, every author
 * and lender in the diamond's request book, and every depositor seen in
 * `CollateralDeposited` logs — a wallet that only deposits appears in no request.
 * The logs are read from a cursor (`points_lend_cursor`) so nothing is scanned
 * twice or skipped, whatever the backlog: a run capped at MAX_BLOCKS leaves the
 * rest for the next.
 *
 * Fails CLOSED. A balance that could not be read, or a token that could not be
 * priced, aborts the run with nothing written: accrual pays min(then, now), so a
 * false zero would erase that interval permanently, while a skipped run only
 * makes the next interval longer.
 *
 * Operator wallets never earn: the fee vault (0x0Ce7…, which also receives the
 * protocol fee) and the liquidation keeper (0xB37d…, whose liquidation rewards
 * land in its ledger as collateral) are excluded by default; POINTS_LEND_EXCLUDE
 * adds more.
 *
 *   ?dryRun=1            compute and return the table; write nothing.
 *   ?chainId=N           (dry runs only) value another chain's book — e.g. the
 *                        Arc testnet parity diamond before mainnet exists.
 *
 * Armed like the other crons (`Authorization: Bearer $CRON_SECRET`); inert with no
 * secret, no diamond on the chain, or the chain disabled in `point_chains`.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ARC = 5042;
const SEASON = 1;
const NATIVE = "0x0000000000000000000000000000000000000001";
/** Chains whose native currency (address(1) in the diamond) is USDC, i.e. $1. */
const NATIVE_IS_USDC = new Set([5042, 5042002]);
const REORG_MARGIN = 5;
/** Arc's RPC refuses wide getLogs ranges (-32012 at 10k); the points-swap span. */
const SPAN = Number(process.env.POINTS_LEND_SPAN ?? 1_000);
const MAX_BLOCKS = Number(process.env.POINTS_LEND_MAX_BLOCKS ?? 20_000);
const LOOKBACK = Number(process.env.POINTS_LEND_LOOKBACK ?? 20_000);
const DELAY_MS = Number(process.env.POINTS_LEND_DELAY_MS ?? 150);
const MULTICALL_CHUNK = 300;

const EXCLUDE = new Set(
  [
    "0x0Ce7f8Aeaad60b9E19ACBe9803518182adC351Bc", // fee vault / deployer
    "0xB37d079F6AccE50332043cf20e1f4FFD363799aE", // liquidation + price keeper
    ...(process.env.POINTS_LEND_EXCLUDE ?? "").split(","),
  ]
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean),
);

const protocol = new ethers.Interface(ProtocolFacetAbi as ethers.InterfaceAbi);
const DEPOSITED_TOPIC = protocol.getEvent("CollateralDeposited")!.topicHash;
const erc20 = new ethers.Interface(["function decimals() view returns (uint8)"]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function authorised(req: Request, secret: string): boolean {
  const header = req.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  return bearer === secret || req.headers.get("x-cron-secret") === secret;
}

class Abort extends Error {}

/** Latest snapshot per wallet for one lending source on one chain. */
async function previousSnapshots(chainId: number, source: LendingSource): Promise<Map<string, Snapshot>> {
  const out = new Map<string, Snapshot>();
  if (!supabaseAdmin) return out;
  const { data, error } = await supabaseAdmin
    .from("point_snapshots")
    .select("wallet, usd_value, block_number, taken_at")
    .eq("chain_id", chainId)
    .eq("source_slug", source)
    .order("taken_at", { ascending: false })
    .limit(5000);
  if (error) throw new Abort(`previous snapshots: ${error.message}`);
  for (const r of data ?? []) {
    const w = String(r.wallet).toLowerCase();
    if (out.has(w)) continue;
    out.set(w, {
      wallet: w,
      chainId,
      sourceSlug: source,
      usdValue: Number(r.usd_value),
      blockNumber: Number(r.block_number),
      takenAt: new Date(r.taken_at),
    });
  }
  return out;
}

/** Readings from multicall, failing the run if any did not land. */
async function readAll(chainId: number, calls: Call[], what: string): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let i = 0; i < calls.length; i += MULTICALL_CHUNK) {
    const res = await readContracts(chainId, calls.slice(i, i + MULTICALL_CHUNK));
    const missed = res.filter((r) => !r.success).length;
    if (missed) throw new Abort(`${missed} ${what} read(s) did not land`);
    out.push(...res.map((r) => r.value));
  }
  return out;
}

async function handle(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return Response.json({ error: "not enabled" }, { status: 503 });
  if (!authorised(req, secret)) return Response.json({ error: "unauthorised" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const dryRun = ["1", "true"].includes((params.get("dryRun") ?? "").toLowerCase());
  const requested = Number(params.get("chainId") ?? ARC);
  if (!Number.isInteger(requested)) return Response.json({ error: "bad chainId" }, { status: 400 });
  if (requested !== ARC && !dryRun) {
    return Response.json({ error: "only Arc (5042) accrues; other chains are dry-run only" }, { status: 400 });
  }
  const chainId = requested;
  if (!dryRun && !supabaseAdmin) return Response.json({ skipped: "no-admin-client" });

  const diamondAddress = getContracts(chainId)?.diamond;
  if (!diamondAddress) return Response.json({ skipped: "no-diamond", chainId });
  const provider = providerForChain(chainId);
  if (!provider) return Response.json({ skipped: "no-provider", chainId });

  const notes: string[] = [];
  try {
    // Chain gate + multiplier (point_chains); a disabled chain accrues nothing.
    let chainMultiplier = 1;
    if (supabaseAdmin) {
      const { data: chainRow } = await supabaseAdmin
        .from("point_chains")
        .select("enabled, multiplier")
        .eq("chain_id", chainId)
        .maybeSingle();
      if (!chainRow?.enabled && !dryRun) return Response.json({ skipped: "chain-disabled", chainId });
      chainMultiplier = Number(chainRow?.multiplier ?? 1) || 1;
    }

    const rates = {} as Record<LendingSource, Awaited<ReturnType<typeof loadRate>>>;
    const nowIso = new Date().toISOString();
    for (const s of LENDING_SOURCES) {
      const base = await loadRate(s, SEASON);
      rates[s] = base ? withCampaignBoost(base, await loadCampaignMultiplier(s, SEASON, nowIso)) : null;
    }

    const head = (await retryRpc(() => provider.getBlockNumber())) - REORG_MARGIN;
    const block = await retryRpc(() => provider.getBlock(head));
    const takenAt = new Date((block?.timestamp ?? Math.floor(Date.now() / 1000)) * 1000);

    // ── depositors from CollateralDeposited logs, resuming at the cursor
    let fromBlock: number;
    let cursorUsable = Boolean(supabaseAdmin);
    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from("points_lend_cursor")
        .select("last_block")
        .eq("chain_id", chainId)
        .maybeSingle();
      if (error) {
        cursorUsable = false;
        notes.push(`cursor unavailable (${error.code ?? error.message}) — scanned the last ${LOOKBACK} blocks`);
        fromBlock = Math.max(0, head - LOOKBACK + 1);
      } else if (data) {
        fromBlock = Number(data.last_block) + 1;
      } else {
        const start = Number(process.env.POINTS_LEND_FROM_BLOCK ?? NaN);
        fromBlock = Number.isFinite(start) ? start : Math.max(0, head - LOOKBACK + 1);
        if (!Number.isFinite(start)) notes.push("no cursor yet and POINTS_LEND_FROM_BLOCK unset — started from the lookback");
      }
    } else {
      fromBlock = Math.max(0, head - LOOKBACK + 1);
    }
    const scanTo = Math.min(head, fromBlock + MAX_BLOCKS - 1);
    const depositors = new Set<string>();
    for (let from = fromBlock; from <= scanTo; from += SPAN) {
      const to = Math.min(scanTo, from + SPAN - 1);
      const logs = await retryRpc(() =>
        provider.getLogs({ address: diamondAddress, topics: [DEPOSITED_TOPIC], fromBlock: from, toBlock: to }),
      );
      for (const l of logs) depositors.add(ethers.getAddress("0x" + l.topics[1].slice(26)).toLowerCase());
      if (DELAY_MS) await sleep(DELAY_MS);
    }
    if (scanTo < head) notes.push(`log backlog: scanned to ${scanTo}, head ${head}; the rest next run`);

    // ── the request book: every author and lender; serviced loans value lend/borrow
    const diamond = new ethers.Contract(diamondAddress, protocol, provider);
    const all = (await retryRpc(() => diamond.getAllRequests(0, 100_000))) as ethers.Result[];
    const loans: ServicedLoan[] = [];
    const participants = new Set<string>();
    for (const r of all) {
      const author = String(r.author).toLowerCase();
      const lender = String(r.lender).toLowerCase();
      participants.add(author);
      if (lender !== ethers.ZeroAddress) participants.add(lender);
      if (BigInt(r.status) === 1n) {
        loans.push({
          author,
          lender,
          token: String(r.loanRequestAddr).toLowerCase(),
          amount: BigInt(r.amount),
          totalRepayment: BigInt(r.totalRepayment),
        });
      }
    }

    const prev = {} as Record<LendingSource, Map<string, Snapshot>>;
    for (const s of LENDING_SOURCES) prev[s] = dryRun && !supabaseAdmin ? new Map() : await previousSnapshots(chainId, s);

    const wallets = new Set<string>([...depositors, ...participants]);
    for (const s of LENDING_SOURCES) for (const w of prev[s].keys()) wallets.add(w);
    for (const w of EXCLUDE) wallets.delete(w);
    const walletList = [...wallets];

    // ── free collateral per wallet × collateral token, in one multicall stream
    const collateral = ((await retryRpc(() => diamond.getAllCollateralToken())) as string[]).map((t) => t.toLowerCase());
    const pairs = walletList.flatMap((w) => collateral.map((t) => [w, t] as const));
    const balances = await readAll(
      chainId,
      pairs.map(([w, t]) => ({ target: diamondAddress, iface: protocol, method: "gets_addressToAvailableBalance", args: [w, t], allowFailure: false })),
      "free-collateral",
    );
    const free: FreeBalance[] = pairs.map(([w, t], i) => ({ wallet: w, token: t, amount: BigInt(balances[i] as bigint) }));

    // ── price every token a position uses (independent source: DEX quotes)
    const tokenSet = new Set<string>([...collateral, ...loans.map((l) => l.token)]);
    const erc20s = [...tokenSet].filter((t) => t !== NATIVE);
    const decs = await readAll(
      chainId,
      erc20s.map((t) => ({ target: t, iface: erc20, method: "decimals", allowFailure: false })),
      "decimals",
    );
    const decimals = new Map<string, number>(erc20s.map((t, i) => [t, Number(decs[i])]));
    const quoted = await dexTokenPrices(chainId, erc20s.map((t) => ({ address: t, decimals: decimals.get(t)! })));
    const tokens = new Map<string, TokenInfo>();
    for (const t of erc20s) tokens.set(t, { decimals: decimals.get(t)!, usd: quoted[t] ?? null });
    tokens.set(NATIVE, { decimals: 18, usd: NATIVE_IS_USDC.has(chainId) ? 1 : null });

    const values = lendingUsd({ loans, free, tokens, exclude: EXCLUDE });
    if (values.unpriced.length) {
      // Only a token some wallet actually holds matters; still, never write partial values.
      if (!dryRun) throw new Abort(`unpriced: ${values.unpriced.join(",")}`);
      notes.push(`unpriced (dry run continues): ${values.unpriced.join(",")}`);
    }

    // ── accrue + snapshot, per source
    const summary: Record<string, { wallets: number; usd: number; epochs: number; points: number; snapshots: number }> = {};
    const skips: Record<string, number> = {};
    for (const s of LENDING_SOURCES) {
      const current = values.bySource[s];
      const rate = rates[s];
      const sum = { wallets: current.size, usd: 0, epochs: 0, points: 0, snapshots: 0 };
      for (const usd of current.values()) sum.usd += usd;
      const series = new Set<string>([...current.keys(), ...prev[s].keys()]);
      for (const wallet of series) {
        if (EXCLUDE.has(wallet)) continue;
        const usd = current.get(wallet) ?? 0;
        const snap: Snapshot = { wallet, chainId, sourceSlug: s, usdValue: usd, blockNumber: head, takenAt };
        const previous = prev[s].get(wallet);
        if (previous && rate) {
          const epoch = accrueInterval(previous, snap, rate, SEASON, chainMultiplier);
          if (epoch) {
            sum.epochs++;
            sum.points += epoch.points;
            if (!dryRun) {
              const { error } = await supabaseAdmin!.from("point_epochs").insert({
                wallet: epoch.wallet,
                chain_id: epoch.chainId,
                source_slug: epoch.sourceSlug,
                season: epoch.season,
                epoch_start: epoch.epochStart.toISOString(),
                epoch_end: epoch.epochEnd.toISOString(),
                usd_seconds: epoch.usdSeconds,
                points: epoch.points,
              });
              if (error && error.code !== "23505") skips[`epoch:${error.code}`] = (skips[`epoch:${error.code}`] ?? 0) + 1;
            }
          }
        }
        if (usd > 0 || previous) {
          sum.snapshots++;
          if (!dryRun) {
            const { error } = await supabaseAdmin!.from("point_snapshots").insert({
              wallet,
              chain_id: chainId,
              source_slug: s,
              usd_value: usd,
              block_number: head,
              taken_at: takenAt.toISOString(),
            });
            if (error && error.code !== "23505") skips[`snapshot:${error.code}`] = (skips[`snapshot:${error.code}`] ?? 0) + 1;
          }
        }
      }
      summary[s] = { ...sum, usd: Math.round(sum.usd * 100) / 100, points: Math.round(sum.points) };
    }

    // The cursor advances only after the scanned range's wallets were snapshotted.
    if (!dryRun && cursorUsable) {
      const { error } = await supabaseAdmin!
        .from("points_lend_cursor")
        .upsert({ chain_id: chainId, last_block: scanTo, updated_at: new Date().toISOString() });
      if (error) notes.push(`cursor not advanced: ${error.message}`);
    }

    return Response.json({
      chainId,
      dryRun,
      block: head,
      scanned: { from: fromBlock, to: scanTo, depositors: depositors.size },
      wallets: walletList.length,
      loans: loans.length,
      sources: summary,
      rates: Object.fromEntries(LENDING_SOURCES.map((s) => [s, rates[s]?.rate ?? null])),
      chainMultiplier,
      skips,
      notes,
    });
  } catch (err) {
    const detail = String((err as Error)?.message ?? err).slice(0, 180);
    return Response.json(
      { error: err instanceof Abort ? "aborted-nothing-written" : "accrual-failed", detail, notes },
      { status: 502 },
    );
  }
}

export const GET = handle;
export const POST = handle;
