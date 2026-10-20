/**
 * Phase 4 — DiagnosticSignal contract.
 * Signals only reference existing Target / Evidence / Finding / Case / tenant.
 * No fabricated Evidence or RCA. No UI, HTTP, or repair side effects.
 */
import {
  DIAGNOSIS_COMPLETIONS,
  DIAGNOSIS_SCHEMA_VERSION,
  DiagnosisContractError,
  validateDiagnosticTarget,
  validateEvidenceRequirement,
  type DiagnosisCompletion,
  type DiagnosticCase,
  type DiagnosticEvidence,
  type DiagnosticFinding,
  type DiagnosticTarget,
  type EvidenceRequirement,
  type TrustedTenantContext,
} from "./types.js";

export const DIAGNOSTIC_SIGNAL_KINDS = [
  "scheduled",
  "event",
  "threshold",
  "trend",
  "verification_triggered",
] as const;
export type DiagnosticSignalKind = (typeof DIAGNOSTIC_SIGNAL_KINDS)[number];

export const DIAGNOSTIC_SIGNAL_STATUSES = [
  "open",
  "suppressed",
  "merged",
  "expired",
  "inconclusive",
] as const;
export type DiagnosticSignalStatus = (typeof DIAGNOSTIC_SIGNAL_STATUSES)[number];

export const DIAGNOSTIC_SIGNAL_TTL_MS = 60 * 60 * 1000;
export const DIAGNOSTIC_SIGNAL_SUPPRESS_MS = 15 * 60 * 1000;

export type DiagnosticSignal = {
  schemaVersion: 1;
  signalId: string;
  kind: DiagnosticSignalKind;
  tenantId: string | null;
  fingerprint: string;
  status: DiagnosticSignalStatus;
  target: DiagnosticTarget;
  evidenceIds: string[];
  findingIds: string[];
  caseId?: string;
  completion: DiagnosisCompletion;
  missingEvidence?: EvidenceRequirement[];
  reasonCode: string;
  occurrenceCount: number;
  retryCount: number;
  observedAt: string;
  lastSeenAt: string;
  expiresAt: string;
  suppressedUntil?: string;
  mergedIntoSignalId?: string;
};

export type DiagnosticSignalCatalog = {
  trusted: TrustedTenantContext;
  targets: readonly DiagnosticTarget[];
  evidences: readonly DiagnosticEvidence[];
  findings: readonly DiagnosticFinding[];
  cases: readonly DiagnosticCase[];
};

export function computeSignalFingerprint(input: {
  kind: DiagnosticSignalKind;
  tenantId: string | null;
  target: Pick<DiagnosticTarget, "targetType" | "targetId">;
  reasonCode: string;
}): string {
  return [
    input.kind,
    input.tenantId ?? "local",
    `${input.target.targetType}:${input.target.targetId}`,
    input.reasonCode,
  ].join("|");
}

export function computeSignalId(fingerprint: string, windowId: string): string {
  return `sig:${fingerprint}:${windowId}`;
}

export function isSignalExpired(signal: DiagnosticSignal, nowMs: number): boolean {
  return Date.parse(signal.expiresAt) <= nowMs;
}

export function isSignalSuppressed(signal: DiagnosticSignal, nowMs: number): boolean {
  return Boolean(signal.suppressedUntil && Date.parse(signal.suppressedUntil) > nowMs);
}

