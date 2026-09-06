import { ethers } from "ethers";

import kaleidoAbi from "@/abi/ProtocolFacet.json";
import { CHAINS, CHAINS_BY_ID } from "@/constants/chains";
import { getContracts, tradableChains } from "@/constants/registry";
import { retryRpc } from "@/lib/dex/rpcRetry";
import { supabaseAdmin } from "@/lib/supabase/serverClient";

/**
 * The pre-liquidation warning, sent from the server instead of from a tab.
 *
 * `lib/notifications/emit.ts` calls the health-factor warning "the one alert in
 * this app that has to arrive". It does not. `useGetValueAndHealth.ts` reads
 * `getHealthFactor` in an effect keyed on `[address, activeAccount, isClient,
 * refreshNonce]` — no interval — so the warning fires when a wallet connects and
 * then never again until something else re-renders the hook. A position that
 * drifts toward liquidation while the laptop is shut is a position nobody is told
 * about, and that is precisely the case the whole web-push stack
 * (`public/sw.js`, `/api/push/send`, `push_subscriptions`) was built to cover.
 *
 * This is the server-side half. `/api/health/watch` is the door; everything about
 * what gets warned, what does not, and why lives here.
 *
 * ── Why this reads a view instead of scanning events ────────────────────────
 *
 * `scripts/push-watcher.mjs` derives its work from logs because an event is the
 * thing it reports: a liquidation happened, at a block, once. Deriving a *level*
 * that way is the wrong shape twice over. It needs `RequestServiced` minus
 * `LoanRepayment(outstanding == 0)` minus `RequestLiquidated` to reconstruct a
 * set the chain already stores, and a cursor seeded at head — which is what
 * push_watch_state correctly does, because a backlog of events is not news —
 * would monitor nobody at all, because every currently-open loan was funded in
 * the past. The set would need a one-time backfill to be correct on day one, and
 * the backfill would have to enumerate every request anyway.
 *
 * `getServicedRequests()` is that enumeration, done on chain, in one `eth_call`:
 * every request whose status is SERVICED, which is exactly "has an open debt".
 * No cursor, no backfill, no drift — a run's view of who is borrowing is the
 * chain's own view at the block it read. The bounded fallback below exists for
 * the one way this can fail.
 *
 * ── The cooldown is the whole design problem ────────────────────────────────
 *
 * A level persists. Someone sitting at 1.02 is still at 1.02 fifteen minutes
 * later, so a monitor that warns whenever it sees an unhealthy position sends the
 * same warning ninety-six times a day, and the alert that has to arrive is the
 * one the user turned off. `health_watch_state` therefore records when each
 * (wallet, chain) was last warned and at what level, and this sends only when
 * nothing has been sent inside COOLDOWN_MS, or the position has got materially
 * worse since whatever was last sent.
 *
 * The client has the same idea and cannot make it stick: its window lives on
 * `window.__kaleido_last_health_warning`, so every page reload re-arms it. That
 * is the difference a table makes.
 */

/**
 * Warn at or below this, in real units. 1.0 is liquidation.
 *
 * The same 1.05 the client uses, and deliberately not a "better" number: two
 * surfaces disagreeing about what counts as dangerous is how a user gets a push
 * saying they are at risk and a portfolio page saying they are fine.
 */
export const WARN_AT = 1.05;

/**
 * Silence after a warning, per wallet per chain.
 *
 * Six hours, against a 15-minute cron. The bound worth reasoning about is not
 * "how often is it safe to nag" but "how long can a position be unhealthy before
 * a *second* mention is news again" — and for a testnet position the answer is
 * hours, not minutes. Shorter and a slow drift becomes a stream of identical
 * notifications; much longer and a user who dismissed one at 2am gets nothing for
 * the working day.
 *
 * WORSENED_BY is the escape hatch that keeps the long window honest: a real
 * deterioration is not silenced by it.
 */
export const COOLDOWN_MS = 6 * 60 * 60 * 1000;

/**
 * Re-warn inside the cooldown if the factor fell this far below the warned level.
 *
 * 0.02 of a health factor is about 2% of collateral value — small enough that a
 * genuine slide gets a second mention within the hour, large enough that price
 * noise on a stablecoin feed does not. Without it the cooldown would be a gag:
 * warn once at 1.04 and say nothing while the position walks to 1.001.
 */
export const WORSENED_BY = 0.02;

/** Scale for the contract's 1e18-fixed-point health factor. */
const HEALTH_SCALE = 1e-18;

