import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GroupMemoryCapsule } from "@openbot/collaboration-core";
import {
  canApproveApplication,
  organizationMetricSet,
  runtimeGovernanceMetricSet,
} from "@openbot/evolution-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import {
  createFailClosedExternalEffectVerifier,
  turnSecurityFromProvenance,
} from "../../infra/execution-chain-provenance.js";
import type { TaskAssignment } from "../../organization/task-assignment.js";
import { deriveCapsuleClusterRecurrences } from "./adapters/capsule.js";
import {
  createMemoryOrganizationPort,
  createOrganizationAdapter,
} from "./adapters/organization.js";
import {
  createMemoryRuntimeGovernancePort,
  createRuntimeGovernanceAdapter,
} from "./adapters/runtime-governance.js";
import { createWorkingDnaAdapter } from "./adapters/working-dna.js";
import { createEvolutionControlPlane } from "./control-plane.js";
import { createAdapterObservationProvider } from "./observation.js";
import { testInspector } from "./test-support.js";

const TENANT = "tenant-missing-sensors";
const GROUP_ID = "group-missing-org";
const RUNTIME_ID = "bot-runtime-missing";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function cfg(): OpenBotConfig {
  return { agents: { list: [{ id: "unused", agentDir: "/tmp" }] } } as unknown as OpenBotConfig;
}

function completedTask(over: Partial<TaskAssignment> = {}): TaskAssignment {
  return {
    id: "task-no-skill",
    organizationId: GROUP_ID,
    title: "Weekly brief",
    ownerAgentId: "bot-owner",
    createdByAgentId: "bot-owner",
    status: "completed",
    createdAt: "2026-09-06T10:00:00.000Z",
    updatedAt: "2026-09-06T10:05:00.000Z",
    completedAt: "2026-09-06T10:05:00.000Z",
    ackRequired: false,
    tenantId: TENANT,
    cohortRef: "cohort-org",
    ...over,
  };
}

