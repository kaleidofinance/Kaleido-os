import { ethers } from "ethers";
import { getChainMeta } from "@/constants/chains";
import { providerForChain } from "@/config/provider";
import { supabaseAdmin } from "@/lib/supabase/serverClient";
import {
  fetchCctpAttestation,
  type CctpAttestation,
} from "@/lib/bridge/cctpAttestation";
import { MESSAGE_TRANSMITTER_V2, encodeCctpReceive } from "@/lib/bridge/cctp";
import { retryRpc } from "@/lib/dex/rpcRetry";

/**
 * The CCTP completion keeper: the app pays the destination gas, so a wallet
 * with none there is never trapped between a burn and its mint.
 *
 * A CCTP bridge is two transactions on two chains. The user burns USDC on the
 * source; once Circle attests, `receiveMessage(message, attestation)` on the
 * destination mints it. Until now only the user could submit that second
 * transaction, from the browser, and it needs gas ON THE DESTINATION — measured
 * 2026-09-17: a wallet bridged 10 USDC from Arc to Base holding no ETH on Base,
 * and the attested USDC sat unmintable. That is the one failure a bridge must
 * not have.
 *
 * The burn sets `destinationCaller = 0` (buildCctpBurnRoute), which means
 * ANYONE may submit the mint — the recipient is fixed in the burn, so the caller
 * can only pay, never redirect. So the keeper wallet submits it: it reads the
 * registry `/api/cctp/record` fills at burn time, asks Circle for the
 * attestation, and sends `receiveMessage` from KEEPER_PRIVATE_KEY on the
 * destination. The user's own "Complete transfer" button stays as a fallback,
 * and the two cannot conflict: a second `receiveMessage` for the same burn
 * reverts with a used nonce, which this reads as "already minted".
 *
 * What it will not do: sign with an owner key (refused, as pushFeeds refuses),
 * spend a balance it does not have (a short balance is reported and the row
 * stays pending, so an unfunded keeper is loud rather than silently broken),
 * or retry forever (MAX_ATTEMPTS, and a 3-day ceiling on waiting for Circle).
 *
 * Every dependency is injectable so the loop is tested with fakes; the real
 * ones (`defaultDeps`) talk to Supabase, Circle and the chain.
 */

export interface CctpTransferRow {
  id: number;
  tx_hash: string;
  source_chain_id: number;
  dest_chain_id: number;
  recipient: string;
  amount: string;
  symbol: string;
  status: "pending" | "minted" | "failed";
  mint_tx_hash: string | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
}

/** Sends that failed (not "pending", not "unfunded") before a row is given up on. */
export const MAX_ATTEMPTS = 20;
/** How long to wait for Circle's attestation before calling the burn lost to us. */
export const PENDING_TTL_MS = 3 * 24 * 60 * 60 * 1000;
/** receiveMessage V2 measured at ~180–250k gas; the ceiling the balance check assumes. */
export const RECEIVE_GAS_LIMIT = 300_000n;
/** Headroom on the fee estimate before a send is attempted at all. */
export const FEE_MARGIN = 2n;

/** Whether production can complete mints: a keeper key AND an armed cron. */
export function keeperArmed(): boolean {
  return Boolean(
    process.env.KEEPER_PRIVATE_KEY && process.env.CRON_SECRET?.trim(),
  );
}

export type SendOutcome =
  | { hash: string }
  /** The keeper could not pay for it right now; the row stays pending. */
  | { skipped: string }
  | { error: string; nonceUsed?: boolean };

export interface CctpKeeperDeps {
  listPending(limit: number): Promise<CctpTransferRow[] | { error: string }>;
  update(
    id: number,
    patch: Partial<
      Pick<CctpTransferRow, "status" | "mint_tx_hash" | "attempts" | "last_error">
    >,
  ): Promise<void>;
  attest(row: CctpTransferRow): Promise<CctpAttestation>;
  send(destChainId: number, data: string): Promise<SendOutcome>;
  keeperAddress(): string | null;
  now(): number;
}

export interface CctpKeeperResult {
  ok: boolean;
  error?: string;
  dryRun: boolean;
  keeper: string | null;
  processed: number;
  minted: string[];
  wouldMint: string[];
  stillPending: number;
  failed: string[];
  skipped: string[];
  errors: string[];
}

const USED_NONCE = /nonce already used|already (been )?(received|used)/i;

