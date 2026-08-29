// Adversarial checks on transaction-error classification. Run with plain tsx —
// no test runner in this repo. Mirrors src/lib/v2/txLog.test.ts.
//
// Every case is an error built with ethers' own `makeError`, in the shape the
// library throws it, and passed through the same `ErrorDecoder` the app uses. That
// is the point of the file: describeFailure's branches are claims about what
// ethers-decode-error returns for each shape, and the first draft got two of them
// wrong — a missing-revert-data estimate does *not* decode to `EmptyError`, and a
// plain `require` string *does* arrive with `fragment.name === "Error"`, which a
// switch over the contract's custom errors must not match. tsc had no opinion on
// either.
//
// The nested-data case is the one that caused the reported bug: a faucet claim
// that reverted `KaleidoTokenFaucet_CooldownNotOver` through a provider that
// nests revert data at `info.error.data` reaches the app with no fragment at all.
import { ErrorDecoder } from "ethers-decode-error";
import { ethers, makeError } from "ethers";
import {
  describeFailure,
  digRevertData,
  isRejection,
  namedRevert,
} from "./txErrors.ts";
import tokenFaucetAbi from "../../abi/TokenFaucet.json";

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

const abi = tokenFaucetAbi as ethers.InterfaceAbi;
const decoder = ErrorDecoder.create([tokenFaucetAbi]);
const iface = new ethers.Interface(abi);
const coder = ethers.AbiCoder.defaultAbiCoder();

const COOLDOWN = iface.encodeErrorResult(
  "KaleidoTokenFaucet_CooldownNotOver",
  [],
);
const NOT_LISTED = iface.encodeErrorResult(
  "KaleidoTokenFaucet_AssetNotListed",
  [],
);
const STRING_REVERT =
  "0x08c379a0" +
  coder.encode(["string"], ["ERC20: transfer amount exceeds balance"]).slice(2);
const PANIC =
  "0x4e487b71" + coder.encode(["uint256"], [0x11]).slice(2);

/** The app's two-step: name the contract's error, else describe the failure. */
async function classify(error: unknown) {
  const err = await decoder.decode(error);
  return {
    err,
    named: namedRevert(err, error, abi),
    message: describeFailure(err, error, abi),
    rejected: isRejection(err),
  };
}

/** An error whose revert data sits where the decoder does not look. */
const nested = (data: string, message = "execution reverted") => {
  const e = makeError(message, "CALL_EXCEPTION", {
    action: "estimateGas",
  }) as Error & { info?: unknown };
  e.info = { error: { code: 3, message, data } };
  return e;
};

/**
 * tsx compiles this file as CommonJS, where top-level await is not available,
 * so the whole run lives in one function.
 */
