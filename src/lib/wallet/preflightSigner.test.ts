/**
 * The sign-time preflight: it must remove doomed wallet prompts and NEVER block a
 * transaction that would have gone through.
 *
 * Run with `npx tsx src/lib/wallet/preflightSigner.test.ts`.
 *
 * The signer here is a fake — three methods and a counter — because the property
 * under test is about control flow (does the real send happen, and when), not
 * about any real chain. `withPreflight` forwards everything else to the wrapped
 * signer, so the fake only implements what the wrapper touches.
 */
import type { Signer, TransactionRequest } from "ethers";
import { withPreflight } from "./preflightSigner.ts";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, got?: string) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${got === undefined ? "" : ` — ${got}`}`);
  }
};

/** A fake signer whose `call` behaviour the test controls, counting real sends. */
function fakeSigner(onCall: () => Promise<unknown>) {
  const state = { sends: 0, calls: 0, lastSent: null as TransactionRequest | null };
  const signer = {
    async call(tx: TransactionRequest) {
      state.calls++;
      return onCall();
    },
    async sendTransaction(tx: TransactionRequest) {
      state.sends++;
      state.lastSent = tx;
      return { hash: "0xsent" };
    },
    async getAddress() {
      return "0xabc";
    },
    marker: "the-real-signer",
  };
  return { signer: signer as unknown as Signer, state };
}

const revert = () => {
  const e = new Error("execution reverted") as Error & { code?: string; data?: string };
  e.code = "CALL_EXCEPTION";
  e.data = "0xdeadbeef";
  return Promise.reject(e);
};
const rpcHiccup = () => {
  const e = new Error("timeout") as Error & { code?: string };
  e.code = "TIMEOUT";
  return Promise.reject(e);
};

async function main() {
  const tx: TransactionRequest = { to: "0xdef", data: "0x1234" };

  console.log("\n— a transaction that simulates clean is sent —");
  {
    const { signer, state } = fakeSigner(() => Promise.resolve("0x"));
    const wrapped = withPreflight(signer);
    const res = await wrapped.sendTransaction(tx);
    check("the preflight eth_call ran", state.calls === 1, String(state.calls));
    check("the real send ran once", state.sends === 1, String(state.sends));
    check("its result is returned", (res as { hash?: string }).hash === "0xsent");
  }

  console.log("\n— a transaction that would revert never reaches the wallet —");
  {
    const { signer, state } = fakeSigner(revert);
    const wrapped = withPreflight(signer);
    let threw: unknown = null;
    try {
      await wrapped.sendTransaction(tx);
    } catch (e) {
      threw = e;
    }
    check("it threw before sending", threw !== null);
    check(
      "the revert is re-thrown intact, data and all",
      (threw as { code?: string; data?: string })?.code === "CALL_EXCEPTION" &&
        (threw as { data?: string })?.data === "0xdeadbeef",
      JSON.stringify({ code: (threw as { code?: string })?.code }),
    );
    check("the wallet was never asked to sign", state.sends === 0, String(state.sends));
  }

  console.log("\n— fail open: a flaky preflight must not block a good send —");
  {
    const { signer, state } = fakeSigner(rpcHiccup);
    const wrapped = withPreflight(signer);
    const res = await wrapped.sendTransaction(tx);
    check("a non-revert preflight error is swallowed", state.calls === 1);
    check("the real send still ran", state.sends === 1, String(state.sends));
    check("and returned normally", (res as { hash?: string }).hash === "0xsent");
  }

  console.log("\n— a signer with no usable call still sends (fail open) —");
  {
    /* Some signer implementations may not implement `.call`; the wrapper must
       degrade to today's behaviour, not throw. */
    const bare = {
      async sendTransaction() {
        return { hash: "0xbare" };
      },
    } as unknown as Signer;
    const wrapped = withPreflight(bare);
    const res = await wrapped.sendTransaction(tx);
    check("no `.call` means no preflight, send proceeds", (res as { hash?: string }).hash === "0xbare");
  }

  console.log("\n— everything else forwards to the real signer —");
  {
    const { signer } = fakeSigner(() => Promise.resolve("0x"));
    const wrapped = withPreflight(signer);
    const addr = await wrapped.getAddress();
    check("a forwarded method works", addr === "0xabc", addr);
    check(
      "a forwarded property reads through",
      (wrapped as unknown as { marker?: string }).marker === "the-real-signer",
    );
  }
}

main().then(() => {
  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
});
