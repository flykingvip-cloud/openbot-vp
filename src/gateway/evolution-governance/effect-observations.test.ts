import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  aggregateRuntimeEffectObservations,
  isGovernanceEvaluationEvent,
  recordRuntimeProbeEffectObservation,
  recordSkillInvocationEffectObservation,
  selectRuntimeEffectObservationEvents,
} from "./effect-observations.js";
import { openGovernanceEffectWindow } from "./effect-verifications.js";
import type { GovernanceEffectObservationEvent } from "./persistent-store.js";

describe("governance effect observation events", () => {
  let configDir = "";

  afterEach(() => {
    if (configDir) {
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  });

  function isolatedDir(): string {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), "obx-gov-obs-"));
    return configDir;
  }

  function evaluationEvent(
    over: Partial<GovernanceEffectObservationEvent> &
      Pick<GovernanceEffectObservationEvent, "eventId">,
  ): GovernanceEffectObservationEvent {
    return {
      effectVerificationId: "effect:control",
      runtimeAgentId: "bot-a",
      occurredAt: new Date().toISOString(),
      kind: "runtime_probe",
      intervention: true,
      sourceReceiptRef: `receipt:${over.eventId}`,
      evaluationCycleId: `cycle:${over.eventId}`,
      metricsSnapshotRef: `metrics:${over.eventId}`,
      cohortRef: "baseline",
      tenantId: "tenant-a",
      ...over,
    };
  }

  it("rejects ordinary probe writes and does not let skill invocations inflate primary", () => {
    const dir = isolatedDir();
    const now = Date.now();
    const baseline = openGovernanceEffectWindow(
      {
        runtimeAgentId: "bot-a",
        reason: "baseline:control",
        action: "observe",
        commandId: "baseline",
        tenantId: "tenant-a",
        now: now - 10_000,
      },
      dir,
    );
    expect(() =>
      recordRuntimeProbeEffectObservation(
        {
          effectVerificationId: baseline.id,
          eventId: "obs-no-receipt",
          sourceReceiptRef: "",
          occurredAt: now,
          tenantId: "tenant-a",
          evaluation: "hold",
          evaluationCycleId: "cycle:forbidden",
          metricsSnapshotRef: "metrics:forbidden",
          capability: { forged: true },
        },
        dir,
      ),
    ).toThrow(/tick-writer-capability-required/);
    expect(() =>
      recordSkillInvocationEffectObservation(
        {
          effectVerificationId: baseline.id,
          invocation: {
            invocationId: "",
            agentId: "bot-a",
            tenantId: "tenant-a",
            completedAt: now,
            outcome: "success",
            latencyMs: 20,
          },
        },
        dir,
      ),
    ).toThrow(/missing-source-receipt/);
    const hold = evaluationEvent({
      eventId: "obs-base-1",
      effectVerificationId: baseline.id,
      occurredAt: new Date(now - 2_000).toISOString(),
    });
    const skill = recordSkillInvocationEffectObservation(
      {
        effectVerificationId: baseline.id,
        invocation: {
          invocationId: "inv-base-1",
          agentId: "bot-a",
          tenantId: "tenant-a",
          completedAt: now - 1_500,
          outcome: "success",
          latencyMs: 20,
          failureCategory: null,
        },
      },
      dir,
    );
    expect(skill.intervention).toBeUndefined();
    expect(isGovernanceEvaluationEvent(skill)).toBe(false);
    expect(isGovernanceEvaluationEvent(hold)).toBe(true);
    const aggregated = aggregateRuntimeEffectObservations([hold, skill]);
    expect(aggregated?.sampleSize).toBe(1);
    expect(aggregated?.humanInterventionRate).toBe(1);
    expect(aggregated?.skillSuccessSampleSize).toBe(1);
  });

  it("excludes mismatched raw bindings and keeps skill invocations out of treatment primary", () => {
    const dir = isolatedDir();
    const now = Date.now();
    const treatmentWindow = openGovernanceEffectWindow(
      {
        runtimeAgentId: "bot-a",
        reason: "evolution:a",
        action: "pause",
        commandId: "treat-a",
        now,
        binding: {
          proposalId: "evo:a",
          experimentId: "exp-a",
          applicationId: "app:a",
          tenantId: "tenant-a",
          domainReceiptRef: "rollback:a",
        },
      },
      dir,
    );
    expect(() =>
      recordSkillInvocationEffectObservation(
        {
          effectVerificationId: treatmentWindow.id,
          invocation: {
            invocationId: "inv-unbound",
            agentId: "bot-a",
            tenantId: "tenant-a",
            completedAt: now,
            outcome: "success",
            latencyMs: 20,
            failureCategory: null,
          },
        },
        dir,
      ),
    ).toThrow(/unbound-invocation-excluded/);
    expect(() =>
      recordSkillInvocationEffectObservation(
        {
          effectVerificationId: treatmentWindow.id,
          invocation: {
            invocationId: "inv-wrong-exp",
            agentId: "bot-a",
            tenantId: "tenant-a",
            completedAt: now,
            outcome: "success",
            latencyMs: 20,
            failureCategory: null,
            experimentId: "exp-other",
            applicationId: "app:a",
          },
        },
        dir,
      ),
    ).toThrow(/unbound-invocation-excluded/);
    expect(() =>
      recordSkillInvocationEffectObservation(
        {
          effectVerificationId: treatmentWindow.id,
          invocation: {
            invocationId: "inv-no-tenant",
            agentId: "bot-a",
            completedAt: now,
            outcome: "success",
            latencyMs: 20,
            experimentId: "exp-a",
            applicationId: "app:a",
          },
        },
        dir,
      ),
    ).toThrow(/unbound-invocation-excluded/);
    const invocation = recordSkillInvocationEffectObservation(
      {
        effectVerificationId: treatmentWindow.id,
        invocation: {
          invocationId: "inv-1",
          agentId: "bot-a",
          tenantId: "tenant-a",
          completedAt: now,
          outcome: "success",
          latencyMs: 20,
          failureCategory: null,
          experimentId: "exp-a",
          applicationId: "app:a",
        },
      },
      dir,
    );
    expect(invocation.intervention).toBeUndefined();
    const startedAt = new Date(now - 10_000).toISOString();
    const endedAt = new Date().toISOString();
    expect(
      selectRuntimeEffectObservationEvents({
        events: [invocation],
        windows: [treatmentWindow],
        phase: "treatment",
        runtimeAgentId: "bot-a",
        startedAt,
        endedAt,
        experimentId: "exp-a",
        applicationId: "app:a",
        tenantId: "tenant-a",
      }),
    ).toEqual([]);
    expect(
      selectRuntimeEffectObservationEvents({
        events: [
          {
            ...invocation,
            tenantId: "tenant-other",
          },
        ],
        windows: [{ ...treatmentWindow, status: "resumed" }],
        phase: "treatment",
        runtimeAgentId: "bot-a",
        startedAt,
        endedAt,
        experimentId: "exp-a",
        applicationId: "app:a",
        tenantId: "tenant-a",
      }),
    ).toEqual([]);
    const selected = selectRuntimeEffectObservationEvents({
      events: [invocation],
      windows: [{ ...treatmentWindow, status: "resumed" }],
      phase: "treatment",
      runtimeAgentId: "bot-a",
      startedAt,
      endedAt,
      experimentId: "exp-a",
      applicationId: "app:a",
      tenantId: "tenant-a",
    });
    expect(selected).toHaveLength(1);
    expect(aggregateRuntimeEffectObservations(selected)?.sampleSize).toBe(0);
    expect(aggregateRuntimeEffectObservations(selected)?.humanInterventionRate).toBeUndefined();
  });

  it("excludes wrong experiment, missing tenant, and other-application history from baseline", () => {
    const dir = isolatedDir();
    const now = Date.now();
    const startedAt = new Date(now - 10_000).toISOString();
    const endedAt = new Date().toISOString();
    const treatmentWindow = openGovernanceEffectWindow(
      {
        runtimeAgentId: "bot-a",
        reason: "evolution:other",
        action: "pause",
        commandId: "treat-other",
        now: now - 10_000,
        binding: {
          proposalId: "evo:other",
          experimentId: "exp-other",
          applicationId: "app:other",
          tenantId: "tenant-a",
          domainReceiptRef: "rollback:other",
        },
      },
      dir,
    );
    const otherTreatment = recordSkillInvocationEffectObservation(
      {
        effectVerificationId: treatmentWindow.id,
        invocation: {
          invocationId: "inv-other",
          agentId: "bot-a",
          tenantId: "tenant-a",
          completedAt: now - 1_000,
          outcome: "success",
          latencyMs: 20,
          failureCategory: null,
          experimentId: "exp-other",
          applicationId: "app:other",
        },
      },
      dir,
    );
    expect(
      selectRuntimeEffectObservationEvents({
        events: [otherTreatment],
        windows: [treatmentWindow],
        phase: "baseline",
        runtimeAgentId: "bot-a",
        startedAt,
        endedAt,
        tenantId: "tenant-a",
      }),
    ).toEqual([]);
    expect(
      selectRuntimeEffectObservationEvents({
        events: [otherTreatment],
        windows: [{ ...treatmentWindow, status: "resumed" }],
        phase: "treatment",
        runtimeAgentId: "bot-a",
        startedAt,
        endedAt,
        experimentId: "exp-expected",
        applicationId: "app:other",
        tenantId: "tenant-a",
      }),
    ).toEqual([]);
    expect(
      selectRuntimeEffectObservationEvents({
        events: [{ ...otherTreatment, tenantId: undefined }],
        windows: [{ ...treatmentWindow, status: "resumed" }],
        phase: "treatment",
        runtimeAgentId: "bot-a",
        startedAt,
        endedAt,
        experimentId: "exp-other",
        applicationId: "app:other",
        tenantId: "tenant-a",
      }),
    ).toEqual([]);
    const duplicates = selectRuntimeEffectObservationEvents({
      events: [otherTreatment, { ...otherTreatment }],
      windows: [{ ...treatmentWindow, status: "resumed" }],
      phase: "treatment",
      runtimeAgentId: "bot-a",
      startedAt,
      endedAt,
      experimentId: "exp-other",
      applicationId: "app:other",
      tenantId: "tenant-a",
    });
    expect(duplicates).toHaveLength(1);
    expect(aggregateRuntimeEffectObservations(duplicates)?.sampleSize).toBe(0);
    const foreignPrimary = evaluationEvent({
      eventId: "obs-other-app",
      effectVerificationId: treatmentWindow.id,
      experimentId: "exp-other",
      applicationId: "app:other",
      cohortRef: "treatment",
    });
    expect(
      selectRuntimeEffectObservationEvents({
        events: [foreignPrimary],
        windows: [{ ...treatmentWindow, status: "resumed" }],
        phase: "baseline",
        runtimeAgentId: "bot-a",
        startedAt,
        endedAt,
        tenantId: "tenant-a",
      }),
    ).toEqual([]);
  });
});
