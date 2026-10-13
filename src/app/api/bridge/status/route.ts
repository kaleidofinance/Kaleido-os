import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const HASH = /^0x[0-9a-fA-F]{64}$/;

/** Proxy LI.FI route status so the browser can reconcile destination completion. */
export async function GET(request: NextRequest) {
  const txHash = request.nextUrl.searchParams.get("tx") ?? "";
  const fromChain = request.nextUrl.searchParams.get("from") ?? "";
  const toChain = request.nextUrl.searchParams.get("to") ?? "";
  if (!HASH.test(txHash) || !/^\d+$/.test(fromChain) || !/^\d+$/.test(toChain))
    return NextResponse.json({ error: "invalid bridge status query" }, { status: 400 });
  const url = new URL("https://li.quest/v1/status");
  url.searchParams.set("txHash", txHash);
  url.searchParams.set("fromChain", fromChain);
  url.searchParams.set("toChain", toChain);
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return NextResponse.json({ status: "PENDING" });
    const data = (await response.json()) as { status?: string; substatus?: string; receiving?: { txHash?: string } };
    return NextResponse.json({ status: data.status ?? "PENDING", substatus: data.substatus ?? null, destinationTxHash: data.receiving?.txHash ?? null });
  } catch {
    return NextResponse.json({ status: "PENDING" });
  }
}
