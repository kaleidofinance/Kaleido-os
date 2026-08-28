/**
 * Browser-closed push — the trigger half.
 *
 *   node --import tsx scripts/push-watcher.mjs        (or: npm run watch:push)
 *
 * The delivery half already exists and is complete: public/sw.js renders a push,
 * /api/push/send encrypts and sends one to a wallet's stored subscriptions, and
 * src/lib/notifications/push.ts is what a browser calls to subscribe. What was
 * missing is the thing that *fires* a send when the browser is shut — the send
 * route's own header names its callers as "our own server-side jobs", and this is
 * that job.
 *
 * useProtocolEvents.ts already turns three on-chain events into notifications, but
 * only while a tab is open: it subscribes over a WebSocket from the browser and
 * dies with the page. That is exactly the case web push exists to cover. This
 * script watches the same three events server-side, across every deployed chain,
 * and POSTs to /api/push/send for the counterparty each one is news to — so the
 * alert that matters most, a liquidation, reaches a closed laptop.
 *
 *   RequestServiced(_requestId, _lender, _borrower, …)   → the BORROWER: funded.
 *   LoanRepayment(sender, lender, id, amount, outstanding) → the LENDER: repaid
 *                                                            (outstanding 0 = in full).
 *   RequestLiquidated(requestId, lenderAddress, borrowerAddress, …)
 *                                                          → BOTH parties.
 *
 * Which party each event is *for* is not a guess: it is the same mapping
 * useProtocolEvents encodes in its filters (RequestServiced on `_borrower`,
 * LoanRepayment on `lender`, RequestLiquidated on both), and the copy below is
 * lifted verbatim from src/lib/notifications/emit.ts so a push reads identically
 * whether the tab was open or shut. None of these bodies carries an amount: they
 * can surface on a lock screen, and the send route redacts per-subscription on
 * top of that.
 *
 * ── Why it defaults to a dry run ─────────────────────────────────────────────
 *
 * Like scripts/set-dex-fees.js, this signs nothing you did not ask for. With
 * PUSH_SEND_SECRET or APP_URL unset it runs as a DRY RUN: it reads the chains,
 * prints the pushes it *would* send, and POSTs none. Broadcasting is the thing
 * you opt into, by configuring both — the same shape as the price-keeper
 * workflow, which is inert until its secret exists and it is merged to the
 * default branch.
 *
 * ── State, and why it needs a table ──────────────────────────────────────────
 *
 * A cron that re-scanned an overlapping window would push the same liquidation
 * twice; one that scanned from genesis would flood every user with years of
 * historical events on first run. So the last block processed per chain is kept
 * in public.push_watch_state (service-role only, like push_subscriptions) and the
 * next run scans strictly after it. First sight of a chain seeds the checkpoint
 * to the head and notifies nothing — the backlog is not news. Cadence therefore
 * only affects latency, never correctness: a dropped or delayed run is caught up
 * by the next one from the checkpoint.
 *
 * Env:
 *   APP_URL                     Origin of the deployed app (e.g. https://app.example).
 *                               Required to broadcast; unset ⇒ dry run.
 *   PUSH_SEND_SECRET            Shared secret for /api/push/send. Unset ⇒ dry run.
 *   SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *                               Checkpoint store + the set of subscribed wallets.
 *                               Unset ⇒ no checkpoint (a fixed recent look-back is
 *                               scanned instead) and no wallet prefilter.
 *   RPC_URL_<chainId>           Override the public RPC for one chain (optional).
 *   CONFIRMATIONS               Blocks to stay behind head for reorg safety (default 5).
 *
 * TESTNET NOTE. The five chains here are testnets. Nothing about this script is
 * chain-privileged — it only reads logs and calls an authenticated HTTP endpoint
 * — so there is no key to guard, unlike the price keeper.
 */

import { ethers } from "ethers";

/* The dynamic-import-with-.ts idiom is how scripts/gen-registry.mjs pulls the
 * same source-of-truth data files under `node --import tsx`; both are plain data
 * (deployments.generated.ts imports only a `type`, chains.ts imports nothing), so
 * neither drags the Next runtime into this process. */
const { GENERATED_DEPLOYMENTS } = await import(
  "../src/constants/deployments.generated.ts"
);
const { CHAINS_BY_ID } = await import("../src/constants/chains.ts");

/* ── Config ─────────────────────────────────────────────────────────────────*/

