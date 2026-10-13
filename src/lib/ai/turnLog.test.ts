import type { AgentTurnRecord } from "./turnLog.ts";

/* Compile-time contract test for the telemetry shape. The runtime logger is
   intentionally a no-op without Supabase, so this verifies the fields that the
   route is allowed to send without touching production data. */
const record: AgentTurnRecord = {
  status: "ok",
  jevRoute: "read_only",
  jevConfidence: 0.94,
  jevNormalizerSkipped: true,
};

if (record.jevRoute !== "read_only" || !record.jevNormalizerSkipped) {
  throw new Error("Jev telemetry contract is not preserved");
}

console.log("ok   Jev telemetry fields are typed and bounded");
