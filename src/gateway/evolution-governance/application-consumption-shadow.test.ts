import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthorityGrantView } from "@openbot/evolution-core";
import type {
  EvolutionApplication,
  EvolutionExperiment,
  EvolutionProposal,
} from "@openbot/evolution-core";
import {
  hashConsumptionCandidatePayload,
  type ControlPlaneConsumptionBinding,
} from "@openbot/evolution-core";
import { describe, expect, it } from "vitest";
import {
  listControlPlaneApplicationConsumptions,
  observeA9M1Shadow,
  observeRuntimeAutoConsumption,
  observeSkillAutoConsumption,
  readSingleTrackCutoverReadiness,
  recoverPersistedShadowStoreHealth,
  resetControlPlaneApplicationConsumptionForTests,
  resolveServerAdmin,
  discardInMemoryShadowStoreHealthForTests,
} from "./application-consumption-shadow.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e5.1-consumption-"));

function binding(): ControlPlaneConsumptionBinding {
  const grant: AuthorityGrantView = {
    grantId: "grant-1",
    status: "APPROVED",
    tenantScope: "tenant-a",
    allowedEvidence: [],
    allowedActions: ["pause"],
    confidentialityCeiling: "enterprise",
  };
  const proposal: EvolutionProposal = {
    schemaVersion: 2,
    proposalId: "evo:rt",
    sourceEvidenceRefs: ["ev"],
    sourceMechanismRef: "case",
    target: { domain: "system", componentId: "bot-a" },
    candidateRef: "cand:v2",
    surfaceId: "system.runtime-binding-governance",
    expectedEffects: [],
    riskLevel: "critical",
    confidentialityScope: "platform",
    tenantScope: "tenant-a",
    grantId: "grant-1",
    status: "APPROVED_FOR_APPLICATION",
    createdAt: "2026-09-22T00:00:00.000Z",
    expiresAt: "2026-09-23T00:00:00.000Z",
    experimentId: "exp:rt",
    applicationId: "app:rt",
  };
  const experiment: EvolutionExperiment = {
    schemaVersion: 1,
    experimentId: "exp:rt",
    proposalId: "evo:rt",
    surfaceId: "system.runtime-binding-governance",
    target: { domain: "system", componentId: "bot-a" },
    tenantScope: "tenant-a",
    baselineRef: "base-v1",
    candidateRef: "cand:v2",
    configRef: "cfg",
    assignment: { strategy: "canary", treatmentRefs: ["t"], controlRefs: ["c"] },
    primaryMetric: {
      metricId: "health",
      kind: "primary",
      improveWhen: "increase",
      minimumEffect: 0,
    },
    guardrailMetrics: [],
    minimumSampleSize: 1,
    requiredConfidence: 0.9,
    expiresAt: "2026-09-23T00:00:00.000Z",
    result: "improved",
    frozen: {
      baselineVersion: "base-v1",
      candidateVersion: "cand:v2",
      codeSha: "sha",
      modelRef: "model",
      providerVersion: "p1",
      configSnapshotRef: "cfg",
      datasetOrCohortRef: "cohort",
      tenantScope: "tenant-a",
      confidentialityScope: "platform",
      expiresAt: "2026-09-23T00:00:00.000Z",
      maxResourceBudget: 1,
    },
  };
  const application: EvolutionApplication = {
    schemaVersion: 1,
    applicationId: "app:rt",
    proposalId: "evo:rt",
    experimentId: "exp:rt",
    adapterId: "runtime-governance",
    idempotencyKey: "pause:bot-a",
    targetVersionBefore: "base-v1",
    targetVersionAfter: "cand:v2",
    rollbackRef: "rollback:pause:bot-a",
    scope: "canary",
    status: "pending",
    appliedToRuntime: false,
  };
  return {
    proposal,
    experiment,
    application,
    grant,
    trustedTenantId: "tenant-a",
    mode: "auto",
    killSwitch: false,
    now: "2026-09-22T00:00:00.000Z",
    storedCandidate: {
      candidateRef: "cand:v2",
      version: "cand:v2",
      payloadHash: hashConsumptionCandidatePayload({
        action: "pause",
        runtimeAgentId: "bot-a",
        candidateVersion: "cand:v2",
      }),
      payload: {
        action: "pause",
        runtimeAgentId: "bot-a",
        candidateVersion: "cand:v2",
      },
    },
    autonomyPolicy: {
      surfaceId: "system.runtime-binding-governance",
      mode: "auto",
      maxApplications: 10,
      usedApplications: 0,
      maxImpactScope: "active",
    },
    rollbackAvailable: true,
    idempotencyKey: "pause:bot-a",
    priorConsumption: null,
    intent: {
      kind: "runtime-action",
      surfaceId: "system.runtime-binding-governance",
      adapterId: "runtime-governance",
      runtimeAgentId: "bot-a",
      action: "pause",
      approvedAction: "pause",
      candidateVersion: "cand:v2",
      tenantScope: "tenant-a",
    },
  };
}

