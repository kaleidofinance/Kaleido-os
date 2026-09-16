// Checks on the CCTP completion machinery (attestation reader + destination
// resolver + the cctpReceive auditor rule). Run with tsx.
//
// The Iris fetch is injected, so nothing here touches the network: the reader is
// exercised against mocked Circle responses (ready / pending / 404 / bad input),
// and the resolver against those to prove it refuses a not-yet-final transfer
// and builds a valid receiveMessage plan when the attestation is ready.
import { ethers } from "ethers";
import {
  MESSAGE_TRANSMITTER_V2,
  encodeCctpReceive,
  isKnownCctpTransmitter,
} from "./cctp.ts";
import {
  fetchCctpAttestation,
  resolveCctpCompletion,
} from "./cctpAttestation.ts";

let pass = 0;
let fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

const ARC = 5042;
const BASE = 8453;
const BNB = 56;
const HASH = "0x" + "ab".repeat(32);
const MESSAGE = "0x" + "11".repeat(120);
const ATTESTATION = "0x" + "22".repeat(65);

// A fetch stand-in that returns a fixed status + JSON body.
const mockFetch = (status, body) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const ready = mockFetch(200, {
  messages: [{ status: "complete", message: MESSAGE, attestation: ATTESTATION }],
});
const iReceive = new ethers.Interface([
  "function receiveMessage(bytes message, bytes attestation) returns (bool)",
]);
const isErr = (r) => typeof r === "object" && r !== null && "error" in r;

async function main() {
  console.log("\n— receiveMessage encoding —");
  const data = encodeCctpReceive(MESSAGE, ATTESTATION);
  const [m, a] = iReceive.decodeFunctionData("receiveMessage", data);
  check("encodes the message bytes", m === MESSAGE);
  check("encodes the attestation bytes", a === ATTESTATION);
  check("transmitter is the known V2 address", isKnownCctpTransmitter(MESSAGE_TRANSMITTER_V2));
  check("a random address is not the transmitter", !isKnownCctpTransmitter(HASH.slice(0, 42)));

  console.log("\n— fetchCctpAttestation —");
  const r1 = await fetchCctpAttestation({ sourceChainId: ARC, txHash: HASH, fetchImpl: ready });
  check("ready when Circle returns complete + bytes", r1.status === "ready" && r1.message === MESSAGE);
  const r2 = await fetchCctpAttestation({ sourceChainId: ARC, txHash: HASH, fetchImpl: mockFetch(404, {}) });
  check("pending on a 404 (not yet indexed)", r2.status === "pending");
  const r3 = await fetchCctpAttestation({
    sourceChainId: ARC,
    txHash: HASH,
    fetchImpl: mockFetch(200, { messages: [{ status: "pending_confirmations", attestation: "PENDING" }] }),
  });
  check("pending while the attestation is still PENDING", r3.status === "pending");
  const r4 = await fetchCctpAttestation({ sourceChainId: ARC, txHash: HASH, fetchImpl: mockFetch(200, { messages: [] }) });
  check("pending when Circle lists no message yet", r4.status === "pending");
  const r5 = await fetchCctpAttestation({ sourceChainId: BNB, txHash: HASH, fetchImpl: ready });
  check("errors on a non-CCTP source chain", isErr(r5));
  const r6 = await fetchCctpAttestation({ sourceChainId: ARC, txHash: "0xnothex", fetchImpl: ready });
  check("errors on a malformed tx hash", isErr(r6));
  const r7 = await fetchCctpAttestation({ sourceChainId: ARC, txHash: HASH, fetchImpl: mockFetch(500, {}) });
  check("errors on a 5xx from Circle", isErr(r7));

  console.log("\n— resolveCctpCompletion —");
  const base = {
    sourceChainId: ARC,
    sourceChainName: "Arc",
    destChainId: BASE,
    txHash: HASH,
    amount: "100",
    symbol: "USDC",
  };
  const good = await resolveCctpCompletion({ ...base, fetchImpl: ready });
  check("builds a plan when the attestation is ready", good.ok === true);
  if (good.ok) {
    const i = good.build.intents[0];
    check("the plan is a single cctpReceive intent", good.build.intents.length === 1 && i.kind === "cctpReceive");
    check("signed on the destination chain", i.kind === "cctpReceive" && i.chainId === BASE);
    check("targets MessageTransmitterV2", i.kind === "cctpReceive" && i.to === MESSAGE_TRANSMITTER_V2);
    check("carries the source chain name", i.kind === "cctpReceive" && i.fromChainName === "Arc");
  }
  const pend = await resolveCctpCompletion({ ...base, fetchImpl: mockFetch(404, {}) });
  check("refuses a not-yet-final transfer", pend.ok === false);
  const badDest = await resolveCctpCompletion({ ...base, destChainId: BNB, fetchImpl: ready });
  check("refuses a non-CCTP destination", badDest.ok === false);

  console.log("\n— cctpReceive auditor rule —");
  const { AUDITORS } = await import("../ai/auditor.ts");
  const step = {
    kind: "cctpReceive",
    to: MESSAGE_TRANSMITTER_V2,
    data: encodeCctpReceive(MESSAGE, ATTESTATION),
    chainId: BASE,
    amount: "100",
    symbol: "USDC",
    fromChainName: "Arc",
  };
  const okRes = AUDITORS.cctpReceive(step, BASE);
  check("accepts a well-formed mint on the connected chain", okRes.reasons.length === 0, JSON.stringify(okRes.reasons));
  check("rejects a wrong target", AUDITORS.cctpReceive({ ...step, to: HASH.slice(0, 42) }, BASE).reasons.length > 0);
  check("rejects a chain mismatch (not the connected chain)", AUDITORS.cctpReceive(step, ARC).reasons.length > 0);
  check("rejects missing attested calldata", AUDITORS.cctpReceive({ ...step, data: "0x" }, BASE).reasons.length > 0);
  check("rejects a non-CCTP destination chain", AUDITORS.cctpReceive({ ...step, chainId: BNB }, BNB).reasons.length > 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
