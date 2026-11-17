import { NextRequest, NextResponse } from "next/server";
import { requestSynthraSwapStatus } from "@/lib/swap/synthraServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HASH = /^0x[0-9a-fA-F]{64}$/;

/** Proxy LI.FI route status so the browser can reconcile destination completion. */
export async function GET(request: NextRequest) {
  const txHash = request.nextUrl.searchParams.get("tx") ?? "";
  const fromChain = request.nextUrl.searchParams.get("from") ?? "";
  const toChain = request.nextUrl.searchParams.get("to") ?? "";
  const provider = request.nextUrl.searchParams.get("provider") ?? "lifi";
  const requestId = request.nextUrl.searchParams.get("requestId") ?? "";
  if (!HASH.test(txHash) || !/^\d+$/.test(fromChain) || !/^\d+$/.test(toChain))
    return NextResponse.json(
      { error: "invalid bridge status query" },
      { status: 400 },
    );
  if (provider === "synthra") {
    if (!/^[A-Za-z0-9._:-]{8,256}$/.test(requestId))
      return NextResponse.json(
        { error: "invalid Synthra status query" },
        { status: 400 },
      );
    try {
      const raw = (await requestSynthraSwapStatus(requestId)) as Record<
        string,
        unknown
      > | null;
      const state = String(
        raw?.status ?? raw?.state ?? "waiting",
      ).toLowerCase();
      const status =
        state === "success"
          ? "DONE"
          : state === "failure" ||
              state === "failed" ||
              state === "refund" ||
              state === "refunded"
            ? "FAILED"
            : "PENDING";
      const destinationTxHash =
        (typeof raw?.destinationTxHash === "string" && raw.destinationTxHash) ||
        (raw?.destination &&
        typeof raw.destination === "object" &&
        typeof (raw.destination as Record<string, unknown>).txHash === "string"
          ? (raw.destination as Record<string, unknown>).txHash
          : null);
      return NextResponse.json({
        status,
        provider: "synthra",
        substatus: raw?.status ?? raw?.state ?? null,
        destinationTxHash,
      });
    } catch {
      return NextResponse.json({ status: "PENDING", provider: "synthra" });
    }
  }
  const url = new URL("https://li.quest/v1/status");
  url.searchParams.set("txHash", txHash);
  url.searchParams.set("fromChain", fromChain);
  url.searchParams.set("toChain", toChain);
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return NextResponse.json({ status: "PENDING" });
    const data = (await response.json()) as {
      status?: string;
      substatus?: string;
      receiving?: { txHash?: string };
    };
    return NextResponse.json({
      status: data.status ?? "PENDING",
      substatus: data.substatus ?? null,
      destinationTxHash: data.receiving?.txHash ?? null,
    });
  } catch {
    return NextResponse.json({ status: "PENDING" });
  }
}
