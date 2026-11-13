import { buildAnalysisResult } from "./analysisResult";
const result = buildAnalysisResult({
  sources: [{ url: "https://example.com", title: "Example", text: "live data", observedAt: "2026-11-13T00:00:00.000Z" }],
  failed: [],
});
if (result.freshness !== "live" || result.observations[0]?.excerpt !== "live data") throw new Error("analysis result failed");
console.log("Analysis result checks passed.");
