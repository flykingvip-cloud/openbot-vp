import os from "node:os";
import path from "node:path";
import { type EvolutionProposal } from "@openbot/evolution-core";
import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import type { EvolutionAuthorizationInspector } from "../../diagnosis/evolution-proposal.js";
import type { OrganizationRoutingPolicy } from "../../organization/routing-policy.js";
import type { TaskAssignment } from "../../organization/task-assignment.js";
import {
  appendSkillInvocationEvent,
  buildCompletedInvocationEvent,
} from "../skill-invocation/event-store.js";
import {
  createFileOrganizationPolicyPort,
  createMemoryOrganizationPort,
  createOrganizationAdapter,
  type OrganizationCandidate,
} from "./adapters/organization.js";
import { createWorkingDnaAdapter } from "./adapters/working-dna.js";
import { createEvolutionControlPlane } from "./control-plane.js";
import { TEST_ALLOWED_ACTIONS, testObservation } from "./test-support.js";

const TENANT_A = "tenant-fixture-a";
const GROUP_ID = "group-org-1";

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

function policy(over: Partial<OrganizationRoutingPolicy> = {}): OrganizationRoutingPolicy {
  return {
    groupId: GROUP_ID,
    revision: 1,
    strategyId: "discussion_driven",
    defaultOwnerAgentId: "bot-owner",
    memberIds: ["bot-owner", "bot-reviewer"],
    ...over,
  };
}

function task(over: Partial<TaskAssignment> = {}): TaskAssignment {
  return {
    id: "task-inflight",
    organizationId: GROUP_ID,
    title: "Write weekly brief",
    ownerAgentId: "bot-owner",
    createdByAgentId: "bot-owner",
    status: "running",
    createdAt: "2026-09-06T09:00:00.000Z",
    updatedAt: "2026-09-06T09:30:00.000Z",
    ackRequired: false,
    cohortRef: "co",
    ...over,
  };
}