/**
 * `_healthFactor` returns `type(uint256).max` for an account with no debt
 * (ProtocolFacet.sol:2455). Tested on the bigint before scaling, because
 * `Number(2**256)` is `Infinity` — which happens to compare correctly here, but
 * only by luck, and the client mirrors this the same way for the same reason.
 */
const NO_DEBT_SENTINEL = (1n << 256n) - 1n;

/**
 * Cap on the fallback scan, and the reason it is a fallback.
 *
 * `getServicedRequests()` returns an unbounded array: it is a view, so it costs
 * no gas, but it is still one ABI-encoded response and a node will refuse one
 * large enough. If that happens the borrower set must still be found, so this
 * walks ids newest-first with `getRequest(n)` the way `lib/lending/book.ts` walks
 * the open book — and unlike the book read, a partial answer here is a real loss
 * (an unwarned borrower), so it is reported as `truncated` rather than passed off
 * as the whole set.
 */
const FALLBACK_SCAN_CAP = 400;

/** Concurrency for the per-wallet health reads. Public testnet RPCs, so modest. */
const BATCH = 10;

/** Status.SERVICED — model/Protocol.sol:90. An open debt. */
const STATUS_SERVICED = 1;

export interface WalletHealth {
  wallet: string;
  /** Health factor in real units, or null when the read failed. */
  health: number | null;
  /** Why nothing was sent, when nothing was. */
  skipped?: "healthy" | "no-debt" | "cooldown" | "unreadable" | "unsubscribed";
  /** True when a push was sent, or would have been on a live run. */
  warned?: boolean;
}

export interface ChainHealthReport {
  chainId: number;
  network: string;
  status: "ok" | "skipped" | "failed";
  /** Present when status is "skipped" or "failed". */
  reason?: string;
  /** How the borrower set was obtained. */
  source?: "serviced-view" | "id-scan";
  /** True when the id-scan hit its cap, so some borrowers were not looked at. */
  truncated?: boolean;
  borrowers: number;
  checked: number;
  warned: number;
  failed: number;
  wallets: WalletHealth[];
}

export interface HealthWatchResult {
  dryRun: boolean;
  /** Sum across chains, so a monitor can read one number. */
  warned: number;
  wouldWarn: number;
  failed: number;
  subscribed: number | null;
  chains: ChainHealthReport[];
}

interface StateRow {
  wallet: string;
  chain_id: number;
  last_warned_at: string | null;
  last_health: number | null;
}

/**
 * The copy, lifted from `sendHealthFactorWarning` in lib/notifications/emit.ts so
 * a push reads identically whether the tab was open or shut — the same rule
 * push-watcher.mjs follows for its three events. `category` is what
 * lib/notifications/taxonomy.ts maps `health_factor_warning` to.
 */
function healthNews(health: number) {
  return {
    title: "Health factor warning",
    body: `Your health factor is ${health.toFixed(3)}. Add collateral or repay to avoid liquidation.`,
    category: "risk",
  };
}

function providerFor(chainId: number): ethers.JsonRpcProvider | null {
  const meta = CHAINS_BY_ID[chainId];
  if (!meta?.rpcUrls?.length) return null;
  /* This module's own provider rather than config/provider.ts's cache, which
     exists for the browser read path and pins one chain — the same choice
     lib/keeper/pushFeeds.ts makes, for the same reason. */
  return new ethers.JsonRpcProvider(
    meta.rpcUrls[0],
    { chainId, name: meta.name },
    { staticNetwork: true },
  );
}

/**
 * Every address with an open debt on this chain, lowercased and deduplicated.
 *
 * One wallet can author several serviced requests, and a health factor is a
 * property of the account rather than of a request, so the set is what matters
 * and the request ids are dropped.
 */