async function run() {
  /* -------------------------------------------------------------------------- */
  console.log("digRevertData");

  check(
    "finds data at the top level",
    digRevertData({ data: COOLDOWN }) === COOLDOWN,
  );
  check(
    "finds data at error.error.data",
    digRevertData({ error: { data: COOLDOWN } }) === COOLDOWN,
  );
  check(
    "finds data at error.info.error.data",
    digRevertData({ info: { error: { data: COOLDOWN } } }) === COOLDOWN,
  );
  check(
    "finds data at error.data.data",
    digRevertData({ data: { data: COOLDOWN } }) === COOLDOWN,
  );
  check("ignores a non-hex data field", digRevertData({ data: "boom" }) === null);
  check(
    "ignores a bare selector-less hex string",
    digRevertData({ data: "0x" }) === null,
  );
  check("survives a cycle", (() => {
    const a: Record<string, unknown> = {};
    const b: Record<string, unknown> = { error: a };
    a.error = b;
    return digRevertData(a) === null;
  })());
  check("returns null for a string", digRevertData("nope") === null);
  check("returns null for null", digRevertData(null) === null);

  /* -------------------------------------------------------------------------- */
  console.log("\nnamed contract errors reach the caller's switch");

  {
    /* The shape that already worked: data on the error itself. */
    const r = await classify(
      makeError("execution reverted", "CALL_EXCEPTION", { data: COOLDOWN }),
    );
    check(
      "top-level data names the error",
      r.named === "KaleidoTokenFaucet_CooldownNotOver",
      `got ${r.named}`,
    );
  }
  {
    /* The shape that did not, and is the reported bug. */
    const r = await classify(nested(COOLDOWN));
    check(
      "decoder alone sees no fragment for nested data",
      r.err?.fragment?.name === undefined,
      `got ${r.err?.fragment?.name}`,
    );
    check(
      "nested data still names the error",
      r.named === "KaleidoTokenFaucet_CooldownNotOver",
      `got ${r.named}`,
    );
  }
  {
    const r = await classify(nested(NOT_LISTED));
    check(
      "nested AssetNotListed is named too",
      r.named === "KaleidoTokenFaucet_AssetNotListed",
      `got ${r.named}`,
    );
  }
  {
    /* A `require` string is not one of the contract's named errors, even though
       ethers reports its fragment as "Error". A switch keyed on namedRevert must
       not see it, or a `case "Error"` becomes plausible. */
    const r = await classify(
      makeError("execution reverted", "CALL_EXCEPTION", { data: STRING_REVERT }),
    );
    check(
      "decoder does report fragment Error for a string revert",
      r.err?.fragment?.name === "Error",
      `got ${r.err?.fragment?.name}`,
    );
    check("string revert is not a named error", r.named === null, `got ${r.named}`);
    check(
      "string revert shows the revert message",
      r.message === "ERC20: transfer amount exceeds balance",
      `got ${r.message}`,
    );
  }
  {
    const r = await classify(nested(STRING_REVERT));
    check(
      "nested string revert is not a named error",
      r.named === null,
      `got ${r.named}`,
    );
    check(
      "nested string revert still shows its message",
      r.message === "ERC20: transfer amount exceeds balance",
      `got ${r.message}`,
    );
  }
  {
    const r = await classify(
      makeError("execution reverted", "CALL_EXCEPTION", { data: PANIC }),
    );
    check("panic is not a named error", r.named === null, `got ${r.named}`);
    check(
      "panic is described, not swallowed",
      /overflow|underflow|internal error/i.test(r.message),
      `got ${r.message}`,
    );
  }

  /* -------------------------------------------------------------------------- */
  console.log("\nthe cases that used to all read 'an unexpected error occurred'");

  const GENERIC = /unexpected error/i;

  {
    const r = await classify(
      makeError("user rejected action", "ACTION_REJECTED", {
        action: "sendTransaction",
        reason: "rejected",
        info: {},
      }),
    );
    check("a decline is recognised", r.rejected, `type ${r.err?.type}`);
    check(
      "a decline says nothing was sent",
      /dismissed/i.test(r.message) && /nothing was sent/i.test(r.message),
      `got ${r.message}`,
    );
    check("a decline is not generic", !GENERIC.test(r.message));
  }
  {
    const r = await classify(
      makeError(
        "insufficient funds for intrinsic transaction cost",
        "INSUFFICIENT_FUNDS",
        { transaction: {} },
      ),
    );
    check("no gas is not a decline", !r.rejected);
    check(
      "no gas says so, and says the tokens are free",
      /cover the gas/i.test(r.message) && /free/i.test(r.message),
      `got ${r.message}`,
    );
  }
  {
    const r = await classify(
      makeError("network changed", "NETWORK_ERROR", { event: "changed" }),
    );
    check(
      "a network error asks the reader to switch",
      /different network/i.test(r.message) && /switch/i.test(r.message),
      `got ${r.message}`,
    );
  }
  {
    const r = await classify(
      makeError("nonce too low", "NONCE_EXPIRED", { transaction: {} }),
    );
    check(
      "a stale nonce names the pending transaction",
      /still pending/i.test(r.message),
      `got ${r.message}`,
    );
  }
  {
    /* A gas estimate against something that is not the contract. Measured: this
       decodes to RpcError/CALL_EXCEPTION with reason "missing revert data" — not to
       EmptyError, which is why describeFailure keys on the code as well. */
    const r = await classify(
      makeError("missing revert data", "CALL_EXCEPTION", {
        action: "estimateGas",
      }),
    );
    check("an empty revert is not named", r.named === null);
    check(
      "an empty revert points at the network",
      /without saying why/i.test(r.message) && /network/i.test(r.message),
      `got ${r.message}`,
    );
    check(
      "an empty revert does not leak 'missing revert data'",
      !/missing revert data/i.test(r.message),
      `got ${r.message}`,
    );
  }
  {
    const r = await classify(
      makeError("execution reverted", "CALL_EXCEPTION", { data: "0xdeadbeef" }),
    );
    check("an unknown selector is not named", r.named === null, `got ${r.named}`);
    check(
      "an unknown selector is quoted so it can be looked up",
      r.message.includes("0xdeadbeef"),
      `got ${r.message}`,
    );
  }
  {
    const r = await classify(new Error("network went away"));
    check(
      "a plain Error passes its message through",
      r.message === "network went away",
      `got ${r.message}`,
    );
  }
  {
    /* The decoder answers "Invalid error" for a thrown string, which would read as
       a bug if it reached a toast. */
    const r = await classify("boom");
    check(
      "a thrown string does not surface 'Invalid error'",
      !/invalid error/i.test(r.message),
      `got ${r.message}`,
    );
  }
  {
    const long = "x".repeat(400);
    const r = await classify(new Error(long));
    check(
      "a novel-length reason is clamped",
      r.message.length <= 160 && r.message.endsWith("…"),
      `len ${r.message.length}`,
    );
  }

  /* -------------------------------------------------------------------------- */
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void run();
