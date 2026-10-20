/**
 * Track B owned evaluation references.
 *
 * These are immutable identity objects. They must not carry recovery or
 * mutable status fields — WAL state stays in diagnosis-ingest-wal.
 */

export const EVOLUTION_SUBMISSION_REF_SCHEMA_VERSION = 1 as const;
export const EVOLUTION_VERIFICATION_REF_SCHEMA_VERSION = 1 as const;

export type EvolutionSubmissionRef = {
  schemaVersion: 1;
  commandId: string;
  proposalId: string;
  candidateRef: string;
  surfaceId: string;
  contentHash: string;
};

export type EvolutionVerificationRef = {
  schemaVersion: 1;
  proposalId: string;
  experimentId: string;
  applicationId: string;
  verificationId: string;
  rollbackRef?: string;
  externalEffectRef?: string;
};

export function assertEvolutionSubmissionRef(
  value: EvolutionSubmissionRef,
): EvolutionSubmissionRef {
  if (value.schemaVersion !== 1) {
    throw new Error("EvolutionSubmissionRef schemaVersion must be 1");
  }
  for (const key of [
    "commandId",
    "proposalId",
    "candidateRef",
    "surfaceId",
    "contentHash",
  ] as const) {
    if (typeof value[key] !== "string" || !value[key].trim()) {
      throw new Error(`EvolutionSubmissionRef.${key} is required`);
    }
  }
  if ("recoveryState" in value || "status" in value) {
    throw new Error("EvolutionSubmissionRef must not carry recoveryState or status");
  }
  return value;
}

export function assertEvolutionVerificationRef(
  value: EvolutionVerificationRef,
): EvolutionVerificationRef {
  if (value.schemaVersion !== 1) {
    throw new Error("EvolutionVerificationRef schemaVersion must be 1");
  }
  for (const key of ["proposalId", "experimentId", "applicationId", "verificationId"] as const) {
    if (typeof value[key] !== "string" || !value[key].trim()) {
      throw new Error(`EvolutionVerificationRef.${key} is required`);
    }
  }
  return value;
}