const APP_URL = (process.env.APP_URL || "").replace(/\/+$/, "");
const PUSH_SEND_SECRET = process.env.PUSH_SEND_SECRET || "";
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const CONFIRMATIONS = Number(process.env.CONFIRMATIONS || "5");
/* eth_getLogs is range-capped on most public endpoints, and 1,000 is the tightest
 * cap across the five configured RPCs — measured 2026-08-27, not assumed. Sepolia's
 * thirdweb endpoint answers a 1,000-block span and rejects 2,000 with `-32005 Log
 * response size exceeded. Maximum allowed number of requested blocks is 1000`; Base
 * Sepolia, Robinhood and Arc all served 5,000. The previous value was 5,000, chosen
 * against "the usual 10k limit", which meant every scheduled run failed on Sepolia
 * before reading a single log.
 *
 * Two traps this walked into, worth keeping in mind before raising it again. Ethers
 * reports the rejection as `could not coalesce error` and `retry` only prints
 * `shortMessage`, so the real `-32005` text was invisible in CI — read `e.error`
 * when diagnosing. And a range cap is deterministic, so `retry`'s five attempts
 * could never clear it; five identical failures is the signature of a request that
 * is malformed for the endpoint rather than an endpoint under load. */
const RANGE = 1000;
/* A backstop on catch-up per run: if a chain fell far behind (a long outage),
 * process at most this many blocks now and continue from the new checkpoint next
 * run, rather than issue hundreds of getLogs in one invocation. This advances the
 * checkpoint — it is a bounded catch-up, not a skip — and is logged when it bites. */
const MAX_SCAN = 100_000;
/* First-run look-back when there is no checkpoint store at all (pure local dry
 * run): scan a small recent window so there is something to see, without a table. */
const DRY_LOOKBACK = 2_000;

const BROADCAST = Boolean(APP_URL && PUSH_SEND_SECRET);
const HAVE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

/* ── Event ABI (from smart-contract/contracts/model/Event.sol, not the generated
 *    ABI file — the events are declared there and the .sol is the authority) ── */
const EVENT_ABI = [
  "event RequestServiced(uint96 indexed _requestId, address indexed _lender, address indexed _borrower, uint256 _amount, address tokenAddress)",
  "event LoanRepayment(address indexed sender, address indexed lender, uint96 id, uint256 amount, uint256 outstanding)",
  "event RequestLiquidated(uint96 indexed requestId, address indexed lenderAddress, address indexed borrowerAddress, uint256 totalRepayment)",
];

/* ── Copy, lifted verbatim from src/lib/notifications/emit.ts ────────────────*/

function fundedNews(requestId) {
  return {
    title: "Your request was funded",
    body: `Request #${requestId} has been filled. The funds are in your wallet.`,
    category: "orders",
  };
}

function repaidNews(requestId, fullyRepaid) {
  return fullyRepaid
    ? {
        title: "A loan you funded was repaid",
        body: `Request #${requestId} has been repaid in full. The funds are in your available balance.`,
        category: "orders",
      }
    : {
        title: "Partial repayment received",
        body: `The borrower paid down part of request #${requestId}. It stays open until the balance is cleared.`,
        category: "orders",
      };
}

function liquidationNews(role, requestId) {
  return role === "borrower"
    ? {
        title: "Position liquidated",
        body: `Request #${requestId} was liquidated and your collateral was sold to repay it.`,
        category: "risk",
      }
    : {
        title: "A loan you funded was liquidated",
        body: `Request #${requestId} was liquidated. Your repayment came out of the borrower's collateral.`,
        category: "risk",
      };
}

/* ── Small helpers ───────────────────────────────────────────────────────────*/

/* Public testnet RPCs drop reads under no load at all — the same note the
 * smart-contract scripts carry. Reads are retried; the only write here (a POST to
 * our own route, and the checkpoint upsert) is not retried on this path. */
const retry = async (label, fn, n = 5) => {
  let last;
  for (let i = 1; i <= n; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < n) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error(
    `${label} failed after ${n} attempts: ${last?.shortMessage || last?.message || last}`,
  );
};

const rpcUrlFor = (id) =>
  process.env[`RPC_URL_${id}`] || CHAINS_BY_ID[id]?.rpcUrls?.[0] || "";

/* ── Supabase (checkpoint + subscribed-wallet set), lazily constructed ───────*/

let supabase = null;
async function getSupabase() {
  if (!HAVE_SUPABASE) return null;
  if (supabase) return supabase;
  const { createClient } = await import("@supabase/supabase-js");
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  return supabase;
}

