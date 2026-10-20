import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { GroupMemoryCapsule } from "@openbot/collaboration-core";
import {
  capsuleMetricSet,
  organizationMetricSet,
  projectEvolutionLineage,
  runtimeGovernanceMetricSet,
  skillMetricSet,
} from "@openbot/evolution-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import type { EvolutionAuthorizationInspector } from "../../diagnosis/evolution-proposal.js";
import { DEFAULT_WORKING_STYLE } from "../agent-growth/genome.js";
import { applyCapsuleGovernanceTransition } from "../collaboration-learning/capsule-governance.js";
import { createCapsuleAdapter, createMemoryCapsuleStore } from "./adapters/capsule.js";
import {
  createMemoryOrganizationPort,
  createOrganizationAdapter,
} from "./adapters/organization.js";
import {
  createMemoryRuntimeGovernancePort,
  createRuntimeGovernanceAdapter,
} from "./adapters/runtime-governance.js";
import {
  createMemorySkillLifecyclePort,
  createSkillInstallationAdapter,
  createSkillSpecAdapter,
} from "./adapters/skill.js";
import { createWorkingDnaAdapter } from "./adapters/working-dna.js";
import { createEvolutionControlPlane } from "./control-plane.js";
import { TEST_ALLOWED_ACTIONS, testObservation } from "./test-support.js";

const TENANT_A = "tenant-fixture-a";
const TENANT_B = "tenant-fixture-b";
const AGENT_ID = "dna-bot";

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

