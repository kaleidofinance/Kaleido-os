#!/usr/bin/env node
/**
 * The filler. Sweeps every chain's resting orders and fills the ones that are due.
 *
 *   npm run keeper:orders                  every chain with a KaleidoOrders address
 *   ORDERS_CHAINS=11155111 npm run keeper:orders    one chain
 *   DRY_RUN=1 npm run keeper:orders        decide and log, send nothing
 *
 * This is the half of {src/lib/dex/fill.ts} that cannot be tested: RPC, a database
 * and a private key. Every decision it makes is made there, by a pure function
 * under test, and this file does nothing but fetch the inputs, send what it is told
 * to send, and write down what happened. When something here looks like a judgement
 * call, it belongs in fill.ts instead.
 *
 * WHY A KEEPER AT ALL. A signed order is fillable by anyone — that is the point of
 * paying the filler out of the input (`fillerFeeBps`) rather than out of the
 * protocol. Nobody is watching yet, so we run the only filler and absorb the gas;
 * the day someone else runs one, nothing about the contract or this table changes.
 *
 * WHAT IT CANNOT DO. Not lose a maker money. It chooses *when* to submit, never at
 * what price: the maker's own signed `minOut` is what the contract hands the router
 * as `amountOutMinimum`, and the output goes to the maker. A misjudged submission
 * reverts and costs this keeper the gas.
 *
 * TESTNET ONLY as written. DEPLOYER_PRIVATE_KEY is the burned testnet deployer and
 * is accepted here only as a fallback. A mainnet filler runs KEEPER_PRIVATE_KEY —
 * a dedicated key holding nothing but gas, whose only power is calling `fill`,
 * which needs no permission from anyone.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ethers } from "ethers";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/*
 * .env before the imports below, because the modules they pull in read
 * process.env at import time — the registry, the provider factory and the
 * Supabase clients all do. Hence the dynamic imports in main().
 *
 * Two files, and not interchangeably. The root .env holds the app's half (Supabase
 * URL and service role); the signer lives in smart-contract/.env, because that is
 * where hardhat reads DEPLOYER_PRIVATE_KEY from and there is no version of this
 * where the same key is written down twice. Root first, so an explicitly-set
 * variable always wins over a file, and a file never overwrites the environment.
 *
 * Absent is fine and is the normal case in CI, where the secrets arrive as real
 * environment variables. verify_leaderboard.mts requires the file because it is a
 * local tool; this runs on a schedule.
 */
for (const rel of [".env", path.join("smart-contract", ".env")]) {
  const envPath = path.join(ROOT, rel);
  if (!fs.existsSync(envPath)) continue;
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const k = line.slice(0, eq).trim();
    if (!process.env[k])
      process.env[k] = line
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
  }
}

/**
 * Only the four functions a filler calls. Written out rather than imported from
 * the artifacts so the script runs without a compile, and duplicated from
 * definitions.ts' `ORDERS_ABI` on purpose: that one is the wallet's half (cancel,
 * epoch) and this is the filler's, and a shared list would grow into a surface
 * both sides carry for the other's sake.
 */
const ORDER_TUPLE =
  "(address maker, address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, uint64 startAt, uint64 expiry, uint32 interval, uint32 maxFills, uint64 epoch, uint256 salt)";
const STATE_TUPLE = "(uint32 fills, uint64 lastFillAt, bool cancelled)";
const FILLER_ABI = [
  `function checkFill(${ORDER_TUPLE} o, bytes signature, bytes path) external view returns (bool ok, string reason)`,
  `function fill(${ORDER_TUPLE} o, bytes signature, bytes path) external returns (uint256 amountOut)`,
  `function stateOf(${ORDER_TUPLE} o) external view returns (${STATE_TUPLE} state)`,
  "function fillerFeeBps() external view returns (uint16)",
];

const QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)",
];

/** How many orders one cycle will spend RPC calls on, per chain. */
const PER_CYCLE = 25;

/**
 * A fill's gas. Measured, not guessed: the contract's own suite reports a
 * single-hop fill at just under 300k, and the ceiling is a multi-hop route.
 */
const GAS_PER_FILL = 400_000n;

