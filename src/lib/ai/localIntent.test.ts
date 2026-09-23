import {
  browserLocalIntentOptions,
  DEFAULT_BROWSER_LOCAL_INTENT_MODEL,
  validateLocalClassification,
} from "./localIntent";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, got = "") => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${got ? ` ${got}` : ""}`);
  }
};

const valid = validateLocalClassification({
  kind: "follow_up",
  reference: "previous_command",
  reason: "Uses the last swap",
  amount: "1000", // must be ignored: models never author transaction fields
});
check("accepts the safe classification envelope", valid.kind === "follow_up");
check("keeps only an allowed reference", valid.reference === "previous_command");
check("ignores transaction fields", !("amount" in valid));

const malformed = validateLocalClassification({
  kind: "execute",
  tokenIn: "0xdead",
  calldata: "0x1234",
});
check("rejects an execution-shaped model response", malformed.kind === "unknown");
check("does not preserve an untrusted reference", malformed.reference === undefined);

const tooLong = validateLocalClassification({
  kind: "question",
  reason: "x".repeat(161),
});
check("drops overlong model prose", tooLong.reason === undefined);

const options = browserLocalIntentOptions();
check("uses the reviewed small-model default", options.modelId === DEFAULT_BROWSER_LOCAL_INTENT_MODEL);
check("starts with a quantized browser dtype", options.dtype === "q4");
check("prefers the GPU acceleration path", options.device === "webgpu");

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
