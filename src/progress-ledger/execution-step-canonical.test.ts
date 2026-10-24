import { describe, expect, it } from "vitest";
import { ORCHESTRATION_LIVE_INVOKE } from "../task-orchestration/types.js";
import {
  CANONICAL_EXECUTION_STEP_SCHEMA_VERSION,
  CANONICAL_STEP_STATUS_UNKNOWN_OUTCOME,
  assertCanonicalStepFields,
  compatReadCanonicalFieldsFromPayload,
  mergeCanonicalStepFields,
  nextAttemptCanonicalFields,
  parseCanonicalExecutionStepFields,
  validateCanonicalExecutionStepFields,
} from "./execution-step-canonical.js";

describe("WP-06 execution-step-canonical", () => {
  it("keeps LIVE false and exposes schema version", () => {
    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
    expect(CANONICAL_EXECUTION_STEP_SCHEMA_VERSION).toBe(1);
    expect(CANONICAL_STEP_STATUS_UNKNOWN_OUTCOME).toBe("unknown_outcome");
  });

  it("parses a full canonical field bag", () => {
    const parsed = parseCanonicalExecutionStepFields({
      logicalActionId: "action.send",
      taskId: "task-1",
      stepId: "step-1",
      attemptId: "attempt-1",
      tenantId: "t1",
      operatorId: "op-1",
      executionPath: "legacy",
      idempotencyKey: "abc",
      status: "in_progress",
      outcome: null,
      policyVersion: "p1",
      executorVersion: "e1",
      startedAt: 100,
      completedAt: null,
      retryCount: 0,
      evidenceRefs: ["ev:1"],
      externalReceiptRefs: ["rcpt:1"],
      errorCode: null,
      unknownReason: null,
      ignored: true,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.value.logicalActionId).toBe("action.send");
    expect(parsed.value.attemptId).toBe("attempt-1");
    expect(parsed.value.retryCount).toBe(0);
    expect(parsed.value.evidenceRefs).toEqual(["ev:1"]);
  });

  it("accepts unknown_outcome status and rejects invalid status", () => {
    const ok = parseCanonicalExecutionStepFields({
      status: CANONICAL_STEP_STATUS_UNKNOWN_OUTCOME,
      unknownReason: "provider_timeout_no_receipt",
    });
    expect(ok.ok).toBe(true);
    expect(parseCanonicalExecutionStepFields({ status: "weird" }).ok).toBe(false);
    expect(validateCanonicalExecutionStepFields({})).toBe(true);
  });

  it("assert + merge prefer Step fields", () => {
    assertCanonicalStepFields({ logicalActionId: "a", idempotencyKey: "k" });
    expect(() => assertCanonicalStepFields({ logicalActionId: "  " })).toThrow(
      /canonical_execution_step_fields_invalid/,
    );
    const merged = mergeCanonicalStepFields(
      { id: "step-1", title: "t" },
      { logicalActionId: "action.x", attemptId: "att-1", idempotencyKey: "k1" },
    );
    expect(merged.id).toBe("step-1");
    expect(merged.logicalActionId).toBe("action.x");
    expect(merged.attemptId).toBe("att-1");
  });

  it("compat-read: Step wins over payload; payload fills gaps", () => {
    const merged = compatReadCanonicalFieldsFromPayload(
      { logicalActionId: "from-step", status: "completed" },
      {
        logicalActionId: "from-payload",
        attemptId: "att-payload",
        idempotencyKey: "key-p",
        status: "failed",
      },
    );
    expect(merged.logicalActionId).toBe("from-step");
    expect(merged.status).toBe("completed");
    expect(merged.attemptId).toBe("att-payload");
    expect(merged.idempotencyKey).toBe("key-p");
  });

  it("next attempt keeps logicalActionId+idempotencyKey and forbids retry under unknown_outcome", () => {
    const next = nextAttemptCanonicalFields(
      {
        logicalActionId: "action.send",
        idempotencyKey: "key-1",
        attemptId: "att-1",
        retryCount: 0,
        status: "failed",
        errorCode: "transient",
      },
      "att-2",
    );
    expect(next.logicalActionId).toBe("action.send");
    expect(next.idempotencyKey).toBe("key-1");
    expect(next.attemptId).toBe("att-2");
    expect(next.retryCount).toBe(1);
    expect(next.status).toBe("pending");

    expect(() =>
      nextAttemptCanonicalFields(
        {
          logicalActionId: "action.send",
          idempotencyKey: "key-1",
          status: CANONICAL_STEP_STATUS_UNKNOWN_OUTCOME,
          unknownReason: "unclear",
        },
        "att-x",
      ),
    ).toThrow(/unknown_outcome/);
  });
});
