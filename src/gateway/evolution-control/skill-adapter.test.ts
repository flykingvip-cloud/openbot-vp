import { type EvolutionProposal } from "@openbot/evolution-core";
import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import type { EvolutionAuthorizationInspector } from "../../diagnosis/evolution-proposal.js";
import {
  createMemorySkillLifecyclePort,
  createSkillInstallationAdapter,
  createSkillSpecAdapter,
  type SkillCandidate,
  type SkillRecord,
} from "./adapters/skill.js";
import { createWorkingDnaAdapter } from "./adapters/working-dna.js";
import { createEvolutionControlPlane } from "./control-plane.js";
import { TEST_ALLOWED_ACTIONS, testObservation } from "./test-support.js";

const TENANT_A = "tenant-fixture-a";
const SKILL_ID = "skill-1";
const AGENT_ID = "bot-canary";

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

function skillSeed(over: Partial<SkillRecord> = {}): SkillRecord {
  return {
    skillId: SKILL_ID,
    name: "Timeout retry",
    summary: "Retry timed-out tool calls once before escalating.",
    lifecycle: "private",
    version: "1.0.0",
    successRate: 0.8,
    installations: {},
    ...over,
  };
}

function proposal(over: Partial<EvolutionProposal> = {}): EvolutionProposal {
  return {
    schemaVersion: 2,
    proposalId: "evo:skill-1",
    sourceEvidenceRefs: ["ev-a"],
    sourceMechanismRef: "case-skill",
    target: { domain: "capability", skillId: SKILL_ID },
    candidateRef: "cand:skill-1",
    surfaceId: "capability.skill-spec",
    expectedEffects: [
      { metricId: "skill_success_rate", improveWhen: "increase", minimumEffect: 0.02 },
    ],
    riskLevel: "medium",
    confidentialityScope: "enterprise",
    tenantScope: TENANT_A,
    grantId: "grant-1",
    status: "APPROVED_FOR_EXPERIMENT",
    createdAt: "2026-09-06T10:00:00.000Z",
    expiresAt: "2026-09-06T12:00:00.000Z",
    ...over,
  };
}

