// The CCTP completion keeper's loop, driven with fakes: no Supabase, no Circle,
// no chain. What these protect: a mint the keeper cannot pay for stays pending
// (never counted as an attempt), a used nonce is success not failure, a dry run
// sends nothing, and a row is given up on only by the two bounds.
//
//   npm run test:cctpkeeper

import type { CctpAttestation } from "../bridge/cctpAttestation.ts";
import type { CctpKeeperDeps, CctpTransferRow, SendOutcome } from "./cctpKeeper.ts";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, got = "") => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${got ? " " + got : ""}`);
  }
};

const TX = (n: number) => "0x" + n.toString(16).padStart(64, "0");
const READY: CctpAttestation = { status: "ready", message: "0xab", attestation: "0xcd" };
const PENDING: CctpAttestation = { status: "pending" };

function row(over: Partial<CctpTransferRow> = {}): CctpTransferRow {
  return {
    id: 1,
    tx_hash: TX(1),
    source_chain_id: 5042,
    dest_chain_id: 8453,
    recipient: "0x1111111111111111111111111111111111111111",
    amount: "10",
    symbol: "USDC",
    status: "pending",
    mint_tx_hash: null,
    attempts: 0,
    last_error: null,
    created_at: new Date(1_000_000_000_000).toISOString(),
    ...over,
  };
}

/** A fake world: rows in memory, scripted attestations and sends, every call recorded. */
function world(opts: {
  rows: CctpTransferRow[];
  attest?: (r: CctpTransferRow) => CctpAttestation | Promise<CctpAttestation>;
  send?: (dest: number, data: string) => SendOutcome;
  now?: number;
}) {
  const updates: Array<{ id: number; patch: Record<string, unknown> }> = [];
  const sends: Array<{ dest: number; data: string }> = [];
  const deps: CctpKeeperDeps = {
    listPending: async (limit) => opts.rows.filter((r) => r.status === "pending").slice(0, limit),
    update: async (id, patch) => {
      updates.push({ id, patch });
      const r = opts.rows.find((x) => x.id === id);
      if (r) Object.assign(r, patch);
    },
    attest: async (r) => (opts.attest ? opts.attest(r) : READY),
    send: async (dest, data) => {
      sends.push({ dest, data });
      return opts.send ? opts.send(dest, data) : { hash: "0xmint" };
    },
    keeperAddress: () => "0xkeeper",
    now: () => opts.now ?? 1_000_000_000_000 + 60_000,
  };
  return { deps, updates, sends };
}

async function main() {
  const { completeCctpTransfers, MAX_ATTEMPTS, PENDING_TTL_MS } = await import("./cctpKeeper.ts");

  console.log("\n— the happy path —");
  {
    const w = world({ rows: [row()] });
    const r = await completeCctpTransfers({}, w.deps);
    check("attested and sent → minted", r.minted.length === 1 && r.ok, JSON.stringify(r));
    check("the row is marked minted with the mint hash", w.updates[0]?.patch.status === "minted" && w.updates[0]?.patch.mint_tx_hash === "0xmint", JSON.stringify(w.updates));
    check("the send went to the destination chain with receiveMessage calldata", w.sends[0]?.dest === 8453 && String(w.sends[0]?.data).startsWith("0x"), JSON.stringify(w.sends));
    check("the keeper address is reported", r.keeper === "0xkeeper");
  }

  console.log("\n— a dry run sends nothing —");
  {
    const w = world({ rows: [row()] });
    const r = await completeCctpTransfers({ dryRun: true }, w.deps);
    check("would mint, did not", r.wouldMint.length === 1 && r.minted.length === 0 && w.sends.length === 0, JSON.stringify(r));
    check("and touches no row", w.updates.length === 0);
  }

  console.log("\n— Circle not ready yet —");
  {
    const w = world({ rows: [row()], attest: () => PENDING });
    const r = await completeCctpTransfers({}, w.deps);
    check("stays pending, no send, no attempt counted", r.stillPending === 1 && w.sends.length === 0 && w.updates.length === 0, JSON.stringify(r));
  }

  console.log("\n— an unfunded keeper is loud, not silent —");
  {
    const w = world({ rows: [row()], send: () => ({ skipped: "keeper 0xkeeper is unfunded on Base: has 0.0 ETH, needs about 0.0006 ETH" }) });
    const r = await completeCctpTransfers({}, w.deps);
    check("reported as skipped", r.skipped.length === 1 && r.skipped[0].includes("unfunded"), JSON.stringify(r.skipped));
    check("the row stays pending with attempts untouched", w.updates.length === 0);
  }

  console.log("\n— a used nonce is someone else's success —");
  {
    const w = world({ rows: [row()], send: () => ({ error: "execution reverted: Nonce already used", nonceUsed: true }) });
    const r = await completeCctpTransfers({}, w.deps);
    check("counted as minted", r.minted.length === 1 && r.errors.length === 0, JSON.stringify(r));
    check("marked minted without a mint hash of ours", w.updates[0]?.patch.status === "minted" && !("mint_tx_hash" in (w.updates[0]?.patch ?? {})), JSON.stringify(w.updates));
  }

  console.log("\n— a real send failure counts one attempt —");
  {
    const w = world({ rows: [row({ attempts: 3 })], send: () => ({ error: "send: insufficient funds for gas" }) });
    const r = await completeCctpTransfers({}, w.deps);
    check("attempts go 3 → 4 and the error is kept", w.updates[0]?.patch.attempts === 4 && String(w.updates[0]?.patch.last_error).includes("insufficient"), JSON.stringify(w.updates));
    check("reported as an error, still pending", r.errors.length === 1 && r.failed.length === 0);
  }

  console.log("\n— an attestation error counts one attempt too —");
  {
    const w = world({ rows: [row()], attest: () => ({ error: "Circle's attestation service returned 502." }) });
    const r = await completeCctpTransfers({}, w.deps);
    check("attempts 0 → 1, no send", w.updates[0]?.patch.attempts === 1 && w.sends.length === 0, JSON.stringify(w.updates));
    check("reported", r.errors.length === 1);
  }

  console.log("\n— the two bounds —");
  {
    const w = world({ rows: [row({ attempts: MAX_ATTEMPTS })] });
    const r = await completeCctpTransfers({}, w.deps);
    check(`${MAX_ATTEMPTS} attempts → failed, without another send`, r.failed.length === 1 && w.sends.length === 0 && w.updates[0]?.patch.status === "failed", JSON.stringify(w.updates));
    const w2 = world({ rows: [row()], now: 1_000_000_000_000 + PENDING_TTL_MS + 1 });
    const r2 = await completeCctpTransfers({}, w2.deps);
    check("3 days without attestation → failed, no send", r2.failed.length === 1 && w2.sends.length === 0 && String(w2.updates[0]?.patch.last_error).includes("3 days"), JSON.stringify(w2.updates));
  }

  console.log("\n— the limit and a registry error —");
  {
    const rows = [row({ id: 1, tx_hash: TX(1) }), row({ id: 2, tx_hash: TX(2) }), row({ id: 3, tx_hash: TX(3) })];
    const w = world({ rows });
    const r = await completeCctpTransfers({ limit: 2 }, w.deps);
    check("processes at most `limit` rows", r.processed === 2 && r.minted.length === 2, JSON.stringify(r));
    const broken: CctpKeeperDeps = { ...world({ rows: [] }).deps, listPending: async () => ({ error: "cctp_transfers table missing" }) };
    const rb = await completeCctpTransfers({}, broken);
    check("a registry error is reported, not thrown", rb.ok === false && String(rb.error).includes("missing"), JSON.stringify(rb));
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