async function readCheckpoint(chainId) {
  const db = await getSupabase();
  if (!db) return null;
  const { data, error } = await db
    .from("push_watch_state")
    .select("last_block")
    .eq("chain_id", chainId)
    .maybeSingle();
  if (error) throw new Error(`checkpoint read (${chainId}): ${error.message}`);
  return data ? Number(data.last_block) : null;
}

async function writeCheckpoint(chainId, lastBlock) {
  const db = await getSupabase();
  if (!db) return;
  const { error } = await db.from("push_watch_state").upsert(
    { chain_id: chainId, last_block: lastBlock, updated_at: new Date().toISOString() },
    { onConflict: "chain_id" },
  );
  if (error) throw new Error(`checkpoint write (${chainId}): ${error.message}`);
}

/* The wallets that have ever enabled push. Used to skip POSTing for a party who
 * could not receive one anyway — the send route already returns sent:0 for them,
 * but there is no reason to make the round trip. Null (feature off) means "don't
 * filter"; an empty set means "nobody subscribed, so nothing to send". */
async function subscribedWallets() {
  const db = await getSupabase();
  if (!db) return null;
  const { data, error } = await db
    .from("push_subscriptions")
    .select("wallet")
    .not("wallet", "is", null);
  if (error) throw new Error(`subscription list: ${error.message}`);
  return new Set((data ?? []).map((r) => String(r.wallet).toLowerCase()));
}

/* ── Sending ─────────────────────────────────────────────────────────────────*/

