import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { DEFAULT_WORKING_STYLE } from "../gateway/agent-growth/genome.js";
import { readRobotWorkingStyle } from "../gateway/agent-growth/working-style-store.js";
import { createWorkingDnaAdapter } from "../gateway/evolution-control/adapters/working-dna.js";
import { createEvolutionControlPlane } from "../gateway/evolution-control/control-plane.js";
import { testInspector, testObservation } from "../gateway/evolution-control/test-support.js";
import {
  createIsolatedWorkingDnaControl,
  workingDnaContentDigest,
} from "./action-intent-control.js";
import { inspectActionIntentRecovery } from "./action-intent-recovery.js";
import { createActionIntentStore } from "./action-intent-store.js";
import { createTestActionIntentFactory, type ApprovalEvidence } from "./action-intent.js";
const roots: string[] = [];
const now = Date.parse("2026-09-06T11:00:00Z");
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "intent-control-"));
  roots.push(root);
  const agentDir = path.join(root, "agent");
  const persistDir = path.join(root, "control");
  await fs.mkdir(agentDir);
  await fs.mkdir(persistDir);
  const cfg: OpenBotConfig = { agents: { list: [{ id: "bot", agentDir }] } };
  const adapter = createWorkingDnaAdapter(cfg, { persistDir: path.join(persistDir, "adapter") });
  const plane = createEvolutionControlPlane({
    inspector: testInspector("tenant"),
    workingDnaAdapter: adapter,
    observationProvider: testObservation(),
    persistDir,
    now: () => new Date(now).toISOString(),
  });
  plane.ingestV1(
    {
      schemaVersion: 1,
      proposalId: "proposal",
      sourceFindingIds: ["finding"],
      sourceEvidenceRefs: ["ev-a"],
      tenantScope: "tenant",
      targetDomain: "agent_working_dna",
      proposedChange: { summary: "injected test change" },
      expectedEffect: "injected hypothesis",
      riskLevel: "medium",
      confidentialityScope: "enterprise",
      status: "APPROVED",
      approvalRequired: true,
      approverScope: "enterprise",
      grantId: "grant-1",
      createdAt: "2026-09-06T10:00:00Z",
      expiresAt: "2026-09-06T12:00:00Z",
      auditReceipt: "test-audit",
      candidateRef: "candidate",
    },
    { agentId: "bot" },
  );
  plane.registerCandidate("candidate", {
    agentId: "bot",
    delta: { riskPreference: "conservative" },
    baselineStyle: DEFAULT_WORKING_STYLE,
    candidateVersion: "candidate",
  });
  const baseline = (await adapter.inspect({ domain: "agent", agentId: "bot" })).version;
  const experiment = await plane.startWorkingDnaExperiment({
    commandId: "experiment",
    proposalId: "proposal",
    now: new Date(now).toISOString(),
    freeze: {
      baselineVersion: baseline,
      candidateVersion: "candidate",
      codeSha: "injected-code",
      modelRef: "injected-model",
      providerVersion: "injected-provider",
      configSnapshotRef: "injected-config",
      datasetOrCohortRef: "cohort",
      tenantScope: "tenant",
      confidentialityScope: "enterprise",
      expiresAt: "2026-09-07T00:00:00Z",
      maxResourceBudget: 1,
    },
  });
  await plane.evaluateExperiment(experiment.experimentId);
  const intents = createTestActionIntentFactory();
  const intentStore = createActionIntentStore(path.join(root, "intents"));
  const scope = {
    kind: "enterprise",
    tenantId: "tenant",
    enterpriseDomainId: "domain",
    subjectRef: "subject:test-user",
    authzScopeRef: "auth",
  } as const;
  const target = {
    controlPlane: "evolution.working-dna",
    targetType: "agent",
    targetId: "bot",
    scopeRef: "tenant",
    expectedConfigVersion: baseline,
    diffDigest: workingDnaContentDigest({
      ...DEFAULT_WORKING_STYLE,
      riskPreference: "conservative",
    }),
    previewRef: "proposal",
    rollbackPointRef: "rollback:apply",
    rollbackExpectedVersion: baseline,
    rollbackDiffDigest: workingDnaContentDigest(DEFAULT_WORKING_STYLE),
  };
  let intent = intents.create(
    {
      actionIntentId: "intent",
      findingRef: { findingId: "finding", source: "rule_v1" },
      target,
      evidence: {
        sampleRefs: [
          {
            sampleId: "injected-sample",
            taskId: "injected-task",
            outcomeVersion: 1,
            agentId: "bot",
          },
        ],
        metricDictVersion: 1,
        metricId: "business.task_closed_success_rate",
        denominatorDefinition: "injected-current-tips",
        cohortRef: "cohort",
        window: { from: now - 100, to: now },
        eligibility: "eligible",
        improvementEligible: true,
        environment: "test",
        provenance: "injected",
        reasons: ["isolated_test_fixture"],
      },
    },
    now,
  );
  await intentStore.commit({
    scope,
    intent,
    expectedRevision: -1,
    commandId: "draft",
    requestDigest: "draft",
  });
  const preview = intents.transition(
    intent,
    { type: "preview" },
    { now, expectedRevision: intent.revision, approval: null },
  );
  if (!preview.ok) {
    throw new Error(preview.reason);
  }
  intent = preview.intent;
  await intentStore.commit({
    scope,
    intent,
    expectedRevision: 0,
    commandId: "preview",
    requestDigest: "preview",
  });
  let approval: ApprovalEvidence | null = {
    approvalId: "test-user-authorization",
    actorRef: "test-user",
    source: "user",
    intentRevision: intent.revision,
    target,
    issuedAt: now,
    expiresAt: now + 60000,
    revokedAt: null,
  };
  const authorized = intents.transition(
    intent,
    { type: "authorize", approval },
    { now, expectedRevision: intent.revision, approval },
  );
  if (!authorized.ok) {
    throw new Error(authorized.reason);
  }
  intent = authorized.intent;
  await intentStore.commit({
    scope,
    intent,
    expectedRevision: 1,
    commandId: "authorize",
    requestDigest: "authorize",
  });
  const args = {
    rootDir: root,
    cfg,
    agentId: "bot",
    tenantId: "tenant",
    proposalId: "proposal",
    experimentId: experiment.experimentId,
    persistDir,
    plane,
    adapter,
    intents,
    readApproval: () => approval,
    now: () => now,
  };
  const control = createIsolatedWorkingDnaControl(args);
  return {
    root,
    scope,
    intentStore,
    cfg,
    plane,
    adapter,
    intents,
    intent,
    control,
    args,
    setApproval: (a: ApprovalEvidence | null) => {
      approval = a;
    },
    approval,
  };
}
describe("read-only interrupted application recovery", () => {
  it("finds the original application after restart without replaying apply or granting restored authority", async () => {
    const x = await setup();
    const applied = await x.control.submit(x.intent, "apply");
    expect(applied.intent.state).toBe("executing");
    // Simulate interruption here: the real application is durable, its intent receipt is not committed.
    const restartedStore = createActionIntentStore(path.join(x.root, "intents"));
    const adapter = createWorkingDnaAdapter(x.cfg, {
      persistDir: path.join(x.args.persistDir, "adapter"),
    });
    const plane = createEvolutionControlPlane({
      inspector: testInspector("tenant"),
      workingDnaAdapter: adapter,
      observationProvider: testObservation(),
      persistDir: x.args.persistDir,
      now: () => new Date(now).toISOString(),
    });
    const restored = await restartedStore.detail(x.scope, "intent");
    expect(restored?.state).toBe("authorized");
    expect(restored?.receipts).toEqual([]);
    expect(x.intents.owns(restored!)).toBe(false);
    expect(createTestActionIntentFactory().owns(restored!)).toBe(false);
    const before = await readRobotWorkingStyle(x.cfg, "bot");
    const result = await inspectActionIntentRecovery(
      {
        scope: x.scope,
        intentId: "intent",
        commandId: "apply",
        proposalId: "proposal",
        experimentId: x.args.experimentId,
        agentId: "bot",
      },
      {
        store: restartedStore,
        plane,
        authorize: async () => true,
        readback: async () => ({
          actualVersion: (await adapter.inspect({ domain: "agent", agentId: "bot" })).version,
          actualDiffDigest: workingDnaContentDigest((await readRobotWorkingStyle(x.cfg, "bot"))!),
        }),
      },
    );
    expect(result.ok && "status" in result && result.status).toBe("applied_but_unrecorded");
    if (!result.ok || !("readbackMatches" in result)) {
      throw new Error("recovery_failed");
    }
    expect(result.readbackMatches).toBe(true);
    expect(result.automaticApply).toBe(false);
    expect(result.automaticAssociation).toBe(false);
    expect(result.executionAuthorityRestored).toBe(false);
    expect(result.doNotRetryApply).toBe(true);
    expect(plane.listApplications()).toHaveLength(1);
    expect(await readRobotWorkingStyle(x.cfg, "bot")).toEqual(before);
    expect((await restartedStore.detail(x.scope, "intent"))?.revision).toBe(2);
  });
  it("denies unauthorized inspection and never synthesizes missing applications", async () => {
    const x = await setup();
    const request = {
      scope: x.scope,
      intentId: "intent",
      commandId: "missing",
      proposalId: "proposal",
      experimentId: x.args.experimentId,
      agentId: "bot",
    };
    const ports = {
      store: x.intentStore,
      plane: x.plane,
      authorize: async () => false,
      readback: async () => ({ actualVersion: "none", actualDiffDigest: "none" }),
    };
    expect(await inspectActionIntentRecovery(request, ports)).toEqual({
      ok: false,
      reason: "unauthorized",
    });
    expect(
      await inspectActionIntentRecovery(request, { ...ports, authorize: async () => true }),
    ).toEqual({ ok: true, status: "application_missing", automaticApply: false });
    expect(x.plane.listApplications()).toEqual([]);
    expect(await readRobotWorkingStyle(x.cfg, "bot")).toBeNull();
  });
});