export function validateDiagnosticSignal(
  raw: unknown,
  catalog: DiagnosticSignalCatalog,
  path = "",
): DiagnosticSignal {
  const obj = asRecord(raw, path);
  if (obj.schemaVersion !== DIAGNOSIS_SCHEMA_VERSION) {
    throw new DiagnosisContractError(
      "schema_version_invalid",
      "DiagnosticSignal.schemaVersion must be 1",
      join(path, "schemaVersion"),
    );
  }
  const target = validateDiagnosticTarget(obj.target, catalog.trusted, join(path, "target"));
  const tenantId = requireNullableTenant(obj, path);
  if (tenantId !== catalog.trusted.tenantId || tenantId !== target.tenantId) {
    throw new DiagnosisContractError(
      "tenant_mismatch",
      "DiagnosticSignal tenant must match trusted tenant and target",
      join(path, "tenantId"),
    );
  }
  const evidenceIds = requireStringArray(obj, "evidenceIds", path);
  const findingIds = requireStringArray(obj, "findingIds", path);
  assertRefs(evidenceIds, catalog.evidences, tenantId, "evidenceId", join(path, "evidenceIds"));
  assertFindingRefs(findingIds, catalog.findings, tenantId, join(path, "findingIds"));
  const caseId = optionalString(obj, "caseId");
  if (caseId) {
    const matched = catalog.cases.find((item) => item.caseId === caseId);
    if (!matched || matched.tenantId !== tenantId) {
      throw new DiagnosisContractError(
        "case_ref_missing",
        "DiagnosticSignal.caseId must reference an existing same-tenant Case",
        join(path, "caseId"),
      );
    }
  }
  const completion = requireLiteral(obj, "completion", DIAGNOSIS_COMPLETIONS, path);
  const missingEvidence =
    obj.missingEvidence === undefined
      ? undefined
      : asArray(obj.missingEvidence, join(path, "missingEvidence")).map((item, index) =>
          validateEvidenceRequirement(item, join(path, `missingEvidence[${index}]`)),
        );
  if (completion === "CONFIRMED" && evidenceIds.length === 0) {
    throw new DiagnosisContractError(
      "evidence_required",
      "CONFIRMED DiagnosticSignal must reference existing Evidence",
      join(path, "evidenceIds"),
    );
  }
  if (completion === "INCONCLUSIVE" && (missingEvidence?.length ?? 0) === 0) {
    throw new DiagnosisContractError(
      "missing_evidence_required",
      "INCONCLUSIVE DiagnosticSignal must record missingEvidence",
      join(path, "missingEvidence"),
    );
  }
  if ("causes" in obj || "relations" in obj || "payload" in obj) {
    throw new DiagnosisContractError(
      "signal_payload_forbidden",
      "DiagnosticSignal must not carry fabricated RCA, relations, or payload",
      path,
    );
  }
  const signal: DiagnosticSignal = {
    schemaVersion: 1,
    signalId: requireString(obj, "signalId", path),
    kind: requireLiteral(obj, "kind", DIAGNOSTIC_SIGNAL_KINDS, path),
    tenantId,
    fingerprint: requireString(obj, "fingerprint", path),
    status: requireLiteral(obj, "status", DIAGNOSTIC_SIGNAL_STATUSES, path),
    target,
    evidenceIds,
    findingIds,
    completion,
    reasonCode: requireString(obj, "reasonCode", path),
    occurrenceCount: requirePositiveInt(obj, "occurrenceCount", path),
    retryCount: requireNonNegativeInt(obj, "retryCount", path),
    observedAt: requireString(obj, "observedAt", path),
    lastSeenAt: requireString(obj, "lastSeenAt", path),
    expiresAt: requireString(obj, "expiresAt", path),
  };
  if (caseId) {
    signal.caseId = caseId;
  }
  if (missingEvidence) {
    signal.missingEvidence = missingEvidence;
  }
  const suppressedUntil = optionalString(obj, "suppressedUntil");
  if (suppressedUntil) {
    signal.suppressedUntil = suppressedUntil;
  }
  const mergedIntoSignalId = optionalString(obj, "mergedIntoSignalId");
  if (mergedIntoSignalId) {
    signal.mergedIntoSignalId = mergedIntoSignalId;
  }
  return signal;
}

