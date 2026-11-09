import assert from "node:assert/strict";
import { researchSources, validateResearchUrl } from "./researchSources";

assert.equal(validateResearchUrl("http://example.com"), null);
assert.equal(validateResearchUrl("https://localhost/docs"), null);
assert.equal(validateResearchUrl("https://127.0.0.1/docs"), null);
assert.equal(validateResearchUrl("https://docs.example.com/guide"), "https://docs.example.com/guide");

(async () => {
  const result = await researchSources(["not-a-url", "http://localhost"]);
  assert.equal(result.sources.length, 0);
  assert.equal(result.failed.length, 1);
  console.log("Research source checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
