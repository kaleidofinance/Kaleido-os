/*
 * The send a funding bridge exists for: where it must land, and when it has.
 * Run with `npm run test:afterbridge`.
 */
import {
  arrivalTarget,
  clearWatch,
  loadWatch,
  saveWatch,
  waitForArrival,
  type KeyValueStore,
} from "./afterBridge.ts";

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

const TO = "0xACF53eE33893FA6F9fc246b6a4261ceF95A9D77C";
const usdcArc = {
  address: "0x3600000000000000000000000000000000000000",
  name: "USDC", symbol: "USDC", decimals: 6, chainId: 5042,
};
const send = (over: Record<string, unknown> = {}) =>
  ({ kind: "send", amount: "5", token: usdcArc, to: TO, chain: "Base", ...over }) as never;

async function main() {
  console.log("\n— where the send must land —");
  {
    const t = arrivalTarget(send());
    check(
      "a send on Base waits for Base's USDC, in Base's decimals",
      !!t && t.chainId === 8453 && t.token.toLowerCase() === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" && t.decimals === 6 && t.units === 5_000_000n && !t.isNative,
      JSON.stringify(t, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    );
    const bsc = arrivalTarget(send({ chain: "bsc", amount: "1.5" }));
    check("BSC's USDC is 18 decimals, so 1.5 is 1.5e18 units", !!bsc && bsc.units === 1_500_000_000_000_000_000n, String(bsc?.units));
    check("a send with no chain has no target (never guessed)", arrivalTarget(send({ chain: undefined })) === null);
    check("an unknown chain has no target", arrivalTarget(send({ chain: "mars" })) === null);
    check("more precision than the token holds has no target", arrivalTarget(send({ amount: "1.1234567" })) === null);
    check("anything but a send has no target", arrivalTarget({ kind: "stake", amount: "5" } as never) === null);
  }

  console.log("\n— when it has landed —");
  const fakeClock = () => {
    let t = 0;
    return { now: () => t, sleep: async (ms: number) => { t += ms; } };
  };
  {
    const seq: (bigint | null | "throw")[] = [0n, null, "throw", 4_000_000n, 5_000_000n];
    let i = 0;
    const clock = fakeClock();
    const out = await waitForArrival({
      read: async () => {
        const v = seq[Math.min(i++, seq.length - 1)];
        if (v === "throw") throw new Error("rpc");
        return v;
      },
      need: 5_000_000n,
      intervalMs: 8_000,
      timeoutMs: 60_000,
      ...clock,
    });
    check("keeps polling through empty, unreadable and failing reads until it's covered", out === "arrived" && i === 5, `${out} after ${i}`);
  }
  {
    const clock = fakeClock();
    let reads = 0;
    const out = await waitForArrival({ read: async () => { reads++; return 1n; }, need: 5n, intervalMs: 10_000, timeoutMs: 30_000, ...clock });
    check("gives up at the timeout", out === "timeout" && reads === 4, `${out} ${reads}`);
  }
  {
    const ac = new AbortController();
    const clock = fakeClock();
    let reads = 0;
    const out = await waitForArrival({
      read: async () => { if (++reads === 2) ac.abort(); return 0n; },
      need: 5n, intervalMs: 1_000, timeoutMs: 60_000, signal: ac.signal, ...clock,
    });
    check("stops when aborted (Clear, leaving the page)", out === "aborted" && reads === 2, `${out} ${reads}`);
  }
  {
    const out = await waitForArrival({ read: async () => 7n, need: 5n, intervalMs: 1, timeoutMs: 1, ...fakeClock() });
    check("an already-covered balance arrives on the first read", out === "arrived");
  }

  console.log("\n— surviving a reload —");
  {
    const mem = new Map<string, string>();
    const store: KeyValueStore = {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
      removeItem: (k) => void mem.delete(k),
    };
    const W = "0x1111111111111111111111111111111111111111";
    const OTHER = "0x2222222222222222222222222222222222222222";
    saveWatch(store, W, { then: send(), deadline: 123 });
    const back = loadWatch(store, W.toUpperCase().replace("0X", "0x"));
    check(
      "a saved watch comes back for the same wallet (address case ignored)",
      !!back && back.deadline === 123 && back.then.kind === "send" &&
        (back.then as { to: string }).to === TO && (back.then as { chain?: string }).chain === "Base" &&
        (back.then as { amount: string }).amount === "5",
      JSON.stringify(back),
    );
    check("…and it still resolves to the same arrival target", !!back && arrivalTarget(back.then)?.units === 5_000_000n);
    check("another wallet never sees it", loadWatch(store, OTHER) === null);
    clearWatch(store, W);
    check("cleared means gone", loadWatch(store, W) === null);

    const key = `kaleido:afterBridge:${W.toLowerCase()}`;
    const good = JSON.parse(JSON.stringify({ then: send(), deadline: 1 }));
    const tamper = (f: (v: any) => void) => {
      const v = JSON.parse(JSON.stringify(good));
      f(v);
      mem.set(key, JSON.stringify(v));
      return loadWatch(store, W);
    };
    check("a stored non-send is refused", tamper((v) => { v.then.kind = "bridge"; }) === null);
    check("a malformed recipient is refused", tamper((v) => { v.then.to = "0x1234"; }) === null);
    check("an amount that isn't a plain number is refused", tamper((v) => { v.then.amount = "5e3"; }) === null);
    check("a send with no chain is refused", tamper((v) => { delete v.then.chain; }) === null);
    check("bad token decimals are refused", tamper((v) => { v.then.token.decimals = 99; }) === null);
    check("a missing deadline is refused", tamper((v) => { delete v.deadline; }) === null);
    mem.set(key, "{not json");
    check("garbage is refused, not thrown", loadWatch(store, W) === null);

    const broken: KeyValueStore = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("quota"); },
      removeItem: () => { throw new Error("denied"); },
    };
    let threw = false;
    try {
      saveWatch(broken, W, { then: send(), deadline: 1 });
      clearWatch(broken, W);
      loadWatch(broken, W);
      saveWatch(null, W, { then: send(), deadline: 1 });
    } catch {
      threw = true;
    }
    check("a blocked or missing store never throws (the watch just won't survive a reload)", !threw && loadWatch(broken, W) === null);
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
