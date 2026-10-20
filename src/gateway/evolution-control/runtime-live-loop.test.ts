import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeGovernanceMetricSet } from "@openbot/evolution-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import {
  isGovernanceEvaluationEvent,
  listGovernanceEffectObservationEvents,
} from "../evolution-governance/effect-observations.js";
import {
  closeGovernanceEffectWindow,
  listGovernanceEffectDecisions,
  listGovernanceEffectVerifications,
  openGovernanceEffectWindow,
  registerRuntimeEffectVerifier,
  submitGovernanceEffectDecision,
} from "../evolution-governance/effect-verifications.js";
import {
  isGovernanceKillSwitchActive,
  runEvolutionGovernancePipeline,
  setEffectVerifyMsForTests,
  setEvolutionGovernanceModeForTests,
  setGovernanceKillSwitch,
} from "../evolution-governance/index.js";
import {
  appendSkillInvocationEvent,
  buildCompletedInvocationEvent,
} from "../skill-invocation/event-store.js";
import {
  createLiveRuntimeGovernancePort,
  createMemoryRuntimeGovernancePort,
  createRuntimeGovernanceAdapter,
} from "./adapters/runtime-governance.js";
import { createWorkingDnaAdapter } from "./adapters/working-dna.js";
import { createEvolutionControlPlane } from "./control-plane.js";
import { createAdapterObservationProvider } from "./observation.js";
import { runtimePlatformInspector, testInspector } from "./test-support.js";

const TENANT = "tenant-runtime-live";
const AGENT_ID = "bot-runtime-live";
const SAMPLE_SIZE = 20;
const { tmpDir } = vi.hoisted(() => {
  const nodePath = require("node:path") as typeof import("node:path");
  const nodeOs = require("node:os") as typeof import("node:os");
  return { tmpDir: nodePath.join(nodeOs.tmpdir(), `openbot-runtime-live-${Date.now()}`) };
});

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const runtime = await import("../agent-runtime-store.js");

/**
 * Runtime Governance real sampling loop.
 *
 * Primary sample = one Tick cycle that consumed previously unseen evidence.
 * Idle Ticks must not increment evaluationCount or mint a primary sample.
 * Tests advance a simulated clock and only call the official Tick runner.
 * Passing this file does not complete the five-chain production loop.
 */
