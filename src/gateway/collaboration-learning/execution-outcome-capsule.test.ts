import {
  canProjectCapsuleToLearningAsset,
  generateCandidateCapsule,
} from "@openbot/collaboration-core";
import { composeTrustedMechanismClusterRef } from "@openbot/evolution-core";
import { describe, expect, it } from "vitest";
import type { CollaborationExecutionRecord } from "../collaboration-ledger/types.js";
import {
  executionRecordToLearningSignal,
  stampExecutionCapsuleCluster,
} from "./execution-outcome-capsule.js";

function execRecord(
  overrides: Partial<CollaborationExecutionRecord> = {},
): CollaborationExecutionRecord {
  return {
    kind: "execution",
    roundId: "r1",
    groupId: "g1",
    sessionKey: "sk1",
    agentId: "bot-a",
    agentName: "Bot A",
    tier: "duty",
    status: "failed",
    recordedAtMs: 1000,
    ...overrides,
  };
}

describe("executionRecordToLearningSignal", () => {
  it("returns null for completed (no friction) and skipped (not a failure)", () => {
    expect(executionRecordToLearningSignal(execRecord({ status: "completed" }))).toBeNull();
    expect(executionRecordToLearningSignal(execRecord({ status: "skipped" }))).toBeNull();
  });

  it("maps a failed execution into a failure learning signal", () => {
    const signal = executionRecordToLearningSignal(
      execRecord({ status: "failed", contributionRole: "lead" }),
    );
    expect(signal).not.toBeNull();
    expect(signal).toMatchObject({
      groupId: "g1",
      taskId: "r1",
      outcome: "failure",
      createdBy: "bot-a",
      sourceType: "task",
      observation: "contributionRole=lead",
    });
    expect(signal?.sourceIds).toEqual(["sk1", "r1"]);
  });
});

describe("wire: failed execution -> candidate anti_pattern capsule (not projectable)", () => {
  it("produces a governance-gated candidate from a failed record", () => {
    const signal = executionRecordToLearningSignal(execRecord({ status: "failed" }));
    expect(signal).not.toBeNull();
    const capsule = generateCandidateCapsule(signal!);
    expect(capsule).not.toBeNull();
    expect(capsule?.capsuleType).toBe("anti_pattern");
    expect(capsule?.status).toBe("candidate");
    expect(capsule?.groupId).toBe("g1");
    if (!capsule) {
      throw new Error("expected candidate capsule");
    }
    // safety default: a freshly generated candidate must not be projectable until governed.
    expect(canProjectCapsuleToLearningAsset(capsule, { actorId: "reviewer-1" })).toBe(false);
    expect(
      composeTrustedMechanismClusterRef({
        diagnoserOrDomain: "task",
        cause: signal!.taskId,
        mechanismVersion: "v1",
      }),
    ).toBeUndefined();
    expect(capsule?.metadata?.failureClusterRef).toBeUndefined();
    expect(capsule?.metadata?.clusterProvenance).not.toBe("native");
  });

  it("stamps the same native mechanism for different task instances", () => {
    const first = generateCandidateCapsule(executionRecordToLearningSignal(execRecord())!);
    const later = generateCandidateCapsule(
      executionRecordToLearningSignal(execRecord({ roundId: "r2", sessionKey: "sk2" }))!,
    );
    stampExecutionCapsuleCluster(first!, execRecord({ latencyMs: 80 }), () => ({
      cause: "timeout",
    }));
    stampExecutionCapsuleCluster(
      later!,
      execRecord({ roundId: "r2", sessionKey: "sk2", latencyMs: 90 }),
      () => ({ cause: "timeout" }),
    );
    expect(first?.metadata).toMatchObject({
      failureClusterRef: "failure:skill-invocation:timeout:v1",
      clusterProvenance: "native",
    });
    expect(later?.metadata?.failureClusterRef).toBe(first?.metadata?.failureClusterRef);
  });

  it("does not stamp a cluster without a unique trusted turn mechanism", () => {
    const capsule = generateCandidateCapsule(executionRecordToLearningSignal(execRecord())!);
    stampExecutionCapsuleCluster(capsule!, execRecord({ latencyMs: 80 }), () => undefined);
    expect(capsule?.metadata?.failureClusterRef).toBeUndefined();
    stampExecutionCapsuleCluster(capsule!, execRecord(), () => ({ cause: "timeout" }));
    expect(capsule?.metadata?.failureClusterRef).toBeUndefined();
  });
});
