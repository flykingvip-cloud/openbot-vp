/**
 * Content fingerprint for an evolution prescription.
 * Lifecycle fields (state, expiry, applied job, confirm receipt) are excluded
 * so a confirm binds the prescription the caller approved.
 */
import { createHash } from "node:crypto";

export type EvolutionPrescriptionContent = {
  prescriptionId: string;
  professionalReportId: string;
  tenantId: string;
  targetAgentAssetId: string;
  targetAgentId: string;
  targetOwnerId: string;
  purpose: string;
  purposeLabel: string;
  kind: string;
  normalizedSchedule: string;
  scheduleExpr: string;
  cadenceLabel: string;
  expectedEffect: string;
  wakeText: string;
  payloadVersion: number;
  schemaVersion: number;
  authorizationRef: string | null;
  prescriptionContentHash?: string | null;
};

export type PrescriptionHashBindResult =
  | { ok: true; fingerprint: string }
  | { ok: false; reason: "prescription_hash_mismatch" | "prescription_hash_required" };

export function evolutionPrescriptionContentHash(record: EvolutionPrescriptionContent): string {
  const canonical = {
    authorizationRef: record.authorizationRef ?? null,
    cadenceLabel: record.cadenceLabel,
    expectedEffect: record.expectedEffect,
    kind: record.kind,
    normalizedSchedule: record.normalizedSchedule,
    payloadVersion: record.payloadVersion,
    prescriptionId: record.prescriptionId,
    professionalReportId: record.professionalReportId,
    purpose: record.purpose,
    purposeLabel: record.purposeLabel,
    scheduleExpr: record.scheduleExpr,
    schemaVersion: record.schemaVersion,
    targetAgentAssetId: record.targetAgentAssetId,
    targetAgentId: record.targetAgentId,
    targetOwnerId: record.targetOwnerId,
    tenantId: record.tenantId,
    wakeText: record.wakeText,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** Stored fingerprint and the submitted fingerprint must both match a fresh hash. */
export function matchPrescriptionContentHash(
  record: EvolutionPrescriptionContent,
  submitted: string | undefined,
): PrescriptionHashBindResult {
  const fingerprint = evolutionPrescriptionContentHash(record);
  const stored = record.prescriptionContentHash?.trim() ?? "";
  if (!stored || stored !== fingerprint) {
    return {
      ok: false,
      reason: stored ? "prescription_hash_mismatch" : "prescription_hash_required",
    };
  }
  const given = submitted?.trim() ?? "";
  if (!given) {
    return { ok: false, reason: "prescription_hash_required" };
  }
  if (given !== fingerprint) {
    return { ok: false, reason: "prescription_hash_mismatch" };
  }
  return { ok: true, fingerprint };
}