export function mergeSignals(
  existing: DiagnosticSignal,
  incoming: DiagnosticSignal,
): DiagnosticSignal {
  if (existing.tenantId !== incoming.tenantId || existing.fingerprint !== incoming.fingerprint) {
    throw new DiagnosisContractError(
      "signal_merge_forbidden",
      "signals may only merge when tenant and fingerprint match",
      "fingerprint",
    );
  }
  const merged: DiagnosticSignal = {
    ...existing,
    status: existing.status === "expired" ? incoming.status : existing.status,
    evidenceIds: unique(existing.evidenceIds, incoming.evidenceIds),
    findingIds: unique(existing.findingIds, incoming.findingIds),
    lastSeenAt:
      incoming.lastSeenAt > existing.lastSeenAt ? incoming.lastSeenAt : existing.lastSeenAt,
    occurrenceCount: existing.occurrenceCount + incoming.occurrenceCount,
    retryCount: Math.max(existing.retryCount, incoming.retryCount),
    expiresAt: incoming.expiresAt > existing.expiresAt ? incoming.expiresAt : existing.expiresAt,
    completion:
      existing.completion === "CONFIRMED" || incoming.completion === "CONFIRMED"
        ? "CONFIRMED"
        : incoming.completion,
  };
  if (incoming.caseId && !merged.caseId) {
    merged.caseId = incoming.caseId;
  }
  if (incoming.missingEvidence?.length && merged.completion === "INCONCLUSIVE") {
    merged.missingEvidence = incoming.missingEvidence;
  }
  return merged;
}

export function suppressSignal(signal: DiagnosticSignal, untilIso: string): DiagnosticSignal {
  return { ...signal, status: "suppressed", suppressedUntil: untilIso };
}

export function expireSignals(
  signals: readonly DiagnosticSignal[],
  nowMs: number,
): DiagnosticSignal[] {
  return signals.map((signal) =>
    isSignalExpired(signal, nowMs) && signal.status !== "merged"
      ? { ...signal, status: "expired" }
      : signal,
  );
}

function assertRefs(
  ids: readonly string[],
  rows: readonly DiagnosticEvidence[],
  tenantId: string | null,
  key: "evidenceId",
  path: string,
): void {
  for (const id of ids) {
    const row = rows.find((item) => item[key] === id);
    if (!row || row.target.tenantId !== tenantId) {
      throw new DiagnosisContractError(
        "evidence_ref_missing",
        "DiagnosticSignal must reference existing same-tenant Evidence",
        path,
      );
    }
  }
}

function assertFindingRefs(
  ids: readonly string[],
  rows: readonly DiagnosticFinding[],
  tenantId: string | null,
  path: string,
): void {
  for (const id of ids) {
    const row = rows.find((item) => item.findingId === id);
    if (!row || row.target.tenantId !== tenantId) {
      throw new DiagnosisContractError(
        "finding_ref_missing",
        "DiagnosticSignal must reference existing same-tenant Finding",
        path,
      );
    }
  }
}

function asRecord(raw: unknown, path: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new DiagnosisContractError("invalid_type", "expected object", path);
  }
  return raw as Record<string, unknown>;
}

function asArray(raw: unknown, path: string): unknown[] {
  if (!Array.isArray(raw)) {
    throw new DiagnosisContractError("invalid_type", "expected array", path);
  }
  return raw;
}

function requireString(obj: Record<string, unknown>, key: string, path: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new DiagnosisContractError(
      "invalid_type",
      `${key} must be a non-empty string`,
      join(path, key),
    );
  }
  return value;
}

function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  return typeof obj[key] === "string" && obj[key].length > 0 ? obj[key] : undefined;
}

function requireStringArray(obj: Record<string, unknown>, key: string, path: string): string[] {
  const value = obj[key];
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    throw new DiagnosisContractError(
      "invalid_type",
      `${key} must be a string array`,
      join(path, key),
    );
  }
  return value;
}

function requireLiteral<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  path: string,
): T {
  const value = obj[key];
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new DiagnosisContractError("invalid_literal", `${key} is invalid`, join(path, key));
  }
  return value as T;
}

function requireNullableTenant(obj: Record<string, unknown>, path: string): string | null {
  const value = obj.tenantId;
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new DiagnosisContractError(
      "invalid_type",
      "tenantId must be a string or null",
      join(path, "tenantId"),
    );
  }
  return value;
}

function requirePositiveInt(obj: Record<string, unknown>, key: string, path: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new DiagnosisContractError(
      "invalid_type",
      `${key} must be a positive integer`,
      join(path, key),
    );
  }
  return value;
}

function requireNonNegativeInt(obj: Record<string, unknown>, key: string, path: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new DiagnosisContractError(
      "invalid_type",
      `${key} must be a non-negative integer`,
      join(path, key),
    );
  }
  return value;
}

function unique(left: readonly string[], right: readonly string[]): string[] {
  return [...new Set([...left, ...right])];
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}
