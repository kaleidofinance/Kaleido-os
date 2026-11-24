import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { ZERO_DST_EID, ZERO_PUBLIC_RPC } from "@/lib/bridge/zero";

export const dynamic = "force-dynamic";

export interface ZeroTransferItem {
  guid: string;
  srcTxHash: string;
  dstTxHash: string | null;
  srcEid: number;
  dstEid: number;
  status: string;
  amountZro: string | null;
  created: string | null;
  scanUrl: string;
}

const EID_TO_CHAIN_NAME: Record<number, string> = {
  30101: "Ethereum",
  30110: "Arbitrum",
  30184: "Base",
  30102: "BNB Chain",
  30111: "Optimism",
  30109: "Polygon",
  30106: "Avalanche",
  33002: "Zero",
};

/**
 * Tracks a wallet's bridged $ZRO transfers landing on Zero (dstEid = 33002)
 * using LayerZero Scan's public API — no Zero RPC required before Nov 30.
 */
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address")?.trim() || "";
  if (!ethers.isAddress(address)) {
    return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
  }

  let liveBalanceZro: string | null = null;
  if (ZERO_PUBLIC_RPC) {
    try {
      const provider = new ethers.JsonRpcProvider(ZERO_PUBLIC_RPC, ZERO_DST_EID, {
        staticNetwork: true,
      });
      const bal = await provider.getBalance(address);
      liveBalanceZro = ethers.formatEther(bal);
    } catch {
      liveBalanceZro = null;
    }
  }

  try {
    const url = `https://scan.layerzero-api.com/v1/messages/wallet/${address}?limit=50`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Kaleido-Zero-Bridge/1.0" },
      next: { revalidate: 10 },
    });

    if (!res.ok) {
      return NextResponse.json({
        address,
        zeroRpc: ZERO_PUBLIC_RPC,
        liveBalanceZro,
        deliveredTotalZro: "0",
        inflightTotalZro: "0",
        transfers: [],
        source: "layerzeroscan",
        warning: `LayerZero Scan returned HTTP ${res.status}`,
      });
    }

    const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
    const rows = Array.isArray(json?.data) ? json.data : [];

    let deliveredSum = 0;
    let inflightSum = 0;
    const transfers: (ZeroTransferItem & { srcChainName: string })[] = [];

    for (const row of rows) {
      const pathway = (row.pathway as Record<string, unknown> | undefined) ?? {};
      const dstEid = Number(pathway.dstEid ?? row.dstEid ?? 0);
      if (dstEid !== ZERO_DST_EID) continue;

      const srcEid = Number(pathway.srcEid ?? row.srcEid ?? 0);
      const source = (row.source as Record<string, unknown> | undefined) ?? {};
      const srcTx = (source.tx as Record<string, unknown> | undefined) ?? {};
      const destination = (row.destination as Record<string, unknown> | undefined) ?? {};
      const dstTx = (destination.tx as Record<string, unknown> | undefined) ?? {};
      const statusObj = (row.status as Record<string, unknown> | undefined) ?? {};
      const statusName = String(statusObj.name ?? row.status ?? "INFLIGHT").toUpperCase();

      // Extract OFT amount if present in payload/decoded fields
      let amountZro: string | null = null;
      const payload = srcTx.payload ?? row.payload;
      if (typeof payload === "string" && payload.startsWith("0x") && payload.length >= 82) {
        // LayerZero V2 OFT payload: bytes32 sendTo (64 hex) + uint64 amountSD (16 hex, 6 decimals)
        try {
          const sdHex = "0x" + payload.slice(2 + 64, 2 + 64 + 16);
          const sd = BigInt(sdHex);
          const num = Number(sd) / 1e6;
          if (Number.isFinite(num) && num > 0 && num < 1e9) {
            amountZro = num.toFixed(4).replace(/\.?0+$/, "");
            if (statusName === "DELIVERED") deliveredSum += num;
            else if (statusName !== "FAILED") inflightSum += num;
          }
        } catch {
          amountZro = null;
        }
      }

      const srcTxHash = String(srcTx.txHash ?? "");
      const dstTxHash = dstTx.txHash ? String(dstTx.txHash) : null;
      const guid = String(row.guid ?? srcTxHash);

      transfers.push({
        guid,
        srcTxHash,
        dstTxHash,
        srcEid,
        dstEid,
        srcChainName: EID_TO_CHAIN_NAME[srcEid] || `EID ${srcEid}`,
        status: statusName,
        amountZro,
        created: typeof row.created === "string" ? row.created : null,
        scanUrl: srcTxHash
          ? `https://layerzeroscan.com/tx/${srcTxHash}`
          : `https://layerzeroscan.com/address/${address}`,
      });
    }

    return NextResponse.json({
      address,
      zeroRpc: ZERO_PUBLIC_RPC,
      liveBalanceZro,
      deliveredTotalZro: deliveredSum.toFixed(4).replace(/\.?0+$/, "") || "0",
      inflightTotalZro: inflightSum.toFixed(4).replace(/\.?0+$/, "") || "0",
      transfers,
      source: "layerzeroscan",
    });
  } catch (err) {
    return NextResponse.json({
      address,
      zeroRpc: ZERO_PUBLIC_RPC,
      liveBalanceZro,
      deliveredTotalZro: "0",
      inflightTotalZro: "0",
      transfers: [],
      source: "layerzeroscan",
      warning: err instanceof Error ? err.message : "Failed to fetch LayerZero Scan",
    });
  }
}
