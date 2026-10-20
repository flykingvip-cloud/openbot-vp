import type { EvolutionVerificationRef } from "./evaluation-refs.js";
/**
 * Diagnosis recheck contract owned by Track B.
 *
 * Request/Result store references, target, and an outcome enum only.
 * Track A implements DiagnosisRecheckPort. evolution-core must not import src/diagnosis.
 */
import { evolutionTargetKey, type EvolutionTarget } from "./types.js";

export const DIAGNOSIS_RECHECK_OUTCOMES = [
  "RESOLVED",
  "STILL_OPEN",
  "REGRESSED",
  "INCONCLUSIVE",
  "BLOCKED",
] as const;
export type DiagnosisRecheckOutcome = (typeof DIAGNOSIS_RECHECK_OUTCOMES)[number];

export type DiagnosisRecheckRequest = {
  verificationRef: EvolutionVerificationRef;
  target: EvolutionTarget;
  findingRefs: readonly string[];
  surfaceId: string;
  tenantScope: string | null;
};

export type DiagnosisRecheckResult = {
  outcome: DiagnosisRecheckOutcome;
  findingRefs: readonly string[];
  target: EvolutionTarget;
  verificationRef: EvolutionVerificationRef;
  observedEvidenceRefs: readonly string[];
  reasonCode: string;
};

export type DiagnosisRecheckPort = {
  recheck(request: DiagnosisRecheckRequest): Promise<DiagnosisRecheckResult>;
};

export function isDiagnosisRecheckOutcome(value: string): value is DiagnosisRecheckOutcome {
  return (DIAGNOSIS_RECHECK_OUTCOMES as readonly string[]).includes(value);
}

function assertNonEmptyRefs(refs: readonly string[], field: string): void {
  if (!Array.isArray(refs) || refs.length === 0) {
    throw new Error(`${field} must be a non-empty reference list`);
  }
  for (const ref of refs) {
    if (typeof ref !== "string" || !ref.trim()) {
      throw new Error(`${field} must contain non-empty strings`);
    }
  }
}

function verificationKey(ref: EvolutionVerificationRef): string {
  return [ref.proposalId, ref.experimentId, ref.applicationId, ref.verificationId].join("|");
}

export function canonicalizeFindingRefs(refs: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const ref of refs) {
    if (typeof ref !== "string" || !ref.trim()) {
      throw new Error("finding refs must contain non-empty strings");
    }
    unique.add(ref.trim());
  }
  if (unique.size === 0) {
    throw new Error("finding refs must be a non-empty reference list");
  }
  return [...unique].sort();
}

function sameFindingRefs(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = canonicalizeFindingRefs(left);
  const rightSet = canonicalizeFindingRefs(right);
  if (leftSet.length !== rightSet.length) {
    return false;
  }
  return leftSet.every((ref, index) => ref === rightSet[index]);
}

export function assertDiagnosisRecheckRequest(
  value: DiagnosisRecheckRequest,
): DiagnosisRecheckRequest {
  if (!value.surfaceId.trim()) {
    throw new Error("DiagnosisRecheckRequest.surfaceId is required");
  }
  if (!value.target) {
    throw new Error("DiagnosisRecheckRequest.target is required");
  }
  assertNonEmptyRefs(value.findingRefs, "DiagnosisRecheckRequest.findingRefs");
  if ("reportProse" in value || "evidencePayload" in value) {
    throw new Error("DiagnosisRecheckRequest must not copy report prose or evidence payload");
  }
  return value;
}

export function assertDiagnosisRecheckResult(
  value: DiagnosisRecheckResult,
): DiagnosisRecheckResult {
  if (!isDiagnosisRecheckOutcome(value.outcome)) {
    throw new Error("DiagnosisRecheckResult.outcome is unknown");
  }
  if (!value.reasonCode.trim()) {
    throw new Error("DiagnosisRecheckResult.reasonCode is required");
  }
  if (!value.target) {
    throw new Error("DiagnosisRecheckResult.target is required");
  }
  assertNonEmptyRefs(value.findingRefs, "DiagnosisRecheckResult.findingRefs");
  assertNonEmptyRefs(value.observedEvidenceRefs, "DiagnosisRecheckResult.observedEvidenceRefs");
  if ("reportProse" in value || "evidencePayload" in value) {
    throw new Error("DiagnosisRecheckResult must not copy report prose or evidence payload");
  }
  return value;
}

export function assertDiagnosisRecheckBinding(
  request: DiagnosisRecheckRequest,
  result: DiagnosisRecheckResult,
):
  | { ok: true }
  | { ok: false; code: "verification_mismatch" | "target_mismatch" | "finding_mismatch" } {
  assertDiagnosisRecheckRequest(request);
  assertDiagnosisRecheckResult(result);
  if (verificationKey(request.verificationRef) !== verificationKey(result.verificationRef)) {
    return { ok: false, code: "verification_mismatch" };
  }
  if (evolutionTargetKey(request.target) !== evolutionTargetKey(result.target)) {
    return { ok: false, code: "target_mismatch" };
  }
  if (!sameFindingRefs(request.findingRefs, result.findingRefs)) {
    return { ok: false, code: "finding_mismatch" };
  }
  return { ok: true };
}
