/**
 * P5-a producer-model compatibility matrix (L16).
 * Separate artifact from the schema ladder. Never authorizes placement, promotion, or purge.
 */
import type { ProducerModelMatrixEntry } from "./types.js";

export type ProducerClaimLookup =
  | { ok: true; claimSupport: ProducerModelMatrixEntry["claimSupport"] }
  | { ok: false; error: "producer_claim_unknown" };

export function lookupProducerClaimSupport(params: {
  matrix: readonly ProducerModelMatrixEntry[];
  producerModelId: string;
  schemaVersion: string;
}): ProducerClaimLookup {
  const hit = params.matrix.find(
    (row) =>
      row.producerModelId === params.producerModelId && row.schemaVersion === params.schemaVersion,
  );
  if (!hit) {
    return { ok: false, error: "producer_claim_unknown" };
  }
  return { ok: true, claimSupport: hit.claimSupport };
}

export function assertProducerMatrixShape(
  value: unknown,
): value is readonly ProducerModelMatrixEntry[] {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return false;
    }
    const raw = row as Record<string, unknown>;
    return (
      typeof raw.producerModelId === "string" &&
      raw.producerModelId.trim() !== "" &&
      typeof raw.schemaVersion === "string" &&
      raw.schemaVersion.trim() !== "" &&
      (raw.claimSupport === "supported" ||
        raw.claimSupport === "unsupported" ||
        raw.claimSupport === "flagged") &&
      !("fromSchemaVersion" in raw) &&
      !("transformId" in raw) &&
      !("transformMember" in raw)
    );
  });
}

export function parseProducerModelMatrix(value: unknown): ProducerModelMatrixEntry[] | null {
  if (!assertProducerMatrixShape(value) || value.length === 0) {
    return null;
  }
  return value.map((row) => ({
    producerModelId: row.producerModelId,
    schemaVersion: row.schemaVersion,
    claimSupport: row.claimSupport,
  }));
}
