import { describe, expect, it } from "vitest";
import type { EvidenceReadView } from "../executor-evidence/read-port.js";
import type { CommandReceipt, TrustedScope } from "../task-outcome/types.js";
import { projectDurableExecutorExecutions } from "./durable-execution-projection.js";

const scope: TrustedScope = {
  kind: "enterprise",
  tenantId: "tenant",
  enterpriseDomainId: "domain",
  subjectRef: "subject:alice",
  authzScopeRef: "auth",
};
const time = Date.parse("2026-11-06T00:00:00Z");
const view = (overrides: Partial<EvidenceReadView> = {}): EvidenceReadView =>
  ({
    schemaVersion: 1,
    source: "task-outcome-store+executor-evidence",
    projectedAt: time + 1,
    readOnly: true,
    durableAcrossRestart: true,
    completeHistory: false,
    retention: { policy: "bounded_file_log", maxCallFiles: 8 },
    capacity: { callFiles: 1, associationFiles: 1, watermark: 1 },
    receipts: [
      {
        schemaVersion: 1,
        commandId: "cmd",
        taskId: "task",
        outcomeVersion: 1,
        requestDigest: "digest",
        disposition: "applied",
        commitId: "commit",
      } satisfies CommandReceipt,
    ],
    calls: [
      {
        schemaVersion: 1,
        evidenceId: "ev",
        agentId: "bot",
        scope,
        taskId: "task",
        runId: "run",
        attemptId: "attempt",
        attemptKind: "turn",
        callId: "call",
        parentCallId: null,
        providerRequestId: null,
        providerResponseId: null,
        provider: "test",
        model: "m",
        startedAt: time,
        completedAt: time + 10,
        observedAt: time + 10,
        status: "completed",
        terminalCause: "none",
        usageSource: "test",
        usageAggregation: "per_call",
        usage: { input: 1, output: 1, cacheRead: null, cacheWrite: null },
        provenance: "live",
        collector: "runtime_execution",
        localIdentity: {
          proves: "executor_attempt_allocated_before_return",
          doesNotProve: "provider_request_identity_when_ids_null",
        },
        persisted: true,
        durableAcrossRestart: true,
        modelResponseStatus: "observed",
        timeOrderValid: true,
      },
    ],
    associations: [
      {
        schemaVersion: 1,
        callEvidenceId: "ev",
        callId: "call",
        budgetCommandId: "cmd",
        requestDigest: "digest",
        disposition: "applied",
        commitId: "commit",
        chargeOutcomeVersion: 1,
        closeOutcomeVersion: 1,
        finalOutcomeVersion: 1,
        runId: "run",
        attemptId: "attempt",
        capabilityCallId: "call",
        deliveryId: null,
        deliveryTruth: "recorded",
        finalMetadataFingerprint: "fp",
        finalMetadataFingerprintSchemaVersion: 1,
        usageFingerprint: "u",
        completeness: "complete",
        missing: [],
        coverage: "test",
        correctionInherited: false,
        taskJudgement: "success",
        chain: {
          taskId: "task",
          outcomeVersion: 1,
          runId: "run",
          attemptId: "attempt",
          capabilityCallId: "call",
          deliveryId: null,
          source: "receipt",
        },
        callEstimate: null,
        committedAttribution: { status: "known", amount: 1, usageFingerprint: "u" },
        candidateAttemptId: "attempt",
        taskAttemptId: "attempt",
        trustedScope: scope,
        finalSnapshotFingerprint: "fp",
        cost: {
          estimatedUsd: { amount: 1, status: "known" },
          committedUsd: { amount: 1, status: "known" },
          usageFingerprint: "u",
        },
        scopeId: "scope",
        agentId: "bot",
      },
    ],
    gaps: [],
    completeness: "partial",
    callChainCompleteness: "complete",
    costAttributionCompleteness: "complete",
    reasons: [],
    ...overrides,
  }) as EvidenceReadView;

describe("durable executor execution projection", () => {
  it("projects associated model-call evidence inside the window", () => {
    const rows = projectDurableExecutorExecutions({
      view: view(),
      taskId: "task",
      outcomeVersion: 1,
      from: time,
      to: time + 20,
    });
    expect(rows.map((row) => row.attemptId)).toEqual(["attempt", "attempt"]);
    expect(rows.every((row) => row.outcomeVersion === 1 && row.taskId === "task")).toBe(true);
  });

  it("does not invent events for a different outcome version or empty window", () => {
    expect(
      projectDurableExecutorExecutions({
        view: view(),
        taskId: "task",
        outcomeVersion: 2,
        from: time,
        to: time + 20,
      }),
    ).toEqual([]);
    expect(
      projectDurableExecutorExecutions({
        view: view(),
        taskId: "task",
        outcomeVersion: 1,
        from: time + 50,
        to: time + 60,
      }),
    ).toEqual([]);
  });

  it("returns nothing on an identity mismatch view", () => {
    expect(
      projectDurableExecutorExecutions({
        view: view({ completeness: "mismatch" }),
        taskId: "task",
        outcomeVersion: 1,
        from: time,
        to: time + 20,
      }),
    ).toEqual([]);
  });
});