const freeze = {
  baselineVersion: "skill:private:1.0.0",
  candidateVersion: "cand:skill-1",
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

function planeWith(port = createMemorySkillLifecyclePort([skillSeed()])) {
  return {
    port,
    plane: createEvolutionControlPlane({
      inspector: inspector(),
      workingDnaAdapter: createWorkingDnaAdapter({} as OpenBotConfig),
      skillSpecAdapter: createSkillSpecAdapter(port),
      skillInstallationAdapter: createSkillInstallationAdapter(port),
      observationProvider: testObservation(),
      now: () => "2026-09-06T11:00:00.000Z",
    }),
  };
}

async function runExperiment(
  plane: ReturnType<typeof planeWith>["plane"],
  registered: EvolutionProposal,
  commandPrefix: string,
  candidate: SkillCandidate,
) {
  plane.registerProposal(registered, candidate);
  const experiment = await plane.startExperiment({
    commandId: `${commandPrefix}-exp`,
    proposalId: registered.proposalId,
    freeze,
    now: "2026-09-06T11:00:00.000Z",
  });
  const evaluated = await plane.evaluateExperiment(experiment.experimentId);
  return { experiment, evaluated };
}

describe("skill adapter", () => {
  it("publishes through skill-spec without copying skill body, then rollback restores lifecycle", async () => {
    const { port, plane } = planeWith();
    const { experiment } = await runExperiment(plane, proposal(), "pub", {
      skillId: SKILL_ID,
      operation: "publish",
      candidateVersion: "cand:skill-1",
    });
    expect(experiment.primaryMetric.metricId).toBe("skill_success_rate");
    const first = await plane.applySkill({
      commandId: "apply-publish",
      proposalId: "evo:skill-1",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      scope: "canary",
    });
    const second = await plane.applySkill({
      commandId: "apply-publish",
      proposalId: "evo:skill-1",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      scope: "canary",
    });
    expect(second.applicationId).toBe(first.applicationId);
    expect(first.adapterId).toBe("skill");
    expect(port.get(SKILL_ID)?.lifecycle).toBe("published");
    expect(port.get(SKILL_ID)?.summary).toBe("Retry timed-out tool calls once before escalating.");
    const verification = await plane.verifyApplication({
      commandId: "ver-publish",
      applicationId: first.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      now: "2026-09-06T11:10:00.000Z",
    });
    expect(verification.outcome).toBe("improved");
    await plane.rollbackApplication({
      commandId: "rb-publish",
      applicationId: first.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
    });
    expect(port.get(SKILL_ID)?.lifecycle).toBe("private");
  });

  it("refuses canary install for draft skills", async () => {
    const { plane } = planeWith(
      createMemorySkillLifecyclePort([skillSeed({ lifecycle: "draft" })]),
    );
    const { experiment } = await runExperiment(
      plane,
      proposal({
        proposalId: "evo:skill-install",
        surfaceId: "capability.skill-installation",
      }),
      "draft",
      {
        skillId: SKILL_ID,
        operation: "install",
        agentId: AGENT_ID,
        candidateVersion: "cand:skill-1",
      },
    );
    await expect(
      plane.applySkill({
        commandId: "apply-install",
        proposalId: "evo:skill-install",
        experimentId: experiment.experimentId,
        principalRef: "ent-admin",
        trustedTenantId: TENANT_A,
        scope: "canary",
      }),
    ).rejects.toThrow(/runnable published or approved/);
  });

  it("installs only the canary agent as a separate application from publish", async () => {
    const { port, plane } = planeWith(
      createMemorySkillLifecyclePort([skillSeed({ lifecycle: "published" })]),
    );
    const { experiment } = await runExperiment(
      plane,
      proposal({
        proposalId: "evo:skill-install",
        surfaceId: "capability.skill-installation",
      }),
      "inst",
      {
        skillId: SKILL_ID,
        operation: "install",
        agentId: AGENT_ID,
        candidateVersion: "cand:skill-1",
      },
    );
    const installed = await plane.applySkill({
      commandId: "apply-install",
      proposalId: "evo:skill-install",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      scope: "canary",
    });
    expect(installed.adapterId).toBe("skill-installation");
    expect(port.installation(AGENT_ID, SKILL_ID)?.installed).toBe(true);
    expect(port.installation("other-bot", SKILL_ID)).toBeUndefined();
    await plane.rollbackApplication({
      commandId: "rb-install",
      applicationId: installed.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
    });
    expect(port.installation(AGENT_ID, SKILL_ID)).toBeUndefined();
    expect(port.get(SKILL_ID)?.lifecycle).toBe("published");
  });

  it("promotes only the canary pin and rollback does not rewrite skill content", async () => {
    const port = createMemorySkillLifecyclePort([
      skillSeed({
        lifecycle: "published",
        version: "1.0.1",
        installations: {
          [AGENT_ID]: { installed: true, installedVersion: "1.0.0", enabled: true },
        },
      }),
    ]);
    const { plane } = planeWith(port);
    const { experiment } = await runExperiment(
      plane,
      proposal({
        proposalId: "evo:skill-promote",
        surfaceId: "capability.skill-spec",
      }),
      "promo",
      {
        skillId: SKILL_ID,
        operation: "promote",
        agentId: AGENT_ID,
        candidateVersion: "cand:skill-1",
      },
    );
    const promoted = await plane.applySkill({
      commandId: "apply-promote",
      proposalId: "evo:skill-promote",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      scope: "canary",
    });
    expect(promoted.adapterId).toBe("skill");
    expect(port.installation(AGENT_ID, SKILL_ID)?.installedVersion).toBe("1.0.1");
    await plane.rollbackApplication({
      commandId: "rb-promote",
      applicationId: promoted.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
    });
    expect(port.installation(AGENT_ID, SKILL_ID)?.installedVersion).toBe("1.0.0");
    expect(port.get(SKILL_ID)?.summary).toBe("Retry timed-out tool calls once before escalating.");
    expect(port.get(SKILL_ID)?.lifecycle).toBe("published");
  });

  it("observes unlabeled completed invocations as baseline control and does not invent sampleSize 1", async () => {
    const port = createMemorySkillLifecyclePort([
      skillSeed({
        invocations: [
          {
            outcome: "success",
            latencyMs: 20,
            completedAt: Date.parse("2026-09-06T11:06:00.000Z"),
            agentId: AGENT_ID,
            tenantId: TENANT_A,
            failureCategory: null,
          },
          {
            outcome: "failure",
            latencyMs: 40,
            completedAt: Date.parse("2026-09-06T11:07:00.000Z"),
            agentId: AGENT_ID,
            tenantId: TENANT_A,
            failureCategory: null,
          },
          {
            outcome: "success",
            latencyMs: 10,
            completedAt: Date.parse("2026-09-05T10:00:00.000Z"),
            agentId: AGENT_ID,
            tenantId: TENANT_A,
            failureCategory: null,
          },
        ],
      }),
    ]);
    const adapter = createSkillSpecAdapter(port);
    const measured = await adapter.observeTarget?.(
      { domain: "capability", skillId: SKILL_ID },
      "w",
      {
        windowId: "w",
        experimentId: "e",
        phase: "baseline",
        startedAt: "2026-09-06T11:05:00.000Z",
        endedAt: "2026-09-06T11:10:00.000Z",
        tenantScope: TENANT_A,
        targetKey: "capability:skill-1",
        modelRevision: "m",
        configRevision: "c",
        cohortRef: "co",
      },
    );
    expect(measured?.[0]?.metricId).toBe("skill_success_rate");
    expect(measured?.[0]?.sampleSize).toBe(2);
    expect(measured?.[0]?.value).toBeCloseTo(0.5);
    expect(measured?.find((row) => row.metricId === "p95_latency")?.value).toBe(40);
    expect(measured?.find((row) => row.metricId === "security_violations")).toEqual(
      expect.objectContaining({ value: 0, sampleSize: 2 }),
    );
    expect(measured?.find((row) => row.metricId === "cross_tenant_contamination")).toEqual(
      expect.objectContaining({ value: 0, sampleSize: 2 }),
    );
    const empty = await adapter.observeTarget?.({ domain: "capability", skillId: SKILL_ID }, "w", {
      windowId: "w",
      experimentId: "e",
      phase: "baseline",
      startedAt: "2026-09-04T00:00:00.000Z",
      endedAt: "2026-09-04T01:00:00.000Z",
      tenantScope: TENANT_A,
      targetKey: "capability:skill-1",
      modelRevision: "m",
      configRevision: "c",
      cohortRef: "co",
    });
    expect(empty).toEqual([]);
  });

  it("requires an explicit matching experimentId for treatment observations", async () => {
    const port = createMemorySkillLifecyclePort([
      skillSeed({
        invocations: [
          {
            outcome: "success",
            latencyMs: 20,
            completedAt: Date.parse("2026-09-06T11:06:00.000Z"),
            agentId: AGENT_ID,
            tenantId: TENANT_A,
            failureCategory: null,
            experimentId: "exp-skill",
            applicationId: "app-skill",
          },
          {
            outcome: "failure",
            latencyMs: 40,
            completedAt: Date.parse("2026-09-06T11:07:00.000Z"),
            agentId: AGENT_ID,
            tenantId: TENANT_A,
            failureCategory: null,
          },
        ],
      }),
    ]);
    const adapter = createSkillSpecAdapter(port);
    const window = {
      windowId: "w",
      experimentId: "exp-skill",
      startedAt: "2026-09-06T11:05:00.000Z",
      endedAt: "2026-09-06T11:10:00.000Z",
      tenantScope: TENANT_A,
      targetKey: "capability:skill-1",
      modelRevision: "m",
      configRevision: "c",
      cohortRef: "co",
    };
    const unlabeledTreatment = await adapter.observeTarget?.(
      { domain: "capability", skillId: SKILL_ID },
      "w",
      { ...window, phase: "treatment" },
    );
    expect(unlabeledTreatment?.[0]).toEqual(
      expect.objectContaining({
        metricId: "skill_success_rate",
        sampleSize: 1,
        value: 1,
      }),
    );
    const baseline = await adapter.observeTarget?.(
      { domain: "capability", skillId: SKILL_ID },
      "w",
      { ...window, phase: "baseline" },
    );
    expect(baseline?.[0]?.sampleSize).toBe(2);
  });
});