export async function completeCctpTransfers(
  opts: { limit?: number; dryRun?: boolean } = {},
  deps: CctpKeeperDeps = defaultDeps(),
): Promise<CctpKeeperResult> {
  const dryRun = opts.dryRun ?? false;
  const limit = Math.max(1, Math.min(opts.limit ?? 5, 25));
  const result: CctpKeeperResult = {
    ok: true,
    dryRun,
    keeper: deps.keeperAddress(),
    processed: 0,
    minted: [],
    wouldMint: [],
    stillPending: 0,
    failed: [],
    skipped: [],
    errors: [],
  };

  const rows = await deps.listPending(limit);
  if ("error" in rows) {
    result.ok = false;
    result.error = rows.error;
    return result;
  }

  for (const row of rows) {
    result.processed += 1;

    if (deps.now() - Date.parse(row.created_at) > PENDING_TTL_MS) {
      await deps.update(row.id, {
        status: "failed",
        last_error: "no attestation from Circle within 3 days",
      });
      result.failed.push(row.tx_hash);
      continue;
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      await deps.update(row.id, {
        status: "failed",
        last_error: `gave up after ${row.attempts} failed attempts: ${row.last_error ?? "unknown"}`,
      });
      result.failed.push(row.tx_hash);
      continue;
    }

    let att: CctpAttestation;
    try {
      att = await deps.attest(row);
    } catch (e) {
      att = { error: `attestation fetch threw: ${(e as Error).message}` };
    }
    if ("error" in att) {
      await deps.update(row.id, {
        attempts: row.attempts + 1,
        last_error: att.error.slice(0, 400),
      });
      result.errors.push(`${row.tx_hash}: ${att.error}`);
      continue;
    }
    if (att.status === "pending") {
      result.stillPending += 1;
      continue;
    }

    const data = encodeCctpReceive(att.message, att.attestation);
    if (dryRun) {
      result.wouldMint.push(row.tx_hash);
      continue;
    }

    const sent = await deps.send(row.dest_chain_id, data);
    if ("hash" in sent) {
      await deps.update(row.id, {
        status: "minted",
        mint_tx_hash: sent.hash,
        last_error: null,
      });
      result.minted.push(row.tx_hash);
      continue;
    }
    if ("skipped" in sent) {
      /* Not an attempt against the row — the keeper could not pay. Left
         pending untouched so it is retried the moment the keeper is funded. */
      result.skipped.push(`${row.tx_hash}: ${sent.skipped}`);
      continue;
    }
    if (sent.nonceUsed) {
      /* Someone else — the user's own Complete button, most likely — already
         minted it. That is success, not failure; the mint hash is theirs. */
      await deps.update(row.id, {
        status: "minted",
        last_error: "completed by another party (nonce already used)",
      });
      result.minted.push(row.tx_hash);
      continue;
    }
    await deps.update(row.id, {
      attempts: row.attempts + 1,
      last_error: sent.error.slice(0, 400),
    });
    result.errors.push(`${row.tx_hash}: ${sent.error}`);
  }

  return result;
}

/* ------------------------------------------------------------- real deps -- */

const TABLE = "cctp_transfers";

function tableMissing(err: { code?: string; message?: string } | null): boolean {
  return (
    err?.code === "42P01" ||
    /relation .*cctp_transfers.* does not exist/i.test(err?.message ?? "")
  );
}

export const TABLE_MISSING_HINT =
  "cctp_transfers table missing — apply supabase/migrations/20260917040000_cctp_transfers.sql";

export function defaultDeps(): CctpKeeperDeps {
  const key = process.env.KEEPER_PRIVATE_KEY;
  return {
    async listPending(limit) {
      if (!supabaseAdmin)
        return { error: "Supabase service client is not configured" };
      const { data, error } = await supabaseAdmin
        .from(TABLE)
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(limit);
      if (error) {
        return { error: tableMissing(error) ? TABLE_MISSING_HINT : error.message };
      }
      return (data ?? []) as CctpTransferRow[];
    },

    async update(id, patch) {
      if (!supabaseAdmin) return;
      const { error } = await supabaseAdmin
        .from(TABLE)
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) console.error("[keeper/cctp] update failed:", error.message);
    },

    attest(row) {
      return fetchCctpAttestation({
        sourceChainId: row.source_chain_id,
        txHash: row.tx_hash,
      });
    },

    keeperAddress() {
      if (!key) return null;
      try {
        return new ethers.Wallet(key).address;
      } catch {
        return null;
      }
    },

    now: () => Date.now(),

    async send(destChainId, data) {
      if (!key) return { error: "KEEPER_PRIVATE_KEY is not set" };
      /* The same refusal pushFeeds makes: an owner key can change the protocol
         and must never sit behind an HTTP route, however well gated. */
      if (
        key === process.env.PRIVATE_KEY ||
        key === process.env.DEPLOYER_PRIVATE_KEY
      ) {
        return {
          error: "KEEPER_PRIVATE_KEY equals an owner key — refusing to sign with it",
        };
      }
      const meta = getChainMeta(destChainId);
      const provider = providerForChain(destChainId);
      if (!meta || !provider)
        return { error: `chain ${destChainId} has no RPC in the registry` };

      let wallet: ethers.Wallet;
      try {
        wallet = new ethers.Wallet(key, provider);
      } catch {
        return { error: "KEEPER_PRIVATE_KEY is not a valid key" };
      }
      const tx = { to: MESSAGE_TRANSMITTER_V2, data, from: wallet.address };

      /* Estimate first: a burn someone already completed reverts here with a
         used nonce, which is the one revert that means success. */
      let gas: bigint;
      try {
        gas = await retryRpc(() => provider.estimateGas(tx));
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        return { error: `estimateGas: ${msg.slice(0, 300)}`, nonceUsed: USED_NONCE.test(msg) };
      }

      const [balance, fee] = await retryRpc(() =>
        Promise.all([provider.getBalance(wallet.address), provider.getFeeData()]),
      );
      const perGas = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
      const ceiling = gas > RECEIVE_GAS_LIMIT ? gas : RECEIVE_GAS_LIMIT;
      const need = ceiling * perGas * FEE_MARGIN;
      if (balance < need) {
        const sym = meta.nativeCurrency?.symbol ?? "gas";
        return {
          skipped: `keeper ${wallet.address} is unfunded on ${meta.shortName}: has ${ethers.formatEther(balance)} ${sym}, needs about ${ethers.formatEther(need)} ${sym}`,
        };
      }

      try {
        const sentTx = await wallet.sendTransaction({
          ...tx,
          gasLimit: (gas * 12n) / 10n,
        });
        /* One confirmation, bounded: the row is marked minted on the hash
           either way, and a receipt that arrives after the function's clock
           runs out changes nothing about what was sent. */
        await Promise.race([
          sentTx.wait(1),
          new Promise((resolve) => setTimeout(resolve, 45_000)),
        ]);
        return { hash: sentTx.hash };
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        return { error: `send: ${msg.slice(0, 300)}`, nonceUsed: USED_NONCE.test(msg) };
      }
    },
  };
}
