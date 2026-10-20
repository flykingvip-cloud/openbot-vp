import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { GroupMemoryCapsule } from "@openbot/collaboration-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { DEFAULT_WORKING_STYLE } from "../agent-growth/genome.js";
import { readRobotWorkingStyle } from "../agent-growth/working-style-store.js";
import { applyCapsuleGovernanceTransition } from "../collaboration-learning/capsule-governance.js";
import { createCapsuleAdapter, createMemoryCapsuleStore } from "./adapters/capsule.js";
import { createWorkingDnaAdapter } from "./adapters/working-dna.js";
import { createEvolutionControlPlane } from "./control-plane.js";
import { testInspector, testObservation, withWorkingDnaExternal } from "./test-support.js";

const TENANT_A = "tenant-fixture-a";
const AGENT_ID = "dna-bot";

function freeze(candidateVersion: string) {
  return {
    baselineVersion: "style-seed",
    candidateVersion,
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
}

function dnaV1(proposalId: string, candidateRef: string) {
  return {
    schemaVersion: 1 as const,
    proposalId,
    sourceFindingIds: ["f-1"],
    sourceEvidenceRefs: ["ev-a"],
    tenantScope: TENANT_A,
    targetDomain: "agent_working_dna" as const,
    proposedChange: { summary: "tune" },
    expectedEffect: "raise success",
    riskLevel: "medium" as const,
    confidentialityScope: "enterprise" as const,
    status: "APPROVED" as const,
    approvalRequired: true as const,
    approverScope: "enterprise" as const,
    grantId: "grant-1",
    createdAt: "2026-09-06T10:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    auditReceipt: `aud:${proposalId}`,
    candidateRef,
  };
}

describe("evolution acceptance gates", () => {
  let tmpDir = "";
  let cfg: OpenBotConfig;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-evo-gate-"));
    cfg = { agents: { list: [{ id: AGENT_ID, agentDir: tmpDir }] } } as unknown as OpenBotConfig;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("refuses to reuse a passed experiment on another proposal", async () => {
    const plane = createEvolutionControlPlane({
      inspector: testInspector(TENANT_A),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      observationProvider: testObservation(),
    });
    plane.ingestV1(dnaV1("evo:a", "cand:a"), { agentId: AGENT_ID });
    plane.ingestV1(dnaV1("evo:b", "cand:b"), { agentId: AGENT_ID });
    plane.registerCandidate("cand:a", {
      agentId: AGENT_ID,
      delta: { riskPreference: "conservative" },
      baselineStyle: DEFAULT_WORKING_STYLE,
      candidateVersion: "cand:a",
    });
    plane.registerCandidate("cand:b", {
      agentId: AGENT_ID,
      delta: { communicationTone: "formal" },
      baselineStyle: DEFAULT_WORKING_STYLE,
      candidateVersion: "cand:b",
    });
    const experimentA = await plane.startExperiment({
      commandId: "exp-a",
      proposalId: "evo:a",
      freeze: freeze("cand:a"),
      now: "2026-09-06T11:00:00.000Z",
    });
    await plane.evaluateExperiment(experimentA.experimentId);
    await expect(
      plane.applyWorkingDna({
        commandId: "apply-b-with-a",
        proposalId: "evo:b",
        experimentId: experimentA.experimentId,
        principalRef: "ent-admin",
        trustedTenantId: TENANT_A,
        scope: "canary",
      }),
    ).rejects.toThrow(/not bound to this proposal/);
    expect(await readRobotWorkingStyle(cfg, AGENT_ID)).toBeNull();
  });

  it("applies the governed candidate, not a client-supplied payload", async () => {
    const plane = createEvolutionControlPlane({
      inspector: testInspector(TENANT_A),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      observationProvider: testObservation(),
    });
    plane.ingestV1(dnaV1("evo:dna", "cand:dna"), { agentId: AGENT_ID });
    plane.registerCandidate("cand:dna", {
      agentId: AGENT_ID,
      delta: { riskPreference: "conservative" },
      baselineStyle: DEFAULT_WORKING_STYLE,
      candidateVersion: "cand:dna",
    });
    const experiment = await plane.startExperiment({
      commandId: "exp-dna",
      proposalId: "evo:dna",
      freeze: freeze("cand:dna"),
      now: "2026-09-06T11:00:00.000Z",
    });
    await plane.evaluateExperiment(experiment.experimentId);
    await plane.applyWorkingDna({
      commandId: "apply-dna",
      proposalId: "evo:dna",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      scope: "canary",
    });
    expect((await readRobotWorkingStyle(cfg, AGENT_ID))?.riskPreference).toBe("conservative");
    expect((await readRobotWorkingStyle(cfg, AGENT_ID))?.communicationTone).toBe(
      DEFAULT_WORKING_STYLE.communicationTone,
    );
  });

  it("keeps Working DNA and Capsule shadow applies at zero mutation", async () => {
    const approved = applyCapsuleGovernanceTransition(
      {
        capsuleId: "cap-1",
        groupId: "group-1",
        capsuleType: "lesson",
        status: "candidate",
        reusability: "group_only",
        sensitivity: "internal",
        createdBy: "bot-reviewer",
        createdAt: 1,
        updatedAt: 1,
        summary: "retry timeouts",
      } as GroupMemoryCapsule,
      "approved",
      { actor: "reviewer-1", nowMs: 5000 },
    );
    const store = createMemoryCapsuleStore([approved]);
    const plane = createEvolutionControlPlane({
      inspector: testInspector(TENANT_A),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      capsuleAdapter: createCapsuleAdapter(store),
      observationProvider: testObservation(),
    });
    plane.ingestV1(dnaV1("evo:dna", "cand:dna"), { agentId: AGENT_ID });
    plane.registerCandidate("cand:dna", {
      agentId: AGENT_ID,
      delta: { riskPreference: "conservative" },
      baselineStyle: DEFAULT_WORKING_STYLE,
      candidateVersion: "cand:dna",
    });
    plane.registerProposal(
      {
        schemaVersion: 2,
        proposalId: "evo:cap",
        sourceEvidenceRefs: ["ev-a"],
        sourceMechanismRef: "case-cap",
        target: { domain: "knowledge", assetId: "group-1/cap-1" },
        candidateRef: "cand:cap",
        surfaceId: "knowledge.experience-capsule",
        expectedEffects: [],
        riskLevel: "low",
        confidentialityScope: "enterprise",
        tenantScope: TENANT_A,
        grantId: "grant-1",
        status: "APPROVED_FOR_EXPERIMENT",
        createdAt: "2026-09-06T10:00:00.000Z",
        expiresAt: "2026-09-06T12:00:00.000Z",
      },
      {
        groupId: "group-1",
        capsuleId: "cap-1",
        targetBotId: "bot-reviewer",
        candidateVersion: "cand:cap",
      },
    );
    const dnaExp = await plane.startExperiment({
      commandId: "dna-exp",
      proposalId: "evo:dna",
      freeze: freeze("cand:dna"),
      now: "2026-09-06T11:00:00.000Z",
    });
    await plane.evaluateExperiment(dnaExp.experimentId);
    await plane.applyWorkingDna({
      commandId: "dna-shadow",
      proposalId: "evo:dna",
      experimentId: dnaExp.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      scope: "shadow",
    });
    expect(await readRobotWorkingStyle(cfg, AGENT_ID)).toBeNull();
    expect(plane.getProposal("evo:dna")?.status).toBe("EXPERIMENTING");
    expect(
      plane.ledger
        .list({ proposalId: "evo:dna" })
        .some((row) => row.type === "experiment.shadow_observed"),
    ).toBe(true);
    expect(
      plane.ledger
        .list({ proposalId: "evo:dna" })
        .some((row) => row.type === "application.applied"),
    ).toBe(false);
    const capExp = await plane.startExperiment({
      commandId: "cap-exp",
      proposalId: "evo:cap",
      freeze: freeze("cand:cap"),
      now: "2026-09-06T11:00:00.000Z",
    });
    await plane.evaluateExperiment(capExp.experimentId);
    await plane.applyCapsule({
      commandId: "cap-shadow",
      proposalId: "evo:cap",
      experimentId: capExp.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      scope: "shadow",
    });
    expect(await store.readLearningAssets("group-1")).toEqual([]);
    expect(await store.readProjections("group-1")).toEqual([]);
    expect(plane.getProposal("evo:cap")?.status).toBe("EXPERIMENTING");
    expect(plane.getApplication("app:cap-shadow")?.appliedToRuntime).toBe(false);
  });

  it("authorizes reject before mutation and again inside the control plane", () => {
    const plane = createEvolutionControlPlane({
      inspector: testInspector(TENANT_A),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      observationProvider: testObservation(),
    });
    plane.ingestV1(dnaV1("evo:dna", "cand:dna"), { agentId: AGENT_ID });
    expect(() =>
      plane.rejectProposal({
        commandId: "reject-x",
        proposalId: "evo:dna",
        principalRef: "intruder",
        trustedTenantId: "tenant-other",
      }),
    ).toThrow(/proposal not found/);
    expect(plane.getProposal("evo:dna")?.status).toBe("APPROVED_FOR_EXPERIMENT");
    const rejected = plane.rejectProposal({
      commandId: "reject-ok",
      proposalId: "evo:dna",
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
    });
    expect(rejected.status).toBe("REJECTED");
  });

  it("evaluates only through a trusted observation provider", async () => {
    const closed = createEvolutionControlPlane({
      inspector: testInspector(TENANT_A),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
    });
    closed.ingestV1(dnaV1("evo:dna", "cand:dna"), { agentId: AGENT_ID });
    const experiment = await closed.startExperiment({
      commandId: "exp-closed",
      proposalId: "evo:dna",
      freeze: freeze("cand:dna"),
      now: "2026-09-06T11:00:00.000Z",
    });
    await expect(closed.evaluateExperiment(experiment.experimentId)).rejects.toThrow(
      /trusted observation provider required/,
    );
  });

  it("verifies through observation only and promotes only from VERIFIED", async () => {
    const plane = createEvolutionControlPlane({
      inspector: testInspector(TENANT_A),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      observationProvider: testObservation(),
      ...withWorkingDnaExternal(cfg),
    });
    plane.ingestV1(dnaV1("evo:dna", "cand:dna"), { agentId: AGENT_ID });
    plane.registerCandidate("cand:dna", {
      agentId: AGENT_ID,
      delta: { riskPreference: "conservative" },
      baselineStyle: DEFAULT_WORKING_STYLE,
      candidateVersion: "cand:dna",
    });
    const experiment = await plane.startExperiment({
      commandId: "exp-dna",
      proposalId: "evo:dna",
      freeze: freeze("cand:dna"),
      now: "2026-09-06T11:00:00.000Z",
    });
    await plane.evaluateExperiment(experiment.experimentId);
    const shadow = await plane.applyWorkingDna({
      commandId: "apply-shadow",
      proposalId: "evo:dna",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      scope: "shadow",
    });
    await expect(
      plane.verifyApplication({
        commandId: "ver-shadow",
        applicationId: shadow.applicationId,
        principalRef: "ent-admin",
        trustedTenantId: TENANT_A,
      }),
    ).rejects.toThrow(/shadow application cannot be verified/);
    plane.ingestV1(dnaV1("evo:live", "cand:live"), { agentId: AGENT_ID });
    plane.registerCandidate("cand:live", {
      agentId: AGENT_ID,
      delta: { communicationTone: "formal" },
      baselineStyle: DEFAULT_WORKING_STYLE,
      candidateVersion: "cand:live",
    });
    const liveExp = await plane.startExperiment({
      commandId: "exp-live",
      proposalId: "evo:live",
      freeze: freeze("cand:live"),
      now: "2026-09-06T11:00:00.000Z",
    });
    await plane.evaluateExperiment(liveExp.experimentId);
    const applied = await plane.applyWorkingDna({
      commandId: "apply-live",
      proposalId: "evo:live",
      experimentId: liveExp.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      scope: "canary",
    });
    expect(() =>
      plane.promoteProposal({
        commandId: "promo-early",
        proposalId: "evo:live",
        principalRef: "ent-admin",
        trustedTenantId: TENANT_A,
      }),
    ).toThrow(/not VERIFIED|OUTCOME_VERIFIED/);
    const verification = await plane.verifyApplication({
      commandId: "ver-ok",
      applicationId: applied.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
    });
    expect(verification.outcome).toBe("improved");
    expect(verification.sampleSize).toBeGreaterThanOrEqual(20);
    expect(plane.getProposal("evo:live")?.status).toBe("VERIFIED");
    expect(
      plane.promoteProposal({
        commandId: "promo-ok",
        proposalId: "evo:live",
        principalRef: "ent-admin",
        trustedTenantId: TENANT_A,
      }).status,
    ).toBe("PROMOTED");
  });
});
