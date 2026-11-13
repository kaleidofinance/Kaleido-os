import type { ResearchSourceResult } from "./researchSources";

export interface AnalysisObservation {
  source: string;
  title: string;
  observedAt: string;
  excerpt: string;
}

export interface AnalysisResult {
  observations: AnalysisObservation[];
  failed: ResearchSourceResult["failed"];
  freshness: "live" | "partial" | "unavailable";
}

/** Keep external analysis explicitly time-stamped and separate from execution. */
export function buildAnalysisResult(result: ResearchSourceResult): AnalysisResult {
  const observations = result.sources.map((source) => ({
    source: source.url,
    title: source.title,
    observedAt: source.observedAt,
    excerpt: source.text.slice(0, 480),
  }));
  return {
    observations,
    failed: result.failed,
    freshness:
      observations.length === 0 ? "unavailable" : result.failed.length ? "partial" : "live",
  };
}
