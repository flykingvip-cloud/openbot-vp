import type { GroupMemoryCapsule } from "@openbot/collaboration-core";
import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import type { EvolutionAuthorizationInspector } from "../../diagnosis/evolution-proposal.js";
import { applyCapsuleGovernanceTransition } from "../collaboration-learning/capsule-governance.js";
import { stampExecutionCapsuleSecurity } from "../collaboration-learning/execution-outcome-capsule.js";
import {
  createCapsuleAdapter,
  createMemoryCapsuleStore,
  deriveCapsuleClusterRecurrences,
} from "./adapters/capsule.js";
import { createWorkingDnaAdapter } from "./adapters/working-dna.js";
import { createEvolutionControlPlane } from "./control-plane.js";
import { TEST_ALLOWED_ACTIONS, testObservation } from "./test-support.js";

const TENANT_A = "tenant-fixture-a";
const GROUP_ID = "group-1";
const CAPSULE_ID = "cap-1";
const BOT_ID = "bot-reviewer";

function inspector(): EvolutionAuthorizationInspector {
  return {
    inspect: () => ({
      grantId: "grant-1",
      status: "APPROVED",
      tenantScope: TENANT_A,
      allowedEvidence: ["ev-a"],
      allowedActions: [...TEST_ALLOWED_ACTIONS],
      confidentialityCeiling: "enterprise",
    }),
  };
}

function candidateCapsule(): GroupMemoryCapsule {
  return {
    capsuleId: CAPSULE_ID,
    groupId: GROUP_ID,
    capsuleType: "lesson",
    status: "candidate",
    reusability: "group_only",
    sensitivity: "internal",
    createdBy: BOT_ID,
    createdAt: 1,
    updatedAt: 1,
    summary: "retry timeouts before escalating",
  };
}

function v1Proposal(status: "APPROVED" | "SUGGESTED" = "APPROVED") {
  return {
    schemaVersion: 1 as const,
    proposalId: "evo:cap-1",
    sourceFindingIds: ["f-1"],
    sourceEvidenceRefs: ["ev-a"],
    tenantScope: TENANT_A,
    targetDomain: "collaboration_capsule" as const,
    proposedChange: { summary: "promote approved capsule" },
    expectedEffect: "reduce recurrence",
    riskLevel: "low" as const,
    confidentialityScope: "enterprise" as const,
    status,
    approvalRequired: true as const,
    approverScope: "enterprise" as const,
    grantId: "grant-1",
    createdAt: "2026-09-06T10:00:00.000Z",
    expiresAt: "2026-09-06T12:00:00.000Z",
    auditReceipt: "aud:evo:cap-1",
    candidateRef: "cand:evo:cap-1",
  };
}

const freeze = {
  baselineVersion: "capsule:approved:1:promotable",
  candidateVersion: "cand:evo:cap-1",
  codeSha: "sha-fixture",
  modelRef: "model-fixture",
  providerVersion: "provider-fixture",
  configSnapshotRef: "cfg-fixture",
  datasetOrCohortRef: "cohort-a",
  tenantScope: TENANT_A,
  confidentialityScope: "enterprise" as const,
  expiresAt: "2026-09-07T00:00:00.000Z",
  maxResourceBudget: 1,
};

function capsuleCandidate() {
  return {
    groupId: GROUP_ID,
    capsuleId: CAPSULE_ID,
    targetBotId: BOT_ID,
    candidateVersion: "cand:evo:cap-1",
  };
}

