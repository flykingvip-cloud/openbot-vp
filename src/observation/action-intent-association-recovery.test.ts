import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { DEFAULT_WORKING_STYLE } from "../gateway/agent-growth/genome.js";
import { readRobotWorkingStyle } from "../gateway/agent-growth/working-style-store.js";
import { createWorkingDnaAdapter } from "../gateway/evolution-control/adapters/working-dna.js";
import { createEvolutionControlPlane } from "../gateway/evolution-control/control-plane.js";
import { testInspector, testObservation } from "../gateway/evolution-control/test-support.js";
import {
  createAssociationRecoveryService,
  type AssociationRecoveryAuthorization,
} from "./action-intent-association-recovery.js";
import {
  createIsolatedWorkingDnaControl,
  workingDnaContentDigest,
} from "./action-intent-control.js";
import { createActionIntentStore } from "./action-intent-store.js";
import { createTestActionIntentFactory, type ApprovalEvidence } from "./action-intent.js";
const roots: string[] = [];
const now = Date.parse("2026-09-06T11:00:00Z");
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function setup() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
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
async function interrupted() {
  const x = await setup();
  const applied = await x.control.submit(x.intent, "apply");
  const store = createActionIntentStore(path.join(x.root, "intents"));
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
  const request = {
    intentId: "intent",
    expectedRevision: 2,
    originalCommandId: "apply",
    applicationId: "app:apply",
    proposalId: "proposal",
    experimentId: x.args.experimentId,
    agentId: "bot",
    recoveryCommandId: "recover",
  };
  let authorization: AssociationRecoveryAuthorization | null = {
    ...request,
    authorizationId: "explicit-recovery",
    actorRef: "test-user",
    action: "restore_association",
    scope: x.scope,
    actualVersion: applied.application.targetVersionAfter,
    actualDiffDigest: x.intent.target.diffDigest,
    issuedAt: now,
    expiresAt: now + 10000,
    revokedAt: null,
  };
  const ports = {
    store,
    plane,
    authorize: async () => authorization,
    readback: async () => ({
      actualVersion: (await adapter.inspect({ domain: "agent", agentId: "bot" })).version,
      actualDiffDigest: workingDnaContentDigest((await readRobotWorkingStyle(x.cfg, "bot"))!),
      observedAt: now,
    }),
    now: () => now,
  };
  return {
    ...x,
    request,
    ports,
    store,
    plane,
    setAuthorization: (value: AssociationRecoveryAuthorization | null) => {
      authorization = value;
    },
    authorization,
  };
}
describe("explicit association recovery", () => {
  it("preserves original application time after apply approval expires", async () => {
    const x = await interrupted();
    const later = now + 120000;
    const auth = { ...x.authorization, issuedAt: later, expiresAt: later + 10000 };
    x.setAuthorization(auth);
    const result = await createAssociationRecoveryService({
      ...x.ports,
      now: () => later,
      readback: async () => ({ ...(await x.ports.readback()), observedAt: later }),
    })(x.request);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.reason);
    }
    expect(result.intent.receipts.at(-1)?.at).toBe(
      Date.parse(x.plane.getApplication("app:apply")!.appliedAt!),
    );
    expect(result.intent.associationRecovery?.recoveredAt).toBe(later);
  });
  it("preserves an existing original command digest and rejects conflicting receipt history", async () => {
    const x = await interrupted();
    const current = (await x.store.detail(x.scope, "intent"))!;
    await x.store.commit({
      scope: x.scope,
      intent: {
        ...current,
        revision: 3,
        command: { commandId: "apply", idempotencyKey: "apply", requestDigest: "original-digest" },
      },
      expectedRevision: 2,
      commandId: "remember-command",
      requestDigest: "remember",
    });
    const request = { ...x.request, expectedRevision: 3 };
    x.setAuthorization({ ...x.authorization, ...request });
    const result = await createAssociationRecoveryService(x.ports)(request);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.reason);
    }
    expect(result.intent.command?.requestDigest).toBe("original-digest");
  });
  it("rejects conflicting original command receipt digests without overwriting history", async () => {
    const x = await interrupted();
    const current = (await x.store.detail(x.scope, "intent"))!;
    await x.store.commit({
      scope: x.scope,
      intent: {
        ...current,
        revision: 3,
        command: { commandId: "apply", idempotencyKey: "apply", requestDigest: "original-digest" },
        receipts: [
          {
            receiptId: "original",
            commandId: "apply",
            idempotencyKey: "apply",
            requestDigest: "conflicting-digest",
            intentRevision: current.authorizedRevision!,
            target: current.target,
            status: "accepted",
            at: now,
            actualVersion: null,
          },
        ],
      },
      expectedRevision: 2,
      commandId: "remember",
      requestDigest: "remember",
    });
    const request = { ...x.request, expectedRevision: 3 };
    x.setAuthorization({ ...x.authorization, ...request });
    const result = await createAssociationRecoveryService(x.ports)(request);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected_conflict");
    }
    expect(result.reason).toBe("original_command_digest_conflict");
    expect((await x.store.detail(x.scope, "intent"))?.revision).toBe(3);
  });
  it("rechecks authorization during replay and does not skip changed application bindings", async () => {
    const x = await interrupted();
    expect((await createAssociationRecoveryService(x.ports)(x.request)).ok).toBe(true);
    let calls = 0;
    const revoked = await createAssociationRecoveryService({
      ...x.ports,
      authorize: async () => (++calls === 1 ? x.authorization : null),
    })(x.request);
    expect(revoked.ok).toBe(false);
    expect(calls).toBe(2);
    const plane = {
      ...x.plane,
      getApplication: () => ({ ...x.plane.getApplication("app:apply")!, proposalId: "wrong" }),
    };
    expect((await createAssociationRecoveryService({ ...x.ports, plane })(x.request)).ok).toBe(
      false,
    );
  });
  it("restores association after real restart without applying again or granting execution authority", async () => {
    const x = await interrupted();
    const before = await readRobotWorkingStyle(x.cfg, "bot");
    const service = createAssociationRecoveryService(x.ports);
    const restored = await service(x.request);
    expect(restored.ok).toBe(true);
    if (!restored.ok) {
      throw new Error(restored.reason);
    }
    expect(restored.intent.state).toBe("effective");
    expect(restored.intent.verification).toBeNull();
    expect(x.intents.owns(restored.intent)).toBe(false);
    expect(x.plane.listApplications()).toHaveLength(1);
    expect(await readRobotWorkingStyle(x.cfg, "bot")).toEqual(before);
    const replay = await service(x.request);
    expect(replay.ok && replay.replayed).toBe(true);
    expect((await x.store.detail(x.scope, "intent"))?.revision).toBe(3);
    x.setAuthorization({ ...x.authorization, authorizationId: "rebound" });
    const rebound = await service(x.request);
    expect(rebound.ok).toBe(false);
  });
  it("preserves the original application when revoked during readback or content mismatches", async () => {
    const x = await interrupted();
    const service = createAssociationRecoveryService({
      ...x.ports,
      readback: async () => {
        const r = await x.ports.readback();
        x.setAuthorization(null);
        return r;
      },
    });
    const result = await service(x.request);
    expect(result.ok).toBe(false);
    expect(result.status).toBe("applied_but_unrecorded");
    expect(result.doNotRetryApply).toBe(true);
    expect((await x.store.detail(x.scope, "intent"))?.revision).toBe(2);
    x.setAuthorization(x.authorization);
    const mismatch = await createAssociationRecoveryService({
      ...x.ports,
      readback: async () => ({
        actualVersion: "wrong",
        actualDiffDigest: "wrong",
        observedAt: now,
      }),
    })(x.request);
    expect(mismatch.ok).toBe(false);
  });
  it("rejects competing revision and preserves application on association commit failure", async () => {
    const x = await interrupted();
    const failStore = {
      detail: (...a: Parameters<typeof x.store.detail>) => x.store.detail(...a),
      commit: async () => {
        throw new Error("disk_failure");
      },
    };
    const result = await createAssociationRecoveryService({ ...x.ports, store: failStore })(
      x.request,
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe("applied_but_unrecorded");
    expect(result.doNotRetryApply).toBe(true);
    const service = createAssociationRecoveryService(x.ports);
    const results = await Promise.all([
      service(x.request),
      service({ ...x.request, recoveryCommandId: "other" }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(x.plane.listApplications()).toHaveLength(1);
  });
  it("isolates the authorization request from runtime mutation", async () => {
    const x = await interrupted();
    const r = await createAssociationRecoveryService({
      ...x.ports,
      authorize: async (input) => {
        Reflect.set(input, "agentId", "forged");
        return x.authorization;
      },
    })(x.request);
    expect(r.ok).toBe(true);
  });
  it("persists the actual readback observation time", async () => {
    const x = await interrupted();
    const r = await createAssociationRecoveryService({ ...x.ports, now: () => now + 100 })(
      x.request,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.intent.readback?.observedAt).toBe(now);
    }
  });
  it("blocks authorization revoked while commit waits for its lock", async () => {
    const x = await interrupted();
    const store = {
      ...x.store,
      commit: async (input: Parameters<typeof x.store.commit>[0]) => {
        x.setAuthorization(null);
        return x.store.commit(input);
      },
    };
    const r = await createAssociationRecoveryService({ ...x.ports, store })(x.request);
    expect(r.ok).toBe(false);
    expect((await x.store.detail(x.scope, "intent"))?.revision).toBe(2);
  });
  it("rechecks authorization after the final replay detail await", async () => {
    const x = await interrupted();
    expect((await createAssociationRecoveryService(x.ports)(x.request)).ok).toBe(true);
    let calls = 0;
    const store = {
      ...x.store,
      detail: async (...args: Parameters<typeof x.store.detail>) => {
        const row = await x.store.detail(...args);
        if (++calls === 2) {
          x.setAuthorization(null);
        }
        return row;
      },
    };
    const replay = await createAssociationRecoveryService({ ...x.ports, store })(x.request);
    expect(replay.ok).toBe(false);
  });
  it("assembles a trusted isolated recovery host using real restarted stores and no effect ports", async () => {
    const x = await interrupted();
    const realRoot = await fs.realpath(x.root);
    const temp = await fs.realpath(os.tmpdir());
    expect(path.relative(temp, realRoot).startsWith("..")).toBe(false);
    const apply = vi.spyOn(x.plane, "applyWorkingDna");
    const rollback = vi.spyOn(x.plane, "rollbackApplication");
    const store = createActionIntentStore(path.join(realRoot, "intents"));
    const authorizationLedger = new Map<string, AssociationRecoveryAuthorization>();
    const readback = vi.fn(async (agentId: string) => {
      expect(agentId).toBe("bot");
      const style = await readRobotWorkingStyle(x.cfg, agentId);
      if (!style) {
        throw new Error("style_missing");
      }
      return {
        actualVersion: (await x.adapter.inspect({ domain: "agent", agentId })).version,
        actualDiffDigest: workingDnaContentDigest(style),
        observedAt: now,
      };
    });
    // Host-only composition: request data cannot supply approval, scope, store or effects.
    const service = createAssociationRecoveryService({
      store,
      plane: {
        getApplication: x.plane.getApplication.bind(x.plane),
        getProposal: x.plane.getProposal.bind(x.plane),
      },
      authorize: async (request) => {
        const approval = authorizationLedger.get(request.recoveryCommandId);
        return approval ? structuredClone(approval) : null;
      },
      readback,
      now: () => now,
    });
    const before = await readRobotWorkingStyle(x.cfg, "bot");
    expect((await service(x.request)).ok).toBe(false);
    expect(readback).not.toHaveBeenCalled();
    authorizationLedger.set(x.request.recoveryCommandId, structuredClone(x.authorization));
    const restored = await service(x.request);
    expect(restored.ok).toBe(true);
    if (!restored.ok) {
      throw new Error(restored.reason);
    }
    expect(restored.executionAuthorityRestored).toBe(false);
    expect(restored.intent.state).toBe("effective");
    expect(restored.intent.verification).toBeNull();
    expect(x.intents.owns(restored.intent)).toBe(false);
    expect(
      (await createActionIntentStore(path.join(realRoot, "intents")).detail(x.scope, "intent"))
        ?.associationRecovery?.authorizationId,
    ).toBe(x.authorization.authorizationId);
    expect((await service(x.request)).ok).toBe(true);
    authorizationLedger.delete(x.request.recoveryCommandId);
    expect((await service(x.request)).ok).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
    expect(x.plane.listApplications()).toHaveLength(1);
    expect(await readRobotWorkingStyle(x.cfg, "bot")).toEqual(before);
  });
});