describe("missing production sensors stay fail-closed", () => {
  let tmpDir = "";

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-evo-missing-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("does not use passing fixtures or invented zeros", () => {
    const text = readFileSync(fileURLToPath(import.meta.url), "utf8");
    expect(text).not.toMatch(/createPassingObservationProvider\s*\(/);
    expect(text).not.toMatch(/\btestObservation\s*\(/);
    expect(text).not.toMatch(/rollbackDrill\s*[:=]\s*["']passed["']/);
  });

  it("Organization without owner-skill sensors leaves criticals unset and blocks canary", async () => {
    const persistDir = path.join(tmpDir, "org");
    const orgAdapter = createOrganizationAdapter(
      createMemoryOrganizationPort([
        {
          policy: {
            groupId: GROUP_ID,
            revision: 1,
            strategyId: "discussion_driven",
            defaultOwnerAgentId: "bot-owner",
            memberIds: ["bot-owner"],
          },
          tasks: [completedTask()],
        },
      ]),
    );
    const plane = createEvolutionControlPlane({
      persistDir,
      inspector: testInspector(TENANT),
      workingDnaAdapter: createWorkingDnaAdapter(cfg()),
      organizationAdapter: orgAdapter,
      observationProvider: createAdapterObservationProvider({
        persistDir,
        resolveAdapter: (surfaceId) => {
          if (surfaceId !== "organization.task-routing") {
            throw new Error(`unexpected surface ${surfaceId}`);
          }
          return orgAdapter;
        },
      }),
      now: () => "2026-09-06T11:00:00.000Z",
    });
    plane.registerProposal(
      {
        schemaVersion: 2,
        proposalId: "evo:org-missing",
        sourceEvidenceRefs: ["ev-a"],
        sourceMechanismRef: "case-org",
        target: { domain: "organization", groupId: GROUP_ID },
        candidateRef: "cand:org-missing",
        surfaceId: "organization.task-routing",
        expectedEffects: [organizationMetricSet().primary],
        riskLevel: "high",
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
        defaultOwnerAgentId: "bot-canary",
        candidateVersion: "cand:org-missing",
      },
    );
    const experiment = await plane.startExperiment({
      commandId: "exp-org-missing",
      proposalId: "evo:org-missing",
      now: "2026-09-06T11:00:00.000Z",
      freeze: {
        baselineVersion: "org:v1",
        candidateVersion: "cand:org-missing",
        codeSha: "sha-org",
        modelRef: "model-org",
        providerVersion: "provider-org",
        configSnapshotRef: "cfg-org",
        datasetOrCohortRef: "cohort-org",
        tenantScope: TENANT,
        confidentialityScope: "enterprise",
        expiresAt: "2026-09-07T00:00:00.000Z",
        maxResourceBudget: 1,
      },
    });
    expect(experiment.baselineCapture?.status).toBe("incomplete");
    expect(experiment.baselineCapture?.primaryPresent).toBe(true);
    expect(experiment.baselineCapture?.missingCriticalGuardrails).toEqual(
      expect.arrayContaining(["security_violations", "cross_tenant_contamination"]),
    );
    const orgWindow = experiment.baselineCapture?.window;
    expect(orgWindow).toBeDefined();
    const observed = await orgAdapter.observeTarget?.(
      { domain: "organization", groupId: GROUP_ID },
      "w",
      orgWindow,
    );
    expect(observed?.some((row) => row.metricId === "first_delivery_pass_rate")).toBe(true);
    expect(observed?.find((row) => row.metricId === "security_violations")).toBeUndefined();
    expect(observed?.find((row) => row.metricId === "cross_tenant_contamination")).toBeUndefined();
    expect(observed?.some((row) => row.metricId === "security_violations" && row.value === 0)).toBe(
      false,
    );
    await expect(
      plane.applyOrganization({
        commandId: "apply-org-missing",
        proposalId: "evo:org-missing",
        experimentId: experiment.experimentId,
        principalRef: "ent-admin",
        trustedTenantId: TENANT,
        scope: "canary",
      }),
    ).rejects.toThrow(/frozen baseline|incomplete/);
  });

  it("Runtime without effectVerifications leaves primary missing and stays inconclusive", async () => {
    const persistDir = path.join(tmpDir, "runtime");
    const runtimeAdapter = createRuntimeGovernanceAdapter(
      createMemoryRuntimeGovernancePort({
        mode: "assist",
        agents: [
          {
            runtimeAgentId: RUNTIME_ID,
            version: "seed",
            bindings: [{ bindingId: "bind-1", state: "active" }],
          },
        ],
      }),
    );
    const plane = createEvolutionControlPlane({
      persistDir,
      inspector: testInspector(TENANT),
      workingDnaAdapter: createWorkingDnaAdapter(cfg()),
      runtimeGovernanceAdapter: runtimeAdapter,
      observationProvider: createAdapterObservationProvider({
        persistDir,
        resolveAdapter: (surfaceId) => {
          if (surfaceId !== "system.runtime-binding-governance") {
            throw new Error(`unexpected surface ${surfaceId}`);
          }
          return runtimeAdapter;
        },
      }),
      now: () => "2026-09-06T11:00:00.000Z",
    });
    plane.registerProposal(
      {
        schemaVersion: 2,
        proposalId: "evo:runtime-missing",
        sourceEvidenceRefs: ["ev-a"],
        sourceMechanismRef: "case-runtime",
        target: { domain: "system", componentId: RUNTIME_ID },
        candidateRef: "cand:runtime-missing",
        surfaceId: "system.runtime-binding-governance",
        expectedEffects: [runtimeGovernanceMetricSet().primary],
        riskLevel: "critical",
        confidentialityScope: "enterprise",
        tenantScope: TENANT,
        grantId: "grant-1",
        status: "APPROVED_FOR_EXPERIMENT",
        createdAt: "2026-09-06T10:00:00.000Z",
        expiresAt: "2026-09-07T00:00:00.000Z",
      },
      {
        kind: "runtime-action",
        runtimeAgentId: RUNTIME_ID,
        action: "pause",
        candidateVersion: "cand:runtime-missing",
      },
    );
    const experiment = await plane.startExperiment({
      commandId: "exp-runtime-missing",
      proposalId: "evo:runtime-missing",
      now: "2026-09-06T09:00:00.000Z",
      freeze: {
        baselineVersion: "runtime:v1",
        candidateVersion: "cand:runtime-missing",
        codeSha: "sha-runtime",
        modelRef: "model-runtime",
        providerVersion: "provider-runtime",
        configSnapshotRef: "cfg-runtime",
        datasetOrCohortRef: "cohort-runtime",
        tenantScope: TENANT,
        confidentialityScope: "enterprise",
        expiresAt: "2026-09-07T00:00:00.000Z",
        maxResourceBudget: 1,
      },
    });
    expect(experiment.baselineCapture?.status).toBe("missing");
    expect(experiment.baselineCapture?.primaryPresent).toBe(false);
    const observed = await runtimeAdapter.observeTarget?.(
      { domain: "system", componentId: RUNTIME_ID },
      "w",
      experiment.baselineCapture?.window ?? {
        windowId: "w",
        experimentId: experiment.experimentId,
        phase: "baseline",
        startedAt: "2026-09-06T09:00:00.000Z",
        endedAt: "2026-09-06T11:00:00.000Z",
        tenantScope: TENANT,
        targetKey: `system:${RUNTIME_ID}`,
        modelRevision: "model-runtime",
        configRevision: "cfg-runtime",
        cohortRef: "cohort-runtime",
      },
    );
    expect(observed).toEqual([]);
    expect(
      observed?.some(
        (row) => row.metricId === "governance_human_intervention_rate" && row.value === 0,
      ),
    ).toBe(false);
    const evaluated = await plane.evaluateExperiment(experiment.experimentId);
    expect(evaluated.decision.result).toBe("inconclusive");
    expect(evaluated.decision.reasons).not.toContain("offline_deterministic_contract");
    const canary = canApproveApplication(experiment, undefined, "canary");
    expect(canary.ok).toBe(false);
    if (!canary.ok) {
      expect(canary.code).toBe("baseline_missing");
    }
    await expect(
      plane.applyRuntimeGovernance({
        commandId: "apply-runtime-missing",
        proposalId: "evo:runtime-missing",
        experimentId: experiment.experimentId,
        principalRef: "ent-admin",
        trustedTenantId: TENANT,
        scope: "canary",
      }),
    ).rejects.toThrow();
  });

  it("Capsule legacy rows without failureClusterRef do not invent same-cluster recurrence", () => {
    const original: GroupMemoryCapsule = {
      capsuleId: "cap-legacy",
      groupId: "group-legacy",
      capsuleType: "lesson",
      status: "candidate",
      reusability: "group_only",
      sensitivity: "internal",
      createdBy: "bot-reviewer",
      createdAt: 1,
      updatedAt: 1,
      summary: "legacy timeout",
      sourceType: "task",
      sourceIds: ["finding-1"],
    };
    const later: GroupMemoryCapsule = {
      ...original,
      capsuleId: "cap-later",
      capsuleType: "anti_pattern",
      createdAt: 2,
      updatedAt: 2,
    };
    expect(deriveCapsuleClusterRecurrences([original, later], "cap-legacy")).toEqual([]);
    const stamped = readFileSync(
      path.join(ROOT, "src/gateway/collaboration-learning/execution-outcome-capsule.ts"),
      "utf8",
    );
    const review = readFileSync(
      path.join(ROOT, "src/gateway/collaboration-learning/review-outcome-capsule.ts"),
      "utf8",
    );
    expect(stamped).not.toMatch(/task:\$\{/);
    expect(stamped).toMatch(/nativeMechanismClusterMetadata/);
    expect(stamped).not.toMatch(/clusterProvenance: "native"/);
    expect(review).not.toMatch(/task:\$\{/);
    expect(review).toMatch(/nativeMechanismClusterMetadata/);
    expect(review).not.toMatch(/clusterProvenance: "native"/);
    expect(
      readFileSync(path.join(ROOT, "src/gateway/evolution-control/adapters/capsule.ts"), "utf8"),
    ).toMatch(/without failureClusterRef cannot compute recurrence/);
  });

  it("unconfigured external verifier keeps applied and suspected bypass fail-closed", () => {
    const verifier = createFailClosedExternalEffectVerifier();
    expect(verifier.verify({ effectObserved: "applied" })).toBe("applied");
    expect(verifier.verify({ effectObserved: "applied", receiptRef: "receipt-1" })).toBe("applied");
    expect(verifier.verify({ effectObserved: "verified", receiptRef: "receipt-1" })).toBe(
      "unknown",
    );
    const suspected = turnSecurityFromProvenance([
      {
        kind: "mutation_attempt",
        tool: "write",
        tool_call_id: "tc-1",
        session_id: "sess-1",
        session_key: "agent:main:main",
        run_id: "run-1",
        resource: "notes.md",
        policy: {
          owner: "workspace-root-guard",
          decision: "denied",
          reason: "sandbox_boundary",
        },
        authorization: { decision: "unknown" },
        approval: { decision: "not_observed" },
        result: "success",
        effectObserved: "applied",
      },
    ]);
    expect(suspected).toEqual({
      securityAttempt: true,
      securityControlDenied: true,
      suspectedAuthorizationBypass: true,
    });
    expect(suspected.securityViolation).toBeUndefined();
  });
});