describe("capsule adapter", () => {
  it("treats governance approval as content gate, not VERIFIED", async () => {
    const approved = applyCapsuleGovernanceTransition(candidateCapsule(), "approved", {
      actor: "reviewer-1",
      nowMs: 5000,
    });
    expect(approved.status).toBe("approved");
    const store = createMemoryCapsuleStore([approved]);
    const plane = createEvolutionControlPlane({
      inspector: inspector(),
      workingDnaAdapter: createWorkingDnaAdapter({} as OpenBotConfig),
      capsuleAdapter: createCapsuleAdapter(store),
      observationProvider: testObservation(),
    });
    const projected = plane.ingestV1(v1Proposal("APPROVED"), {
      assetId: `${GROUP_ID}/${CAPSULE_ID}`,
    });
    expect(projected.status).toBe("APPROVED_FOR_EXPERIMENT");
    expect(projected.status).not.toBe("VERIFIED");
    expect(plane.listProposals()[0]?.applicationId).toBeUndefined();
  });

  it("refuses apply while the capsule is still a candidate", async () => {
    const store = createMemoryCapsuleStore([candidateCapsule()]);
    const plane = createEvolutionControlPlane({
      inspector: inspector(),
      workingDnaAdapter: createWorkingDnaAdapter({} as OpenBotConfig),
      capsuleAdapter: createCapsuleAdapter(store),
      observationProvider: testObservation(),
    });
    plane.ingestV1(v1Proposal(), { assetId: `${GROUP_ID}/${CAPSULE_ID}` });
    plane.registerCandidate("cand:evo:cap-1", capsuleCandidate());
    const experiment = await plane.startExperiment({
      commandId: "exp-cap",
      proposalId: "evo:cap-1",
      freeze,
      now: "2026-09-06T11:00:00.000Z",
    });
    await plane.evaluateExperiment(experiment.experimentId);
    await expect(
      plane.applyCapsule({
        commandId: "apply-cap",
        proposalId: "evo:cap-1",
        experimentId: experiment.experimentId,
        principalRef: "ent-admin",
        trustedTenantId: TENANT_A,
        scope: "canary",
      }),
    ).rejects.toThrow(/content approval/);
  });

  it("projects after unified approval, stays un-VERIFIED until metrics pass, and rollback only unprojects", async () => {
    const approved = applyCapsuleGovernanceTransition(candidateCapsule(), "approved", {
      actor: "reviewer-1",
      nowMs: 5000,
    });
    const store = createMemoryCapsuleStore([approved]);
    const plane = createEvolutionControlPlane({
      inspector: inspector(),
      workingDnaAdapter: createWorkingDnaAdapter({} as OpenBotConfig),
      capsuleAdapter: createCapsuleAdapter(store),
      observationProvider: testObservation(),
      now: () => "2026-09-06T11:00:00.000Z",
    });
    plane.ingestV1(v1Proposal(), { assetId: `${GROUP_ID}/${CAPSULE_ID}` });
    plane.registerCandidate("cand:evo:cap-1", capsuleCandidate());
    const experiment = await plane.startExperiment({
      commandId: "exp-cap",
      proposalId: "evo:cap-1",
      freeze,
      now: "2026-09-06T11:00:00.000Z",
    });
    expect(experiment.primaryMetric.metricId).toBe("issue_recurrence_rate");
    await plane.evaluateExperiment(experiment.experimentId);
    const first = await plane.applyCapsule({
      commandId: "apply-cap",
      proposalId: "evo:cap-1",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      scope: "canary",
    });
    const second = await plane.applyCapsule({
      commandId: "apply-cap",
      proposalId: "evo:cap-1",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      scope: "canary",
    });
    expect(second.applicationId).toBe(first.applicationId);
    const capsulesAfterApply = await store.readCapsules(GROUP_ID);
    expect(capsulesAfterApply[0]?.status).toBe("approved");
    const assets = await store.readLearningAssets(GROUP_ID);
    expect(assets).toHaveLength(1);
    expect(assets[0]?.status).toBe("active");
    const verification = await plane.verifyApplication({
      commandId: "ver-cap",
      applicationId: first.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      now: "2026-09-06T11:10:00.000Z",
    });
    expect(verification.outcome).toBe("improved");
    expect(plane.getProposal("evo:cap-1")?.status).toBe("VERIFIED");
    await plane.rollbackApplication({
      commandId: "rb-cap",
      applicationId: first.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
    });
    const capsulesAfterRollback = await store.readCapsules(GROUP_ID);
    expect(capsulesAfterRollback[0]?.status).toBe("approved");
    const revokedAssets = await store.readLearningAssets(GROUP_ID);
    expect(revokedAssets[0]?.status).toBe("revoked");
    const revokedProjections = await store.readProjections(GROUP_ID);
    expect(revokedProjections[0]?.approvalStatus).toBe("revoked");
    expect(plane.ledger.replay("evo:cap-1").map((row) => row.type)).toEqual([
      "legacy.imported",
      "experiment.started",
      "experiment.completed",
      "application.applied",
      "verification.completed",
      "rollback.started",
      "rollback.completed",
    ]);
  });

  it("does not treat revoked learning assets as issue recurrence", async () => {
    const store = createMemoryCapsuleStore([candidateCapsule()]);
    await store.writeLearningAssets(GROUP_ID, [
      {
        assetId: "asset-revoked",
        botId: BOT_ID,
        sourceGroupId: GROUP_ID,
        sourceCapsuleId: CAPSULE_ID,
        status: "revoked",
      },
    ]);
    const adapter = createCapsuleAdapter(store);
    const measured = await adapter.observeTarget?.(
      { domain: "knowledge", assetId: `${GROUP_ID}/${CAPSULE_ID}` },
      "w",
      {
        windowId: "w",
        experimentId: "e",
        phase: "baseline",
        startedAt: "2026-09-06T11:05:00.000Z",
        endedAt: "2026-09-06T11:10:00.000Z",
        tenantScope: TENANT_A,
        targetKey: `knowledge:${GROUP_ID}/${CAPSULE_ID}`,
        modelRevision: "m",
        configRevision: "c",
        cohortRef: "co",
      },
    );
    expect(measured).toEqual([]);
  });

  it("stamps capsule security only when a turn inspection returned a boolean", () => {
    const capsule: { metadata: Record<string, unknown> } = {
      metadata: {
        failureClusterRef: "failure:collaboration:timeout:v1",
        clusterProvenance: "native",
      },
    };
    stampExecutionCapsuleSecurity(
      capsule,
      {
        agentId: BOT_ID,
        recordedAtMs: 1000,
        latencyMs: 400,
      },
      () => ({ securityViolation: false }),
    );
    expect(capsule.metadata.securityViolation).toBe(false);

    const empty: { metadata: Record<string, unknown> } = {
      metadata: {
        failureClusterRef: "failure:collaboration:timeout:v1",
        clusterProvenance: "native",
      },
    };
    stampExecutionCapsuleSecurity(
      empty,
      { agentId: BOT_ID, recordedAtMs: 1000, latencyMs: 400 },
      () => ({}),
    );
    expect(empty.metadata.securityViolation).toBeUndefined();

    const noLatency: { metadata: Record<string, unknown> } = {
      metadata: {
        failureClusterRef: "failure:collaboration:timeout:v1",
        clusterProvenance: "native",
      },
    };
    stampExecutionCapsuleSecurity(noLatency, { agentId: BOT_ID, recordedAtMs: 1000 }, () => ({
      securityViolation: true,
    }));
    expect(noLatency.metadata.securityViolation).toBeUndefined();
  });

  it("does not invent security from later capsules that lack a stamped boolean", () => {
    const original = {
      ...candidateCapsule(),
      metadata: {
        failureClusterRef: "failure:collaboration:timeout:v1",
        clusterProvenance: "native",
      },
    };
    const later = {
      ...candidateCapsule(),
      capsuleId: "cap-later-plain",
      createdAt: 2,
      metadata: {
        failureClusterRef: "failure:collaboration:timeout:v1",
        clusterProvenance: "native",
      },
    };
    expect(deriveCapsuleClusterRecurrences([original, later], CAPSULE_ID)).toEqual([
      {
        clusterRef: "failure:collaboration:timeout:v1",
        occurredAt: 2,
        recurred: false,
        securityViolation: undefined,
        crossTenantContamination: undefined,
      },
    ]);
  });

  it("keeps a stamped security boolean on same-cluster later capsules", () => {
    const original = {
      ...candidateCapsule(),
      metadata: {
        failureClusterRef: "failure:collaboration:timeout:v1",
        clusterProvenance: "native",
      },
    };
    const later = {
      ...candidateCapsule(),
      capsuleId: "cap-later-sec",
      capsuleType: "anti_pattern" as const,
      createdAt: 2,
      metadata: {
        failureClusterRef: "failure:collaboration:timeout:v1",
        clusterProvenance: "native",
        securityViolation: true,
      },
    };
    expect(deriveCapsuleClusterRecurrences([original, later], CAPSULE_ID)).toEqual([
      {
        clusterRef: "failure:collaboration:timeout:v1",
        occurredAt: 2,
        recurred: true,
        securityViolation: true,
        crossTenantContamination: undefined,
      },
    ]);
  });

  it("does not infer a failure cluster from sourceIds alone", () => {
    const original = {
      ...candidateCapsule(),
      sourceType: "task" as const,
      sourceIds: ["finding-1"],
    };
    const later = {
      ...candidateCapsule(),
      capsuleId: "cap-later",
      sourceType: "task" as const,
      sourceIds: ["finding-1"],
      capsuleType: "anti_pattern" as const,
      createdAt: 2,
    };
    expect(deriveCapsuleClusterRecurrences([original, later], CAPSULE_ID)).toEqual([]);
  });

  it("computes issue_recurrence_rate from same-cluster later failures", async () => {
    const store = createMemoryCapsuleStore(
      [
        {
          ...candidateCapsule(),
          metadata: {
            failureClusterRef: "failure:collaboration:timeout:v1",
            clusterProvenance: "native",
          },
        },
      ],
      {
        recurrences: {
          [`${GROUP_ID}/${CAPSULE_ID}`]: [
            {
              clusterRef: "failure:collaboration:timeout:v1",
              occurredAt: Date.parse("2026-09-06T11:06:00.000Z"),
              recurred: true,
              securityViolation: false,
              crossTenantContamination: false,
            },
            {
              clusterRef: "failure:collaboration:timeout:v1",
              occurredAt: Date.parse("2026-09-06T11:07:00.000Z"),
              recurred: false,
              securityViolation: false,
              crossTenantContamination: false,
            },
          ],
        },
      },
    );
    const adapter = createCapsuleAdapter(store);
    const measured = await adapter.observeTarget?.(
      { domain: "knowledge", assetId: `${GROUP_ID}/${CAPSULE_ID}` },
      "w",
      {
        windowId: "w",
        experimentId: "e",
        phase: "baseline",
        startedAt: "2026-09-06T11:05:00.000Z",
        endedAt: "2026-09-06T11:10:00.000Z",
        tenantScope: TENANT_A,
        targetKey: `knowledge:${GROUP_ID}/${CAPSULE_ID}`,
        modelRevision: "m",
        configRevision: "c",
        cohortRef: "co",
      },
    );
    expect(measured?.[0]).toEqual(
      expect.objectContaining({
        metricId: "issue_recurrence_rate",
        value: 0.5,
        sampleSize: 2,
      }),
    );
    expect(measured).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metricId: "security_violations", value: 0, sampleSize: 2 }),
        expect.objectContaining({
          metricId: "cross_tenant_contamination",
          value: 0,
          sampleSize: 2,
        }),
      ]),
    );
  });
});