describe("runtime governance real longitudinal loop", () => {
  let persistDir = "";
  let cfg: OpenBotConfig;
  let previousVerifyMs: string | undefined;

  beforeEach(async () => {
    runtime.__agentRuntimeStoreInternals.reset();
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.mkdir(tmpDir, { recursive: true });
    persistDir = path.join(tmpDir, "control");
    cfg = { agents: { list: [{ id: AGENT_ID, agentDir: tmpDir }] } } as unknown as OpenBotConfig;
    previousVerifyMs = process.env.OPENBOT_GOV_EFFECT_VERIFY_MS;
    process.env.OPENBOT_GOV_EFFECT_VERIFY_MS = "0";
    setEffectVerifyMsForTests(0);
    setGovernanceKillSwitch(false);
    setEvolutionGovernanceModeForTests("auto");
  });

  afterEach(() => {
    setGovernanceKillSwitch(false);
    setEvolutionGovernanceModeForTests(null);
    setEffectVerifyMsForTests(null);
    if (previousVerifyMs === undefined) {
      delete process.env.OPENBOT_GOV_EFFECT_VERIFY_MS;
    } else {
      process.env.OPENBOT_GOV_EFFECT_VERIFY_MS = previousVerifyMs;
    }
  });

  function seedAgent(id = AGENT_ID) {
    const now = Date.now();
    runtime.upsertAgent({
      runtimeAgentId: id,
      name: id,
      runtimeVersion: "1",
      lifecycle: "deployed",
      health: "healthy",
      tenantCoverage: [TENANT],
      boundCapabilityCount: 1,
      activeSessionCount: 0,
      resourceUsage: { cpuPercent: 0, memoryPercent: 0, tokenBudgetUsedPercent: 0 },
      deployedAt: now,
      lastActiveAt: now,
    });
  }

  function seedBinding(capabilityId: string, id = AGENT_ID) {
    return runtime.createBinding({
      runtimeAgentId: id,
      capabilityId,
      capabilityVersion: "1",
      bindingType: "skill",
      routingPriority: 40,
      loadStrategy: "eager",
    });
  }

  function writeSkillInvocations(input: {
    count: number;
    startMs: number;
    experimentId?: string;
    applicationId?: string;
    tenantId?: string | null;
    prefix?: string;
    failureCategory?: string | null;
    outcome?: "success" | "failure";
  }) {
    for (let i = 0; i < input.count; i += 1) {
      appendSkillInvocationEvent(
        buildCompletedInvocationEvent({
          skillId: "runtime-owner-skill",
          agentId: AGENT_ID,
          tenantId: input.tenantId === undefined ? TENANT : input.tenantId,
          outcome: input.outcome ?? "success",
          latencyMs: 40,
          failureCategory: input.failureCategory === undefined ? null : input.failureCategory,
          completedAt: input.startMs,
          invocationId: `inv:${input.prefix ?? input.applicationId ?? "base"}:${input.startMs}:${i}`,
          ...(input.experimentId ? { experimentId: input.experimentId } : {}),
          ...(input.applicationId ? { applicationId: input.applicationId } : {}),
        }),
      );
    }
  }

  function runOfficialCycles(
    count: number,
    startNow: number,
    beforeEachCycle?: (now: number, index: number) => void,
  ): { now: number; written: number } {
    let now = startNow;
    let written = 0;
    for (let i = 0; i < count; i += 1) {
      beforeEachCycle?.(now, i);
      written += runEvolutionGovernancePipeline({ now }).cyclesWritten;
      now += 1;
    }
    return { now, written };
  }

  function controlWindows() {
    return listGovernanceEffectVerifications().filter((row) => {
      const commandId = row.commandId ?? "";
      return (
        row.runtimeAgentId === AGENT_ID &&
        (row.reason === "baseline:control" ||
          commandId === `control:${AGENT_ID}` ||
          commandId.startsWith(`control:${AGENT_ID}:`))
      );
    });
  }

  function controlWindow() {
    const rows = controlWindows();
    return rows.find((row) => row.status === "open") ?? rows.at(-1);
  }

  function evaluationEvents() {
    return listGovernanceEffectObservationEvents().filter(isGovernanceEvaluationEvent);
  }

  function createPlane() {
    const adapter = createRuntimeGovernanceAdapter(createLiveRuntimeGovernancePort(), {
      persistDir: path.join(persistDir, "adapters"),
    });
    return createEvolutionControlPlane({
      persistDir,
      inspector: runtimePlatformInspector(TENANT),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      runtimeGovernanceAdapter: adapter,
      observationProvider: createAdapterObservationProvider({
        persistDir,
        resolveAdapter: (surfaceId) => {
          if (surfaceId !== "system.runtime-binding-governance") {
            throw new Error(`unexpected surface ${surfaceId}`);
          }
          return adapter;
        },
      }),
      isKillSwitchActive: () => isGovernanceKillSwitchActive(),
    });
  }

  it("does not import fixtures, Tick writers, or self-registered verifiers", () => {
    const text = readFileSync(fileURLToPath(import.meta.url), "utf8");
    expect(text).not.toMatch(/import\s*\{[^}]*createPassingObservationProvider/);
    expect(text).not.toMatch(/createPassingObservationProvider\s*\(/);
    expect(text).not.toMatch(/assessmentMode\s*[:=]\s*["']deterministic-fixture["']/);
    expect(text).not.toMatch(/\btestObservation\s*\(/);
    expect(text).not.toMatch(/rollbackDrill\s*[:=]\s*["']passed["']/);
    expect(text).not.toMatch(/writeGovernancePersistedState\s*\(/);
    expect(text.includes(["runInGovernance", "TickScope"].join(""))).toBe(false);
    expect(text.includes(["issueGovernance", "TickWriterCapability"].join(""))).toBe(false);
    expect(text.includes(["persistOpen", "WindowEvaluation"].join(""))).toBe(false);
    expect(text).not.toMatch(/for\s*\(.*closeGovernanceEffectWindow/);
    expect(text).not.toMatch(
      /closeGovernanceEffectWindow\(\s*\{[^}]*status:\s*["']resumed["'][^}]*\}\s*\)\s*;/,
    );
    expect(text).not.toMatch(/for\s*\(.*openGovernanceEffectWindow/);
    expect(text.includes(["recordTrusted", "BaselineHoldObservation"].join(""))).toBe(false);
    expect(text.includes(["submitTick", "EffectDecision"].join(""))).toBe(false);
    expect(text.includes(["recordRuntime", "ProbeEffectObservation"].join(""))).toBe(false);
  });

  it("mints one primary sample per previously unconsumed evidence batch", () => {
    seedAgent();
    seedBinding("cap-independence");
    const startNow = Date.now() - 90_000;
    writeSkillInvocations({
      count: 3,
      startMs: startNow,
      prefix: "indep-once",
      outcome: "failure",
    });
    const first = runOfficialCycles(5, startNow);
    expect(first.written).toBe(1);
    expect(controlWindow()?.evaluationCount).toBe(1);
    expect(evaluationEvents()).toHaveLength(1);
    expect(controlWindow()?.consumedInvocationIds).toEqual([
      `inv:indep-once:${startNow}:0`,
      `inv:indep-once:${startNow}:1`,
      `inv:indep-once:${startNow}:2`,
    ]);
    const idle = runOfficialCycles(8, first.now);
    expect(idle.written).toBe(0);
    expect(controlWindow()?.evaluationCount).toBe(1);
    expect(evaluationEvents()).toHaveLength(1);
    const second = runOfficialCycles(1, idle.now, (now) => {
      writeSkillInvocations({
        count: 2,
        startMs: now,
        prefix: "indep-next",
        outcome: "failure",
      });
    });
    expect(second.written).toBe(1);
    expect(controlWindow()?.evaluationCount).toBe(2);
    expect(evaluationEvents()).toHaveLength(2);
    expect(evaluationEvents().map((row) => row.evaluationCycleId)).toEqual([
      expect.stringMatching(/:0$/),
      expect.stringMatching(/:1$/),
    ]);
    expect(new Set(evaluationEvents().map((row) => row.evaluationCycleId)).size).toBe(2);
  });

  it("runs official Tick cycles for baseline → canary → rollback → retry → verify → governed hold", async () => {
    // Assist keeps Tick evaluation on and blocks auto limit/pause windows from
    // minting a second unbound primary out of the same failure invocations.
    setEvolutionGovernanceModeForTests("assist");
    seedAgent();
    const keepOff = seedBinding("cap-keep-off");
    runtime.updateBindingState(keepOff.bindingId, "disabled");
    const active = seedBinding("cap-active");
    const baselineStartMs = Date.now() - 90_000;
    const firstBatch = runOfficialCycles(5, baselineStartMs, (now, index) => {
      writeSkillInvocations({
        count: 1,
        startMs: now,
        prefix: `baseline-${index}`,
        outcome: "failure",
      });
    });
    expect(controlWindow()?.status).toBe("open");
    expect(controlWindow()?.evaluationCount).toBe(5);
    expect(evaluationEvents()).toHaveLength(5);
    const duplicate = runEvolutionGovernancePipeline({ now: firstBatch.now - 1 });
    expect(duplicate.cyclesWritten).toBe(0);
    expect(evaluationEvents()).toHaveLength(5);

    const rest = runOfficialCycles(SAMPLE_SIZE - 5, firstBatch.now, (now, index) => {
      writeSkillInvocations({
        count: 1,
        startMs: now,
        prefix: `baseline-rest-${index}`,
        outcome: "failure",
      });
    });
    expect(controlWindow()?.status).toBe("held");
    expect(controlWindow()?.evaluationCount).toBe(SAMPLE_SIZE);
    expect(
      evaluationEvents().filter((row) => !row.experimentId && !row.applicationId),
    ).toHaveLength(SAMPLE_SIZE);
    expect(rest.written).toBe(SAMPLE_SIZE - 5);
    setEvolutionGovernanceModeForTests("auto");

    const plane = createPlane();
    plane.registerProposal(
      {
        schemaVersion: 2,
        proposalId: "evo:runtime-live",
        sourceEvidenceRefs: ["ev-a"],
        sourceMechanismRef: "case-runtime",
        target: { domain: "system", componentId: AGENT_ID },
        candidateRef: "cand:runtime-live",
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
        runtimeAgentId: AGENT_ID,
        action: "pause",
        candidateVersion: "cand:runtime-live",
      },
    );
    const experiment = await plane.startExperiment({
      commandId: "exp-runtime-live",
      proposalId: "evo:runtime-live",
      now: new Date(rest.now).toISOString(),
      freeze: {
        baselineVersion: `runtime:${AGENT_ID}:${keepOff.bindingId}:disabled,${active.bindingId}:active`,
        candidateVersion: "cand:runtime-live",
        codeSha: "sha-runtime-live",
        modelRef: "model-runtime-live",
        providerVersion: "provider-runtime-live",
        configSnapshotRef: "cfg-runtime-live",
        datasetOrCohortRef: "cohort-runtime-live",
        tenantScope: TENANT,
        confidentialityScope: "enterprise",
        expiresAt: "2026-09-07T00:00:00.000Z",
        maxResourceBudget: 1,
      },
    });
    expect(experiment.baselineCapture?.status).toBe("frozen");
    expect(experiment.baselineCapture?.primaryPresent).toBe(true);
    expect(experiment.baselineCapture?.missingCriticalGuardrails).toEqual([]);
    const capturedPrimary = evaluationEvents().filter(
      (row) => !row.experimentId && !row.applicationId,
    );
    expect(capturedPrimary.length).toBeGreaterThanOrEqual(SAMPLE_SIZE);
    expect(
      capturedPrimary.every(
        (row) =>
          Boolean(row.evaluationCycleId) &&
          Boolean(row.sourceReceiptRef) &&
          Boolean(row.metricsSnapshotRef) &&
          row.tenantId === TENANT &&
          row.runtimeAgentId === AGENT_ID,
      ),
    ).toBe(true);

    const applicationA = await plane.applyRuntimeGovernance({
      commandId: "apply-runtime-a",
      proposalId: "evo:runtime-live",
      experimentId: experiment.experimentId,
      principalRef: "platform-admin",
      trustedTenantId: TENANT,
      scope: "canary",
    });
    expect(applicationA.appliedToRuntime).toBe(true);
    expect(runtime.getBinding(active.bindingId)?.bindingState).toBe("disabled");
    expect(runtime.getBinding(keepOff.bindingId)?.bindingState).toBe("disabled");
    const openedA = listGovernanceEffectVerifications().filter(
      (row) => row.applicationId === applicationA.applicationId && row.status === "open",
    );
    expect(openedA).toHaveLength(1);
    const appliedAAt = Date.now();
    writeSkillInvocations({
      count: 3,
      startMs: appliedAAt,
      experimentId: "exp-other",
      applicationId: applicationA.applicationId,
      prefix: "pollute-exp",
    });
    writeSkillInvocations({
      count: 3,
      startMs: appliedAAt,
      experimentId: experiment.experimentId,
      applicationId: "app:other",
      prefix: "pollute-app",
    });
    writeSkillInvocations({
      count: 3,
      startMs: appliedAAt,
      experimentId: experiment.experimentId,
      applicationId: applicationA.applicationId,
      tenantId: "tenant-other",
      prefix: "pollute-tenant",
    });
    writeSkillInvocations({
      count: 3,
      startMs: appliedAAt,
      experimentId: experiment.experimentId,
      applicationId: applicationA.applicationId,
      tenantId: null,
      prefix: "pollute-notenants",
    });
    writeSkillInvocations({
      count: 3,
      startMs: appliedAAt,
      experimentId: experiment.experimentId,
      applicationId: applicationA.applicationId,
      prefix: "treat-a",
    });
    const treatAReplay = runOfficialCycles(5, appliedAAt);
    const treatmentWindowA = () =>
      listGovernanceEffectVerifications().find((row) => row.id === openedA[0]?.id);
    expect(treatmentWindowA()?.status).toBe("open");
    expect(treatmentWindowA()?.evaluationCount).toBe(1);
    expect(treatmentWindowA()?.consumedInvocationIds).toEqual([
      `inv:treat-a:${appliedAAt}:0`,
      `inv:treat-a:${appliedAAt}:1`,
      `inv:treat-a:${appliedAAt}:2`,
    ]);
    expect(
      evaluationEvents().filter((row) => row.applicationId === applicationA.applicationId),
    ).toHaveLength(1);
    const treatAIdle = runOfficialCycles(4, treatAReplay.now);
    expect(treatmentWindowA()?.evaluationCount).toBe(1);
    expect(
      evaluationEvents().filter((row) => row.applicationId === applicationA.applicationId),
    ).toHaveLength(1);
    runEvolutionGovernancePipeline({ now: treatAIdle.now - 1 });
    expect(treatmentWindowA()?.evaluationCount).toBe(1);
    expect(
      evaluationEvents().filter((row) => row.applicationId === applicationA.applicationId),
    ).toHaveLength(1);
    runOfficialCycles(SAMPLE_SIZE - 1, treatAIdle.now, (now, index) => {
      writeSkillInvocations({
        count: 1,
        startMs: now,
        experimentId: experiment.experimentId,
        applicationId: applicationA.applicationId,
        prefix: `treat-a-cycle-${index}`,
      });
    });
    expect(
      listGovernanceEffectVerifications().find((row) => row.id === openedA[0]?.id)?.status,
    ).toBe("resumed");
    const treatmentA = listGovernanceEffectObservationEvents().filter(
      (row) => row.applicationId === applicationA.applicationId,
    );
    expect(treatmentA.filter(isGovernanceEvaluationEvent)).toHaveLength(SAMPLE_SIZE);
    expect(
      treatmentA
        .filter((row) => row.kind === "skill_invocation")
        .every(
          (row) =>
            Boolean(row.sourceReceiptRef) &&
            row.experimentId === experiment.experimentId &&
            row.applicationId === applicationA.applicationId &&
            row.tenantId === TENANT &&
            row.runtimeAgentId === AGENT_ID,
        ),
    ).toBe(true);
    expect(treatmentA.some((row) => row.kind === "auto_resume_decision")).toBe(true);
    expect(treatmentA.some((row) => row.experimentId === "exp-other")).toBe(false);
    expect(treatmentA.some((row) => row.applicationId === "app:other")).toBe(false);
    expect(treatmentA.some((row) => row.tenantId === "tenant-other")).toBe(false);
    expect(
      treatmentA
        .filter((row) => row.kind === "skill_invocation")
        .every((row) => row.intervention == null),
    ).toBe(true);
    expect(listGovernanceEffectDecisions().some((row) => row.decidedBy === "governance_tick")).toBe(
      true,
    );

    setGovernanceKillSwitch(true);
    await expect(
      plane.applyRuntimeGovernance({
        commandId: "apply-runtime-blocked",
        proposalId: "evo:runtime-live",
        experimentId: experiment.experimentId,
        principalRef: "platform-admin",
        trustedTenantId: TENANT,
        scope: "canary",
      }),
    ).rejects.toThrow(/kill switch/);
    const eventsBeforeRollback = evaluationEvents().length;
    const drill = await plane.runRollbackDrill({
      commandId: "drill-runtime-a",
      applicationId: applicationA.applicationId,
      principalRef: "platform-admin",
      trustedTenantId: TENANT,
      verifiedBy: "platform-admin",
      evidenceRefs: ["ev-drill-runtime"],
    });
    expect(drill.result).toBe("passed");
    expect(runtime.getBinding(active.bindingId)?.bindingState).toBe("active");
    expect(runtime.getBinding(keepOff.bindingId)?.bindingState).toBe("disabled");
    expect(evaluationEvents()).toHaveLength(eventsBeforeRollback);
    setGovernanceKillSwitch(false);

    const applicationB = await plane.applyRuntimeGovernance({
      commandId: "apply-runtime-b",
      proposalId: "evo:runtime-live",
      experimentId: experiment.experimentId,
      principalRef: "platform-admin",
      trustedTenantId: TENANT,
      scope: "canary",
    });
    expect(applicationB.applicationId).not.toBe(applicationA.applicationId);
    const duplicateB = await plane.applyRuntimeGovernance({
      commandId: "apply-runtime-b",
      proposalId: "evo:runtime-live",
      experimentId: experiment.experimentId,
      principalRef: "platform-admin",
      trustedTenantId: TENANT,
      scope: "canary",
    });
    expect(duplicateB.applicationId).toBe(applicationB.applicationId);
    const openedB = listGovernanceEffectVerifications().filter(
      (row) => row.applicationId === applicationB.applicationId && row.status === "open",
    );
    expect(openedB).toHaveLength(1);
    const appliedBAt = Date.now();
    runOfficialCycles(SAMPLE_SIZE, appliedBAt, (now, index) => {
      writeSkillInvocations({
        count: 1,
        startMs: now,
        experimentId: experiment.experimentId,
        applicationId: applicationB.applicationId,
        prefix: `treat-b-${index}`,
      });
    });
    expect(
      listGovernanceEffectVerifications().find(
        (row) => row.applicationId === applicationB.applicationId,
      )?.status,
    ).toBe("resumed");
    const treatmentB = listGovernanceEffectObservationEvents().filter(
      (row) => row.applicationId === applicationB.applicationId && isGovernanceEvaluationEvent(row),
    );
    expect(treatmentB).toHaveLength(SAMPLE_SIZE);
    const verification = await plane.verifyApplication({
      commandId: "verify-runtime-b",
      applicationId: applicationB.applicationId,
      principalRef: "platform-admin",
      trustedTenantId: TENANT,
    });
    expect(verification.outcome).toBe("improved");
    expect(verification.assessment?.method).toBe("two-proportion-z");
    expect(verification.sampleSize).toBeGreaterThanOrEqual(SAMPLE_SIZE);
    expect(plane.getProposal("evo:runtime-live")?.status).toBe("VERIFIED");
    expect(() =>
      plane.promoteProposal({
        commandId: "promote-runtime-b",
        proposalId: "evo:runtime-live",
        principalRef: "platform-admin",
        trustedTenantId: TENANT,
      }),
    ).toThrow(/critical proposals cannot be promoted/);

    const restarted = createPlane();
    expect(restarted.getProposal("evo:runtime-live")?.status).toBe("VERIFIED");
    expect(restarted.getExperiment(experiment.experimentId)?.experimentId).toBe(
      experiment.experimentId,
    );
    expect(restarted.getApplication(applicationA.applicationId)?.status).toBe("rolled_back");
    expect(restarted.getApplication(applicationB.applicationId)?.status).toBe("applied");
    expect(restarted.getRollbackDrill(drill.drillId)?.result).toBe("passed");
    expect(restarted.getVerification(verification.verificationId)?.outcome).toBe("improved");
    expect(evaluationEvents().length).toBeGreaterThan(SAMPLE_SIZE);
    expect(listGovernanceEffectDecisions().length).toBeGreaterThan(0);
    expect(restarted.ledger.list().length).toBeGreaterThan(0);
    const priorTreatmentIds = evaluationEvents()
      .filter((row) => row.applicationId === applicationB.applicationId)
      .map((row) => row.eventId);
    const restartNow = Date.now();
    runEvolutionGovernancePipeline({ now: restartNow });
    expect(
      evaluationEvents()
        .filter((row) => row.applicationId === applicationB.applicationId)
        .map((row) => row.eventId),
    ).toEqual(priorTreatmentIds);
    const afterRestart = evaluationEvents().map((row) => row.eventId);
    const replay = runEvolutionGovernancePipeline({ now: restartNow });
    expect(replay.cyclesWritten).toBe(0);
    expect(evaluationEvents().map((row) => row.eventId)).toEqual(afterRestart);
  });

  it("keeps a window open until the term elapses when samples are still short", () => {
    seedAgent();
    seedBinding("cap-term");
    const startNow = Date.now() - 90_000;
    runOfficialCycles(2, startNow, (now, index) => {
      writeSkillInvocations({ count: 1, startMs: now, prefix: `term-${index}` });
    });
    const opened = controlWindow();
    expect(opened?.status).toBe("open");
    expect(opened?.evaluationCount).toBe(2);
    const until = Date.parse(opened?.observationUntil ?? "");
    expect(Number.isFinite(until)).toBe(true);
    const closed = runEvolutionGovernancePipeline({ now: until + 1_000 });
    expect(closed.effectsClosed).toBeGreaterThan(0);
    expect(controlWindow()?.status).toBe("held");
    expect(controlWindow()?.outcomeNote).toMatch(/insufficient|term|elapsed|observation/i);
    expect(evaluationEvents().length).toBeLessThan(SAMPLE_SIZE);
  });

  it("escalates a critical treatment regression before minimumSampleSize", async () => {
    seedAgent();
    seedBinding("cap-crit");
    const adapter = createRuntimeGovernanceAdapter(createLiveRuntimeGovernancePort(), {
      persistDir: path.join(persistDir, "critical"),
    });
    const application = await adapter.apply({
      candidate: {
        kind: "runtime-action",
        runtimeAgentId: AGENT_ID,
        action: "pause",
        candidateVersion: "cand-crit",
      },
      context: {
        proposal: {
          schemaVersion: 2,
          proposalId: "evo:crit",
          sourceEvidenceRefs: ["ev-a"],
          sourceMechanismRef: "case",
          target: { domain: "system", componentId: AGENT_ID },
          candidateRef: "cand-crit",
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
        experiment: {
          schemaVersion: 1,
          experimentId: "exp-crit",
          proposalId: "evo:crit",
          surfaceId: "system.runtime-binding-governance",
          target: { domain: "system", componentId: AGENT_ID },
          tenantScope: TENANT,
          baselineRef: "v1",
          candidateRef: "cand-crit",
          configRef: "cfg",
          assignment: { strategy: "canary", treatmentRefs: ["t"], controlRefs: ["c"] },
          primaryMetric: runtimeGovernanceMetricSet().primary,
          guardrailMetrics: runtimeGovernanceMetricSet().guardrails,
          minimumSampleSize: SAMPLE_SIZE,
          requiredConfidence: 0.9,
          expiresAt: "2026-09-07T00:00:00.000Z",
          result: "pending",
          frozen: {
            baselineVersion: "v1",
            candidateVersion: "cand-crit",
            codeSha: "sha",
            modelRef: "m",
            providerVersion: "p",
            configSnapshotRef: "cfg",
            datasetOrCohortRef: "co",
            tenantScope: TENANT,
            confidentialityScope: "enterprise",
            expiresAt: "2026-09-07T00:00:00.000Z",
            maxResourceBudget: 1,
          },
        },
        grantId: "grant-1",
        tenantScope: TENANT,
        surfaceId: "system.runtime-binding-governance",
        commandId: "cmd-crit",
      },
      scope: "canary",
      idempotencyKey: "crit-pause",
    });
    const opened = listGovernanceEffectVerifications().find(
      (row) => row.applicationId === application.applicationId,
    );
    expect(opened?.status).toBe("open");
    const now = Date.now();
    writeSkillInvocations({
      count: 1,
      startMs: now,
      experimentId: "exp-crit",
      applicationId: application.applicationId,
      prefix: "crit",
      outcome: "failure",
      failureCategory: "security",
    });
    const tick = runEvolutionGovernancePipeline({ now });
    expect(tick.effectsClosed).toBeGreaterThan(0);
    expect(
      listGovernanceEffectVerifications().find(
        (row) => row.applicationId === application.applicationId,
      )?.status,
    ).toBe("escalated");
    expect(
      listGovernanceEffectVerifications().find(
        (row) => row.applicationId === application.applicationId,
      )?.evaluationCount,
    ).toBeLessThan(SAMPLE_SIZE);
  });

  it("rollback of an open window does not mint a primary sample", async () => {
    seedAgent();
    seedBinding("cap-rb");
    const adapter = createRuntimeGovernanceAdapter(createLiveRuntimeGovernancePort(), {
      persistDir: path.join(persistDir, "rollback-open"),
    });
    const application = await adapter.apply({
      candidate: {
        kind: "runtime-action",
        runtimeAgentId: AGENT_ID,
        action: "pause",
        candidateVersion: "cand-rb",
      },
      context: {
        proposal: {
          schemaVersion: 2,
          proposalId: "evo:rb",
          sourceEvidenceRefs: ["ev-a"],
          sourceMechanismRef: "case",
          target: { domain: "system", componentId: AGENT_ID },
          candidateRef: "cand-rb",
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
        experiment: {
          schemaVersion: 1,
          experimentId: "exp-rb",
          proposalId: "evo:rb",
          surfaceId: "system.runtime-binding-governance",
          target: { domain: "system", componentId: AGENT_ID },
          tenantScope: TENANT,
          baselineRef: "v1",
          candidateRef: "cand-rb",
          configRef: "cfg",
          assignment: { strategy: "canary", treatmentRefs: ["t"], controlRefs: ["c"] },
          primaryMetric: runtimeGovernanceMetricSet().primary,
          guardrailMetrics: runtimeGovernanceMetricSet().guardrails,
          minimumSampleSize: SAMPLE_SIZE,
          requiredConfidence: 0.9,
          expiresAt: "2026-09-07T00:00:00.000Z",
          result: "pending",
          frozen: {
            baselineVersion: "v1",
            candidateVersion: "cand-rb",
            codeSha: "sha",
            modelRef: "m",
            providerVersion: "p",
            configSnapshotRef: "cfg",
            datasetOrCohortRef: "co",
            tenantScope: TENANT,
            confidentialityScope: "enterprise",
            expiresAt: "2026-09-07T00:00:00.000Z",
            maxResourceBudget: 1,
          },
        },
        grantId: "grant-1",
        tenantScope: TENANT,
        surfaceId: "system.runtime-binding-governance",
        commandId: "cmd-rb",
      },
      scope: "canary",
      idempotencyKey: "rb-pause",
    });
    const before = evaluationEvents().length;
    const rolled = await adapter.rollback(application);
    expect(rolled.status).toBe("rolled_back");
    expect(evaluationEvents()).toHaveLength(before);
    expect(
      listGovernanceEffectVerifications().find(
        (row) => row.applicationId === application.applicationId,
      )?.status,
    ).toBe("escalated");
  });

  it("rollback restores only this application bindings and keeps later human edits", async () => {
    seedAgent();
    const keepOff = seedBinding("cap-keep-human");
    runtime.updateBindingState(keepOff.bindingId, "disabled");
    const active = seedBinding("cap-act-human");
    const adapter = createRuntimeGovernanceAdapter(createLiveRuntimeGovernancePort(), {
      persistDir: path.join(persistDir, "human"),
    });
    const context = {
      proposal: {
        schemaVersion: 2 as const,
        proposalId: "evo:human",
        sourceEvidenceRefs: ["ev-a"],
        sourceMechanismRef: "case",
        target: { domain: "system" as const, componentId: AGENT_ID },
        candidateRef: "cand-human",
        surfaceId: "system.runtime-binding-governance",
        expectedEffects: [runtimeGovernanceMetricSet().primary],
        riskLevel: "critical" as const,
        confidentialityScope: "enterprise" as const,
        tenantScope: TENANT,
        grantId: "grant-1",
        status: "APPROVED_FOR_EXPERIMENT" as const,
        createdAt: "2026-09-06T10:00:00.000Z",
        expiresAt: "2026-09-07T00:00:00.000Z",
      },
      experiment: {
        schemaVersion: 1 as const,
        experimentId: "exp-human",
        proposalId: "evo:human",
        surfaceId: "system.runtime-binding-governance",
        target: { domain: "system" as const, componentId: AGENT_ID },
        tenantScope: TENANT,
        baselineRef: "v1",
        candidateRef: "cand-human",
        configRef: "cfg",
        assignment: { strategy: "canary" as const, treatmentRefs: ["t"], controlRefs: ["c"] },
        primaryMetric: runtimeGovernanceMetricSet().primary,
        guardrailMetrics: runtimeGovernanceMetricSet().guardrails,
        minimumSampleSize: 20,
        requiredConfidence: 0.9,
        expiresAt: "2026-09-07T00:00:00.000Z",
        result: "pending" as const,
        frozen: {
          baselineVersion: "v1",
          candidateVersion: "cand-human",
          codeSha: "sha",
          modelRef: "m",
          providerVersion: "p",
          configSnapshotRef: "cfg",
          datasetOrCohortRef: "co",
          tenantScope: TENANT,
          confidentialityScope: "enterprise" as const,
          expiresAt: "2026-09-07T00:00:00.000Z",
          maxResourceBudget: 1,
        },
      },
      grantId: "grant-1",
      tenantScope: TENANT,
      surfaceId: "system.runtime-binding-governance",
      commandId: "cmd-human",
    };
    const application = await adapter.apply({
      candidate: {
        kind: "runtime-action",
        runtimeAgentId: AGENT_ID,
        action: "pause",
        candidateVersion: "cand-human",
      },
      context,
      scope: "canary",
      idempotencyKey: "human-pause",
    });
    expect(runtime.getBinding(active.bindingId)?.bindingState).toBe("disabled");
    await expect(
      adapter.apply({
        candidate: {
          kind: "runtime-action",
          runtimeAgentId: AGENT_ID,
          action: "limit",
          candidateVersion: "cand-human-2",
        },
        context: {
          ...context,
          proposal: {
            ...context.proposal,
            proposalId: "evo:human-2",
            candidateRef: "cand-human-2",
          },
          experiment: {
            ...context.experiment,
            experimentId: "exp-human-2",
            proposalId: "evo:human-2",
          },
          commandId: "cmd-human-2",
        },
        scope: "canary",
        idempotencyKey: "human-pause-2",
      }),
    ).rejects.toThrow(/multiple live/);
    runtime.updateBindingState(active.bindingId, "degraded");
    const extra = seedBinding("cap-extra-human");
    runtime.updateBindingState(extra.bindingId, "warming");
    const rolled = await adapter.rollback(application);
    expect(rolled.status).toBe("rolled_back");
    expect(runtime.getBinding(active.bindingId)?.bindingState).toBe("degraded");
    expect(runtime.getBinding(keepOff.bindingId)?.bindingState).toBe("disabled");
    expect(runtime.getBinding(extra.bindingId)?.bindingState).toBe("warming");
  });

  it("keeps assist, kill switch, open windows, and expired grants fail-closed", async () => {
    seedAgent();
    seedBinding("cap-neg");
    const assistPort = createMemoryRuntimeGovernancePort({
      mode: "assist",
      agents: [
        {
          runtimeAgentId: AGENT_ID,
          version: "seed",
          bindings: [{ bindingId: "bind-1", state: "active" }],
        },
      ],
    });
    const assistAdapter = createRuntimeGovernanceAdapter(assistPort, {
      persistDir: path.join(persistDir, "assist"),
      governanceConfigDir: path.join(persistDir, "assist-gov"),
    });
    const denied = await assistAdapter.validate(
      {
        kind: "runtime-action",
        runtimeAgentId: AGENT_ID,
        action: "pause",
        candidateVersion: "cand-neg",
      },
      {
        proposal: {
          schemaVersion: 2,
          proposalId: "evo:neg",
          sourceEvidenceRefs: ["ev-a"],
          sourceMechanismRef: "case",
          target: { domain: "system", componentId: AGENT_ID },
          candidateRef: "cand-neg",
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
        experiment: {
          schemaVersion: 1,
          experimentId: "exp-neg",
          proposalId: "evo:neg",
          surfaceId: "system.runtime-binding-governance",
          target: { domain: "system", componentId: AGENT_ID },
          tenantScope: TENANT,
          baselineRef: "v1",
          candidateRef: "cand-neg",
          configRef: "cfg",
          assignment: { strategy: "canary", treatmentRefs: ["t"], controlRefs: ["c"] },
          primaryMetric: runtimeGovernanceMetricSet().primary,
          guardrailMetrics: runtimeGovernanceMetricSet().guardrails,
          minimumSampleSize: 20,
          requiredConfidence: 0.9,
          expiresAt: "2026-09-07T00:00:00.000Z",
          result: "pending",
          frozen: {
            baselineVersion: "v1",
            candidateVersion: "cand-neg",
            codeSha: "sha",
            modelRef: "m",
            providerVersion: "p",
            configSnapshotRef: "cfg",
            datasetOrCohortRef: "co",
            tenantScope: TENANT,
            confidentialityScope: "enterprise",
            expiresAt: "2026-09-07T00:00:00.000Z",
            maxResourceBudget: 1,
          },
        },
        grantId: "grant-1",
        tenantScope: TENANT,
        surfaceId: "system.runtime-binding-governance",
        commandId: "cmd-neg",
      },
    );
    expect(denied).toMatchObject({ code: "assist_zero_mutation" });

    setGovernanceKillSwitch(true);
    await expect(
      createRuntimeGovernanceAdapter(createLiveRuntimeGovernancePort()).validate(
        {
          kind: "runtime-action",
          runtimeAgentId: AGENT_ID,
          action: "pause",
          candidateVersion: "cand-ks",
        },
        {
          proposal: {
            schemaVersion: 2,
            proposalId: "evo:ks",
            sourceEvidenceRefs: ["ev-a"],
            sourceMechanismRef: "case",
            target: { domain: "system", componentId: AGENT_ID },
            candidateRef: "cand-ks",
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
          experiment: {
            schemaVersion: 1,
            experimentId: "exp-ks",
            proposalId: "evo:ks",
            surfaceId: "system.runtime-binding-governance",
            target: { domain: "system", componentId: AGENT_ID },
            tenantScope: TENANT,
            baselineRef: "v1",
            candidateRef: "cand-ks",
            configRef: "cfg",
            assignment: { strategy: "canary", treatmentRefs: ["t"], controlRefs: ["c"] },
            primaryMetric: runtimeGovernanceMetricSet().primary,
            guardrailMetrics: runtimeGovernanceMetricSet().guardrails,
            minimumSampleSize: 20,
            requiredConfidence: 0.9,
            expiresAt: "2026-09-07T00:00:00.000Z",
            result: "pending",
            frozen: {
              baselineVersion: "v1",
              candidateVersion: "cand-ks",
              codeSha: "sha",
              modelRef: "m",
              providerVersion: "p",
              configSnapshotRef: "cfg",
              datasetOrCohortRef: "co",
              tenantScope: TENANT,
              confidentialityScope: "enterprise",
              expiresAt: "2026-09-07T00:00:00.000Z",
              maxResourceBudget: 1,
            },
          },
          grantId: "grant-1",
          tenantScope: TENANT,
          surfaceId: "system.runtime-binding-governance",
          commandId: "cmd-ks",
        },
      ),
    ).resolves.toMatchObject({ code: "kill_switch_active" });
    setGovernanceKillSwitch(false);

    const beforeFail = listGovernanceEffectVerifications().length;
    const failAdapter = createRuntimeGovernanceAdapter(createLiveRuntimeGovernancePort(), {
      persistDir: path.join(persistDir, "fail-action"),
    });
    await expect(
      failAdapter.apply({
        candidate: {
          kind: "runtime-action",
          runtimeAgentId: AGENT_ID,
          action: "resume",
          candidateVersion: "cand-fail",
        },
        context: {
          proposal: {
            schemaVersion: 2,
            proposalId: "evo:fail",
            sourceEvidenceRefs: ["ev-a"],
            sourceMechanismRef: "case",
            target: { domain: "system", componentId: AGENT_ID },
            candidateRef: "cand-fail",
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
          experiment: {
            schemaVersion: 1,
            experimentId: "exp-fail",
            proposalId: "evo:fail",
            surfaceId: "system.runtime-binding-governance",
            target: { domain: "system", componentId: AGENT_ID },
            tenantScope: TENANT,
            baselineRef: "v1",
            candidateRef: "cand-fail",
            configRef: "cfg",
            assignment: { strategy: "canary", treatmentRefs: ["t"], controlRefs: ["c"] },
            primaryMetric: runtimeGovernanceMetricSet().primary,
            guardrailMetrics: runtimeGovernanceMetricSet().guardrails,
            minimumSampleSize: 20,
            requiredConfidence: 0.9,
            expiresAt: "2026-09-07T00:00:00.000Z",
            result: "pending",
            frozen: {
              baselineVersion: "v1",
              candidateVersion: "cand-fail",
              codeSha: "sha",
              modelRef: "m",
              providerVersion: "p",
              configSnapshotRef: "cfg",
              datasetOrCohortRef: "co",
              tenantScope: TENANT,
              confidentialityScope: "enterprise",
              expiresAt: "2026-09-07T00:00:00.000Z",
              maxResourceBudget: 1,
            },
          },
          grantId: "grant-1",
          tenantScope: TENANT,
          surfaceId: "system.runtime-binding-governance",
          commandId: "cmd-fail",
        },
        scope: "canary",
        idempotencyKey: "fail-resume",
      }),
    ).rejects.toThrow(/no-pause-snapshot|runtime action failed/);
    expect(listGovernanceEffectVerifications()).toHaveLength(beforeFail);
    const untrustedClose = {
      effectVerificationId: "missing",
      status: "resumed" as const,
    };
    expect(() => closeGovernanceEffectWindow(untrustedClose)).toThrow(/untrusted-status-close/);
    expect(() => registerRuntimeEffectVerifier()).toThrow(
      /runtime-verifier-self-registration-forbidden/,
    );
    expect(() =>
      submitGovernanceEffectDecision({
        decisionId: "plain-token",
        effectVerificationId: "missing",
        decidedBy: "runtime_verifier",
        decision: "hold",
        evidenceRefs: ["ev"],
        sourceReceiptRef: "verifier:self:ok",
        verifierId: "self",
        capabilityToken: "i-chose-this",
      }),
    ).toThrow(/runtime-verifier-unavailable/);

    const openWindow = openGovernanceEffectWindow({
      runtimeAgentId: AGENT_ID,
      reason: "evolution:open",
      action: "pause",
      commandId: "open-bound",
      binding: {
        proposalId: "evo:open",
        experimentId: "exp-open",
        applicationId: "app:open",
        tenantId: TENANT,
        domainReceiptRef: "receipt:open",
      },
    });
    const liveAdapter = createRuntimeGovernanceAdapter(createLiveRuntimeGovernancePort());
    const emptyPrimary = await liveAdapter.observeTarget?.(
      { domain: "system", componentId: AGENT_ID },
      "w-neg",
      {
        windowId: "w-neg",
        experimentId: "exp-open",
        phase: "treatment",
        startedAt: new Date(Date.now() - 10_000).toISOString(),
        endedAt: new Date().toISOString(),
        tenantScope: TENANT,
        targetKey: `system:${AGENT_ID}`,
        modelRevision: "m",
        configRevision: "cfg",
        cohortRef: "co",
      },
    );
    expect(emptyPrimary ?? []).toEqual([]);
    const beforeTick = listGovernanceEffectVerifications().find((row) => row.id === openWindow.id);
    expect(beforeTick?.status).toBe("open");
    runEvolutionGovernancePipeline();
    expect(
      listGovernanceEffectVerifications().find((row) => row.id === openWindow.id)?.status,
    ).toBe("open");

    const expiredPlane = createEvolutionControlPlane({
      persistDir: path.join(persistDir, "expired"),
      inspector: testInspector(TENANT, {
        expired: true,
        status: "EXPIRED",
        allowedActions: ["suggest", "experiment", "apply", "verify", "promote", "platform"],
        confidentialityCeiling: "platform",
      }),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      runtimeGovernanceAdapter: createRuntimeGovernanceAdapter(createLiveRuntimeGovernancePort()),
    });
    expiredPlane.registerProposal(
      {
        schemaVersion: 2,
        proposalId: "evo:expired",
        sourceEvidenceRefs: ["ev-a"],
        sourceMechanismRef: "case",
        target: { domain: "system", componentId: AGENT_ID },
        candidateRef: "cand:expired",
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
        runtimeAgentId: AGENT_ID,
        action: "pause",
        candidateVersion: "cand:expired",
      },
    );
    await expect(
      expiredPlane.startExperiment({
        commandId: "exp-expired",
        proposalId: "evo:expired",
        now: "2026-09-06T11:00:00.000Z",
        freeze: {
          baselineVersion: "v1",
          candidateVersion: "cand:expired",
          codeSha: "sha",
          modelRef: "m",
          providerVersion: "p",
          configSnapshotRef: "cfg",
          datasetOrCohortRef: "co",
          tenantScope: TENANT,
          confidentialityScope: "enterprise",
          expiresAt: "2026-09-07T00:00:00.000Z",
          maxResourceBudget: 1,
        },
      }),
    ).rejects.toThrow(/expired|grant/i);
  });

  it("opens the next control generation after the first window closes", () => {
    setEvolutionGovernanceModeForTests("assist");
    seedAgent();
    seedBinding("cap-rotate");
    const startNow = Date.now() - 90_000;
    const first = runOfficialCycles(SAMPLE_SIZE, startNow, (now, index) => {
      writeSkillInvocations({
        count: 1,
        startMs: now,
        prefix: `rotate-${index}`,
        outcome: "failure",
      });
    });
    const closed = controlWindows().filter(
      (row) => row.status === "held" || row.status === "resumed",
    );
    expect(closed.length).toBeGreaterThanOrEqual(1);
    expect(controlWindows().some((row) => row.status === "open")).toBe(false);
    const firstId = closed[0]?.id;
    const firstCommandId = closed[0]?.commandId;
    runOfficialCycles(1, first.now, (now) => {
      writeSkillInvocations({
        count: 1,
        startMs: now,
        prefix: "rotate-next",
        outcome: "failure",
      });
    });
    const opened = controlWindows().find((row) => row.status === "open");
    expect(opened).toBeTruthy();
    expect(opened?.id).not.toBe(firstId);
    expect(opened?.commandId).not.toBe(firstCommandId);
    expect(opened?.commandId).toMatch(new RegExp(`^control:${AGENT_ID}:`));
    expect(opened?.evaluationCount).toBe(1);
    runEvolutionGovernancePipeline({ now: first.now + 1 });
    expect(controlWindows().filter((row) => row.status === "open")).toHaveLength(1);
    expect(controlWindows().find((row) => row.status === "open")?.id).toBe(opened?.id);
  });

  it("marks baseline incomplete when Tick cycles lack critical sensors", async () => {
    seedAgent();
    seedBinding("cap-incomplete");
    const incompleteStart = Date.now() - 90_000;
    const idleTicks = runOfficialCycles(SAMPLE_SIZE, incompleteStart);
    expect(idleTicks.written).toBe(0);
    expect(controlWindow()?.status).toBe("open");
    expect(controlWindow()?.evaluationCount ?? 0).toBe(0);
    expect(evaluationEvents()).toHaveLength(0);
    const incompletePlane = createPlane();
    incompletePlane.registerProposal(
      {
        schemaVersion: 2,
        proposalId: "evo:incomplete",
        sourceEvidenceRefs: ["ev-a"],
        sourceMechanismRef: "case",
        target: { domain: "system", componentId: AGENT_ID },
        candidateRef: "cand:incomplete",
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
        runtimeAgentId: AGENT_ID,
        action: "pause",
        candidateVersion: "cand:incomplete",
      },
    );
    const incomplete = await incompletePlane.startExperiment({
      commandId: "exp-incomplete",
      proposalId: "evo:incomplete",
      now: new Date(incompleteStart).toISOString(),
      freeze: {
        baselineVersion: "v1",
        candidateVersion: "cand:incomplete",
        codeSha: "sha",
        modelRef: "m",
        providerVersion: "p",
        configSnapshotRef: "cfg",
        datasetOrCohortRef: "co",
        tenantScope: TENANT,
        confidentialityScope: "enterprise",
        expiresAt: "2026-09-07T00:00:00.000Z",
        maxResourceBudget: 1,
      },
    });
    expect(["missing", "incomplete"]).toContain(incomplete.baselineCapture?.status);
    expect(incomplete.baselineCapture?.primaryPresent).toBe(false);
    expect(incomplete.baselineCapture?.missingCriticalGuardrails).toEqual(
      expect.arrayContaining(["security_violations", "cross_tenant_contamination"]),
    );
  });
});
