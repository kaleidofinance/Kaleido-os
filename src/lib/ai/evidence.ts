/**
 * Common result envelope for Luca's live reads.
 *
 * A number is not enough to describe a read: zero can be a real value, while
 * a provider timeout, an unsupported chain, or a partial multi-chain response
 * means the value is unknown. Keeping scope, provenance and coverage beside
 * the data lets the model explain those cases without guessing.
 */
export type EvidenceStatus =
  | "ok"
  | "partial"
  | "unavailable"
  | "unsupported";

export type EvidenceNetworkMode = "mainnet" | "testnet";

export interface EvidenceScope {
  chainIds: number[];
  networkMode: EvidenceNetworkMode;
}

export interface EvidenceCoverage {
  requested: string[];
  succeeded: string[];
  failed: string[];
}

export interface EvidenceResult<T> {
  status: EvidenceStatus;
  data: T | null;
  scope: EvidenceScope;
  source: string;
  observedAt: string | null;
  fetchedAt: string;
  blockNumber?: string;
  coverage: EvidenceCoverage;
  warnings: string[];
  evidenceId: string;
}

export interface EvidenceInput {
  scope: EvidenceScope;
  source: string;
  coverage: EvidenceCoverage;
  observedAt?: string | null;
  blockNumber?: string;
  warnings?: string[];
  evidenceId?: string;
}

function idFor(source: string): string {
  const safeSource = source.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const random =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `evidence-${safeSource}-${random}`;
}

function makeEvidence<T>(
  status: EvidenceStatus,
  data: T | null,
  input: EvidenceInput,
): EvidenceResult<T> {
  const fetchedAt = new Date().toISOString();
  return {
    status,
    data,
    scope: input.scope,
    source: input.source,
    observedAt: input.observedAt === undefined ? fetchedAt : input.observedAt,
    fetchedAt,
    ...(input.blockNumber ? { blockNumber: input.blockNumber } : {}),
    coverage: input.coverage,
    warnings: input.warnings ?? [],
    evidenceId: input.evidenceId ?? idFor(input.source),
  };
}

export function evidenceOk<T>(
  data: T,
  input: EvidenceInput,
): EvidenceResult<T> {
  return makeEvidence("ok", data, input);
}

export function evidencePartial<T>(
  data: T,
  input: EvidenceInput,
): EvidenceResult<T> {
  return makeEvidence("partial", data, input);
}

export function evidenceUnavailable(
  input: EvidenceInput,
): EvidenceResult<null> {
  return makeEvidence<null>("unavailable", null, {
    ...input,
    observedAt: input.observedAt ?? null,
  });
}

export function evidenceUnsupported(
  input: EvidenceInput,
): EvidenceResult<null> {
  return makeEvidence<null>("unsupported", null, {
    ...input,
    observedAt: input.observedAt ?? null,
  });
}