async function sendPush(wallet, news) {
  const res = await fetch(`${APP_URL}/api/push/send`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kaleido-push-secret": PUSH_SEND_SECRET,
    },
    body: JSON.stringify({
      wallet,
      title: news.title,
      body: news.body,
      category: news.category,
      // None of these are permission asks; the SW reserves requireInteraction for
      // actionable ones, matching emit.ts (these senders attach no request).
      actionable: false,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST /api/push/send → ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json().catch(() => ({}));
}

/* ── Per-chain scan ──────────────────────────────────────────────────────────*/

/** Decode the logs in [from, to] into { wallet, requestId, news, block, index }. */
async function collectTargets(contract, from, to) {
  const out = [];
  for (let lo = from; lo <= to; lo += RANGE) {
    const hi = Math.min(lo + RANGE - 1, to);
    const [serviced, repaid, liquidated] = await Promise.all([
      retry(`RequestServiced ${lo}-${hi}`, () =>
        contract.queryFilter(contract.filters.RequestServiced(), lo, hi),
      ),
      retry(`LoanRepayment ${lo}-${hi}`, () =>
        contract.queryFilter(contract.filters.LoanRepayment(), lo, hi),
      ),
      retry(`RequestLiquidated ${lo}-${hi}`, () =>
        contract.queryFilter(contract.filters.RequestLiquidated(), lo, hi),
      ),
    ]);

    for (const e of serviced) {
      const id = String(e.args._requestId);
      out.push({
        wallet: String(e.args._borrower).toLowerCase(),
        news: fundedNews(id),
        block: e.blockNumber,
        index: e.index,
      });
    }
    for (const e of repaid) {
      const id = String(e.args.id);
      out.push({
        wallet: String(e.args.lender).toLowerCase(),
        news: repaidNews(id, e.args.outstanding === 0n),
        block: e.blockNumber,
        index: e.index,
      });
    }
    for (const e of liquidated) {
      const id = String(e.args.requestId);
      out.push({
        wallet: String(e.args.borrowerAddress).toLowerCase(),
        news: liquidationNews("borrower", id),
        block: e.blockNumber,
        index: e.index,
      });
      out.push({
        wallet: String(e.args.lenderAddress).toLowerCase(),
        news: liquidationNews("lender", id),
        block: e.blockNumber,
        index: e.index,
      });
    }
  }
  // Deliver in the order the chain produced them.
  out.sort((a, b) => a.block - b.block || a.index - b.index);
  return out;
}

async function watchChain(chainId, subs) {
  const meta = CHAINS_BY_ID[chainId];
  const diamond = GENERATED_DEPLOYMENTS[chainId]?.diamond;
  const url = rpcUrlFor(chainId);
  const label = `${meta?.name || "chain"} (${chainId})`;

  if (!diamond || !ethers.isAddress(diamond)) {
    console.log(`\n${label}: no diamond recorded — skipping.`);
    return;
  }
  if (!url) {
    console.log(`\n${label}: no RPC URL (chains.ts + RPC_URL_${chainId}) — skipping.`);
    return;
  }

  const provider = new ethers.JsonRpcProvider(
    url,
    { chainId, name: meta.name },
    { staticNetwork: true },
  );
  const contract = new ethers.Contract(diamond, EVENT_ABI, provider);

  const head = await retry(`${label} head`, () => provider.getBlockNumber());
  const to = head - CONFIRMATIONS;
  if (to <= 0) {
    console.log(`\n${label}: chain too short (head ${head}) — skipping.`);
    return;
  }

  const checkpoint = HAVE_SUPABASE ? await readCheckpoint(chainId) : null;

  console.log(`\n${label}`);
  console.log(`  diamond ${diamond}`);
  console.log(`  head ${head}  scan-to ${to} (−${CONFIRMATIONS} conf)`);

  // Bootstrap: first sight of a chain with a store. Seed to head, notify nothing.
  if (HAVE_SUPABASE && checkpoint === null) {
    await writeCheckpoint(chainId, to);
    console.log(`  bootstrapped checkpoint to ${to} — historical events are not news.`);
    return;
  }

  let from = HAVE_SUPABASE ? checkpoint + 1 : Math.max(1, to - DRY_LOOKBACK);
  if (from > to) {
    console.log(`  nothing new since ${checkpoint}.`);
    return;
  }
  if (to - from + 1 > MAX_SCAN) {
    const capped = from + MAX_SCAN - 1;
    console.log(
      `  ! ${to - from + 1} blocks behind; capping this run at ${MAX_SCAN} ` +
        `(${from}-${capped}) and continuing next run.`,
    );
    // Bounded catch-up: process the older window now, advance the checkpoint to
    // its end, and let the next run pick up from there.
    return scanRange(chainId, contract, from, capped, subs, label);
  }

  return scanRange(chainId, contract, from, to, subs, label);
}

async function scanRange(chainId, contract, from, to, subs, label) {
  console.log(`  scanning ${from}-${to}…`);
  const targets = await collectTargets(contract, from, to);

  const deliverable = targets.filter((t) => !subs || subs.has(t.wallet));
  const skipped = targets.length - deliverable.length;
  console.log(
    `  ${targets.length} event-notification(s)` +
      (subs ? `, ${deliverable.length} to subscribed wallets (${skipped} without a subscription)` : ""),
  );

  for (const t of deliverable) {
    const line = `${t.news.title} → ${t.wallet} @ block ${t.block}`;
    if (!BROADCAST) {
      console.log(`    [dry] ${line}`);
      continue;
    }
    try {
      const r = await sendPush(t.wallet, t.news);
      console.log(`    sent: ${line}${typeof r?.sent === "number" ? ` (${r.sent} device[s])` : ""}`);
    } catch (err) {
      // One wallet's failure must not abort the run or advance the checkpoint
      // past events that never went out.
      console.error(`    FAILED: ${line} — ${err.message}`);
      throw err;
    }
  }

  if (BROADCAST && HAVE_SUPABASE) {
    await writeCheckpoint(chainId, to);
    console.log(`  checkpoint → ${to}.`);
  } else if (!BROADCAST) {
    console.log(`  dry run — checkpoint not advanced.`);
  }
}

/* ── Main ────────────────────────────────────────────────────────────────────*/

async function main() {
  console.log("Kaleido push watcher");
  console.log(`  mode:      ${BROADCAST ? "BROADCAST" : "DRY RUN (nothing sent)"}`);
  console.log(`  app url:   ${APP_URL || "(unset — dry run)"}`);
  console.log(`  state:     ${HAVE_SUPABASE ? "Supabase checkpoints" : "none (recent-window scan)"}`);
  if (!BROADCAST) {
    console.log(
      "  → Set APP_URL and PUSH_SEND_SECRET to broadcast. See .github/workflows/push-watcher.yml.",
    );
  }

  const chainIds = Object.keys(GENERATED_DEPLOYMENTS)
    .map(Number)
    .filter((id) => CHAINS_BY_ID[id]);

  const subs = await subscribedWallets();
  if (subs) console.log(`  subscribed wallets: ${subs.size}`);

  let failures = 0;
  for (const id of chainIds) {
    try {
      await watchChain(id, subs);
    } catch (err) {
      // Independent per chain, like the two jobs in price-keeper.yml: one RPC
      // outage must not stop the others, and a failed chain keeps its checkpoint.
      failures++;
      console.error(`\n${CHAINS_BY_ID[id]?.name || id}: ${err.message}`);
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Done. ${chainIds.length} chain(s), ${failures} failed.`);
  // A failed chain is a red run so the operator sees it, but a checkpoint was not
  // advanced past anything undelivered, so the next run retries cleanly.
  if (failures) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
