import {
  jevReplaceMinConfidence,
  jevMode,
  shouldSkipNormalizer,
} from "./jev.ts";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  if (actual !== expected) {
    failures += 1;
    console.error(`FAIL ${label}:`, { actual, expected });
  } else {
    console.log(`ok   ${label}`);
  }
}

const originalMode = process.env.LUCA_JEV_NORMALIZER_MODE;
const originalMinimum = process.env.LUCA_JEV_REPLACE_MIN_CONFIDENCE;

delete process.env.LUCA_JEV_NORMALIZER_MODE;
delete process.env.LUCA_JEV_REPLACE_MIN_CONFIDENCE;
check("missing mode is off", jevMode(), "off");
check("missing confidence threshold defaults conservatively", jevReplaceMinConfidence(), 0.8);

process.env.LUCA_JEV_NORMALIZER_MODE = "shadow";
check("shadow mode is recognized", jevMode(), "shadow");
check(
  "shadow mode never changes routing",
  shouldSkipNormalizer({ mode: "shadow", route: "read_only", confidence: 0.99, minimum: 0.8 }),
  false,
);

process.env.LUCA_JEV_NORMALIZER_MODE = "replace";
check(
  "high-confidence read routes around the cheap normalizer",
  shouldSkipNormalizer({ mode: "replace", route: "read_only", confidence: 0.9, minimum: 0.8 }),
  true,
);
check(
  "high-confidence reasoning routes around the cheap normalizer",
  shouldSkipNormalizer({ mode: "replace", route: "full_reasoning", confidence: 0.8, minimum: 0.8 }),
  true,
);
check(
  "transaction plans still use the normalizer",
  shouldSkipNormalizer({ mode: "replace", route: "transaction_plan", confidence: 1, minimum: 0.8 }),
  false,
);
check(
  "low confidence falls back to the normalizer",
  shouldSkipNormalizer({ mode: "replace", route: "read_only", confidence: 0.79, minimum: 0.8 }),
  false,
);
check(
  "missing confidence falls back to the normalizer",
  shouldSkipNormalizer({ mode: "replace", route: "full_reasoning", confidence: null, minimum: 0.8 }),
  false,
);

if (originalMode === undefined) delete process.env.LUCA_JEV_NORMALIZER_MODE;
else process.env.LUCA_JEV_NORMALIZER_MODE = originalMode;
if (originalMinimum === undefined) delete process.env.LUCA_JEV_REPLACE_MIN_CONFIDENCE;
else process.env.LUCA_JEV_REPLACE_MIN_CONFIDENCE = originalMinimum;

if (failures) process.exit(1);
