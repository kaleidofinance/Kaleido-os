import {
  verifyMessage,
  JsonRpcProvider,
  isAddress,
  isHexString,
  type TransactionResponse,
  type TransactionReceipt,
} from "ethers";
import { supabaseAdmin, isAdminConfigured } from "@/lib/supabase/serverClient";
import { hasArcActivity } from "@/lib/waitlist/arcMainnet";
import { providerForChain } from "@/config/provider";
import { CHAINS_BY_ID } from "@/constants/chains";
import { getContracts } from "@/constants/registry";
import { isKnownBridgeAddress, isKnownBridgeSpender } from "@/lib/bridge/route";
import { isKnownCctpTarget } from "@/lib/bridge/cctp";
import { isKnownSwapRouter } from "@/lib/swap/kyberswap";
import {
  TRANSACTION_TASK_POINTS,
  transactionTaskColumn,
  transactionTaskCreditHash,
  type TransactionTask,
} from "@/lib/waitlist/transactionTasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Task = TransactionTask;
type Operation = "swap" | "swapMultiHop" | "aggregatorSwap" | "bridge";
const message = (address: string, task: Task, txHash?: string) =>
  task === "arcMainnet"
    ? `Confirm my Kaleido Arc mainnet transaction for wallet ${address}.`
    : task === "agent"
      ? txHash
        ? `Confirm my first Kaleido agent transaction ${txHash} for wallet ${address}.`
        : `Confirm my first Kaleido agent transaction for wallet ${address}.`
      : `Confirm my first Kaleido bridge transaction for wallet ${address}.`;

async function creditActivatedTask(
  wallet: string,
  task: Task,
  occurredAt: string,
): Promise<string | null> {
  const { error } = await supabaseAdmin!.from("point_actions").insert({
    wallet,
    source_slug: "waitlist",
    season: 1,
    tx_hash: transactionTaskCreditHash(wallet, task),
    chain_id: 5042,
    usd_value: 0,
    multiplier_applied: 1.0,
    points: TRANSACTION_TASK_POINTS[task],
    is_agent_initiated: false,
    occurred_at: occurredAt,
  });
  if (error && error.code !== "23505") return error.message;
  return null;
}

/**
 * Locate a wallet's successful transaction by hash, WITHOUT trusting the client's
 * idea of which chain it is on.
 *
 * A bridge's source transaction lives on whatever chain the user bridged FROM —
 * which, for a bridge INTO Arc, is not the chain their wallet is connected to
 * when they verify. The client sends its active chain, so the old single-chain
 * lookup rejected every legitimate inbound bridge (except CCTP found via
 * cctp_transfers) with "successful wallet transaction not found". We instead try
 * the preferred chain first (the fast path for an outbound bridge / a swap on the
 * connected chain) and then fall back across the other supported chains. A match
 * still has to be the wallet's own successful tx AND, back in the caller, hit the
 * allow-listed bridge/swap target — so probing more chains never widens what
 * counts, it only stops rejecting a real tx for being on the "wrong" chain.
 */
async function locateWalletTx(
  txHash: string,
  preferredChainId: number | undefined,
  wallet: string,
): Promise<{
  chainId: number;
  tx: TransactionResponse;
  receipt: TransactionReceipt;
} | null> {
  const all = Object.keys(CHAINS_BY_ID).map(Number);
  const order = [preferredChainId, ...all].filter(
    (c, i, a): c is number =>
      Number.isInteger(c) && a.indexOf(c) === i,
  );
  for (const chainId of order) {
    const rpc = providerForChain(chainId) as JsonRpcProvider | null;
    if (!rpc) continue;
    try {
      const tx = await rpc.getTransaction(txHash);
      // Cheap gate before the second round trip: it must be the wallet's own tx.
      if (!tx || tx.from.toLowerCase() !== wallet) continue;
      const receipt = await rpc.getTransactionReceipt(txHash);
      if (receipt && receipt.status === 1) return { chainId, tx, receipt };
    } catch {
      // A chain whose RPC errors is skipped, not fatal — try the next.
    }
  }
  return null;
}

