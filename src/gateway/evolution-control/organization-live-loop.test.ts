import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ledgerEventIsReceiptNotProof,
  organizationMetricSet,
  type EvolutionLedgerEventType,
} from "@openbot/evolution-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import {
  routingPolicyVersion,
  type OrganizationRoutingPolicy,
} from "../../organization/routing-policy.js";
import {
  createTaskAssignment,
  readManagedOrganizationTaskAssignments,
  transitionTaskAssignment,
  upsertManagedOrganizationTaskAssignment,
} from "../../organization/task-assignment.js";
import {
  appendSkillInvocationEvent,
  buildCompletedInvocationEvent,
} from "../skill-invocation/event-store.js";
import {
  createFileOrganizationPolicyPort,
  createOrganizationAdapter,
} from "./adapters/organization.js";
import { createWorkingDnaAdapter } from "./adapters/working-dna.js";
import { createEvolutionControlPlane } from "./control-plane.js";
import { createAdapterObservationProvider } from "./observation.js";
import { testInspector } from "./test-support.js";

const TENANT = "tenant-org-live";
const GROUP_ID = "group-org-live";
const OWNER = "bot-owner";
const CANARY_OWNER = "bot-canary";
const COHORT = "cohort-org-live";
const SAMPLE_SIZE = 20;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const SEED_POLICY: OrganizationRoutingPolicy = {
  groupId: GROUP_ID,
  revision: 1,
  strategyId: "discussion_driven",
  defaultOwnerAgentId: OWNER,
  memberIds: [OWNER, CANARY_OWNER],
};

/**
 * Organization longitudinal loop through the production task persist writer.
 *
 * Organization production loop on eligible data. External verification for
 * this surface is fail-closed unsupported, not a Working DNA fallback.
 */
