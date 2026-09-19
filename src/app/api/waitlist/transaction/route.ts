import { verifyMessage, JsonRpcProvider, isAddress, isHexString } from "ethers";
import { supabaseAdmin, isAdminConfigured } from "@/lib/supabase/serverClient";
import { hasArcActivity } from "@/lib/waitlist/arcMainnet";
import { providerForChain } from "@/config/provider";
import {
  TRANSACTION_TASK_POINTS,
  transactionTaskColumn,
  transactionTaskCreditHash,
  type TransactionTask,
} from "@/lib/waitlist/transactionTasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Task = TransactionTask;
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

export async function POST(req: Request) {
  if (!isAdminConfigured || !supabaseAdmin)
    return Response.json({ error: "unconfigured" }, { status: 503 });
  let body: {
    address?: string;
    signature?: string;
    task?: Task;
    txHash?: string;
    chainId?: number;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad body" }, { status: 400 });
  }
  const { address, signature, task, txHash, chainId } = body;
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
    (!isHexString(txHash, 32) || !Number.isInteger(chainId))
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

  if (task === "arcMainnet") {
    if (!(await hasArcActivity(wallet)))
      return Response.json(
        { error: "no Arc mainnet transaction found" },
        { status: 409 },
      );
  } else if (txHash) {
    const provider = providerForChain(chainId!);
    if (!provider)
      return Response.json(
        { error: "unsupported transaction chain" },
        { status: 400 },
      );
    const tx = await (provider as JsonRpcProvider).getTransaction(txHash!);
    const receipt = await (provider as JsonRpcProvider).getTransactionReceipt(
      txHash!,
    );
    if (
      !tx ||
      !receipt ||
      receipt.status !== 1 ||
      tx.from.toLowerCase() !== wallet
    ) {
      return Response.json(
        { error: "successful wallet transaction not found" },
        { status: 409 },
      );
    }
  } else if (task === "agent") {
    // Manual swaps are `swap`; Luca swaps are `agent_swap`. Both satisfy the
    // waitlist's single "Make 1st transaction on Kaleido" task.
    const { data } = await supabaseAdmin
      .from("point_actions")
      .select("tx_hash")
      .eq("wallet", wallet)
      .in("source_slug", ["swap", "agent_swap"])
      .limit(1);
    if (!data?.length)
      return Response.json(
        { error: "no qualifying Kaleido trade found" },
        { status: 409 },
      );
  } else {
    const { data } = await supabaseAdmin
      .from("cctp_transfers")
      .select("tx_hash")
      .ilike("recipient", wallet)
      .limit(1);
    if (!data?.length)
      return Response.json(
        { error: "no qualifying bridge found" },
        { status: 409 },
      );
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
