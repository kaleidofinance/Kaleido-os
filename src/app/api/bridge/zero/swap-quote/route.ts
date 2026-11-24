import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { ZERO_SOURCE_BY_ID, ZRO_OFT_ADDRESS } from "@/lib/bridge/zero";

export const dynamic = "force-dynamic";

/**
 * Quotes a same-chain swap (any token on a supported EVM chain -> canonical $ZRO)
 * via LI.FI so users can bridge any token from any chain to Zero in 2 clean steps:
 *   1. Swap Token -> $ZRO on source chain
 *   2. Bridge $ZRO -> Zero (or enroll in Auto-Bridge Queue if route is closed)
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      chainId?: number;
      fromToken?: string;
      fromAmount?: string;
      fromAddress?: string;
      slippage?: number;
    };

    const chainId = Number(body.chainId);
    const source = ZERO_SOURCE_BY_ID[chainId];
    if (!source) {
      return NextResponse.json({ error: "Unsupported source chain" }, { status: 400 });
    }
    if (!body.fromToken || !ethers.isAddress(body.fromToken)) {
      return NextResponse.json({ error: "Invalid fromToken address" }, { status: 400 });
    }
    if (!body.fromAddress || !ethers.isAddress(body.fromAddress)) {
      return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
    }
    if (!body.fromAmount || !/^\d+$/.test(body.fromAmount) || BigInt(body.fromAmount) <= 0n) {
      return NextResponse.json({ error: "Invalid fromAmount" }, { status: 400 });
    }

    const params = new URLSearchParams({
      fromChain: String(chainId),
      toChain: String(chainId),
      fromToken: body.fromToken,
      toToken: ZRO_OFT_ADDRESS,
      fromAmount: body.fromAmount,
      fromAddress: body.fromAddress,
      slippage: String(body.slippage ?? 0.005),
      integrator: "kaleido",
    });

    const headers: Record<string, string> = { Accept: "application/json" };
    if (process.env.LIFI_API_KEY) {
      headers["x-lifi-api-key"] = process.env.LIFI_API_KEY;
    }

    const res = await fetch(`https://li.quest/v1/quote?${params.toString()}`, {
      headers,
      cache: "no-store",
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      return NextResponse.json(
        { error: String(data.message || `LI.FI quote failed (${res.status})`) },
        { status: res.status },
      );
    }

    const estimate = (data.estimate as Record<string, unknown> | undefined) ?? {};
    const txReq = (data.transactionRequest as Record<string, unknown> | undefined) ?? {};
    const approvalAddress =
      typeof estimate.approvalAddress === "string" ? estimate.approvalAddress : null;

    return NextResponse.json({
      tool: String(data.tool || "LI.FI"),
      toAmount: String(estimate.toAmount || "0"),
      toAmountMin: String(estimate.toAmountMin || "0"),
      fromAmountUSD: estimate.fromAmountUSD ? String(estimate.fromAmountUSD) : null,
      toAmountUSD: estimate.toAmountUSD ? String(estimate.toAmountUSD) : null,
      approvalAddress,
      transactionRequest: {
        to: String(txReq.to || ""),
        data: String(txReq.data || "0x"),
        value: String(txReq.value || "0"),
        gasLimit: txReq.gasLimit ? String(txReq.gasLimit) : undefined,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Swap quote error" },
      { status: 500 },
    );
  }
}
