import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { DEFAULT_WORKING_STYLE } from "../gateway/agent-growth/genome.js";
import {
  readRobotWorkingStyle,
  writeRobotWorkingStyle,
} from "../gateway/agent-growth/working-style-store.js";
import { createWorkingDnaAdapter } from "../gateway/evolution-control/adapters/working-dna.js";
import { createEvolutionControlPlane } from "../gateway/evolution-control/control-plane.js";
import { testInspector, testObservation } from "../gateway/evolution-control/test-support.js";
import {
  createIsolatedWorkingDnaControl,
  workingDnaContentDigest,
  IsolatedControlFailure,
} from "./action-intent-control.js";
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
  const preview = intents.transition(
    intent,
    { type: "preview" },
    { now, expectedRevision: intent.revision, approval: null },
  );
  if (!preview.ok) {
    throw new Error(preview.reason);
  }
  intent = preview.intent;
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
describe("isolated injected Working DNA action intent control", () => {
  it("uses real apply receipt then independent readback and rollback, never auto-verifies", async () => {
    const x = await setup();
    const applied = await x.control.submit(x.intent, "apply");
    expect(applied.intent.state).toBe("executing");
    expect(applied.intent.receipts.map((r) => r.status)).toEqual(["succeeded"]);
    expect((await readRobotWorkingStyle(x.cfg, "bot"))?.riskPreference).toBe("conservative");
    const replay = await x.control.submit(x.intent, "apply");
    expect(replay.application.applicationId).toBe(applied.application.applicationId);
    expect(x.plane.listApplications()).toHaveLength(1);
    const read = await x.control.readback(applied.intent, applied.application);
    expect(read.ok).toBe(true);
    if (!read.ok) {
      throw new Error(read.reason);
    }
    expect(read.intent.state).toBe("effective");
    expect(read.intent.verification).toBeNull();
    const rolled = await x.control.rollback(read.intent, applied.application, "rollback");
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) {
      throw new Error(rolled.reason);
    }
    expect(rolled.intent.state).toBe("rolled_back");
    expect((await readRobotWorkingStyle(x.cfg, "bot"))?.riskPreference).toBe(
      DEFAULT_WORKING_STYLE.riskPreference,
    );
  });
  it("preserves a real application when authorization is revoked after the original apply", async () => {
    const x = await setup();
    const original = x.plane.applyWorkingDna.bind(x.plane);
    let calls = 0;
    const plane = {
      ...x.plane,
      applyWorkingDna: async (...args: Parameters<typeof original>) => {
        calls++;
        const app = await original(...args);
        x.setApproval({ ...x.approval, revokedAt: now });
        return app;
      },
    };
    const control = createIsolatedWorkingDnaControl({ ...x.args, plane });
    const result = await control.submit(x.intent, "apply");
    expect(result.status).toBe("applied_but_unrecorded");
    if (result.status !== "applied_but_unrecorded") {
      throw new Error("expected_blocked");
    }
    expect(result.doNotRetry).toBe(true);
    expect(result.application.applicationId).toBe("app:apply");
    expect(result.intent.state).toBe("authorized");
    expect(result.intent.receipts).toEqual([]);
    expect((await readRobotWorkingStyle(x.cfg, "bot"))?.riskPreference).toBe("conservative");
    await expect(control.submit(x.intent, "apply")).rejects.toThrow("approval_invalid");
    expect(calls).toBe(1);
  });
  it("preserves original control failures as failed intent receipt evidence", async () => {
    const x = await setup();
    const plane = {
      ...x.plane,
      applyWorkingDna: async () => {
        throw new Error("original_control_rejected");
      },
    };
    const control = createIsolatedWorkingDnaControl({ ...x.args, plane });
    try {
      await control.submit(x.intent, "apply");
      throw new Error("expected_failure");
    } catch (error) {
      expect(error).toBeInstanceOf(IsolatedControlFailure);
      if (!(error instanceof IsolatedControlFailure)) {
        throw error;
      }
      expect(error.intent.state).toBe("failed");
      expect(error.receipt.status).toBe("failed");
      expect(error.application).toBeUndefined();
    }
    expect(await readRobotWorkingStyle(x.cfg, "bot")).toBeNull();
  });
  it("rechecks full approval after asynchronous rollback inspection", async () => {
    const x = await setup();
    const applied = await x.control.submit(x.intent, "apply");
    const read = await x.control.readback(applied.intent, applied.application);
    if (!read.ok) {
      throw new Error(read.reason);
    }
    const original = x.adapter.inspect.bind(x.adapter);
    const adapter = {
      ...x.adapter,
      inspect: async (...args: Parameters<typeof original>) => {
        const result = await original(...args);
        x.setApproval({ ...x.approval, revokedAt: now });
        return result;
      },
    };
    const control = createIsolatedWorkingDnaControl({ ...x.args, adapter });
    await expect(control.rollback(read.intent, applied.application, "rollback")).rejects.toThrow(
      "approval_invalid",
    );
    expect((await readRobotWorkingStyle(x.cfg, "bot"))?.riskPreference).toBe("conservative");
  });
  it("rejects stale versions and revoked approvals without creating applications", async () => {
    const x = await setup();
    await writeRobotWorkingStyle(x.cfg, "bot", {
      ...DEFAULT_WORKING_STYLE,
      reportingCadence: "milestone",
    });
    await expect(x.control.submit(x.intent, "apply")).rejects.toThrow("expected_version_conflict");
    expect(x.plane.listApplications()).toEqual([]);
    x.setApproval({ ...x.approval, revokedAt: now });
    await expect(x.control.submit(x.intent, "apply")).rejects.toThrow("approval_invalid");
    expect(x.plane.listApplications()).toEqual([]);
  });
  it("blocks forged environment provenance and shadow from effective", async () => {
    const x = await setup();
    await expect(x.control.submit(structuredClone(x.intent), "apply")).rejects.toThrow(
      "test_evidence_required",
    );
    const shadow = await x.control.submit(x.intent, "shadow", "shadow");
    expect(shadow.application.appliedToRuntime).toBe(false);
    await expect(x.control.readback(shadow.intent, shadow.application)).rejects.toThrow(
      "runtime_application_required",
    );
    expect(await readRobotWorkingStyle(x.cfg, "bot")).toBeNull();
  });
  it("retains executing state when independent content readback disagrees", async () => {
    const x = await setup();
    const applied = await x.control.submit(x.intent, "apply");
    const broken = createIsolatedWorkingDnaControl({
      ...x.args,
      readStyle: async () => DEFAULT_WORKING_STYLE,
    });
    const result = await broken.readback(applied.intent, applied.application);
    expect(result.ok).toBe(false);
    expect(result.intent.state).toBe("executing");
  });
  it("rejects rollback approval retargeting before any rollback write", async () => {
    const x = await setup();
    const applied = await x.control.submit(x.intent, "apply");
    const read = await x.control.readback(applied.intent, applied.application);
    if (!read.ok) {
      throw new Error(read.reason);
    }
    x.setApproval({ ...x.approval, target: { ...x.intent.target, targetId: "other" } });
    await expect(x.control.rollback(read.intent, applied.application, "rollback")).rejects.toThrow(
      "approval_invalid",
    );
    expect((await readRobotWorkingStyle(x.cfg, "bot"))?.riskPreference).toBe("conservative");
  });
  it("binds intent expected version despite a same-candidate write after inspect", async () => {
    const x = await setup();
    const original = x.plane.applyWorkingDna.bind(x.plane);
    const plane = {
      ...x.plane,
      applyWorkingDna: async (...args: Parameters<typeof original>) => {
        await writeRobotWorkingStyle(x.cfg, "bot", {
          ...DEFAULT_WORKING_STYLE,
          riskPreference: "conservative",
        });
        return original(...args);
      },
    };
    const control = createIsolatedWorkingDnaControl({ ...x.args, plane });
    await expect(control.submit(x.intent, "race")).rejects.toThrow("version_conflict");
    expect(x.plane.listApplications()).toHaveLength(0);
  });
});
