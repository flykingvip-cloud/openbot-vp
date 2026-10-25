/**
 * WP-06 — Canonical ExecutionStep field set (additive validators; no fold migration).
 *
 * User binding: first-class ledger fields live on ExecutionStep; payload holds
 * adapter/provider/redacted extensions only. New writes prefer these fields;
 * compat read from payload is allowed when the existing contract cannot yet
 * accept Step fields — never two authorities.
 *
 * Does NOT mutate fold / writer contracts, does NOT flip ORCHESTRATION_LIVE_INVOKE,
 * and does NOT claim G4-A. See wp06/execution-step-canonical-schema.md.
 */

export const CANONICAL_EXECUTION_STEP_SCHEMA_VERSION = 1 as const;

/**
 * Unclear external result MUST use this status — never "failed" then auto-retry.
 * Not yet folded into types.ts StepStatus (avoid breaking migration); helper-level
 * constant for WP-07 / recovery guidance.
 */
export const CANONICAL_STEP_STATUS_UNKNOWN_OUTCOME = "unknown_outcome" as const;

export type CanonicalStepStatusGuidance =
  | "pending"
  | "in_progress"
  | "executed"
  | "verified"
  | "completed"
  | "failed"
  | "blocked"
  | typeof CANONICAL_STEP_STATUS_UNKNOWN_OUTCOME;

/** First-class fields that hang on ExecutionStep (or merge onto it). */
export type CanonicalExecutionStepFields = {
  logicalActionId?: string;
  taskId?: string;
  stepId?: string;
  attemptId?: string;
  tenantId?: string | null;
  operatorId?: string | null;
  executionPath?: string;
  idempotencyKey?: string;
  status?: CanonicalStepStatusGuidance;
  outcome?: string | null;
  policyVersion?: string;
  executorVersion?: string;
  startedAt?: number | null;
  completedAt?: number | null;
  retryCount?: number;
  evidenceRefs?: string[];
  externalReceiptRefs?: string[];
  errorCode?: string | null;
  unknownReason?: string | null;
};

/** Non-authority payload extensions only. */
export type CanonicalPayloadExtensions = {
  adapterRequest?: unknown;
  adapterResponse?: unknown;
  providerMetadata?: Record<string, unknown>;
  redactedDiagnostics?: Record<string, unknown>;
  /** Content hash or version ref for raw payload body (required when raw retained). */
  payloadContentHash?: string;
  payloadVersionRef?: string;
  /** Catch-all non-canonical extensions — never authoritative for identity/status/idempotency. */
  extensions?: Record<string, unknown>;
};

export type CanonicalStepParseOk = {
  ok: true;
  value: CanonicalExecutionStepFields;
};

export type CanonicalStepParseFail = {
  ok: false;
  reason: string;
  field?: string;
};

const STATUS_SET = new Set<string>([
  "pending",
  "in_progress",
  "executed",
  "verified",
  "completed",
  "failed",
  "blocked",
  CANONICAL_STEP_STATUS_UNKNOWN_OUTCOME,
]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function optionalNonEmptyString(
  value: unknown,
  field: string,
): { ok: true; value: string } | CanonicalStepParseFail {
  if (typeof value !== "string") {
    return { ok: false, reason: "expected_string", field };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty_string", field };
  }
  return { ok: true, value: trimmed };
}

function optionalNullableString(
  value: unknown,
  field: string,
): { ok: true; value: string | null } | CanonicalStepParseFail {
  if (value === null) {
    return { ok: true, value: null };
  }
  return optionalNonEmptyString(value, field);
}

function optionalStringArray(
  value: unknown,
  field: string,
): { ok: true; value: string[] } | CanonicalStepParseFail {
  if (!Array.isArray(value)) {
    return { ok: false, reason: "expected_string_array", field };
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      return { ok: false, reason: "expected_non_empty_string_items", field };
    }
    out.push(item.trim());
  }
  return { ok: true, value: out };
}

/**
 * Parse/validate a partial canonical ExecutionStep field bag.
 * Unknown keys are ignored. Empty object is valid.
 */
export function parseCanonicalExecutionStepFields(
  input: unknown,
): CanonicalStepParseOk | CanonicalStepParseFail {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, reason: "expected_object" };
  }
  const raw = input as Record<string, unknown>;
  const value: CanonicalExecutionStepFields = {};

  const stringFields = [
    "logicalActionId",
    "taskId",
    "stepId",
    "attemptId",
    "executionPath",
    "idempotencyKey",
    "policyVersion",
    "executorVersion",
  ] as const;
  for (const field of stringFields) {
    if (field in raw) {
      const parsed = optionalNonEmptyString(raw[field], field);
      if (!parsed.ok) {
        return parsed;
      }
      value[field] = parsed.value;
    }
  }

  for (const field of [
    "tenantId",
    "operatorId",
    "outcome",
    "errorCode",
    "unknownReason",
  ] as const) {
    if (field in raw) {
      const parsed = optionalNullableString(raw[field], field);
      if (!parsed.ok) {
        return parsed;
      }
      value[field] = parsed.value;
    }
  }

  if ("status" in raw) {
    if (typeof raw.status !== "string" || !STATUS_SET.has(raw.status)) {
      return { ok: false, reason: "invalid_status", field: "status" };
    }
    value.status = raw.status as CanonicalStepStatusGuidance;
  }

  for (const field of ["startedAt", "completedAt"] as const) {
    if (field in raw) {
      if (raw[field] === null) {
        value[field] = null;
      } else if (!isFiniteNumber(raw[field]) || raw[field] < 0) {
        return { ok: false, reason: "non_negative_ms", field };
      } else {
        value[field] = raw[field];
      }
    }
  }

  if ("retryCount" in raw) {
    if (
      !isFiniteNumber(raw.retryCount) ||
      !Number.isInteger(raw.retryCount) ||
      raw.retryCount < 0
    ) {
      return { ok: false, reason: "retry_count_non_negative_int", field: "retryCount" };
    }
    value.retryCount = raw.retryCount;
  }

  if ("evidenceRefs" in raw) {
    const parsed = optionalStringArray(raw.evidenceRefs, "evidenceRefs");
    if (!parsed.ok) {
      return parsed;
    }
    value.evidenceRefs = parsed.value;
  }

  if ("externalReceiptRefs" in raw) {
    const parsed = optionalStringArray(raw.externalReceiptRefs, "externalReceiptRefs");
    if (!parsed.ok) {
      return parsed;
    }
    value.externalReceiptRefs = parsed.value;
  }

  if (
    value.status === CANONICAL_STEP_STATUS_UNKNOWN_OUTCOME &&
    (value.unknownReason == null || value.unknownReason === "")
  ) {
    // Guidance only: unknown_outcome should carry unknownReason when available.
    // Still valid — writers may learn reason later via reconciliation.
  }

  return { ok: true, value };
}