describe("organization real longitudinal loop", () => {
  let tmpDir = "";
  let persistDir = "";
  let skillDir = "";
  let prevStateDir: string | undefined;
  let cfg: OpenBotConfig;

  beforeEach(async () => {
    prevStateDir = process.env.OPENBOT_STATE_DIR;
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-evo-org-live-"));
    persistDir = path.join(tmpDir, "control");
    skillDir = path.join(tmpDir, "skill-events");
    process.env.OPENBOT_STATE_DIR = path.join(tmpDir, "state");
    cfg = { agents: { list: [{ id: OWNER, agentDir: tmpDir }] } } as unknown as OpenBotConfig;
    await fs.mkdir(persistDir, { recursive: true });
    await fs.writeFile(
      path.join(persistDir, "organization-policies.json"),
      `${JSON.stringify({ [GROUP_ID]: SEED_POLICY })}\n`,
    );
  });

  afterEach(async () => {
    if (prevStateDir === undefined) {
      delete process.env.OPENBOT_STATE_DIR;
    } else {
      process.env.OPENBOT_STATE_DIR = prevStateDir;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function createPlane() {
    const organizationAdapter = createOrganizationAdapter(
      createFileOrganizationPolicyPort(path.join(persistDir, "organization-policies.json"), {
        skillEventsConfigDir: skillDir,
      }),
      { persistDir: path.join(persistDir, "adapters"), skillEventsConfigDir: skillDir },
    );
    const plane = createEvolutionControlPlane({
      persistDir,
      inspector: testInspector(TENANT),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      organizationAdapter,
      observationProvider: createAdapterObservationProvider({
        persistDir,
        resolveAdapter: (surfaceId) => {
          if (
            surfaceId !== "organization.task-routing" &&
            surfaceId !== "organization.team-composition"
          ) {
            throw new Error(`unexpected surface ${surfaceId}`);
          }
          return organizationAdapter;
        },
      }),
    });
    return { plane, organizationAdapter };
  }

  async function persistTerminalTask(input: {
    id: string;
    title: string;
    ownerAgentId: string;
    createdAt: string;
    completedAt: string;
    succeeded: boolean;
    runId: string;
  }) {
    const pending = createTaskAssignment({
      id: input.id,
      organizationId: GROUP_ID,
      title: input.title,
      ownerAgentId: input.ownerAgentId,
      createdByAgentId: input.ownerAgentId,
      now: input.createdAt,
      tenantId: TENANT,
      runId: input.runId,
      ackRequired: false,
    });
    const terminal = transitionTaskAssignment(pending, input.succeeded ? "completed" : "rejected", {
      now: input.completedAt,
    });
    const stamped = await upsertManagedOrganizationTaskAssignment(terminal, { persistDir });
    appendSkillInvocationEvent(
      buildCompletedInvocationEvent({
        skillId: "org-owner-skill",
        agentId: stamped.ownerAgentId,
        tenantId: TENANT,
        outcome: input.succeeded ? "success" : "failure",
        latencyMs: 40,
        failureCategory: null,
        runId: stamped.runId,
        taskId: stamped.id,
        completedAt: Date.parse(input.completedAt),
      }),
      skillDir,
    );
    return stamped;
  }

  it("does not import fixtures or stamp a passed drill", () => {
    const text = readFileSync(fileURLToPath(import.meta.url), "utf8");
    expect(text).not.toMatch(/import\s*\{[^}]*createPassingObservationProvider/);
    expect(text).not.toMatch(/createPassingObservationProvider\s*\(/);
    expect(text).not.toMatch(/assessmentMode\s*[:=]\s*["']deterministic-fixture["']/);
    expect(text).not.toMatch(/\btestObservation\s*\(/);
    expect(text).not.toMatch(/rollbackDrill\s*[:=]\s*["']passed["']/);
    expect(text).not.toMatch(/bindOrganizationTaskRecord\s*\(/);
  });

  it("does not freeze a baseline when completed tasks lack owner-skill events", async () => {
    const baselineStartMs = Date.now() - 90_000;
    for (let i = 0; i < SAMPLE_SIZE; i += 1) {
      const createdAt = new Date(baselineStartMs + i * 2_000).toISOString();
      const completedAt = new Date(baselineStartMs + i * 2_000 + 40).toISOString();
      const pending = createTaskAssignment({
        id: `task-bare-${i}`,
        organizationId: GROUP_ID,
        title: `bare ${i}`,
        ownerAgentId: OWNER,
        createdByAgentId: OWNER,
        now: createdAt,
        tenantId: TENANT,
        runId: `run-bare-${i}`,
        ackRequired: false,
      });
      await upsertManagedOrganizationTaskAssignment(
        transitionTaskAssignment(pending, i % 2 === 0 ? "completed" : "rejected", {
          now: completedAt,
        }),
      );
    }
    const { plane } = createPlane();
    plane.registerProposal(
      {
        schemaVersion: 2,
        proposalId: "evo:org-bare",
        sourceEvidenceRefs: ["ev-a"],
        sourceMechanismRef: "case-org",
        target: { domain: "organization", groupId: GROUP_ID },
        candidateRef: "cand:org-bare",
        surfaceId: "organization.task-routing",
        expectedEffects: [organizationMetricSet().primary],
        riskLevel: "medium",
        confidentialityScope: "enterprise",
        tenantScope: TENANT,
        grantId: "grant-1",
        status: "APPROVED_FOR_EXPERIMENT",
        createdAt: "2026-09-06T10:00:00.000Z",
        expiresAt: "2026-09-07T00:00:00.000Z",
      },
      {
        groupId: GROUP_ID,
        kind: "task-routing",
        strategyId: "task_driven",
        defaultOwnerAgentId: CANARY_OWNER,
        candidateVersion: "cand:org-bare",
      },
    );
    const experiment = await plane.startExperiment({
      commandId: "exp-org-bare",
      proposalId: "evo:org-bare",
      now: new Date(baselineStartMs + SAMPLE_SIZE * 2_000).toISOString(),
      freeze: {
        baselineVersion: routingPolicyVersion(SEED_POLICY),
        candidateVersion: "cand:org-bare",
        codeSha: "sha-org-bare",
        modelRef: "model-org",
        providerVersion: "provider-org",
        configSnapshotRef: "cfg-org",
        datasetOrCohortRef: COHORT,
        tenantScope: TENANT,
        confidentialityScope: "enterprise",
        expiresAt: "2026-09-07T00:00:00.000Z",
        maxResourceBudget: 1,
      },
    });
    expect(experiment.baselineCapture?.status).toBe("incomplete");
    expect(experiment.baselineCapture?.missingCriticalGuardrails).toEqual(
      expect.arrayContaining(["security_violations", "cross_tenant_contamination"]),
    );
  });

  it("runs persist → baseline → canary → treatment → drill → re-apply → verify → promote → restart", async () => {
    const baselineStartMs = Date.now() - 90_000;
    for (let i = 0; i < SAMPLE_SIZE; i += 1) {
      await persistTerminalTask({
        id: `task-base-${i}`,
        title: `baseline ${i}`,
        ownerAgentId: OWNER,
        createdAt: new Date(baselineStartMs + i * 2_000).toISOString(),
        completedAt: new Date(baselineStartMs + i * 2_000 + 40).toISOString(),
        succeeded: i % 2 === 0,
        runId: `run-base-${i}`,
      });
    }

    const { plane } = createPlane();
    plane.registerProposal(
      {
        schemaVersion: 2,
        proposalId: "evo:org-live",
        sourceEvidenceRefs: ["ev-a"],
        sourceMechanismRef: "case-org",
        target: { domain: "organization", groupId: GROUP_ID },
        candidateRef: "cand:org-live",
        surfaceId: "organization.task-routing",
        expectedEffects: [organizationMetricSet().primary],
        riskLevel: "medium",
        confidentialityScope: "enterprise",
        tenantScope: TENANT,
        grantId: "grant-1",
        status: "APPROVED_FOR_EXPERIMENT",
        createdAt: "2026-09-06T10:00:00.000Z",
        expiresAt: "2026-09-07T00:00:00.000Z",
      },
      {
        groupId: GROUP_ID,
        kind: "task-routing",
        strategyId: "task_driven",
        defaultOwnerAgentId: CANARY_OWNER,
        candidateVersion: "cand:org-live",
      },
    );
    const experiment = await plane.startExperiment({
      commandId: "exp-org-live",
      proposalId: "evo:org-live",
      now: new Date(baselineStartMs + SAMPLE_SIZE * 2_000).toISOString(),
      freeze: {
        baselineVersion: routingPolicyVersion(SEED_POLICY),
        candidateVersion: "cand:org-live",
        codeSha: "sha-org-live",
        modelRef: "model-org",
        providerVersion: "provider-org",
        configSnapshotRef: "cfg-org",
        datasetOrCohortRef: COHORT,
        tenantScope: TENANT,
        confidentialityScope: "enterprise",
        expiresAt: "2026-09-07T00:00:00.000Z",
        maxResourceBudget: 1,
      },
    });
    expect(experiment.baselineCapture?.status).toBe("frozen");
    expect(experiment.baselineCapture?.primaryPresent).toBe(true);
    expect(experiment.baselineCapture?.missingCriticalGuardrails).toEqual([]);

    const applicationA = await plane.applyOrganization({
      commandId: "apply-org-live-a",
      proposalId: "evo:org-live",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
      scope: "canary",
    });
    expect(applicationA.purpose).toBe("canary");
    expect(applicationA.appliedToRuntime).toBe(true);
    const afterA = JSON.parse(
      await fs.readFile(path.join(persistDir, "organization-policies.json"), "utf8"),
    ) as Record<string, OrganizationRoutingPolicy>;
    expect(afterA[GROUP_ID]?.defaultOwnerAgentId).toBe(CANARY_OWNER);

    const appliedAAt = Date.parse(applicationA.appliedAt ?? "") || Date.now();
    for (let i = 0; i < SAMPLE_SIZE; i += 1) {
      const completedMs = Date.now();
      const createdMs = Math.max(appliedAAt, completedMs - 40);
      const stamped = await persistTerminalTask({
        id: `task-treat-a-${i}`,
        title: `treatment a ${i}`,
        ownerAgentId: CANARY_OWNER,
        createdAt: new Date(createdMs).toISOString(),
        completedAt: new Date(completedMs).toISOString(),
        succeeded: true,
        runId: `run-treat-a-${i}`,
      });
      expect(stamped.experimentId).toBe(experiment.experimentId);
      expect(stamped.applicationId).toBe(applicationA.applicationId);
      expect(stamped.cohortRef).toBe(COHORT);
    }

    const evaluated = await plane.evaluateExperiment(experiment.experimentId);
    expect(evaluated.decision.assessment.method).toBe("two-proportion-z");
    expect(evaluated.decision.primaryEffect).toBeGreaterThan(0);
    expect(evaluated.decision.reasons).toContain("rollback_drill_not_run");

    const drill = await plane.runRollbackDrill({
      commandId: "drill-org-live-a",
      applicationId: applicationA.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
      verifiedBy: "ent-admin",
      evidenceRefs: ["ev-org-drill"],
    });
    expect(drill.result).toBe("passed");
    expect(drill.restoredVersion).toBe(applicationA.targetVersionBefore);
    const restored = JSON.parse(
      await fs.readFile(path.join(persistDir, "organization-policies.json"), "utf8"),
    ) as Record<string, OrganizationRoutingPolicy>;
    expect(restored[GROUP_ID]?.defaultOwnerAgentId).toBe(OWNER);
    expect(routingPolicyVersion(restored[GROUP_ID])).toBe(applicationA.targetVersionBefore);
    expect(plane.getProposal("evo:org-live")?.status).toBe("EXPERIMENTING");

    const applicationB = await plane.applyOrganization({
      commandId: "apply-org-live-b",
      proposalId: "evo:org-live",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
      scope: "canary",
    });
    expect(applicationB.applicationId).not.toBe(applicationA.applicationId);
    expect(applicationB.idempotencyKey).not.toBe(applicationA.idempotencyKey);

    const appliedBAt = Date.parse(applicationB.appliedAt ?? "") || Date.now();
    for (let i = 0; i < SAMPLE_SIZE; i += 1) {
      const completedMs = Date.now();
      const createdMs = Math.max(appliedBAt, completedMs - 40);
      const stamped = await persistTerminalTask({
        id: `task-treat-b-${i}`,
        title: `treatment b ${i}`,
        ownerAgentId: CANARY_OWNER,
        createdAt: new Date(createdMs).toISOString(),
        completedAt: new Date(completedMs).toISOString(),
        succeeded: true,
        runId: `run-treat-b-${i}`,
      });
      expect(stamped.experimentId).toBe(experiment.experimentId);
      expect(stamped.applicationId).toBe(applicationB.applicationId);
      expect(stamped.applicationId).not.toBe(applicationA.applicationId);
    }
    const storedB = (await readManagedOrganizationTaskAssignments(GROUP_ID)).filter((row) =>
      row.id.startsWith("task-treat-b-"),
    );
    expect(storedB).toHaveLength(SAMPLE_SIZE);
    expect(
      storedB.every(
        (row) =>
          row.experimentId === experiment.experimentId &&
          row.applicationId === applicationB.applicationId,
      ),
    ).toBe(true);

    const verification = await plane.verifyApplication({
      commandId: "verify-org-live-b",
      applicationId: applicationB.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
    });
    expect(verification.applicationId).toBe(applicationB.applicationId);
    expect(verification.outcome).toBe("improved");
    expect(verification.assessment?.method).toBe("two-proportion-z");
    expect(plane.getProposal("evo:org-live")?.status).toBe("VERIFIED");

    const promoted = plane.promoteProposal({
      commandId: "promote-org-live",
      proposalId: "evo:org-live",
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
    });
    expect(promoted.status).toBe("PROMOTED");
    expect(plane.getApplication(applicationB.applicationId)?.purpose).toBe("promoted");
    expect(plane.getApplication(applicationA.applicationId)?.purpose).toBe("canary");

    const { plane: restarted } = createPlane();
    expect(restarted.getProposal("evo:org-live")?.status).toBe("PROMOTED");
    expect(restarted.getApplication(applicationA.applicationId)?.status).toBe("rolled_back");
    expect(restarted.getApplication(applicationB.applicationId)?.purpose).toBe("promoted");
    expect(restarted.getVerification(verification.verificationId)?.outcome).toBe("improved");
    expect(restarted.getRollbackDrill(drill.drillId)?.result).toBe("passed");
    const types = restarted.ledger.replay("evo:org-live").map((row) => row.type);
    const required: EvolutionLedgerEventType[] = [
      "experiment.started",
      "application.applied",
      "rollback_drill.started",
      "rollback_drill.completed",
      "application.rolled_back",
      "application.applied",
      "verification.completed",
      "promotion.completed",
    ];
    let cursor = -1;
    for (const type of required) {
      const next = types.indexOf(type, cursor + 1);
      expect(next, `missing ledger ${type}`).toBeGreaterThan(cursor);
      cursor = next;
    }
    expect(types.filter((type) => type === "application.applied")).toHaveLength(2);
    expect(ledgerEventIsReceiptNotProof("rollback_drill.completed")).toBe(true);
    expect(ledgerEventIsReceiptNotProof("application.rolled_back")).toBe(true);
    expect(ledgerEventIsReceiptNotProof("verification.completed")).toBe(false);
    expect(ledgerEventIsReceiptNotProof("promotion.completed")).toBe(false);
  });

  it("keeps Capsule and the generic verifier honestly unfinished", () => {
    expect(
      readFileSync(
        path.join(ROOT, "src/gateway/evolution-control/adapters/runtime-governance.ts"),
        "utf8",
      ),
    ).toMatch(/governance_human_intervention_rate/);
    expect(
      readFileSync(path.join(ROOT, "src/gateway/evolution-control/adapters/capsule.ts"), "utf8"),
    ).toMatch(/without failureClusterRef cannot compute recurrence/);
    expect(
      readFileSync(path.join(ROOT, "src/infra/execution-chain-provenance.ts"), "utf8"),
    ).toMatch(/Generic production verification is not implemented/);
  });
});
