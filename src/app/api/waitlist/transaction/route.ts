import { verifyMessage, JsonRpcProvider, isAddress, isHexString } from "ethers";
import { supabaseAdmin, isAdminConfigured } from "@/lib/supabase/serverClient";
import { hasArcActivity } from "@/lib/waitlist/arcMainnet";
import { providerForChain } from "@/config/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Task = "arcMainnet" | "agent" | "bridge";
const message = (address: string, task: Task, txHash?: string) =>
  task === "arcMainnet"
    ? `Confirm my Kaleido Arc mainnet transaction for wallet ${address}.`
    : task === "agent"
      ? txHash
        ? `Confirm my first Kaleido agent transaction ${txHash} for wallet ${address}.`
        : `Confirm my first Kaleido agent transaction for wallet ${address}.`
      : `Confirm my first Kaleido bridge transaction for wallet ${address}.`;

const taskColumn = (task: Task) =>
  task === "arcMainnet" ? "arc_mainnet_tx_at" : task === "agent" ? "agent_tx_at" : "bridge_tx_at";

export async function POST(req: Request) {
  if (!isAdminConfigured || !supabaseAdmin) return Response.json({ error: "unconfigured" }, { status: 503 });
  let body: { address?: string; signature?: string; task?: Task; txHash?: string; chainId?: number };
  try { body = await req.json(); } catch { return Response.json({ error: "bad body" }, { status: 400 }); }
  const { address, signature, task, txHash, chainId } = body;
  const auto = signature === undefined;
  if (!address || !isAddress(address) || (!auto && typeof signature !== "string") || (task !== "arcMainnet" && task !== "agent" && task !== "bridge")) {
    return Response.json({ error: "bad input" }, { status: 400 });
  }
  if ((task === "agent" || task === "bridge") && txHash && (!isHexString(txHash, 32) || !Number.isInteger(chainId))) {
    return Response.json({ error: "transaction hash and chain are required" }, { status: 400 });
  }
  if (!auto) {
    try {
      const recovered = verifyMessage(message(address, task, txHash), signature!);
      if (recovered.toLowerCase() !== address.toLowerCase()) return Response.json({ error: "signature mismatch" }, { status: 401 });
    } catch { return Response.json({ error: "bad signature" }, { status: 401 }); }
  }

  const wallet = address.toLowerCase();
  const { data: row } = await supabaseAdmin.from("waitlist").select("wallet, arc_mainnet_tx_at, agent_tx_at, bridge_tx_at").eq("wallet", wallet).single();
  if (!row) return Response.json({ error: "not registered" }, { status: 404 });
  const col = taskColumn(task);
  if (row[col]) return Response.json({ ok: true, already: true });

  if (task === "arcMainnet") {
    if (!(await hasArcActivity(wallet))) return Response.json({ error: "no Arc mainnet transaction found" }, { status: 409 });
  } else if (txHash) {
    const provider = providerForChain(chainId!);
    if (!provider) return Response.json({ error: "unsupported transaction chain" }, { status: 400 });
    const tx = await (provider as JsonRpcProvider).getTransaction(txHash!);
    const receipt = await (provider as JsonRpcProvider).getTransactionReceipt(txHash!);
    if (!tx || !receipt || receipt.status !== 1 || tx.from.toLowerCase() !== wallet) {
      return Response.json({ error: "successful wallet transaction not found" }, { status: 409 });
    }
  } else if (task === "agent") {
    const { data } = await supabaseAdmin.from("point_actions").select("tx_hash").eq("wallet", wallet).eq("source_slug", "swap").limit(1);
    if (!data?.length) return Response.json({ error: "no qualifying Kaleido trade found" }, { status: 409 });
  } else {
    const { data } = await supabaseAdmin.from("cctp_transfers").select("tx_hash").ilike("recipient", wallet).limit(1);
    if (!data?.length) return Response.json({ error: "no qualifying bridge found" }, { status: 409 });
  }
  const { error } = await supabaseAdmin.from("waitlist").update({ [col]: new Date().toISOString() }).eq("wallet", wallet).is(col, null);
  if (error) return Response.json({ error: "record failed" }, { status: 500 });
  return Response.json({ ok: true });
}