function proposal(over: Partial<EvolutionProposal> = {}): EvolutionProposal {
  return {
    schemaVersion: 2,
    proposalId: "evo:org-1",
    sourceEvidenceRefs: ["ev-a"],
    sourceMechanismRef: "case-org",
    target: { domain: "organization", groupId: GROUP_ID },
    candidateRef: "cand:org-1",
    surfaceId: "organization.task-routing",
    expectedEffects: [
      { metricId: "first_delivery_pass_rate", improveWhen: "increase", minimumEffect: 0.02 },
    ],
    riskLevel: "high",
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
  baselineVersion: "org:group-org-1:1:discussion_driven:bot-owner",
  candidateVersion: "cand:org-1",
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

function routingCandidate(over: Partial<OrganizationCandidate> = {}): OrganizationCandidate {
  return {
    groupId: GROUP_ID,
    kind: "task-routing",
    strategyId: "task_driven",
    defaultOwnerAgentId: "bot-canary",
    candidateVersion: "cand:org-1",
    ...over,
  };
}

function planeWith(
  seed: Parameters<typeof createMemoryOrganizationPort>[0][number] = {
    policy: policy(),
    tasks: [
      task(),
      task({
        id: "task-done",
        title: "Ship release notes",
        status: "completed",
        completedAt: "2026-09-06T08:00:00.000Z",
      }),
    ],
  },
) {
  const port = createMemoryOrganizationPort([seed]);
  const adapter = createOrganizationAdapter(port);
  return {
    port,
    adapter,
    plane: createEvolutionControlPlane({
      inspector: inspector(),
      workingDnaAdapter: createWorkingDnaAdapter({} as OpenBotConfig),
      organizationAdapter: adapter,
      observationProvider: testObservation(),
      now: () => "2026-09-06T11:00:00.000Z",
    }),
  };
}

async function runExperiment(
  plane: ReturnType<typeof planeWith>["plane"],
  registered: EvolutionProposal,
  commandPrefix: string,
  candidate: OrganizationCandidate = routingCandidate(),
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

describe("organization adapter", () => {
  it("shadow apply writes a plan only and leaves real tasks and policy untouched", async () => {
    const { port, adapter, plane } = planeWith();
    const { experiment } = await runExperiment(
      plane,
      proposal(),
      "shadow",
      routingCandidate({ sampleNewTaskTitles: ["Draft launch checklist"] }),
    );
    expect(experiment.primaryMetric.metricId).toBe("first_delivery_pass_rate");
    const first = await plane.applyOrganization({
      commandId: "apply-shadow",
      proposalId: "evo:org-1",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      scope: "shadow",
    });
    const second = await plane.applyOrganization({
      commandId: "apply-shadow",
      proposalId: "evo:org-1",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      scope: "shadow",
    });
    expect(second.applicationId).toBe(first.applicationId);
    expect(first.adapterId).toBe("organization");
    expect(first.targetVersionAfter).toBe(first.targetVersionBefore);
    expect(port.getPolicy(GROUP_ID)?.defaultOwnerAgentId).toBe("bot-owner");
    expect(port.getPolicy(GROUP_ID)?.revision).toBe(1);
    expect(port.listTasks(GROUP_ID).map((row) => row.ownerAgentId)).toEqual([
      "bot-owner",
      "bot-owner",
    ]);
    const created = port.createNewTask(GROUP_ID, "After shadow");
    expect(created.ownerAgentId).toBe("bot-owner");
    const plan = adapter.getShadowPlan(first.rollbackRef);
    expect(plan?.mutatesInFlightTasks).toBe(false);
    expect(plan?.inFlightTaskIds).toEqual(["task-inflight"]);
    expect(plan?.newTaskProjections).toEqual([
      { title: "Draft launch checklist", proposedOwnerAgentId: "bot-canary" },
    ]);
  });

  it("canary revises routing policy for new tasks only and rollback restores policy", async () => {
    const { port, plane } = planeWith();
    const { experiment } = await runExperiment(plane, proposal(), "canary");
    const applied = await plane.applyOrganization({
      commandId: "apply-canary",
      proposalId: "evo:org-1",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      scope: "canary",
    });
    expect(port.getPolicy(GROUP_ID)?.strategyId).toBe("task_driven");
    expect(port.getPolicy(GROUP_ID)?.defaultOwnerAgentId).toBe("bot-canary");
    expect(port.getPolicy(GROUP_ID)?.revision).toBe(2);
    expect(port.listTasks(GROUP_ID).find((row) => row.id === "task-inflight")?.ownerAgentId).toBe(
      "bot-owner",
    );
    expect(port.listTasks(GROUP_ID).find((row) => row.id === "task-done")?.ownerAgentId).toBe(
      "bot-owner",
    );
    expect(port.createNewTask(GROUP_ID, "After canary").ownerAgentId).toBe("bot-canary");
    const verification = await plane.verifyApplication({
      commandId: "ver-org",
      applicationId: applied.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      now: "2026-09-06T11:10:00.000Z",
    });
    expect(verification.outcome).toBe("improved");
    await plane.rollbackApplication({
      commandId: "rb-org",
      applicationId: applied.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
    });
    expect(port.getPolicy(GROUP_ID)?.strategyId).toBe("discussion_driven");
    expect(port.getPolicy(GROUP_ID)?.defaultOwnerAgentId).toBe("bot-owner");
    expect(port.getPolicy(GROUP_ID)?.revision).toBe(1);
    expect(port.listTasks(GROUP_ID).find((row) => row.id === "task-inflight")?.status).toBe(
      "running",
    );
    expect(port.listTasks(GROUP_ID).find((row) => row.id === "task-done")?.status).toBe(
      "completed",
    );
    expect(port.createNewTask(GROUP_ID, "After rollback").ownerAgentId).toBe("bot-owner");
  });

  it("refuses team-composition apply because the surface is shadow-only", async () => {
    const { plane } = planeWith();
    const { experiment } = await runExperiment(
      plane,
      proposal({
        proposalId: "evo:org-team",
        surfaceId: "organization.team-composition",
      }),
      "team",
      {
        groupId: GROUP_ID,
        kind: "team-composition",
        memberIds: ["bot-owner", "bot-new"],
        candidateVersion: "cand:org-1",
      },
    );
    await expect(
      plane.applyOrganization({
        commandId: "apply-team",
        proposalId: "evo:org-team",
        experimentId: experiment.experimentId,
        principalRef: "ent-admin",
        trustedTenantId: TENANT_A,
        scope: "shadow",
      }),
    ).rejects.toThrow(/surface does not allow this operation/);
    expect(plane.getProposal("evo:org-team")?.status).toBe("EXPERIMENTING");
  });

  it("observes only completed tasks inside the baseline window", async () => {
    const { adapter } = planeWith({
      policy: policy(),
      tasks: [
        task({
          id: "task-legacy",
          title: "legacy",
          status: "completed",
          createdAt: "2026-09-01T00:00:00.000Z",
          completedAt: "2026-09-01T00:01:00.000Z",
          tenantId: TENANT_A,
        }),
        task({
          id: "task-fresh",
          title: "fresh-ok",
          status: "completed",
          createdAt: "2026-09-06T11:06:00.000Z",
          completedAt: "2026-09-06T11:06:00.040Z",
          tenantId: TENANT_A,
        }),
        task({
          id: "task-running",
          title: "fresh-running",
          status: "running",
          createdAt: "2026-09-06T11:07:00.000Z",
          tenantId: TENANT_A,
        }),
      ],
    });
    const measured = await adapter.observeTarget?.(
      { domain: "organization", groupId: GROUP_ID },
      "w",
      {
        windowId: "w",
        experimentId: "e",
        phase: "baseline",
        startedAt: "2026-09-06T11:05:00.000Z",
        endedAt: "2026-09-06T11:10:00.000Z",
        tenantScope: TENANT_A,
        targetKey: `organization:${GROUP_ID}`,
        modelRevision: "m",
        configRevision: "c",
        cohortRef: "co",
      },
    );
    expect(measured?.[0]?.metricId).toBe("first_delivery_pass_rate");
    expect(measured?.[0]?.sampleSize).toBe(1);
    expect(measured?.[0]?.value).toBe(1);
    expect(measured?.find((row) => row.metricId === "security_violations")).toBeUndefined();
    expect(measured?.find((row) => row.metricId === "cross_tenant_contamination")).toBeUndefined();
  });

  it("reads persisted organization tasks and derives latency without inventing criticals", async () => {
    const adapter = createOrganizationAdapter(
      createFileOrganizationPolicyPort(path.join(os.tmpdir(), `org-policy-${Date.now()}.json`), {
        listPersistedTasks: () => [
          task({
            id: "task-disk",
            title: "persisted",
            status: "completed",
            createdAt: "2026-09-06T11:06:00.000Z",
            completedAt: "2026-09-06T11:06:00.040Z",
            tenantId: TENANT_A,
          }),
        ],
      }),
    );
    const measured = await adapter.observeTarget?.(
      { domain: "organization", groupId: GROUP_ID },
      "w",
      {
        windowId: "w",
        experimentId: "e",
        phase: "baseline",
        startedAt: "2026-09-06T11:05:00.000Z",
        endedAt: "2026-09-06T11:10:00.000Z",
        tenantScope: TENANT_A,
        targetKey: `organization:${GROUP_ID}`,
        modelRevision: "m",
        configRevision: "c",
        cohortRef: "co",
      },
    );
    expect(measured).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricId: "first_delivery_pass_rate",
          sampleSize: 1,
          value: 1,
        }),
        expect.objectContaining({ metricId: "p95_latency", value: 40, sampleSize: 1 }),
        expect.objectContaining({ metricId: "delivery_failure_rate", value: 0, sampleSize: 1 }),
      ]),
    );
    expect(measured?.find((row) => row.metricId === "security_violations")).toBeUndefined();
    expect(measured?.find((row) => row.metricId === "cross_tenant_contamination")).toBeUndefined();
  });

  it("does not treat a stamped task tenant as a critical sensor without owner-skill events", async () => {
    const { adapter } = planeWith({
      policy: policy(),
      tasks: [
        task({
          id: "task-tenant",
          title: "fresh-ok",
          status: "completed",
          createdAt: "2026-09-06T11:06:00.000Z",
          completedAt: "2026-09-06T11:06:00.040Z",
          tenantId: TENANT_A,
        }),
        task({
          id: "task-other-tenant",
          title: "other",
          status: "completed",
          createdAt: "2026-09-06T11:07:00.000Z",
          completedAt: "2026-09-06T11:07:00.040Z",
          tenantId: "tenant-other",
        }),
      ],
    });
    const measured = await adapter.observeTarget?.(
      { domain: "organization", groupId: GROUP_ID },
      "w",
      {
        windowId: "w",
        experimentId: "e",
        phase: "baseline",
        startedAt: "2026-09-06T11:05:00.000Z",
        endedAt: "2026-09-06T11:10:00.000Z",
        tenantScope: TENANT_A,
        targetKey: `organization:${GROUP_ID}`,
        modelRevision: "m",
        configRevision: "c",
        cohortRef: "co",
      },
    );
    expect(measured?.find((row) => row.metricId === "first_delivery_pass_rate")?.sampleSize).toBe(
      1,
    );
    expect(measured?.find((row) => row.metricId === "security_violations")).toBeUndefined();
    expect(measured?.find((row) => row.metricId === "cross_tenant_contamination")).toBeUndefined();
  });

  it("emits criticals only from attributed owner-skill events", async () => {
    const configDir = path.join(os.tmpdir(), `org-skill-${Date.now()}`);
    appendSkillInvocationEvent(
      buildCompletedInvocationEvent({
        skillId: "org-owner-skill",
        agentId: "bot-owner",
        tenantId: TENANT_A,
        outcome: "success",
        latencyMs: 40,
        failureCategory: null,
        runId: "run-fresh",
        taskId: "task-fresh",
        completedAt: Date.parse("2026-09-06T11:06:00.020Z"),
      }),
      configDir,
    );
    const adapter = createOrganizationAdapter(
      createMemoryOrganizationPort([
        {
          policy: policy(),
          tasks: [
            task({
              id: "task-fresh",
              title: "fresh-ok",
              status: "completed",
              createdAt: "2026-09-06T11:06:00.000Z",
              completedAt: "2026-09-06T11:06:00.040Z",
              tenantId: TENANT_A,
              runId: "run-fresh",
            }),
          ],
        },
      ]),
      { skillEventsConfigDir: configDir },
    );
    const measured = await adapter.observeTarget?.(
      { domain: "organization", groupId: GROUP_ID },
      "w",
      {
        windowId: "w",
        experimentId: "e",
        phase: "baseline",
        startedAt: "2026-09-06T11:05:00.000Z",
        endedAt: "2026-09-06T11:10:00.000Z",
        tenantScope: TENANT_A,
        targetKey: `organization:${GROUP_ID}`,
        modelRevision: "m",
        configRevision: "c",
        cohortRef: "co",
      },
    );
    expect(measured).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metricId: "first_delivery_pass_rate", sampleSize: 1 }),
        expect.objectContaining({ metricId: "security_violations", value: 0, sampleSize: 1 }),
        expect.objectContaining({
          metricId: "cross_tenant_contamination",
          value: 0,
          sampleSize: 1,
        }),
        expect.objectContaining({ metricId: "p95_latency", value: 40, sampleSize: 1 }),
      ]),
    );
  });
});
