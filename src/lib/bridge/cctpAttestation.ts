import {
  MESSAGE_TRANSMITTER_V2,
  encodeCctpReceive,
  isCctpDomainChain,
  cctpDomainForChain,
} from "./cctp";
import type { Intent } from "@/lib/v2/intents/types";
import type { PlanResult } from "@/lib/v2/intents/build";

/**
 * The CCTP completion half — turning a finished source burn into the signable
 * destination mint. See cctp.ts for why the burn alone is not the whole story.
 *
 * A CCTP transfer completes in three phases:
 *   1. burn on the source chain (approve + depositForBurn) — cctp.ts;
 *   2. Circle's Iris service attests the burn once the source chain finalises;
 *   3. receiveMessage(message, attestation) on the DESTINATION chain mints it.
 *
 * This file is phase 2→3: it reads the attestation for a burn transaction and,
 * when ready, builds the phase-3 `cctpReceive` intent. Isomorphic — the fetch is
 * global `fetch`, injectable for tests — so a browser hook or a server route can
 * drive it. The message and attestation are Circle's own bytes, opaque here and
 * validated on-chain by the transmitter's signature check; this file never
 * decides the recipient or the amount, which were fixed by the burn.
 */

/** Circle's mainnet attestation service. Testnet uses iris-api-sandbox. */
const IRIS_MAINNET = "https://iris-api.circle.com";

export type CctpAttestation =
  | { status: "ready"; message: string; attestation: string }
  | { status: "pending" }
  | { error: string };

/**
 * Read the attestation for a burn transaction, or say it isn't ready.
 *
 * `pending` and `error` are different states on purpose: pending is the normal
 * "not finalised yet, ask again", error is "this will not resolve by waiting"
 * (bad hash, non-CCTP chain, service down). The caller refuses on error and
 * invites a retry on pending.
 */
export async function fetchCctpAttestation(params: {
  sourceChainId: number;
  txHash: string;
  fetchImpl?: typeof fetch;
}): Promise<CctpAttestation> {
  const { sourceChainId, txHash } = params;
  const doFetch = params.fetchImpl ?? fetch;

  const domain = cctpDomainForChain(sourceChainId);
  if (domain === undefined)
    return { error: `Chain ${sourceChainId} is not a CCTP chain.` };
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash))
    return { error: `${txHash} isn't a transaction hash.` };

  let res: Response;
  try {
    res = await doFetch(
      `${IRIS_MAINNET}/v2/messages/${domain}?transactionHash=${txHash}`,
      { headers: { accept: "application/json" }, cache: "no-store" },
    );
  } catch {
    return { error: "Couldn't reach Circle's attestation service." };
  }

  // 404 = Circle has not indexed the burn yet, which is a normal early state,
  // not a failure — treat it as pending so the caller retries.
  if (res.status === 404) return { status: "pending" };
  if (!res.ok)
    return { error: `Circle's attestation service returned ${res.status}.` };

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { error: "Circle's attestation service returned an unreadable response." };
  }

  const messages = (body as { messages?: unknown }).messages;
  const msg = Array.isArray(messages)
    ? (messages[0] as {
        status?: string;
        message?: string;
        attestation?: string;
      })
    : undefined;
  if (!msg) return { status: "pending" };

  // "complete" with real bytes is the only ready state; anything else (Circle
  // reports the attestation as the literal "PENDING" until it is signed) is not.
  if (
    msg.status !== "complete" ||
    !msg.message ||
    !msg.attestation ||
    msg.attestation === "PENDING"
  )
    return { status: "pending" };

  return { status: "ready", message: msg.message, attestation: msg.attestation };
}

/**
 * Build the destination-mint plan for a burn transaction, or refuse.
 *
 * Refuses on a not-yet-final transfer with a readable "try again" rather than an
 * error, so the completion surface can poll. On success returns a single
 * `cctpReceive` intent, signed on the destination chain — audited like any plan
 * (the auditor pins its `to` to MessageTransmitterV2).
 */
export async function resolveCctpCompletion(params: {
  sourceChainId: number;
  sourceChainName: string;
  destChainId: number;
  txHash: string;
  amount: string;
  symbol: string;
  fetchImpl?: typeof fetch;
}): Promise<PlanResult> {
  const {
    sourceChainId,
    sourceChainName,
    destChainId,
    txHash,
    amount,
    symbol,
  } = params;

  if (!isCctpDomainChain(destChainId))
    return { ok: false, error: `Chain ${destChainId} is not a CCTP chain.` };

  const att = await fetchCctpAttestation({
    sourceChainId,
    txHash,
    fetchImpl: params.fetchImpl,
  });
  if ("error" in att) return { ok: false, error: att.error };
  if (att.status === "pending")
    return {
      ok: false,
      error: `That transfer isn't final yet — Circle hasn't attested your ${sourceChainName} burn. A standard transfer settles once the source chain finalises; try again in a few minutes.`,
    };

  const intent: Intent = {
    kind: "cctpReceive",
    to: MESSAGE_TRANSMITTER_V2,
    data: encodeCctpReceive(att.message, att.attestation),
    chainId: destChainId,
    amount,
    symbol,
    fromChainName: sourceChainName,
  };

  return {
    ok: true,
    build: {
      summary: `Complete your ${amount} ${symbol} transfer from ${sourceChainName}.`,
      intents: [intent],
    },
  };
}
