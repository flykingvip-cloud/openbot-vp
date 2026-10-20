import { createHash } from "node:crypto";

export type GovernedCandidate = {
  candidateRef: string;
  version: string;
  payloadHash: string;
  payload: unknown;
};

export type CandidateStore = {
  get(candidateRef: string): GovernedCandidate | undefined;
  put(row: GovernedCandidate): void;
};

export function hashCandidatePayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function createMemoryCandidateStore(): CandidateStore {
  const rows = new Map<string, GovernedCandidate>();
  return {
    get: (candidateRef) => rows.get(candidateRef),
    put: (row) => {
      rows.set(row.candidateRef, row);
    },
  };
}

export function sealGovernedCandidate(
  candidateRef: string,
  payload: unknown,
  governedVersion?: string,
): GovernedCandidate {
  const override = governedVersion?.trim() || "";
  if (override && override !== candidateRef) {
    throw new Error("governed version must equal candidateRef");
  }
  const fromPayload =
    payload &&
    typeof payload === "object" &&
    "candidateVersion" in payload &&
    typeof payload.candidateVersion === "string" &&
    payload.candidateVersion.trim()
      ? payload.candidateVersion.trim()
      : candidateRef;
  const version = override || fromPayload;
  return {
    candidateRef,
    version,
    payloadHash: hashCandidatePayload(payload),
    payload,
  };
}

/** Diagnosis candidateVersion is a content hash. The governed version is candidateRef. */
export function sealDiagnosisGovernedCandidate(
  candidateRef: string,
  payload: unknown,
): GovernedCandidate {
  return sealGovernedCandidate(candidateRef, payload, candidateRef);
}
