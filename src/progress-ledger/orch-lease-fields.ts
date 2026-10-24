/**
 * WP-06 ledger field increment — provisional orch lease/fence payload shapes.
 *
 * Additive types + validators only. Does NOT mutate ExecutionStep / ExecutionEvent
 * fold contracts, does NOT write Progress Ledger from readonly invoke, and does
 * NOT flip ORCHESTRATION_LIVE_INVOKE. Production authority remains pending human
 * acceptance of a later schema migration (see wp06/ledger-field-increment.md).
 *
 * Canonical first-class action/attempt/idempotency fields live in
 * execution-step-canonical.ts (ExecutionStep authority; payload extensions only).
 * This module remains the lease/fence provisional bag.
 *
 * Field names mirror field-mapping-adr.md and OrchLeaseRecord (lease-store.ts).
 */
export const ORCH_LEASE_FIELDS_SCHEMA_VERSION = 1 as const;

/** Provisional orch lease/fence fields intended for future ledger step/event payloads. */
export type OrchLeaseLedgerFields = {
  leaseHolder?: string | null;
  /** Monotonic fencing token; stale submit must be rejected by future writers. */
  fencingToken?: number;
  heartbeatAtMs?: number | null;
  deadlineAtMs?: number | null;
  cancelRequested?: boolean;
  attempt?: number;
  budgetRemaining?: number;
  /** Points at WP-01 envelope / deliverable / external receipt — not a second completion ledger. */
  resultRef?: string | null;
  /** Logical action id used to derive action idempotency keys (WP-07). */
  logicalActionId?: string;
};

export type OrchLeaseFieldsParseOk = {
  ok: true;
  value: OrchLeaseLedgerFields;
};

export type OrchLeaseFieldsParseFail = {
  ok: false;
  reason: string;
  field?: string;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function optionalNonEmptyString(
  value: unknown,
  field: string,
): { ok: true; value: string } | OrchLeaseFieldsParseFail {
  if (typeof value !== "string") {
    return { ok: false, reason: "expected_string", field };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty_string", field };
  }
  return { ok: true, value: trimmed };
}

/**
 * Parse/validate a partial orch-lease field bag. Unknown keys are ignored.
 * Null is allowed for nullable fields (holder / heartbeat / deadline / resultRef).
 */
export function parseOrchLeaseLedgerFields(
  input: unknown,
): OrchLeaseFieldsParseOk | OrchLeaseFieldsParseFail {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, reason: "expected_object" };
  }
  const raw = input as Record<string, unknown>;
  const value: OrchLeaseLedgerFields = {};

  if ("leaseHolder" in raw) {
    if (raw.leaseHolder === null) {
      value.leaseHolder = null;
    } else {
      const parsed = optionalNonEmptyString(raw.leaseHolder, "leaseHolder");
      if (!parsed.ok) {
        return parsed;
      }
      value.leaseHolder = parsed.value;
    }
  }

  if ("fencingToken" in raw) {
    if (
      !isFiniteNumber(raw.fencingToken) ||
      !Number.isInteger(raw.fencingToken) ||
      raw.fencingToken < 0
    ) {
      return { ok: false, reason: "fencing_token_non_negative_int", field: "fencingToken" };
    }
    value.fencingToken = raw.fencingToken;
  }

  if ("heartbeatAtMs" in raw) {
    if (raw.heartbeatAtMs === null) {
      value.heartbeatAtMs = null;
    } else if (!isFiniteNumber(raw.heartbeatAtMs) || raw.heartbeatAtMs < 0) {
      return { ok: false, reason: "heartbeat_non_negative_ms", field: "heartbeatAtMs" };
    } else {
      value.heartbeatAtMs = raw.heartbeatAtMs;
    }
  }

  if ("deadlineAtMs" in raw) {
    if (raw.deadlineAtMs === null) {
      value.deadlineAtMs = null;
    } else if (!isFiniteNumber(raw.deadlineAtMs) || raw.deadlineAtMs < 0) {
      return { ok: false, reason: "deadline_non_negative_ms", field: "deadlineAtMs" };
    } else {
      value.deadlineAtMs = raw.deadlineAtMs;
    }
  }

  if ("cancelRequested" in raw) {
    if (typeof raw.cancelRequested !== "boolean") {
      return { ok: false, reason: "expected_boolean", field: "cancelRequested" };
    }
    value.cancelRequested = raw.cancelRequested;
  }

  if ("attempt" in raw) {
    if (!isFiniteNumber(raw.attempt) || !Number.isInteger(raw.attempt) || raw.attempt < 0) {
      return { ok: false, reason: "attempt_non_negative_int", field: "attempt" };
    }
    value.attempt = raw.attempt;
  }

  if ("budgetRemaining" in raw) {
    if (!isFiniteNumber(raw.budgetRemaining)) {
      return { ok: false, reason: "budget_finite_number", field: "budgetRemaining" };
    }
    value.budgetRemaining = raw.budgetRemaining;
  }

  if ("resultRef" in raw) {
    if (raw.resultRef === null) {
      value.resultRef = null;
    } else {
      const parsed = optionalNonEmptyString(raw.resultRef, "resultRef");
      if (!parsed.ok) {
        return parsed;
      }
      value.resultRef = parsed.value;
    }
  }

  if ("logicalActionId" in raw) {
    const parsed = optionalNonEmptyString(raw.logicalActionId, "logicalActionId");
    if (!parsed.ok) {
      return parsed;
    }
    value.logicalActionId = parsed.value;
  }

  if (
    value.heartbeatAtMs != null &&
    value.deadlineAtMs != null &&
    value.heartbeatAtMs > value.deadlineAtMs
  ) {
    return { ok: false, reason: "heartbeat_after_deadline", field: "heartbeatAtMs" };
  }

  return { ok: true, value };
}

/** True when every present field validates (empty object is valid). */
export function validateOrchLeaseLedgerFields(input: unknown): boolean {
  return parseOrchLeaseLedgerFields(input).ok;
}

/**
 * Map OrchLeaseRecord-shaped objects (lease-store) onto provisional ledger fields.
 * heartbeatAt → heartbeatAtMs; deadlineAt → deadlineAtMs. Does not persist.
 */
export function orchLeaseRecordToLedgerFields(record: {
  leaseHolder: string | null;
  fencingToken: number;
  heartbeatAt: number | null;
  deadlineAt: number | null;
  cancelRequested: boolean;
  attempt?: number;
  budgetRemaining?: number;
  resultRef?: string | null;
  logicalActionId?: string;
}): OrchLeaseLedgerFields {
  return {
    leaseHolder: record.leaseHolder,
    fencingToken: record.fencingToken,
    heartbeatAtMs: record.heartbeatAt,
    deadlineAtMs: record.deadlineAt,
    cancelRequested: record.cancelRequested,
    ...(record.attempt !== undefined ? { attempt: record.attempt } : {}),
    ...(record.budgetRemaining !== undefined ? { budgetRemaining: record.budgetRemaining } : {}),
    ...(record.resultRef !== undefined ? { resultRef: record.resultRef } : {}),
    ...(record.logicalActionId !== undefined ? { logicalActionId: record.logicalActionId } : {}),
  };
}