function freeze(baselineVersion: string, candidateVersion: string) {
  return {
    baselineVersion,
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

function expectHashChain(events: Array<{ previousEventHash?: string | null; eventHash?: string }>) {
  expect(
    events.every(
      (row, index) => index === 0 || row.previousEventHash === events[index - 1]?.eventHash,
    ),
  ).toBe(true);
}

describe("five-domain evolution closed loop", () => {
  let tmpDir = "";
  let cfg: OpenBotConfig;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-evo-five-"));
    cfg = { agents: { list: [{ id: AGENT_ID, agentDir: tmpDir }] } } as unknown as OpenBotConfig;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("closes Working DNA, Capsule, Skill, Organization and keeps Runtime apply surface-gated", async () => {
    const approvedCapsule = applyCapsuleGovernanceTransition(
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
        summary: "retry timeouts before escalating",
      } as GroupMemoryCapsule,
      "approved",
      { actor: "reviewer-1", nowMs: 5000 },
    );
    const skillPort = createMemorySkillLifecyclePort([
      {
        skillId: "skill-1",
        name: "Timeout retry",
        summary: "Retry timed-out tool calls once.",
        lifecycle: "private",
        version: "1.0.0",
        successRate: 0.8,
        installations: {},
      },
    ]);
    const orgPort = createMemoryOrganizationPort([
      {
        policy: {
          groupId: "group-org",
          revision: 1,
          strategyId: "discussion_driven",
          defaultOwnerAgentId: "bot-owner",
          memberIds: ["bot-owner"],
        },
        tasks: [
          {
            id: "task-inflight",
            organizationId: "group-org",
            title: "Weekly brief",
            ownerAgentId: "bot-owner",
            createdByAgentId: "bot-owner",
            status: "running",
            createdAt: "2026-09-06T09:00:00.000Z",
            updatedAt: "2026-09-06T09:30:00.000Z",
            ackRequired: false,
          },
        ],
      },
    ]);
    const runtimePort = createMemoryRuntimeGovernancePort({
      mode: "auto",
      agents: [
        {
          runtimeAgentId: "bot-runtime",
          version: "seed",
          bindings: [{ bindingId: "bind-1", state: "active" }],
        },
      ],
    });
    const plane = createEvolutionControlPlane({
      inspector: inspector(),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      capsuleAdapter: createCapsuleAdapter(createMemoryCapsuleStore([approvedCapsule])),
      skillSpecAdapter: createSkillSpecAdapter(skillPort),
      skillInstallationAdapter: createSkillInstallationAdapter(skillPort),
      organizationAdapter: createOrganizationAdapter(orgPort),
      runtimeGovernanceAdapter: createRuntimeGovernanceAdapter(runtimePort),
      observationProvider: testObservation(),
      now: () => "2026-09-06T11:00:00.000Z",
    });

    plane.ingestV1(
      {
        schemaVersion: 1,
        proposalId: "evo:dna",
        sourceFindingIds: ["f-1"],
        sourceEvidenceRefs: ["ev-a"],
        tenantScope: TENANT_A,
        targetDomain: "agent_working_dna",
        proposedChange: { summary: "tune dna" },
        expectedEffect: "raise success",
        riskLevel: "medium",
        confidentialityScope: "enterprise",
        status: "APPROVED",
        approvalRequired: true,
        approverScope: "enterprise",
        grantId: "grant-1",
        createdAt: "2026-09-06T10:00:00.000Z",
        expiresAt: "2026-09-06T12:00:00.000Z",
        auditReceipt: "aud:evo:dna",
        candidateRef: "cand:dna",
      },
      { agentId: AGENT_ID },
    );
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
        expectedEffects: [capsuleMetricSet().primary],
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
    plane.registerProposal(
      {
        schemaVersion: 2,
        proposalId: "evo:skill",
        sourceEvidenceRefs: ["ev-a"],
        sourceMechanismRef: "case-skill",
        target: { domain: "capability", skillId: "skill-1" },
        candidateRef: "cand:skill",
        surfaceId: "capability.skill-spec",
        expectedEffects: [skillMetricSet().primary],
        riskLevel: "medium",
        confidentialityScope: "enterprise",
        tenantScope: TENANT_A,
        grantId: "grant-1",
        status: "APPROVED_FOR_EXPERIMENT",
        createdAt: "2026-09-06T10:00:00.000Z",
        expiresAt: "2026-09-06T12:00:00.000Z",
      },
      {
        skillId: "skill-1",
        operation: "publish",
        candidateVersion: "cand:skill",
      },
    );
    plane.registerProposal(
      {
        schemaVersion: 2,
        proposalId: "evo:org",
        sourceEvidenceRefs: ["ev-a"],
        sourceMechanismRef: "case-org",
        target: { domain: "organization", groupId: "group-org" },
        candidateRef: "cand:org",
        surfaceId: "organization.task-routing",
        expectedEffects: [organizationMetricSet().primary],
        riskLevel: "high",
        confidentialityScope: "enterprise",
        tenantScope: TENANT_A,
        grantId: "grant-1",
        status: "APPROVED_FOR_EXPERIMENT",
        createdAt: "2026-09-06T10:00:00.000Z",
        expiresAt: "2026-09-06T12:00:00.000Z",
      },
      {
        groupId: "group-org",
        kind: "task-routing",
        strategyId: "task_driven",
        defaultOwnerAgentId: "bot-canary",
        candidateVersion: "cand:org",
      },
    );
    plane.registerProposal(
      {
        schemaVersion: 2,
        proposalId: "evo:runtime",
        sourceEvidenceRefs: ["ev-a"],
        sourceMechanismRef: "case-runtime",
        target: { domain: "system", componentId: "bot-runtime" },
        candidateRef: "cand:runtime",
        surfaceId: "system.runtime-binding-governance",
        expectedEffects: [runtimeGovernanceMetricSet().primary],
        riskLevel: "critical",
        confidentialityScope: "enterprise",
        tenantScope: TENANT_A,
        grantId: "grant-1",
        status: "APPROVED_FOR_EXPERIMENT",
        createdAt: "2026-09-06T10:00:00.000Z",
        expiresAt: "2026-09-06T12:00:00.000Z",
      },
      {
        kind: "runtime-action",
        runtimeAgentId: "bot-runtime",
        action: "pause",
        candidateVersion: "cand:runtime",
      },
    );

    const dnaExp = await plane.startExperiment({
      commandId: "dna-exp",
      proposalId: "evo:dna",
      freeze: freeze("style-seed", "cand:dna"),
      now: "2026-09-06T11:00:00.000Z",
    });
    await plane.evaluateExperiment(dnaExp.experimentId);
    const dnaApp = await plane.applyWorkingDna({
      commandId: "dna-apply",
      proposalId: "evo:dna",
      experimentId: dnaExp.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      scope: "canary",
    });
    await plane.verifyApplication({
      commandId: "dna-ver",
      applicationId: dnaApp.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      now: "2026-09-06T11:10:00.000Z",
    });
    await plane.rollbackApplication({
      commandId: "dna-rb",
      applicationId: dnaApp.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
    });

    const capExp = await plane.startExperiment({
      commandId: "cap-exp",
      proposalId: "evo:cap",
      freeze: freeze("capsule-seed", "cand:cap"),
      now: "2026-09-06T11:00:00.000Z",
    });
    await plane.evaluateExperiment(capExp.experimentId);
    const capApp = await plane.applyCapsule({
      commandId: "cap-apply",
      proposalId: "evo:cap",
      experimentId: capExp.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      scope: "canary",
    });
    await plane.verifyApplication({
      commandId: "cap-ver",
      applicationId: capApp.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      now: "2026-09-06T11:10:00.000Z",
    });
    await plane.rollbackApplication({
      commandId: "cap-rb",
      applicationId: capApp.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
    });

    const skillExp = await plane.startExperiment({
      commandId: "skill-exp",
      proposalId: "evo:skill",
      freeze: freeze("skill-seed", "cand:skill"),
      now: "2026-09-06T11:00:00.000Z",
    });
    await plane.evaluateExperiment(skillExp.experimentId);
    const skillApp = await plane.applySkill({
      commandId: "skill-apply",
      proposalId: "evo:skill",
      experimentId: skillExp.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      scope: "canary",
    });
    await plane.verifyApplication({
      commandId: "skill-ver",
      applicationId: skillApp.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      now: "2026-09-06T11:10:00.000Z",
    });
    await plane.rollbackApplication({
      commandId: "skill-rb",
      applicationId: skillApp.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
    });

    const orgExp = await plane.startExperiment({
      commandId: "org-exp",
      proposalId: "evo:org",
      freeze: freeze("org-seed", "cand:org"),
      now: "2026-09-06T11:00:00.000Z",
    });
    await plane.evaluateExperiment(orgExp.experimentId);
    const orgApp = await plane.applyOrganization({
      commandId: "org-apply",
      proposalId: "evo:org",
      experimentId: orgExp.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      scope: "canary",
    });
    expect(orgPort.listTasks("group-org")[0]?.ownerAgentId).toBe("bot-owner");
    await expect(
      plane.applyOrganization({
        commandId: "org-cross",
        proposalId: "evo:org",
        experimentId: orgExp.experimentId,
        principalRef: "ent-admin",
        trustedTenantId: TENANT_B,
        scope: "canary",
      }),
    ).rejects.toThrow(/tenant/);
    await plane.verifyApplication({
      commandId: "org-ver",
      applicationId: orgApp.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      now: "2026-09-06T11:10:00.000Z",
    });
    await plane.rollbackApplication({
      commandId: "org-rb",
      applicationId: orgApp.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
    });

    const runtimeExp = await plane.startExperiment({
      commandId: "runtime-exp",
      proposalId: "evo:runtime",
      freeze: freeze("runtime-seed", "cand:runtime"),
      now: "2026-09-06T11:00:00.000Z",
    });
    await plane.evaluateExperiment(runtimeExp.experimentId);
    await expect(
      plane.applyRuntimeGovernance({
        commandId: "runtime-apply",
        proposalId: "evo:runtime",
        experimentId: runtimeExp.experimentId,
        principalRef: "ent-admin",
        trustedTenantId: TENANT_A,
        scope: "canary",
      }),
    ).rejects.toThrow(/platform approval/);

    expectHashChain(plane.ledger.list());
    for (const proposalId of ["evo:dna", "evo:cap", "evo:skill", "evo:org"]) {
      const proposal = plane.getProposal(proposalId);
      expect(proposal).toBeDefined();
      const events = plane.ledger.replay(proposalId);
      const lineage = projectEvolutionLineage({ proposal: proposal!, events });
      expect(lineage.steps.some((step) => step.type === "experiment.started")).toBe(true);
      expect(lineage.steps.some((step) => step.type === "application.applied")).toBe(true);
      expect(lineage.steps.find((step) => step.type === "application.applied")?.receiptOnly).toBe(
        true,
      );
      expect(lineage.steps.some((step) => step.type === "verification.completed")).toBe(true);
      expect(lineage.steps.some((step) => step.type === "rollback.completed")).toBe(true);
    }
    const runtimeLineage = plane.ledger.replay("evo:runtime");
    expect(runtimeLineage.map((row) => row.type)).toEqual([
      "proposal.created",
      "experiment.started",
      "experiment.completed",
    ]);
    expect(plane.getProposal("evo:runtime")?.status).toBe("EXPERIMENTING");
    expect(new Set(plane.listProposals().map((row) => row.surfaceId)).size).toBe(5);
  });
});
