import {
  MESSAGE_TRANSMITTER_V2,
  encodeCctpReceive,
  isCctpDomainChain,
  cctpDomainForChain,
} from "./cctp";
import { providerForChain } from "@/config/provider";
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

/** MessageTransmitterV2 reverts a second receive with this. */
const USED_NONCE = /nonce already used|already (been )?(received|used)/i;

/**
 * Has this burn already been minted on the destination — by ANYONE?
 *
 * A CCTP burn sets destinationCaller = 0, so the mint can be completed by the
 * user, our keeper, OR a public relayer (measured 2026-09-18: a third party
 * completed a real Arc->Base transfer for free). The pending bar must clear on
 * ALL of those, so it cannot rely on our own records — it has to read the
 * chain. This does, without needing a nonce mapping key: once Circle attests,
 * a read-only `receiveMessage` either would succeed (still mintable, NOT done)
 * or reverts as a used nonce (already minted). Before attestation a mint is
 * impossible, so that reads as not-minted too. Any other revert is
 * inconclusive and also reads as not-minted, so a transient RPC or Circle
 * hiccup never makes the bar vanish while funds are genuinely in flight.
 *
 * `callImpl` is injected in tests; by default it is a read-only eth_call on
 * the destination chain's provider, which throws on revert.
 */
export async function isCctpMinted(params: {
  sourceChainId: number;
  destChainId: number;
  txHash: string;
  fetchImpl?: typeof fetch;
  callImpl?: (chainId: number, to: string, data: string) => Promise<string>;
}): Promise<boolean> {
  const att = await fetchCctpAttestation({
    sourceChainId: params.sourceChainId,
    txHash: params.txHash,
    fetchImpl: params.fetchImpl,
  });
  if ("error" in att || att.status !== "ready") return false;
  const data = encodeCctpReceive(att.message, att.attestation);
  const call =
    params.callImpl ??
    ((chainId, to, d) => {
      const provider = providerForChain(chainId);
      if (!provider) throw new Error(`No provider for chain ${chainId}.`);
      return provider.call({ to, data: d });
    });
  try {
    await call(params.destChainId, MESSAGE_TRANSMITTER_V2, data);
    return false; // would still succeed → mintable, not yet minted
  } catch (e) {
    const msg = String((e as { message?: unknown })?.message ?? e);
    return USED_NONCE.test(msg);
  }
}