/**
 * Warn when the keeper holds fewer than this many fills' worth of gas.
 *
 * Denominated in fills rather than in native, because a fixed native floor means
 * something different on every chain here. 0.005 — the obvious constant, and what
 * this was — is about twelve fills on Sepolia at 1 gwei, six hundred on Base at
 * 0.006, and *two thirds of one fill* on Arc at 21 gwei, where gas is priced in
 * USDC. A keeper one fill from stopping would have passed the check on the chain
 * where it mattered most and failed it on the chains where it did not.
 *
 * Twelve cycles of headroom at the current price, which on the keeper's
 * five-minute schedule is an hour to notice. Warned about rather than enforced:
 * refusing to run would turn a low-balance keeper into a dead one, and the reads
 * it does cost nothing.
 */
const LOW_GAS_FILLS = 12n;

const DRY = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";

/** Not a failed fill — a fill this keeper should not have attempted. See below. */
let bugs = 0;
let failed = 0;
const log = (m: string) => console.log(m);
const bug = (m: string) => {
  bugs++;
  console.log(`  !! ${m}`);
};

async function main() {
  const { DEPLOYMENTS, getContracts } = await import(
    "../src/constants/registry.ts"
  );
  const { chainTokenByAddress } = await import("../src/constants/tokens.ts");
  const { CHAINS_BY_ID } = await import("../src/constants/chains.ts");
  const { providerForChain } = await import("../src/config/provider.ts");
  const { FEE_TIERS } = await import("../src/lib/dex/liquidity.ts");
  const { retryRpc, isTransientRpcError } = await import(
    "../src/lib/dex/rpcRetry.ts"
  );
  const { pathFor, swapInputFor } = await import("../src/lib/dex/orders.ts");
  const { readFillableOrders, SWEEP_CEILING } = await import(
    "../src/lib/dex/orderStore.ts"
  );
  const { decideFill, reconcile, sweepable } = await import(
    "../src/lib/dex/fill.ts"
  );
  const { supabaseAdmin } = await import("../src/lib/supabase/serverClient.ts");

  console.log(`\nKaleido order filler${DRY ? " (dry run)" : ""}\n`);

  /* Both are structural: without the key nothing can be filled, and without the
     service role a fill that lands cannot be written down — which is worse than
     not filling, because the next cycle would fill it again the moment its
     interval allowed. Fail the run rather than half-work. */
  const pk = process.env.KEEPER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk) {
    console.error(
      "No KEEPER_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY). Nothing can be filled.",
    );
    process.exitCode = 1;
    return;
  }
  if (!supabaseAdmin) {
    console.error(
      "No SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL — a fill could not be recorded, so none is attempted.",
    );
    process.exitCode = 1;
    return;
  }
  /* The read and the write hold different keys, so they fail separately. Named
     here rather than left to surface as a fetch error against
     `placeholder.supabase.co`: with the anon key unset, supabaseClient.ts falls
     back to a placeholder client and every chain below would report "read failed"
     with nothing pointing at the variable that is missing. Reads go through anon
     on purpose — the order book is public, and orderStore.ts argues why. */
  const { isSupabaseConfigured } = await import(
    "../src/lib/supabase/supabaseClient.ts"
  );
  if (!isSupabaseConfigured) {
    console.error(
      "No NEXT_PUBLIC_SUPABASE_KEY — the order book cannot be read, only written to.",
    );
    process.exitCode = 1;
    return;
  }

  const only = (process.env.ORDERS_CHAINS ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);

  const chains = Object.keys(DEPLOYMENTS)
    .map(Number)
    .filter((id) => Boolean(getContracts(id).orders))
    .filter((id) => only.length === 0 || only.includes(id));

  if (chains.length === 0) {
    /* Not an error. Until KaleidoOrders is deployed the registry carries no
       `orders` address anywhere, and a keeper with nothing to sweep is the
       correct state of the world rather than a misconfiguration. */
    log("No chain in the registry carries a KaleidoOrders address yet.");
    return;
  }

  const now = () => Math.floor(Date.now() / 1000);

  /**
   * A provider for one chain, preferring an operator override.
   *
   * `RPC_URL_<chainId>`, the convention scripts/push-watcher.mjs already uses,
   * because the public endpoints in chains.ts throttle and this runs every five
   * minutes: sepolia.base.org answers -32016 and Arc -32005 under load, both as
   * HTTP 200 with a JSON-RPC error, which ethers renders as "missing revert data"
   * (rpcRetry.ts carries the phrase list). `providerForChain` honours no per-chain
   * override — `NEXT_PUBLIC_HTTP_RPC` applies to the read chain only — so the
   * override is built here rather than added to a module the browser also imports.
   *
   * `staticNetwork` is left off for an override, which is the one discipline
   * provider.ts insists on: a stale override once served Abstract while declaring
   * itself Sepolia, and every read became a confident answer about the wrong chain.
   * Omitting it costs one `eth_chainId` and turns that into a thrown "network
   * changed". The registry-derived URL keeps the cheap path.
   */
  const providerFor = (chainId: number) => {
    const url = process.env[`RPC_URL_${chainId}`]?.trim();
    if (!url) return providerForChain(chainId);
    const meta = CHAINS_BY_ID[chainId];
    log(`  using RPC_URL_${chainId}`);
    return new ethers.JsonRpcProvider(url, {
      chainId,
      name: meta?.name ?? String(chainId),
    });
  };

  for (const chainId of chains) {
    const contracts = getContracts(chainId);
    const ordersAddress = contracts.orders as string;
    log(`\nchain ${chainId} — ${ordersAddress}`);

    const provider = providerFor(chainId);
    if (!provider) {
      /* providerForChain returns null for a chain chains.ts does not carry, and
         the alternative it refuses is reading a different chain under this one's
         name. Skipping is the honest answer. */
      bug(`no RPC for chain ${chainId} — skipped`);
      continue;
    }
    const wallet = new ethers.Wallet(pk, provider);
    const orders = new ethers.Contract(ordersAddress, FILLER_ABI, wallet);

    /*
     * Rows whose window closed while nobody was looking.
     *
     * The sweep below only reads orders that can still fill, so without this the
     * `status` column would say `open` about them forever: the set behind the
     * table's partial index would grow without bound, and a maker's list would
     * carry rows the keeper had silently stopped considering. Expiry is the one
     * piece of an order's state that needs no chain call to settle — it is a
     * signed field and a clock — so it is written here rather than paid for per
     * order in RPC.
     *
     * One imprecision, taken deliberately: an order that was cancelled and then
     * expired is recorded as expired, because the cancel is only visible on chain
     * and this keeper stopped looking at the order the second its window closed.
     * The wrong word for a dead order, and the alternative is the wrong word for a
     * live one — `open` about something that can never fill again.
     */
    if (!DRY) {
      const { error, count } = await supabaseAdmin
        .from("kaleido_limit_orders")
        .update(
          { status: "expired", reconciled_at: new Date().toISOString() },
          { count: "exact" },
        )
        .eq("chain_id", chainId)
        .eq("status", "open")
        .lte("expiry", now());
      if (error) {
        failed++;
        log(`  could not retire expired rows: ${error.message}`);
      } else if (count) {
        log(`  retired ${count} expired order(s)`);
      }
    }

    let rows: Awaited<ReturnType<typeof readFillableOrders>>;
    try {
      rows = await readFillableOrders(chainId, now());
    } catch (e) {
      /* A failed read is not an empty book. Reported and skipped, never treated
         as "nothing to fill". */
      failed++;
      log(`  read failed: ${(e as Error).message}`);
      continue;
    }
    if (rows.length === SWEEP_CEILING)
      log(
        `  the query itself filled its page (${SWEEP_CEILING}) — there may be older orders it did not reach`,
      );

    /* Rows outlive a redeploy on purpose (the `orders` column exists so they can
       say which contract they belong to). One signed against a previous address
       is not fillable here — the address is inside the digest — so it is dropped
       rather than tried. */
    const mine = rows.filter(
      (r) => r.orders.toLowerCase() === ordersAddress.toLowerCase(),
    );
    if (mine.length !== rows.length)
      log(
        `  ${rows.length - mine.length} row(s) signed against another KaleidoOrders — not fillable here`,
      );

    const { take, dropped } = sweepable(mine, now(), PER_CYCLE);
    log(
      `  ${take.length} order(s) to look at${dropped > 0 ? `, ${dropped} left for the next cycle` : ""}`,
    );
    if (take.length === 0) continue;

    const quoter = contracts.v3Quoter
      ? new ethers.Contract(contracts.v3Quoter, QUOTER_ABI, provider)
      : null;
    if (!quoter) {
      bug(`chain ${chainId} has a KaleidoOrders but no v3Quoter in the registry`);
      continue;
    }

    const balance = await retryRpc(() => provider.getBalance(wallet.address));
    /* The chain's own price, so the warning below means the same thing on a chain
       at 0.006 gwei as on one at 21. Falls back to maxFeePerGas where a chain
       answers only EIP-1559 fields, and skips the check if neither is there —
       an unreadable gas price is not evidence of an empty keeper. */
    const fee = await retryRpc(() => provider.getFeeData());
    const gasPrice = fee.gasPrice ?? fee.maxFeePerGas;
    const perFill = gasPrice ? gasPrice * GAS_PER_FILL : null;
    log(
      `  keeper ${wallet.address} holds ${ethers.formatEther(balance)}` +
        (perFill && perFill > 0n ? ` (~${balance / perFill} fills)` : ""),
    );
    if (perFill && perFill > 0n && balance < perFill * LOW_GAS_FILLS)
      bug(
        `keeper on chain ${chainId} holds ${ethers.formatEther(balance)}, under ` +
          `${LOW_GAS_FILLS} fills at ${ethers.formatUnits(gasPrice!, "gwei")} gwei ` +
          `(${ethers.formatEther(perFill * LOW_GAS_FILLS)}) — top it up before a fill is missed`,
      );

    /* Storage, not a constant: the owner can raise it to pay third-party fillers,
       and a stale copy would make every quote here wrong by the difference. Read
       once per chain rather than once per order — it cannot change mid-cycle in
       any way that matters, since the contract recomputes it on each fill. */
    const fillerFeeBps = Number(await retryRpc(() => orders.fillerFeeBps()));

    for (const stored of take) {
      const o = stored.order;
      const inTok = chainTokenByAddress(chainId, o.tokenIn);
      const outTok = chainTokenByAddress(chainId, o.tokenOut);
      const label = `${inTok?.symbol ?? o.tokenIn.slice(0, 8)}→${outTok?.symbol ?? o.tokenOut.slice(0, 8)} ${stored.hash.slice(0, 10)}`;

      try {
        /* Any tier's path passes `_pathValid`, which checks the two ends and the
           length and nothing else — the tier only decides where the swap goes,
           and that is chosen below from the quotes. So the terms probe costs one
           call rather than one per tier. */
        const probePath = pathFor(o, FEE_TIERS[0]);
        const [termsOk, reason] = await retryRpc(() =>
          orders.checkFill(o, stored.signature, probePath),
        );
        const terms = { ok: Boolean(termsOk), reason: String(reason) };

        const quotedFor = swapInputFor(BigInt(o.amountIn), fillerFeeBps);
        /*
         * Three tiers, and a third outcome besides "quoted" and "did not".
         *
         * A V3 quoter answers by reverting, so "no pool" and "not enough
         * liquidity" arrive as exceptions and both correctly mean this tier
         * cannot route the trade. A dropped connection arrives the same way and
         * means nothing of the kind — and this `catch` used to flatten the two
         * together, so an unreachable RPC was read as an empty market and logged
         * as "no pool quoted this pair". That is the one failure a keeper must
         * not have: it is indistinguishable, in the log, from the market simply
         * not being there, so an endpoint that had stopped answering could go a
         * long time unnoticed while orders sat unfilled.
         *
         * `retryRpc` has already exhausted its retries by the time we are here,
         * so `isTransientRpcError` is being asked a narrower question than it is
         * usually asked: not "retry?" but "was this the market or the wire?".
         */
        const quoted = terms.ok
          ? await Promise.all(
              FEE_TIERS.map(async (fee) => {
                try {
                  const out = await retryRpc(() =>
                    quoter.quoteExactInputSingle.staticCall(
                      o.tokenIn,
                      o.tokenOut,
                      fee,
                      quotedFor,
                      0,
                    ),
                  );
                  return { fee, out: BigInt(out), unreadable: null };
                } catch (e) {
                  if (isTransientRpcError(e))
                    return {
                      fee,
                      out: null,
                      unreadable: (e as Error).message,
                    };
                  return { fee, out: null, unreadable: null };
                }
              }),
            )
          : [];

        const unreadable = quoted.filter((q) => q.unreadable !== null);
        if (unreadable.length > 0 && unreadable.length === quoted.length)
          /* Every tier unreadable is not a market condition, so it is raised
             rather than logged: the catch below counts it as a failure, which
             reddens the run and says which pair could not be priced. The order
             is untouched — the next cycle quotes it again. */
          throw new Error(
            `no fee tier could be quoted — the quoter was unreachable, not the ` +
              `pools empty: ${unreadable[0].unreadable}`,
          );
        if (unreadable.length > 0)
          log(
            `  note  ${label}: ${unreadable.length} of ${quoted.length} tiers ` +
              `could not be read (${unreadable[0].unreadable}) — deciding on the rest`,
          );

        /* Down to what fill.ts is given: it decides on prices, and a tier nobody
           could read is absent from the market as far as that decision goes. */
        const quotes = quoted.map(({ fee, out }) => ({ fee, out }));

        const decision = decideFill({
          order: o,
          terms,
          quotes,
          quotedFor,
          fillerFeeBps,
        });

        if (decision.action === "wait") {
          /* The two reasons that mean this code is wrong rather than the market
             being wrong: both are shapes the store and `pathFor` are supposed to
             have made impossible. Loud, and they redden the run. */
          if (
            decision.because === "malformed order" ||
            decision.because === "path does not match the pair"
          )
            bug(`${label}: ${decision.because} — the contract rejects our own input`);
          else log(`  wait  ${label}: ${decision.because}`);
          continue;
        }

        if (decision.action === "fill") {
          log(`  fill  ${label}: ${decision.because}`);
          if (DRY) continue;
          const fillPath = pathFor(o, decision.fee);
          /* Simulated first, so a fill that would revert costs a call rather than
             a transaction. Not a guarantee — the block it lands in is not the
             block it was simulated against — which is the whole reason the
             failure below is tolerated rather than retried. */
          await orders.fill.staticCall(o, stored.signature, fillPath);
          const tx = await orders.fill(o, stored.signature, fillPath);
          log(`        sent ${tx.hash}`);
          await tx.wait();
        }

        /* Read after the fill, and read on a reconcile decision too: the counts go
           in the row either way and the chain is the only thing that knows them.
           Never incremented locally — a receipt lost on a transaction that landed
           would put this keeper's count permanently out of step. */
        const st = await retryRpc(() => orders.stateOf(o));
        const state = {
          /* `cancelled` composed from both routes. `cancelAll` bumps the epoch and
             leaves this struct untouched, so the struct alone would report a dead
             order as open forever — see OnChainState in fill.ts. */
          cancelled:
            Boolean(st.cancelled) ||
            (decision.action === "reconcile" && decision.status === "cancelled"),
          fills: Number(st.fills),
          lastFillAt: Number(st.lastFillAt),
        };
        const next = reconcile(o, state, now());

        if (decision.action === "reconcile")
          log(`  done  ${label}: ${decision.because} → ${next.status}`);

        if (DRY) continue;
        const { error } = await supabaseAdmin
          .from("kaleido_limit_orders")
          .update({
            status: next.status,
            fills: next.fills,
            last_fill_at: next.lastFillAt,
            reconciled_at: new Date().toISOString(),
          })
          .eq("order_hash", stored.hash);
        if (error) {
          /* The row is now behind the chain. Recoverable — the next cycle reads
             `stateOf` again and writes the same thing — but it must be visible,
             because a fill nobody recorded is a fill the maker cannot see. */
          failed++;
          log(`        could not record it: ${error.message}`);
        }
      } catch (e) {
        /*
         * One order's failure, and deliberately not retried. A write that timed
         * out client-side may still have landed — this repo has sent the same
         * swap three times learning that — so the recovery is the next cycle
         * re-reading `stateOf`, not a second `fill`.
         */
        failed++;
        log(`  err   ${label}: ${(e as Error).message}`);
      }
    }
  }

  console.log(
    bugs === 0 && failed === 0
      ? "\nDone.\n"
      : `\nDone with ${bugs} thing(s) that look like our bug and ${failed} failure(s).\n`,
  );
  /* Red on our own bugs, and on a failure that left a row behind the chain.
     Amber-by-log for anything the market did — an order that simply is not due
     is the normal case and must not page anyone. */
  if (bugs > 0 || failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("\nfiller crashed:", e);
  process.exitCode = 1;
});