describe("E5.1 consumption shadow", () => {
  it("does not call the live runtime or skill mutators", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const shadow = fs.readFileSync(path.join(here, "application-consumption-shadow.ts"), "utf8");
    expect(shadow).not.toMatch(/applyGovernanceRuntimeAction\s*\(/);
    expect(shadow).not.toMatch(/installSkillToRobotAsset\s*\(/);
    expect(shadow).not.toContain("runtime-actions.js");
    expect(shadow).not.toContain("skill-lifecycle-store.js");
    const tick = fs.readFileSync(path.join(here, "tick-pipeline.ts"), "utf8");
    const skill = fs.readFileSync(path.join(here, "skill-auto-evolution.ts"), "utf8");
    expect(tick).toContain("applyGovernanceRuntimeAction");
    expect(skill).toContain("installSkillToRobotAsset");
  });

  it("records an unmatched direct intent as an orphan and stays closed", () => {
    resetControlPlaneApplicationConsumptionForTests(dir);
    const row = observeRuntimeAutoConsumption({
      commandId: "pause:bot-a:orphan",
      runtimeAgentId: "bot-a",
      action: "pause",
      liveExecuted: true,
      mode: "auto",
      killSwitch: false,
      configDir: dir,
      recordedAt: "2026-09-22T00:00:00.000Z",
    });
    expect(row.wouldConsume).toBe(false);
    expect(row.denyReason).toBe("missing_application");
    expect(row.executedConsumer).toBe(false);
    expect(row.liveExecuted).toBe(true);
    const skill = observeSkillAutoConsumption({
      commandId: "install:skill-1:orphan",
      agentId: "bot-a",
      skillId: "skill-1",
      autoInstallIntent: true,
      liveExecuted: true,
      mode: "auto",
      killSwitch: false,
      configDir: dir,
      recordedAt: "2026-09-22T00:01:00.000Z",
    });
    expect(skill.wouldConsume).toBe(false);
    expect(skill.denyReason).toBe("missing_application");
    expect(skill.executedConsumer).toBe(false);
    const readiness = readSingleTrackCutoverReadiness(dir);
    expect(readiness.orphanDirectMutations).toBe(2);
    expect(readiness.cutoverReady).toBe(false);
    expect(readiness.e52SwitchAllowed).toBe(false);
    expect(listControlPlaneApplicationConsumptions(dir)).toHaveLength(2);
  });

  it("does not wouldConsume from a forged autonomy policy, and live readiness stays closed", () => {
    resetControlPlaneApplicationConsumptionForTests(dir);
    const row = observeRuntimeAutoConsumption({
      commandId: "pause:bot-a",
      runtimeAgentId: "bot-a",
      action: "pause",
      liveExecuted: false,
      mode: "auto",
      killSwitch: false,
      tenantScope: "tenant-a",
      binding: binding(),
      configDir: dir,
      recordedAt: "2026-09-22T00:02:00.000Z",
    });
    expect(row.wouldConsume).toBe(false);
    expect(row.denyReason).toBe("autonomy_not_approved");
    expect(row.executedConsumer).toBe(false);
    expect(row.liveExecuted).toBe(false);
    expect(row.contractChecks.candidateStore).toBe(true);
    expect(row.contractChecks.surfacePolicy).toBe(false);
    const readiness = readSingleTrackCutoverReadiness(dir);
    expect(readiness.cutoverReady).toBe(false);
    expect(readiness.e52SwitchAllowed).toBe(false);
  });

  it("records assist and kill switch as closed with no executed consumer", () => {
    resetControlPlaneApplicationConsumptionForTests(dir);
    const assist = observeRuntimeAutoConsumption({
      commandId: "pause:bot-a",
      runtimeAgentId: "bot-a",
      action: "pause",
      liveExecuted: false,
      mode: "assist",
      killSwitch: false,
      tenantScope: "tenant-a",
      binding: binding(),
      configDir: dir,
      recordedAt: "2026-09-22T00:03:00.000Z",
    });
    expect(assist.wouldConsume).toBe(false);
    expect(assist.denyReason).toBe("assist_zero_mutation");
    expect(assist.executedConsumer).toBe(false);
    const killed = observeRuntimeAutoConsumption({
      commandId: "pause:bot-a",
      runtimeAgentId: "bot-a",
      action: "pause",
      liveExecuted: false,
      mode: "auto",
      killSwitch: true,
      tenantScope: "tenant-a",
      binding: binding(),
      configDir: dir,
      recordedAt: "2026-09-22T00:04:00.000Z",
    });
    expect(killed.wouldConsume).toBe(false);
    expect(killed.denyReason).toBe("kill_switch");
    expect(killed.executedConsumer).toBe(false);
    const readiness = readSingleTrackCutoverReadiness(dir);
    expect(readiness.killSwitchDrillPassed).toBe(false);
    expect(readiness.rollbackDrillPassed).toBe(false);
    expect(readiness.e52SwitchAllowed).toBe(false);
    expect(readiness.denyCounts.kill_switch).toBe(1);
    expect(readiness.denyCounts.assist_zero_mutation).toBe(1);
  });

  it("treats corrupt, truncated, unsupported, and failed writes as No-Go", () => {
    const corruptDir = fs.mkdtempSync(path.join(os.tmpdir(), "e5.1.2-corrupt-"));
    const file = path.join(
      corruptDir,
      "evolution-governance",
      "control-plane-application-consumption.jsonl",
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      '{"schemaVersion":1,"idempotencyKey":"ok","executedConsumer":false}\n{bad\n',
    );
    const corrupt = readSingleTrackCutoverReadiness(corruptDir);
    expect(corrupt.observationStoreHealthy).toBe(false);
    expect(corrupt.corruptionCount).toBeGreaterThan(0);
    expect(corrupt.cutoverReady).toBe(false);
    expect(corrupt.e52SwitchAllowed).toBe(false);

    const truncatedDir = fs.mkdtempSync(path.join(os.tmpdir(), "e5.1.2-trunc-"));
    const truncatedFile = path.join(
      truncatedDir,
      "evolution-governance",
      "control-plane-application-consumption.jsonl",
    );
    fs.mkdirSync(path.dirname(truncatedFile), { recursive: true });
    fs.writeFileSync(truncatedFile, '{"schemaVersion":1,"idempotencyKey":"half"');
    const truncated = readSingleTrackCutoverReadiness(truncatedDir);
    expect(truncated.truncated).toBe(true);
    expect(truncated.observationStoreHealthy).toBe(false);
    expect(truncated.cutoverReady).toBe(false);

    const schemaDir = fs.mkdtempSync(path.join(os.tmpdir(), "e5.1.2-schema-"));
    const schemaFile = path.join(
      schemaDir,
      "evolution-governance",
      "control-plane-application-consumption.jsonl",
    );
    fs.mkdirSync(path.dirname(schemaFile), { recursive: true });
    fs.writeFileSync(schemaFile, '{"schemaVersion":99,"idempotencyKey":"future"}\n');
    const unsupported = readSingleTrackCutoverReadiness(schemaDir);
    expect(unsupported.unsupportedSchemaCount).toBe(1);
    expect(unsupported.observationStoreHealthy).toBe(false);
    expect(unsupported.cutoverReady).toBe(false);

    const forgedDir = fs.mkdtempSync(path.join(os.tmpdir(), "e5.1.2-forged-"));
    const forgedFile = path.join(
      forgedDir,
      "evolution-governance",
      "control-plane-application-consumption.jsonl",
    );
    fs.mkdirSync(path.dirname(forgedFile), { recursive: true });
    fs.writeFileSync(
      forgedFile,
      `${JSON.stringify({ schemaVersion: 1, idempotencyKey: "forged", executedConsumer: true })}\n`,
    );
    const forged = readSingleTrackCutoverReadiness(forgedDir);
    expect(forged.corruptionCount).toBe(1);
    expect(forged.observationStoreHealthy).toBe(false);
    expect(forged.cutoverReady).toBe(false);
    expect(listControlPlaneApplicationConsumptions(forgedDir)).toEqual([]);

    const blocked = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "e5.1.2-write-")), "not-a-dir");
    fs.writeFileSync(blocked, "x");
    const failed = observeRuntimeAutoConsumption({
      commandId: "pause:write-fail",
      runtimeAgentId: "bot-a",
      action: "pause",
      liveExecuted: false,
      mode: "auto",
      killSwitch: false,
      configDir: blocked,
      recordedAt: "2026-09-22T00:05:00.000Z",
    });
    expect(failed.executedConsumer).toBe(false);
    expect(failed.persistenceFailure).toBe(true);
    const failedRead = readSingleTrackCutoverReadiness(blocked);
    expect(failedRead.persistenceFailure).toBe(true);
    expect(failedRead.observationStoreHealthy).toBe(false);
    expect(failedRead.cutoverReady).toBe(false);
    expect(failedRead.e52SwitchAllowed).toBe(false);
  });

  it("atomically keeps at most 500 shadow rows and never executes a consumer", () => {
    const capDir = fs.mkdtempSync(path.join(os.tmpdir(), "e5.1.2-cap-"));
    for (let index = 0; index < 501; index += 1) {
      const row = observeRuntimeAutoConsumption({
        commandId: `pause:cap:${index}`,
        runtimeAgentId: "bot-a",
        action: "pause",
        liveExecuted: false,
        mode: "assist",
        killSwitch: false,
        configDir: capDir,
        recordedAt: `2026-09-22T01:${String(index).padStart(2, "0")}:00.000Z`,
      });
      expect(row.executedConsumer).toBe(false);
    }
    const file = path.join(
      capDir,
      "evolution-governance",
      "control-plane-application-consumption.jsonl",
    );
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(500);
    expect(fs.readFileSync(file, "utf8").endsWith("\n")).toBe(true);
    expect(fs.readdirSync(path.dirname(file)).some((name) => name.endsWith(".tmp"))).toBe(false);
    const readiness = readSingleTrackCutoverReadiness(capDir);
    expect(readiness.shadowObservationWindow.sampleCount).toBe(500);
    expect(readiness.observationStoreHealthy).toBe(true);
    expect(readiness.cutoverReady).toBe(false);
    expect(readiness.e52SwitchAllowed).toBe(false);
  });

  it("keeps a write failure No-Go after restart until audited window recovery", () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "e5.1.3-restart-"));
    const storeDir = path.join(configDir, "evolution-governance");
    fs.mkdirSync(storeDir, { recursive: true });
    fs.chmodSync(storeDir, 0o555);
    try {
      const failed = observeRuntimeAutoConsumption({
        commandId: "pause:restart",
        runtimeAgentId: "bot-a",
        action: "pause",
        liveExecuted: false,
        mode: "auto",
        killSwitch: false,
        configDir,
        recordedAt: "2026-09-22T03:00:00.000Z",
      });
      expect(failed.executedConsumer).toBe(false);
      expect(failed.persistenceFailure).toBe(true);
      const healthFile = path.join(configDir, "control-plane-application-consumption.health.json");
      expect(fs.readFileSync(healthFile, "utf8")).toContain("write_failure");

      discardInMemoryShadowStoreHealthForTests();
      const afterRestart = readSingleTrackCutoverReadiness(configDir);
      expect(afterRestart.observationStoreHealthy).toBe(false);
      expect(afterRestart.persistenceFailure).toBe(true);
      expect(afterRestart.cutoverReady).toBe(false);
      expect(afterRestart.e52SwitchAllowed).toBe(false);

      const authority = {
        verifyAdmin: (adminId: string) => adminId === "admin-e514",
      };
      const forged = {
        configDir,
        adminId: "admin-e514",
        reason: "forged client flags",
        authority,
        audited: true,
        observationWindowRevalidated: true,
      };
      expect(recoverPersistedShadowStoreHealth(forged).cleared).toBe(false);
      expect(
        resolveServerAdmin({
          adminId: "admin-e514",
          authority,
          clientClaims: { audited: true, observationWindowRevalidated: true },
        }),
      ).toBeNull();
      expect(
        recoverPersistedShadowStoreHealth({
          configDir,
          admin: { adminId: "admin-e514" },
          reason: "raw admin object is not a server identity",
          authority,
        }).cleared,
      ).toBe(false);
      expect(
        recoverPersistedShadowStoreHealth({
          configDir,
          adminId: "intruder",
          reason: "unauthorized",
          authority,
        }).cleared,
      ).toBe(false);
      const latched = fs.readFileSync(
        path.join(configDir, "evolution-shadow-ledger", "events.jsonl"),
        "utf8",
      );
      expect(latched).toContain("write_failure");
      expect(readSingleTrackCutoverReadiness(configDir).observationStoreHealthy).toBe(false);

      fs.chmodSync(storeDir, 0o755);
      fs.writeFileSync(
        path.join(storeDir, "control-plane-application-consumption.jsonl"),
        `${JSON.stringify({
          schemaVersion: 1,
          idempotencyKey: "recovered-window",
          executedConsumer: false,
          recordedAt: "2026-09-22T03:10:00.000Z",
        })}\n`,
      );
      expect(
        recoverPersistedShadowStoreHealth({
          configDir,
          adminId: "intruder",
          reason: "still unauthorized after the window exists",
          authority,
        }).cleared,
      ).toBe(false);
      expect(
        fs.readFileSync(path.join(configDir, "evolution-shadow-ledger", "events.jsonl"), "utf8"),
      ).toBe(latched);
      const admin = resolveServerAdmin({ adminId: "admin-e514", authority });
      expect(admin?.adminId).toBe("admin-e514");
      const recovered = recoverPersistedShadowStoreHealth({
        configDir,
        admin: admin ?? undefined,
        reason: "server verified the repaired observation window",
        authority,
      });
      expect(recovered.cleared).toBe(true);
      const auditLog = fs.readFileSync(
        path.join(configDir, "evolution-shadow-ledger", "events.jsonl"),
        "utf8",
      );
      expect(auditLog).toContain("admin-e514");
      expect(auditLog).toContain('"type":"recovery"');

      discardInMemoryShadowStoreHealthForTests();
      const afterRecovery = readSingleTrackCutoverReadiness(configDir);
      expect(afterRecovery.observationStoreHealthy).toBe(true);
      expect(afterRecovery.persistenceFailure).toBe(false);
      expect(afterRecovery.cutoverReady).toBe(false);
      expect(afterRecovery.e52SwitchAllowed).toBe(false);
      expect(listControlPlaneApplicationConsumptions(configDir)[0]?.executedConsumer).toBe(false);

      fs.appendFileSync(
        path.join(storeDir, "control-plane-application-consumption.jsonl"),
        "{bad\n",
      );
      discardInMemoryShadowStoreHealthForTests();
      const relapsed = readSingleTrackCutoverReadiness(configDir);
      expect(relapsed.observationStoreHealthy).toBe(false);
      expect(relapsed.cutoverReady).toBe(false);
      expect(relapsed.e52SwitchAllowed).toBe(false);
      expect(relapsed.corruptionCount).toBeGreaterThan(0);
    } finally {
      fs.chmodSync(storeDir, 0o755);
    }
  });

  it("keeps corrupt, truncated, and unsupported schema latched across restart", () => {
    const cases = [
      {
        name: "corrupt",
        body: "{bad\n",
        field: "corruptionCount" as const,
      },
      {
        name: "truncated",
        body: '{"schemaVersion":1,"idempotencyKey":"half","executedConsumer":false,"recordedAt":"2026-09-22T03:20:00.000Z"}',
        field: "truncated" as const,
      },
      {
        name: "unsupported",
        body: '{"schemaVersion":99,"idempotencyKey":"future","executedConsumer":false,"recordedAt":"2026-09-22T03:21:00.000Z"}\n',
        field: "unsupportedSchemaCount" as const,
      },
    ];
    for (const entry of cases) {
      const configDir = fs.mkdtempSync(path.join(os.tmpdir(), `e5.1.3-${entry.name}-`));
      const jsonl = path.join(
        configDir,
        "evolution-governance",
        "control-plane-application-consumption.jsonl",
      );
      fs.mkdirSync(path.dirname(jsonl), { recursive: true });
      fs.writeFileSync(jsonl, entry.body);
      const first = readSingleTrackCutoverReadiness(configDir);
      expect(first.observationStoreHealthy).toBe(false);
      expect(first.cutoverReady).toBe(false);
      expect(first.e52SwitchAllowed).toBe(false);
      fs.writeFileSync(
        jsonl,
        `${JSON.stringify({
          schemaVersion: 1,
          idempotencyKey: `repaired-${entry.name}`,
          executedConsumer: false,
          recordedAt: "2026-09-22T03:30:00.000Z",
        })}\n`,
      );
      discardInMemoryShadowStoreHealthForTests();
      const restarted = readSingleTrackCutoverReadiness(configDir);
      expect(restarted.observationStoreHealthy).toBe(false);
      expect(restarted.cutoverReady).toBe(false);
      expect(restarted.e52SwitchAllowed).toBe(false);
      if (entry.field === "truncated") {
        expect(restarted.truncated).toBe(true);
      } else {
        expect(restarted[entry.field]).toBeGreaterThan(0);
      }
    }
  });

  it("returns No-Go when readiness cannot read the store", () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "e5.1.3-read-"));
    const jsonl = path.join(
      configDir,
      "evolution-governance",
      "control-plane-application-consumption.jsonl",
    );
    fs.mkdirSync(jsonl, { recursive: true });
    expect(() => readSingleTrackCutoverReadiness(configDir)).not.toThrow();
    const unreadable = readSingleTrackCutoverReadiness(configDir);
    expect(unreadable.observationStoreHealthy).toBe(false);
    expect(unreadable.persistenceFailure).toBe(true);
    expect(unreadable.cutoverReady).toBe(false);
    expect(unreadable.e52SwitchAllowed).toBe(false);
    fs.rmSync(jsonl, { recursive: true, force: true });
    discardInMemoryShadowStoreHealthForTests();
    const afterRestart = readSingleTrackCutoverReadiness(configDir);
    expect(afterRestart.observationStoreHealthy).toBe(false);
    expect(afterRestart.cutoverReady).toBe(false);
    expect(afterRestart.e52SwitchAllowed).toBe(false);
  });

  it("stays No-Go when the health mirror cannot be written and after the chain is damaged", () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "e5.1.4-mirror-"));
    const storeDir = path.join(configDir, "evolution-governance");
    const ledgerDir = path.join(configDir, "evolution-shadow-ledger");
    const mirror = path.join(configDir, "control-plane-application-consumption.health.json");
    const chain = path.join(ledgerDir, "events.jsonl");
    fs.mkdirSync(storeDir, { recursive: true });
    fs.mkdirSync(ledgerDir, { recursive: true });
    fs.chmodSync(storeDir, 0o555);
    fs.chmodSync(configDir, 0o555);
    try {
      const failed = observeRuntimeAutoConsumption({
        commandId: "pause:mirror-fail",
        runtimeAgentId: "bot-a",
        action: "pause",
        liveExecuted: false,
        mode: "auto",
        killSwitch: false,
        configDir,
        recordedAt: "2026-09-22T04:00:00.000Z",
      });
      expect(failed.executedConsumer).toBe(false);
      expect(failed.persistenceFailure).toBe(true);
      expect(fs.existsSync(mirror)).toBe(false);
      const chainText = fs.readFileSync(chain, "utf8");
      expect(chainText).toContain("write_failure");
      expect(chainText).toContain('"mirrorPersisted":false');
      discardInMemoryShadowStoreHealthForTests();
      const restarted = readSingleTrackCutoverReadiness(configDir);
      expect(restarted.observationStoreHealthy).toBe(false);
      expect(restarted.persistenceFailure).toBe(true);
      expect(restarted.cutoverReady).toBe(false);
      expect(restarted.e52SwitchAllowed).toBe(false);
    } finally {
      fs.chmodSync(configDir, 0o755);
      fs.chmodSync(storeDir, 0o755);
    }

    const healthyDir = fs.mkdtempSync(path.join(os.tmpdir(), "e5.1.4-chain-"));
    observeRuntimeAutoConsumption({
      commandId: "pause:chain",
      runtimeAgentId: "bot-a",
      action: "pause",
      liveExecuted: false,
      mode: "assist",
      killSwitch: false,
      configDir: healthyDir,
      recordedAt: "2026-09-22T04:01:00.000Z",
    });
    const healthyChain = path.join(healthyDir, "evolution-shadow-ledger", "events.jsonl");
    const healthyMirror = path.join(
      healthyDir,
      "control-plane-application-consumption.health.json",
    );
    const original = fs.readFileSync(healthyChain, "utf8");

    fs.writeFileSync(healthyChain, "{bad\n");
    discardInMemoryShadowStoreHealthForTests();
    expect(readSingleTrackCutoverReadiness(healthyDir).observationStoreHealthy).toBe(false);
    expect(readSingleTrackCutoverReadiness(healthyDir).cutoverReady).toBe(false);
    expect(readSingleTrackCutoverReadiness(healthyDir).e52SwitchAllowed).toBe(false);

    fs.writeFileSync(healthyChain, original);
    fs.rmSync(healthyChain, { force: true });
    discardInMemoryShadowStoreHealthForTests();
    expect(readSingleTrackCutoverReadiness(healthyDir).observationStoreHealthy).toBe(false);
    expect(readSingleTrackCutoverReadiness(healthyDir).e52SwitchAllowed).toBe(false);

    fs.writeFileSync(healthyChain, original);
    const tampered = `${original.slice(0, -4)}ffff\n`;
    fs.writeFileSync(healthyChain, tampered);
    discardInMemoryShadowStoreHealthForTests();
    expect(readSingleTrackCutoverReadiness(healthyDir).observationStoreHealthy).toBe(false);
    expect(readSingleTrackCutoverReadiness(healthyDir).cutoverReady).toBe(false);

    fs.writeFileSync(healthyChain, original);
    fs.rmSync(healthyMirror, { force: true });
    discardInMemoryShadowStoreHealthForTests();
    const deletedMirror = readSingleTrackCutoverReadiness(healthyDir);
    expect(deletedMirror.observationStoreHealthy).toBe(false);
    expect(deletedMirror.cutoverReady).toBe(false);
    expect(deletedMirror.e52SwitchAllowed).toBe(false);
  });

  it("observes A9 M1 without treating it as an E5.2 cutover receipt", () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "e5.1.5-a9-"));
    resetControlPlaneApplicationConsumptionForTests(configDir);
    const observed = observeA9M1Shadow({
      configDir,
      binding: binding(),
      event: {
        kind: "a9-m1",
        proposalId: "evo:rt",
        experimentId: "exp:rt",
        applicationId: "app:rt",
        recordedAt: "2026-09-22T04:00:00.000Z",
        cutoverReady: true,
        e52SwitchAllowed: true,
        executedConsumer: true,
        directMutatorsRetired: true,
        killSwitchDrillPassed: true,
        rollbackDrillPassed: true,
        idempotentReplayPassed: true,
        audited: true,
      },
    });
    expect(observed.classification.accepted).toBe(true);
    expect(observed.classification.isE52CutoverReceipt).toBe(false);
    expect(observed.isE52CutoverReceipt).toBe(false);
    expect(observed.executedConsumer).toBe(false);
    expect(observed.directMutatorsRetired).toBe(false);
    expect(observed.bindingMatched).toBe(true);
    expect(observed.record?.source).toBe("a9-m1");
    expect(observed.record?.livePath).toBe("diagnosis-m1-observation");
    expect(observed.record?.liveExecuted).toBe(false);
    expect(observed.record?.executedConsumer).toBe(false);
    expect(observed.record?.proposalId).toBe("evo:rt");
    expect(observed.record?.experimentId).toBe("exp:rt");
    expect(observed.record?.applicationId).toBe("app:rt");
    expect(observed.observationWindow.sampleCount).toBe(1);
    expect(observed.unresolvedDenials).toBeGreaterThan(0);
    expect(observed.denialCounts.autonomy_not_approved).toBeGreaterThan(0);
    expect(observed.healthChain).toBe("present");
    expect(observed.readiness.killSwitchDrillPassed).toBe(false);
    expect(observed.readiness.rollbackDrillPassed).toBe(false);
    expect(observed.readiness.idempotentReplayPassed).toBe(false);
    expect(observed.readiness.cutoverReady).toBe(false);
    expect(observed.readiness.e52SwitchAllowed).toBe(false);
    const stored = fs.readFileSync(
      path.join(configDir, "evolution-governance", "control-plane-application-consumption.jsonl"),
      "utf8",
    );
    expect(stored).toContain('"executedConsumer":false');
    expect(stored).not.toContain('"executedConsumer":true');
    expect(stored).not.toContain("e52SwitchAllowed");
    const tick = fs.readFileSync(
      fileURLToPath(new URL("./tick-pipeline.ts", import.meta.url)),
      "utf8",
    );
    const skillAuto = fs.readFileSync(
      fileURLToPath(new URL("./skill-auto-evolution.ts", import.meta.url)),
      "utf8",
    );
    expect(tick).toContain("applyGovernanceRuntimeAction(");
    expect(skillAuto).toContain("installSkillToRobotAsset(");

    const forged = observeA9M1Shadow({
      configDir,
      event: {
        kind: "e5.2-cutover-receipt",
        proposalId: "evo:rt",
        experimentId: "exp:rt",
        applicationId: "app:rt",
        recordedAt: "2026-09-22T04:05:00.000Z",
        cutoverReady: true,
        e52SwitchAllowed: true,
        executedConsumer: true,
        directMutatorsRetired: true,
      },
    });
    expect(forged.classification.accepted).toBe(false);
    expect(forged.isE52CutoverReceipt).toBe(false);
    expect(forged.record).toBeNull();
    expect(forged.readiness.cutoverReady).toBe(false);
    expect(forged.readiness.e52SwitchAllowed).toBe(false);
    expect(forged.directMutatorsRetired).toBe(false);
  });

  it("fail-closes A9 readiness on an empty window, denial, corruption, or a missing chain", () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "e5.1.5-empty-"));
    const empty = observeA9M1Shadow({
      configDir: emptyDir,
      event: { kind: "a9-m1", cutoverReady: true, e52SwitchAllowed: true },
    });
    expect(empty.observationWindow.sampleCount).toBe(0);
    expect(empty.readiness.cutoverReady).toBe(false);
    expect(empty.readiness.e52SwitchAllowed).toBe(false);
    expect(empty.executedConsumer).toBe(false);

    const deniedDir = fs.mkdtempSync(path.join(os.tmpdir(), "e5.1.5-deny-"));
    const denied = observeA9M1Shadow({
      configDir: deniedDir,
      binding: binding(),
      event: {
        kind: "a9-m1",
        proposalId: "other-proposal",
        experimentId: "exp:rt",
        applicationId: "app:rt",
        recordedAt: "2026-09-22T04:10:00.000Z",
        directMutatorsRetired: true,
      },
    });
    expect(denied.bindingMatched).toBe(false);
    expect(denied.unresolvedDenials).toBeGreaterThan(0);
    expect(denied.readiness.cutoverReady).toBe(false);
    expect(denied.readiness.e52SwitchAllowed).toBe(false);
    expect(denied.directMutatorsRetired).toBe(false);

    const chain = path.join(deniedDir, "evolution-shadow-ledger", "events.jsonl");
    fs.rmSync(chain, { force: true });
    discardInMemoryShadowStoreHealthForTests();
    const missingChain = readSingleTrackCutoverReadiness(deniedDir);
    expect(missingChain.observationStoreHealthy).toBe(false);
    expect(missingChain.cutoverReady).toBe(false);
    expect(missingChain.e52SwitchAllowed).toBe(false);

    const corruptDir = fs.mkdtempSync(path.join(os.tmpdir(), "e5.1.5-corrupt-"));
    observeA9M1Shadow({
      configDir: corruptDir,
      binding: binding(),
      event: {
        kind: "a9-m1",
        proposalId: "evo:rt",
        experimentId: "exp:rt",
        applicationId: "app:rt",
        recordedAt: "2026-09-22T04:20:00.000Z",
      },
    });
    fs.appendFileSync(
      path.join(corruptDir, "evolution-governance", "control-plane-application-consumption.jsonl"),
      '{"schemaVersion":1,"source":"e5.2-cutover-receipt","executedConsumer":false,"idempotencyKey":"forged","recordedAt":"2026-09-22T04:21:00.000Z"}\n',
    );
    discardInMemoryShadowStoreHealthForTests();
    const corrupt = readSingleTrackCutoverReadiness(corruptDir);
    expect(corrupt.observationStoreHealthy).toBe(false);
    expect(corrupt.corruptionCount).toBeGreaterThan(0);
    expect(corrupt.cutoverReady).toBe(false);
    expect(corrupt.e52SwitchAllowed).toBe(false);
  });
});