async function borrowersOf(diamond: ethers.Contract): Promise<{
  wallets: string[];
  source: "serviced-view" | "id-scan";
  truncated: boolean;
}> {
  try {
    const rows = await retryRpc(() => diamond.getServicedRequests());
    const set = new Set<string>();
    for (const r of rows) {
      const author = String(r.author ?? r[2]).toLowerCase();
      if (author && author !== ethers.ZeroAddress) set.add(author);
    }
    return { wallets: [...set], source: "serviced-view", truncated: false };
  } catch (err) {
    /* Not swallowed silently: falling back is cheap, but doing so without a line
       in the log means a chain quietly switching to a bounded scan looks exactly
       like one that is fine. */
    console.warn(
      "[health/watch] getServicedRequests failed, falling back to an id scan:",
      err instanceof Error ? err.message : err,
    );
  }

  const total = Number(await retryRpc(() => diamond.getRequestId()));
  if (!Number.isFinite(total)) {
    throw new Error("getRequestId did not return a number");
  }

  const set = new Set<string>();
  let scanned = 0;
  let id = total;
  while (id >= 1 && scanned < FALLBACK_SCAN_CAP) {
    const batch: number[] = [];
    while (
      id >= 1 &&
      batch.length < BATCH &&
      scanned + batch.length < FALLBACK_SCAN_CAP
    ) {
      batch.push(id);
      id -= 1;
    }
    scanned += batch.length;
    const authors = await Promise.all(
      batch.map(async (n) => {
        try {
          const r = await retryRpc(() => diamond.getRequest(n));
          if (Number(r.status) !== STATUS_SERVICED) return null;
          return String(r.author).toLowerCase();
        } catch {
          /* An unwritten id reverts Protocol__IdNotExist. Dropped rather than
             aborting: one bad id must not empty the borrower set. */
          return null;
        }
      }),
    );
    for (const a of authors) if (a) set.add(a);
  }

  return {
    wallets: [...set],
    source: "id-scan",
    truncated: id >= 1,
  };
}

/** The wallets that have ever enabled push. Null when Supabase is unconfigured. */
async function subscribedWallets(): Promise<Set<string> | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("wallet")
    .not("wallet", "is", null);
  if (error) throw new Error(`subscription list: ${error.message}`);
  return new Set((data ?? []).map((r) => String(r.wallet).toLowerCase()));
}

async function readState(
  chainId: number,
  wallets: string[],
): Promise<Map<string, StateRow>> {
  const out = new Map<string, StateRow>();
  if (!supabaseAdmin || wallets.length === 0) return out;
  const { data, error } = await supabaseAdmin
    .from("health_watch_state")
    .select("wallet, chain_id, last_warned_at, last_health")
    .eq("chain_id", chainId)
    .in("wallet", wallets);
  if (error) throw new Error(`state read (${chainId}): ${error.message}`);
  for (const row of (data ?? []) as StateRow[]) {
    out.set(String(row.wallet).toLowerCase(), row);
  }
  return out;
}

/**
 * Whether this level is news, given what was last sent.
 *
 * Split out and exported because it is the only part of this module with no I/O
 * in it, and it is the part a mistake in is invisible — an over-eager rule sends
 * a duplicate, which is annoying, and an over-cautious one withholds a
 * liquidation warning, which is the failure this whole file exists to prevent.
 */
export function shouldWarn(
  health: number,
  prev:
    { last_warned_at: string | null; last_health: number | null } | undefined,
  now: number,
): boolean {
  if (health > WARN_AT) return false;
  if (!prev?.last_warned_at) return true;
  const age = now - Date.parse(prev.last_warned_at);
  /* An unparseable timestamp is treated as no warning rather than as a recent
     one: erring toward a duplicate is the safe direction here. */
  if (!Number.isFinite(age) || age >= COOLDOWN_MS) return true;
  const before = prev.last_health;
  return before !== null && health <= before - WORSENED_BY;
}

async function sendWarning(
  appUrl: string,
  secret: string,
  wallet: string,
  health: number,
): Promise<void> {
  const news = healthNews(health);
  const res = await fetch(`${appUrl}/api/push/send`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kaleido-push-secret": secret,
    },
    body: JSON.stringify({
      wallet,
      title: news.title,
      body: news.body,
      category: news.category,
      /* Actionable: unlike the three counterparty events push-watcher sends,
         this one is asking for something — add collateral or repay — and the
         service worker reserves requireInteraction for exactly that. */
      actionable: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `POST /api/push/send → ${res.status} ${text.slice(0, 200)}`,
    );
  }
}