export async function POST(req: Request) {
  if (!isAdminConfigured || !supabaseAdmin)
    return Response.json({ error: "unconfigured" }, { status: 503 });
  let body: {
    address?: string;
    signature?: string;
    task?: Task;
    txHash?: string;
    chainId?: number;
    operation?: Operation;
    provider?: string;
    amount?: string;
    symbol?: string;
    sourceChainId?: number;
    destinationChainId?: number;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad body" }, { status: 400 });
  }
  const {
    address,
    signature,
    task,
    txHash,
    chainId,
    operation,
    provider,
    amount,
    symbol,
    sourceChainId,
    destinationChainId,
  } = body;
  let verifiedTxHash = txHash;
  let verifiedChainId = chainId;
  let verifiedOperation = operation;
  let verifiedProvider = provider;
  const auto = signature === undefined;
  if (
    !address ||
    !isAddress(address) ||
    (!auto && typeof signature !== "string") ||
    (task !== "arcMainnet" && task !== "agent" && task !== "bridge")
  ) {
    return Response.json({ error: "bad input" }, { status: 400 });
  }
  if (
    (task === "agent" || task === "bridge") &&
    txHash &&
    (!isHexString(txHash, 32) ||
      !Number.isInteger(chainId) ||
      (task === "agent" &&
        !["swap", "swapMultiHop", "aggregatorSwap"].includes(
          operation ?? "",
        )) ||
      (task === "bridge" && operation !== "bridge"))
  ) {
    return Response.json(
      { error: "transaction hash and chain are required" },
      { status: 400 },
    );
  }
  if (!auto) {
    try {
      const recovered = verifyMessage(
        message(address, task, txHash),
        signature!,
      );
      if (recovered.toLowerCase() !== address.toLowerCase())
        return Response.json({ error: "signature mismatch" }, { status: 401 });
    } catch {
      return Response.json({ error: "bad signature" }, { status: 401 });
    }
  }

  const wallet = address.toLowerCase();
  const { data: row, error: rowError } = await supabaseAdmin
    .from("waitlist")
    .select(
      "wallet, activated_at, arc_mainnet_tx_at, agent_tx_at, bridge_tx_at",
    )
    .eq("wallet", wallet)
    .single();
  if (rowError) {
    // A missing task column must not be reported as a missing wallet. Confirm
    // the core row separately so production schema drift is diagnosable.
    const { data: walletRow } = await supabaseAdmin
      .from("waitlist")
      .select("wallet")
      .eq("wallet", wallet)
      .single();
    if (!walletRow)
      return Response.json({ error: "not registered" }, { status: 404 });
    return Response.json(
      { error: "waitlist transaction tasks are not enabled yet" },
      { status: 503 },
    );
  }
  if (!row) return Response.json({ error: "not registered" }, { status: 404 });
  const col = transactionTaskColumn(task);
  if (row[col]) {
    /* Backfill a task verified before this route began crediting activated
       wallets. The stable task hash makes this safe on every retry. */
    const completedAfterActivation =
      row.activated_at &&
      new Date(String(row[col])).getTime() >
        new Date(String(row.activated_at)).getTime();
    if (completedAfterActivation) {
      const creditError = await creditActivatedTask(
        wallet,
        task,
        String(row[col]),
      );
      if (creditError) {
        console.error(
          "[waitlist/transaction] task backfill failed:",
          creditError,
        );
        return Response.json({ error: "point credit failed" }, { status: 503 });
      }
    }
    return Response.json({ ok: true, already: true });
  }

  // The "Make 1st transaction on Kaleido" (agent) task was retired 2026-09-23:
  // it could not distinguish a real trade from a cent-sized or no-op router call,
  // and the swap-volume tasks now cover real trading. Existing completions keep
  // their points (they short-circuit above); only NEW agent claims are refused,
  // so the task can no longer be farmed. arcMainnet was likewise retired from the
  // UI in #394.
  // Non-narrowing membership check (a string[] .includes does not narrow `task`),
  // so the existing multi-task code below still type-checks while these two are
  // refused at runtime.
  const RETIRED_TASKS: string[] = ["agent", "arcMainnet"];
  if (RETIRED_TASKS.includes(task)) {
    return Response.json(
      { error: "this task has been retired", retired: true },
      { status: 410 },
    );
  }

  let evidence: {
    task: Task;
    txHash: string;
    chainId: number;
    operation: Operation;
    provider: string;
    target: string | null;
    amount: string | null;
    symbol: string | null;
    sourceChainId: number | null;
    destinationChainId: number | null;
  } | null = null;

  if (!verifiedTxHash && (task === "agent" || task === "bridge")) {
    const { data: priorEvidence } = await supabaseAdmin
      .from("waitlist_transaction_evidence")
      .select(
        "task, tx_hash, chain_id, operation, provider, target, amount, symbol, source_chain_id, destination_chain_id",
      )
      .eq("wallet", wallet)
      .eq("task", task)
      .maybeSingle();
    if (priorEvidence) {
      evidence = {
        task,
        txHash: String(priorEvidence.tx_hash),
        chainId: Number(priorEvidence.chain_id),
        operation: priorEvidence.operation as Operation,
        provider: String(priorEvidence.provider),
        target: priorEvidence.target ? String(priorEvidence.target) : null,
        amount: priorEvidence.amount ? String(priorEvidence.amount) : null,
        symbol: priorEvidence.symbol ? String(priorEvidence.symbol) : null,
        sourceChainId: priorEvidence.source_chain_id
          ? Number(priorEvidence.source_chain_id)
          : null,
        destinationChainId: priorEvidence.destination_chain_id
          ? Number(priorEvidence.destination_chain_id)
          : null,
      };
    }
  }

  // Legacy indexed rows are only candidates. They must still pass the same
  // receipt, sender, and allow-listed target checks below before any points
  // are granted; a timestamp alone is never evidence.
  if (!verifiedTxHash && !evidence && task === "agent") {
    const { data } = await supabaseAdmin
      .from("point_actions")
      .select("tx_hash, chain_id")
      .eq("wallet", wallet)
      .in("source_slug", ["swap", "agent_swap"])
      .not("tx_hash", "is", null)
      .order("occurred_at", { ascending: true })
      .limit(1);
    const legacy = data?.[0];
    if (legacy?.tx_hash && Number.isInteger(Number(legacy.chain_id))) {
      verifiedTxHash = String(legacy.tx_hash);
      verifiedChainId = Number(legacy.chain_id);
      verifiedOperation = "swap";
    }
  }
  if (!verifiedTxHash && !evidence && task === "bridge") {
    const { data } = await supabaseAdmin
      .from("cctp_transfers")
      .select("tx_hash, source_chain_id")
      .ilike("recipient", wallet)
      .not("tx_hash", "is", null)
      .order("created_at", { ascending: true })
      .limit(1);
    const legacy = data?.[0];
    if (legacy?.tx_hash && Number.isInteger(Number(legacy.source_chain_id))) {
      verifiedTxHash = String(legacy.tx_hash);
      verifiedChainId = Number(legacy.source_chain_id);
      verifiedOperation = "bridge";
      verifiedProvider = "cctp";
    }
  }

  if (task === "arcMainnet") {
    if (!(await hasArcActivity(wallet)))
      return Response.json(
        { error: "no Arc mainnet transaction found" },
        { status: 409 },
      );
  } else if (evidence) {
    // A prior automatic verification already left durable evidence.
  } else if (verifiedTxHash) {
    // Find the tx on whatever supported chain it actually landed on — the client's
    // active chain is only a hint (wrong for a bridge INTO Arc). See locateWalletTx.
    const found = await locateWalletTx(verifiedTxHash, verifiedChainId, wallet);
    if (!found) {
      return Response.json(
        { error: "successful wallet transaction not found" },
        { status: 409 },
      );
    }
    verifiedChainId = found.chainId;
    const { tx } = found;
    const target = (tx.to ?? "").toLowerCase();
    let verifiedProvider: string | null = null;
    if (task === "agent") {
      if (
        verifiedOperation === "aggregatorSwap" &&
        isKnownSwapRouter(verifiedChainId!, target)
      ) {
        verifiedProvider = "kyberswap";
      } else if (
        (verifiedOperation === "swap" || verifiedOperation === "swapMultiHop") &&
        getContracts(verifiedChainId!).v3Router?.toLowerCase() === target
      ) {
        verifiedProvider = "kaleido";
      }
      if (!verifiedProvider)
        return Response.json(
          { error: "transaction is not a recognized Kaleido swap" },
          { status: 409 },
        );
    } else {
      // The client may not know which bridge provider executed a route (and a
      // user may paste a hash from another session), so derive it from the
      // verified transaction target. A supplied provider is only an optional
      // hint; it can never widen the allow-list.
      if (isKnownCctpTarget(target) && (!verifiedProvider || verifiedProvider === "cctp"))
        verifiedProvider = "cctp";
      else if (
        isKnownBridgeAddress(verifiedChainId!, target) &&
        (!verifiedProvider || verifiedProvider === "canonical")
      )
        verifiedProvider = "canonical";
      else if (
        isKnownBridgeSpender(target) &&
        !isKnownCctpTarget(target) &&
        (!verifiedProvider || verifiedProvider === "lifi")
      )
        verifiedProvider = "lifi";
      if (!verifiedProvider)
        return Response.json(
          { error: "transaction is not a recognized bridge route" },
          { status: 409 },
        );
    }
    evidence = {
      task,
      txHash: verifiedTxHash!,
      chainId: verifiedChainId!,
      operation: verifiedOperation!,
      provider: verifiedProvider,
      target: tx.to ?? null,
      amount: amount ?? null,
      symbol: symbol ?? null,
      sourceChainId: sourceChainId ?? (task === "bridge" ? chainId! : null),
      destinationChainId: destinationChainId ?? null,
    };
  } else {
    return Response.json(
      { error: task === "agent" ? "no qualifying Kaleido trade found" : "no qualifying bridge found" },
      { status: 409 },
    );
  }

  if (evidence) {
    const { error: evidenceError } = await supabaseAdmin
      .from("waitlist_transaction_evidence")
      .upsert(
        {
          wallet,
          task: evidence.task,
          tx_hash: evidence.txHash.toLowerCase(),
          chain_id: evidence.chainId,
          operation: evidence.operation,
          provider: evidence.provider,
          target: evidence.target,
          amount: evidence.amount,
          symbol: evidence.symbol,
          source_chain_id: evidence.sourceChainId,
          destination_chain_id: evidence.destinationChainId,
        },
        { onConflict: "task,wallet", ignoreDuplicates: true },
      );
    if (evidenceError) {
      console.error(
        "[waitlist/transaction] evidence insert failed:",
        evidenceError.message,
      );
      return Response.json(
        { error: "transaction evidence unavailable" },
        { status: 503 },
      );
    }
  }
  const verifiedAt = new Date().toISOString();

  /* An activated wallet no longer passes through the activation snapshot. Give
     it the fixed task grant now, using a task-specific idempotency key. Pending
     wallets receive the grant when activation snapshots the waitlist row. */
  if (row.activated_at) {
    const creditError = await creditActivatedTask(wallet, task, verifiedAt);
    if (creditError) {
      console.error("[waitlist/transaction] task credit failed:", creditError);
      return Response.json({ error: "point credit failed" }, { status: 503 });
    }
  }

  const { error } = await supabaseAdmin
    .from("waitlist")
    .update({ [col]: verifiedAt })
    .eq("wallet", wallet)
    .is(col, null);
  if (error) return Response.json({ error: "record failed" }, { status: 500 });
  return Response.json({ ok: true });
}