export function assertCanonicalStepFields(
  input: unknown,
): asserts input is CanonicalExecutionStepFields {
  const parsed = parseCanonicalExecutionStepFields(input);
  if (!parsed.ok) {
    const detail = parsed.field ? `${parsed.reason}:${parsed.field}` : parsed.reason;
    throw new Error(`canonical_execution_step_fields_invalid:${detail}`);
  }
}

export function validateCanonicalExecutionStepFields(input: unknown): boolean {
  return parseCanonicalExecutionStepFields(input).ok;
}

/**
 * Merge canonical fields onto an existing step-shaped object without touching
 * fold-required keys. Does not persist. Prefer this for new writes.
 */
export function mergeCanonicalStepFields<T extends Record<string, unknown>>(
  step: T,
  canonical: CanonicalExecutionStepFields,
): T & CanonicalExecutionStepFields {
  const parsed = parseCanonicalExecutionStepFields(canonical);
  if (!parsed.ok) {
    const detail = parsed.field ? `${parsed.reason}:${parsed.field}` : parsed.reason;
    throw new Error(`canonical_execution_step_fields_invalid:${detail}`);
  }
  return { ...step, ...parsed.value };
}

/**
 * Compat-read: pull canonical fields from a payload bag when Step lacks them.
 * Payload is never authoritative once Step has the field set.
 *
 * Fail-closed: if Step is present and claims any canonical field that fails
 * validation, throw — never silently discard Step identity/status and fall
 * back to payload (which would re-author the record).
 */
export function compatReadCanonicalFieldsFromPayload(
  step: Partial<CanonicalExecutionStepFields> | null | undefined,
  payload: Record<string, unknown> | null | undefined,
): CanonicalExecutionStepFields {
  let stepValue: CanonicalExecutionStepFields = {};
  if (step != null && typeof step === "object" && !Array.isArray(step)) {
    const fromStep = parseCanonicalExecutionStepFields(step);
    if (!fromStep.ok) {
      const detail = fromStep.field ? `${fromStep.reason}:${fromStep.field}` : fromStep.reason;
      throw new Error(`canonical_execution_step_fields_invalid:${detail}`);
    }
    stepValue = fromStep.value;
  }
  if (!payload || typeof payload !== "object") {
    return stepValue;
  }
  const fromPayload = parseCanonicalExecutionStepFields(payload);
  // Invalid payload is ignored for gap-fill (payload is never authority).
  const payloadValue = fromPayload.ok ? fromPayload.value : {};
  const merged: CanonicalExecutionStepFields = { ...payloadValue };
  // Step keys present (even if value is undefined after parse) already won via
  // stepValue; overwrite payload for every key Step successfully supplied.
  for (const [key, val] of Object.entries(stepValue) as [
    keyof CanonicalExecutionStepFields,
    CanonicalExecutionStepFields[keyof CanonicalExecutionStepFields],
  ][]) {
    if (val !== undefined) {
      (merged as Record<string, unknown>)[key] = val;
    }
  }
  return merged;
}

/**
 * Retry guidance: same logicalActionId + idempotencyKey; new attemptId; bump retryCount.
 * Does not register with action-idempotency — caller must keep param digest stable.
 */
export function nextAttemptCanonicalFields(
  previous: CanonicalExecutionStepFields,
  newAttemptId: string,
): CanonicalExecutionStepFields {
  const attempt = optionalNonEmptyString(newAttemptId, "attemptId");
  if (!attempt.ok) {
    throw new Error(`canonical_execution_step_fields_invalid:${attempt.reason}:attemptId`);
  }
  if (!previous.logicalActionId || !previous.idempotencyKey) {
    throw new Error("canonical_retry_requires_logical_action_and_idempotency_key");
  }
  if (previous.status === CANONICAL_STEP_STATUS_UNKNOWN_OUTCOME) {
    throw new Error("canonical_retry_forbidden_while_unknown_outcome");
  }
  const retryCount = (previous.retryCount ?? 0) + 1;
  return {
    ...previous,
    attemptId: attempt.value,
    retryCount,
    status: "pending",
    outcome: null,
    errorCode: null,
    unknownReason: null,
    completedAt: null,
  };
}