async function watchChain(
  chainId: number,
  subs: Set<string> | null,
  opts: { dryRun: boolean; appUrl: string; pushSecret: string; only?: string },
): Promise<ChainHealthReport> {
  const meta = CHAINS_BY_ID[chainId];
  const report: ChainHealthReport = {
    chainId,
    network: meta?.name ?? String(chainId),
    status: "ok",
    borrowers: 0,
    checked: 0,
    warned: 0,
    failed: 0,
    wallets: [],
  };

  const diamondAddress = getContracts(chainId).diamond;
  if (!diamondAddress || !ethers.isAddress(diamondAddress)) {
    return { ...report, status: "skipped", reason: "no diamond recorded" };
  }
  const provider = providerFor(chainId);
  if (!provider) {
    return { ...report, status: "skipped", reason: "no RPC URL" };
  }

  const diamond = new ethers.Contract(diamondAddress, kaleidoAbi, provider);

  let found: Awaited<ReturnType<typeof borrowersOf>>;
  try {
    found = await borrowersOf(diamond);
  } catch (err) {
    return {
      ...report,
      status: "failed",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
  report.source = found.source;
  report.truncated = found.truncated;
  report.borrowers = found.wallets.length;

  /* Prefiltered to wallets that could actually receive a push. Not a
     micro-optimisation: without it every run reads a health factor for every
     borrower on five chains to decide, at the end, that there was nowhere to send
     it — and `/api/push/send` would answer `sent: 0` to each. A wallet with no
     subscription is reported rather than dropped, because "nobody was warned" and
     "nobody could be warned" are different operational facts.

     `subs === null` means Supabase is unconfigured, which is the local dry-run
     case; there is no list to filter against, so every borrower is checked. */
  let candidates = found.wallets;
  if (opts.only) {
    candidates = candidates.filter((w) => w === opts.only);
  }
  if (subs) {
    for (const w of candidates) {
      if (!subs.has(w))
        report.wallets.push({
          wallet: w,
          health: null,
          skipped: "unsubscribed",
        });
    }
    candidates = candidates.filter((w) => subs.has(w));
  }

  /* Read the levels first, then the state, then decide. One `.in()` query for
     the whole chain rather than a row per wallet — and only for the wallets whose
     level came back inside the band, so a chain where everyone is healthy costs
     no database read at all. */
  const levels: { wallet: string; health: number | null; noDebt: boolean }[] =
    [];
  for (let i = 0; i < candidates.length; i += BATCH) {
    const slice = candidates.slice(i, i + BATCH);
    const read = await Promise.all(
      slice.map(async (wallet) => {
        try {
          const raw: bigint = await retryRpc(() =>
            diamond.getHealthFactor(wallet),
          );
          if (BigInt(raw) === NO_DEBT_SENTINEL) {
            return { wallet, health: null, noDebt: true };
          }
          return {
            wallet,
            health: Number(raw.toString()) * HEALTH_SCALE,
            noDebt: false,
          };
        } catch (err) {
          /* A failed read is NOT a healthy position. `getHealthFactor` prices
             collateral, so it reverts `Protocol__StalePrice` on a chain whose
             feed has aged out — which is a chain where liquidation is also
             impossible, but it is not a chain where everyone is safe. Counted as
             a failure so the run is red and an operator looks. */
          console.warn(
            `[health/watch] ${chainId} getHealthFactor(${wallet}) failed:`,
            err instanceof Error ? err.message : err,
          );
          return { wallet, health: null, noDebt: false };
        }
      }),
    );
    levels.push(...read);
  }
  report.checked = levels.length;

  const atRisk = levels.filter((l) => l.health !== null && l.health <= WARN_AT);
  const state = await readState(
    chainId,
    atRisk.map((l) => l.wallet),
  );
  const now = Date.now();

  for (const level of levels) {
    if (level.noDebt) {
      report.wallets.push({
        wallet: level.wallet,
        health: null,
        skipped: "no-debt",
      });
      continue;
    }
    if (level.health === null) {
      report.failed += 1;
      report.wallets.push({
        wallet: level.wallet,
        health: null,
        skipped: "unreadable",
      });
      continue;
    }
    if (level.health > WARN_AT) {
      report.wallets.push({
        wallet: level.wallet,
        health: level.health,
        skipped: "healthy",
      });
      continue;
    }
    if (!shouldWarn(level.health, state.get(level.wallet), now)) {
      report.wallets.push({
        wallet: level.wallet,
        health: level.health,
        skipped: "cooldown",
      });
      continue;
    }

    if (opts.dryRun) {
      report.warned += 1;
      report.wallets.push({
        wallet: level.wallet,
        health: level.health,
        warned: true,
      });
      continue;
    }

    try {
      await sendWarning(
        opts.appUrl,
        opts.pushSecret,
        level.wallet,
        level.health,
      );
      /* Written only after the send succeeded. The other order — record then
         send — would set a six-hour cooldown on a warning that never went out,
         which is the one bug in this file that loses a liquidation rather than
         duplicating one. */
      if (supabaseAdmin) {
        const { error } = await supabaseAdmin.from("health_watch_state").upsert(
          {
            wallet: level.wallet,
            chain_id: chainId,
            last_warned_at: new Date(now).toISOString(),
            last_health: level.health,
            last_check_at: new Date(now).toISOString(),
          },
          { onConflict: "wallet,chain_id" },
        );
        if (error) {
          /* The push went out. A failed state write means the next run may send
             it again, which is the acceptable half of the tradeoff — so this is
             a logged warning and a counted failure, not a thrown error that
             would abandon the remaining wallets on this chain. */
          console.error(
            `[health/watch] state write failed for ${chainId}: ${error.message}`,
          );
          report.failed += 1;
        }
      }
      report.warned += 1;
      report.wallets.push({
        wallet: level.wallet,
        health: level.health,
        warned: true,
      });
    } catch (err) {
      /* One wallet's send failing must not stop the others: the next-most-at-risk
         borrower is the one most likely to be behind it in the list. */
      console.error(
        `[health/watch] send failed for ${level.wallet} on ${chainId}:`,
        err instanceof Error ? err.message : err,
      );
      report.failed += 1;
      report.wallets.push({ wallet: level.wallet, health: level.health });
    }
  }

  /* Liveness for every wallet that was looked at, warned or not. This is what
     distinguishes "no warnings because everyone is healthy" from "no warnings
     because the monitor stopped running a week ago" — the two are identical from
     the outside, and only one of them is fine. Deliberately not part of the
     warning write above: a failure here must not affect a delivered push, so it
     is a fire-and-forget update after the decisions are made. */
  if (!opts.dryRun && supabaseAdmin && candidates.length > 0) {
    const { error } = await supabaseAdmin.from("health_watch_state").upsert(
      candidates.map((wallet) => ({
        wallet,
        chain_id: chainId,
        last_check_at: new Date(now).toISOString(),
      })),
      { onConflict: "wallet,chain_id", ignoreDuplicates: false },
    );
    if (error) {
      console.warn(
        `[health/watch] liveness write failed for ${chainId}: ${error.message}`,
      );
    }
  }

  return report;
}

/**
 * Check every borrower on every requested chain and warn the ones at risk.
 *
 * Per-chain failures are reported rather than thrown, like
 * `pushSelfHostedFeeds`: one RPC outage must not stop the other four chains, and
 * the caller turns `failed > 0` into a non-200 so a cron monitor sees red.
 */
export async function runHealthWatch(opts: {
  chainIds?: number[];
  dryRun?: boolean;
  /** Restrict to one wallet, for testing a real position by hand. */
  wallet?: string;
}): Promise<HealthWatchResult> {
  const appUrl = (
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    ""
  ).replace(/\/+$/, "");
  const pushSecret = process.env.PUSH_SEND_SECRET || "";
  /* Dry when asked, and dry when it could not send anyway. The second half is
     the important one: without it an unconfigured deployment would do every read,
     report warnings it never delivered, and advance the cooldown so the next run
     said nothing. The same shape as scripts/push-watcher.mjs, which is a dry run
     until both of these exist. */
  const dryRun = Boolean(opts.dryRun) || !appUrl || !pushSecret;

  const requested = opts.chainIds?.length
    ? opts.chainIds
    : tradableChains(CHAINS).map((c) => c.id);

  const subs = await subscribedWallets();
  const only = opts.wallet?.toLowerCase();

  const chains: ChainHealthReport[] = [];
  for (const chainId of requested) {
    try {
      chains.push(
        await watchChain(chainId, subs, { dryRun, appUrl, pushSecret, only }),
      );
    } catch (err) {
      chains.push({
        chainId,
        network: CHAINS_BY_ID[chainId]?.name ?? String(chainId),
        status: "failed",
        reason: err instanceof Error ? err.message : String(err),
        borrowers: 0,
        checked: 0,
        warned: 0,
        failed: 1,
        wallets: [],
      });
    }
  }

  const sum = (pick: (c: ChainHealthReport) => number) =>
    chains.reduce((n, c) => n + pick(c), 0);

  return {
    dryRun,
    warned: dryRun ? 0 : sum((c) => c.warned),
    wouldWarn: dryRun ? sum((c) => c.warned) : 0,
    failed:
      sum((c) => c.failed) + chains.filter((c) => c.status === "failed").length,
    subscribed: subs ? subs.size : null,
    chains,
  };
}
