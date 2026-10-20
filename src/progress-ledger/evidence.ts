import { LedgerInvariantError, LedgerWriteError } from "./errors.js";
import type { EvidenceType, ForbiddenEvidenceType, ProgressEvidence } from "./types.js";

export const ALLOWED_EVIDENCE_TYPES = [
  "tool_result",
  "data_snapshot",
  "artifact",
  "external_receipt",
  "validation_result",
  "human_confirmation",
  "system_observation",
] as const satisfies readonly EvidenceType[];

export const FORBIDDEN_EVIDENCE_TYPES = [
  "assistant_text",
  "model_claim",
  "planner_claim",
  "llm_self_report",
  "run_summary_guess",
] as const satisfies readonly ForbiddenEvidenceType[];

const ALLOWED = new Set<string>(ALLOWED_EVIDENCE_TYPES);
const FORBIDDEN = new Set<string>(FORBIDDEN_EVIDENCE_TYPES);

export function isAllowedEvidenceType(type: string): type is EvidenceType {
  return ALLOWED.has(type);
}

export function isForbiddenEvidenceType(type: string): type is ForbiddenEvidenceType {
  return FORBIDDEN.has(type);
}

export function hasAllowedEvidence(evidence: readonly ProgressEvidence[]): boolean {
  return evidence.some((item) => isAllowedEvidenceType(item.type));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reject LLM self-report and unknown types. Never returns a forbidden evidence row. */
export function recordEvidence(input: unknown): ProgressEvidence {
  if (!isRecord(input)) {
    throw new LedgerWriteError("evidence must be an object");
  }
  const type = typeof input.type === "string" ? input.type : "";
  if (isForbiddenEvidenceType(type)) {
    throw new LedgerInvariantError("I3", `forbidden evidence type: ${type}`);
  }
  if (!isAllowedEvidenceType(type)) {
    throw new LedgerWriteError(`unknown evidence type: ${type || "(missing)"}`);
  }
  if (typeof input.atMs !== "number" || !Number.isFinite(input.atMs)) {
    throw new LedgerWriteError("evidence.atMs must be a finite number");
  }
  return {
    type,
    atMs: input.atMs,
    ...(typeof input.source === "string" ? { source: input.source } : {}),
    ...(typeof input.recordCount === "number" ? { recordCount: input.recordCount } : {}),
    ...(typeof input.ruleVersion === "string" ? { ruleVersion: input.ruleVersion } : {}),
    ...(input.verification === "passed" ||
    input.verification === "failed" ||
    input.verification === "skipped"
      ? { verification: input.verification }
      : {}),
    ...(typeof input.artifactRef === "string" ? { artifactRef: input.artifactRef } : {}),
    ...(typeof input.receiptId === "string" ? { receiptId: input.receiptId } : {}),
    ...(typeof input.recipient === "string" ? { recipient: input.recipient } : {}),
    ...(typeof input.note === "string" ? { note: input.note } : {}),
  };
}

export function collectEvidence(input: unknown): ProgressEvidence[] {
  if (input == null) {
    return [];
  }
  const rows = Array.isArray(input) ? input : [input];
  return rows.map((row) => recordEvidence(row));
}

/** Contract §3.3: the event payload itself must carry allowed evidence. */
export function requirePayloadEvidence(
  eventType: string,
  payloadEvidence: unknown,
): ProgressEvidence[] {
  const rows = collectEvidence(payloadEvidence);
  if (rows.length === 0 || !hasAllowedEvidence(rows)) {
    throw new LedgerInvariantError(
      "I3",
      `${eventType} payload must include at least one allowed evidence`,
    );
  }
  return rows;
}
