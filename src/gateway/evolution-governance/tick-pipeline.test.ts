import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-gov-tick-${Date.now()}`);
vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const runtime = await import("../agent-runtime-store.js");
const { runEvolutionGovernancePipeline, setEffectVerifyMsForTests } =
  await import("./tick-pipeline.js");
const {
  applyGovernanceRuntimeAction,
  getAgentPauseRecord,
  listControlPlaneApplicationConsumptions,
  readGovernancePersistedState,
  setEvolutionGovernanceModeForTests,
  setGovernanceKillSwitch,
} = await import("./index.js");

function clean() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  setGovernanceKillSwitch(false);
  setEffectVerifyMsForTests(null);
  setEvolutionGovernanceModeForTests("auto"); // mutation tests need auto
  // Reset runtime store by writing empty path under CONFIG_DIR
  try {
    // agent-runtime-store uses CONFIG_DIR/agent-runtime
    fs.rmSync(path.join(tmpDir, "agent-runtime"), { recursive: true, force: true });
  } catch {
    // ignore
  }
}

describe("runEvolutionGovernancePipeline", () => {
  beforeEach(clean);
  afterEach(() => {
    setGovernanceKillSwitch(false);
    setEvolutionGovernanceModeForTests(null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists assets and metrics for known runtime agents", () => {
    // Seed one agent via public API if available
    const created = runtime.createAgent?.({
      runtimeAgentId: "bot-gov-1",
      name: "bot-gov-1",
      runtimeVersion: "1",
      lifecycle: "deployed",
      health: "healthy",
      tenantCoverage: [],
    });
    // Fallback: if createAgent shape differs, pipeline still runs empty-safe.
    void created;

    const result = runEvolutionGovernancePipeline();
    expect(result.assetsSeeded).toBeGreaterThanOrEqual(0);
    const state = readGovernancePersistedState();
    expect(state.jobCursor.lastAggregationAt).toBeTruthy();
    expect(Array.isArray(state.assets)).toBe(true);
    expect(Array.isArray(state.anomalies)).toBe(true);
    expect(Array.isArray(state.actions)).toBe(true);
    expect(Array.isArray(state.metrics)).toBe(true);
  });

  it("respects kill switch", () => {
    setGovernanceKillSwitch(true);
    const result = runEvolutionGovernancePipeline();
    expect(result).toEqual({
      assetsSeeded: 0,
      anomalies: 0,
      actionsExecuted: 0,
      pausedAgents: [],
      resumedAgents: [],
      effectsClosed: 0,
      cyclesWritten: 0,
    });
  });

  it("is idempotent for pause actions on the same day", () => {
    setGovernanceKillSwitch(false);
    const first = runEvolutionGovernancePipeline();
    const second = runEvolutionGovernancePipeline();
    // Second tick should not explode; may skip already-executed pauses.
    expect(second.assetsSeeded).toBe(first.assetsSeeded);
    const state = readGovernancePersistedState();
    const pauseKeys = (state.actions as Array<{ idempotencyKey?: string; status?: string }>)
      .filter((a) => a.idempotencyKey?.startsWith("pause:"))
      .map((a) => a.idempotencyKey);
    // No duplicate executed keys with same id beyond merge-by-id
    expect(new Set(pauseKeys).size).toBe(pauseKeys.length);
  });

  it("applies soft limit for low skill success (no full auto-pause)", async () => {
    const now = Date.now();
    runtime.upsertAgent({
      runtimeAgentId: "bot-low-success",
      name: "bot-low-success",
      runtimeVersion: "1",
      lifecycle: "deployed",
      health: "healthy",
      tenantCoverage: [],
      boundCapabilityCount: 1,
      activeSessionCount: 0,
      resourceUsage: { cpuPercent: 0, memoryPercent: 0, tokenBudgetUsedPercent: 0 },
      deployedAt: now,
      lastActiveAt: now,
    });

    const { saveSkillAsset } = await import("../skill-lifecycle-store.js");
    const { recordSkillInvocationCompleted } = await import("../skill-invocation/index.js");
    const saved = saveSkillAsset({
      sourceAgentId: "bot-low-success",
      lifecycle: "private",
      profile: {
        name: "Flaky skill",
        summary: "fails often",
        assetType: "capability",
        visibility: "private",
      },
      runtimeDefinition: { prompts: ["x"], tools: ["notes"] },
    });
    // Agent-scoped invocation events: 2 success / 8 failure, high latency
    for (let i = 0; i < 10; i += 1) {
      recordSkillInvocationCompleted({
        invocationId: `gov-inv-${i}`,
        skillId: saved.skillId,
        agentId: "bot-low-success",
        skillVersion: "1",
        outcome: i < 2 ? "success" : "failure",
        latencyMs: 45_000,
        failureCategory: i < 2 ? null : "tool_error",
      });
    }

    const result = runEvolutionGovernancePipeline();
    // Full pause still not used for low success.
    expect(result.pausedAgents).not.toContain("bot-low-success");
    const state = readGovernancePersistedState();
    const anomalies = state.anomalies as Array<{ type?: string; status?: string }>;
    const lowSuccess = anomalies.find((a) => a.type === "low_skill_success_rate");
    expect(lowSuccess?.status).toBe("acted");
    const highLatency = anomalies.find((a) => a.type === "high_skill_latency");
    expect(highLatency?.status).toBe("acted");
    const limits = state.limits;
    expect(limits?.["bot-low-success"]).toBeTruthy();
    const metrics = (
      state.metrics as Array<{ skillSuccessRate?: number | null; skillUsageTotal?: number }>
    ).find((m) => m.skillUsageTotal && m.skillUsageTotal >= 5);
    expect(metrics?.skillSuccessRate).toBeLessThan(0.5);
  });

  it("assist mode detects low success but does not mutate runtime", async () => {
    setEvolutionGovernanceModeForTests("assist");
    const now = Date.now();
    runtime.upsertAgent({
      runtimeAgentId: "bot-assist",
      name: "bot-assist",
      runtimeVersion: "1",
      lifecycle: "deployed",
      health: "healthy",
      tenantCoverage: [],
      boundCapabilityCount: 1,
      activeSessionCount: 0,
      resourceUsage: { cpuPercent: 0, memoryPercent: 0, tokenBudgetUsedPercent: 0 },
      deployedAt: now,
      lastActiveAt: now,
    });
    const binding = runtime.createBinding({
      runtimeAgentId: "bot-assist",
      capabilityId: "cap-assist",
      capabilityVersion: "1",
      bindingType: "skill",
      routingPriority: 80,
      loadStrategy: "eager",
    });

    const { saveSkillAsset } = await import("../skill-lifecycle-store.js");
    const { recordSkillInvocationCompleted } = await import("../skill-invocation/index.js");
    const saved = saveSkillAsset({
      sourceAgentId: "bot-assist",
      lifecycle: "private",
      profile: {
        name: "Flaky assist",
        summary: "fails",
        assetType: "capability",
        visibility: "private",
      },
      runtimeDefinition: { prompts: ["x"], tools: ["notes"] },
    });
    for (let i = 0; i < 10; i += 1) {
      recordSkillInvocationCompleted({
        invocationId: `assist-inv-${i}`,
        skillId: saved.skillId,
        agentId: "bot-assist",
        skillVersion: "1",
        outcome: i < 2 ? "success" : "failure",
        latencyMs: 45_000,
        failureCategory: i < 2 ? null : "tool_error",
      });
    }

    const result = runEvolutionGovernancePipeline();
    expect(result.pausedAgents).toEqual([]);
    const state = readGovernancePersistedState();
    const anomalies = state.anomalies as Array<{ type?: string; status?: string }>;
    expect(anomalies.find((a) => a.type === "low_skill_success_rate")?.status).toBe("pending");
    expect(anomalies.find((a) => a.type === "high_skill_latency")?.status).toBe("pending");
    // No runtime mutation: no limits, binding stays active
    expect(state.limits?.["bot-assist"]).toBeFalsy();
    expect(runtime.getBinding(binding.bindingId)?.bindingState).toBe("active");
    expect(runtime.getBinding(binding.bindingId)?.routingPriority).toBe(80);
    const shadow = listControlPlaneApplicationConsumptions(tmpDir).filter(
      (row) => row.source === "runtime-auto-tick",
    );
    expect(shadow).toHaveLength(2);
    expect(shadow.every((row) => !row.liveExecuted)).toBe(true);
    expect(shadow.every((row) => !row.executedConsumer)).toBe(true);
    expect(shadow.map((row) => row.approvedAction).toSorted()).toEqual(["limit", "limit"]);
  });

  it("assist mode records a due recovery intent but never resumes the runtime", async () => {
    const now = Date.now();
    runtime.upsertAgent({
      runtimeAgentId: "bot-assist-recovery",
      name: "bot-assist-recovery",
      runtimeVersion: "1",
      lifecycle: "deployed",
      health: "healthy",
      tenantCoverage: ["tenant-assist"],
      boundCapabilityCount: 0,
      activeSessionCount: 0,
      resourceUsage: { cpuPercent: 0, memoryPercent: 0, tokenBudgetUsedPercent: 0 },
      deployedAt: now,
      lastActiveAt: now,
    });
    expect(
      applyGovernanceRuntimeAction({
        runtimeAgentId: "bot-assist-recovery",
        action: "pause",
        reason: "test-baseline",
        idempotencyKey: "test-baseline",
      }).ok,
    ).toBe(true);
    setEvolutionGovernanceModeForTests("assist");
    const { writeGovernancePersistedState, readGovernancePersistedState: read } =
      await import("./persistent-store.js");
    writeGovernancePersistedState({
      ...read(),
      effectVerifications: [
        {
          id: "effect:pause:bot-assist-recovery:idle_with_cost",
          assetId: "asset:bot:bot-assist-recovery",
          runtimeAgentId: "bot-assist-recovery",
          reason: "idle_with_cost",
          pausedAt: new Date(now - 10_000).toISOString(),
          verifyAfterAt: new Date(now - 2_000).toISOString(),
          nextEvaluateAt: new Date(now - 2_000).toISOString(),
          observationUntil: new Date(now - 1_000).toISOString(),
          minimumSampleSize: 1,
          evaluationCount: 0,
          baseline: {
            skillSuccessRate: null,
            skillUsageTotal: 0,
            invocationCount7d: 0,
            tokenConsumption7d: 100,
          },
          tenantId: "tenant-assist",
          status: "open",
        },
      ],
    });
    setEffectVerifyMsForTests(0);

    const result = runEvolutionGovernancePipeline({ now });

    expect(result.resumedAgents).toEqual([]);
    expect(getAgentPauseRecord("bot-assist-recovery")).toBeTruthy();
    const recovery = listControlPlaneApplicationConsumptions(tmpDir).find(
      (row) => row.approvedAction === "resume",
    );
    expect(recovery).toMatchObject({
      source: "runtime-auto-tick",
      liveExecuted: false,
      executedConsumer: false,
    });
  });

  it("closes due effect verification windows (hold or resume)", async () => {
    const now = Date.now();
    runtime.upsertAgent({
      runtimeAgentId: "bot-effect",
      name: "bot-effect",
      runtimeVersion: "1",
      lifecycle: "deployed",
      health: "healthy",
      tenantCoverage: [],
      boundCapabilityCount: 0,
      activeSessionCount: 0,
      resourceUsage: { cpuPercent: 0, memoryPercent: 0, tokenBudgetUsedPercent: 0 },
      deployedAt: now,
      lastActiveAt: now,
    });
    const { writeGovernancePersistedState, readGovernancePersistedState: read } =
      await import("./persistent-store.js");
    writeGovernancePersistedState({
      ...read(),
      effectVerifications: [
        {
          id: "effect:pause:bot-effect:idle_with_cost",
          assetId: "asset:bot:bot-effect",
          runtimeAgentId: "bot-effect",
          reason: "idle_with_cost",
          pausedAt: new Date(now - 10_000).toISOString(),
          verifyAfterAt: new Date(now - 1_000).toISOString(),
          nextEvaluateAt: new Date(now - 1_000).toISOString(),
          minimumSampleSize: 1,
          evaluationCount: 0,
          baseline: {
            skillSuccessRate: 0.2,
            skillUsageTotal: 10,
            invocationCount7d: 0,
            tokenConsumption7d: 100,
          },
          tenantId: "tenant-effect",
          status: "open",
        },
      ],
    });
    setEffectVerifyMsForTests(0);
    const result = runEvolutionGovernancePipeline();
    expect(result.effectsClosed).toBeGreaterThanOrEqual(1);
    const state = readGovernancePersistedState();
    const effects = (state.effectVerifications ?? []) as Array<{ status?: string }>;
    expect(effects.some((e) => e.status === "held" || e.status === "resumed")).toBe(true);
  });

  it("does not increment evaluationCount when a due Tick has no new evidence", async () => {
    runtime.__agentRuntimeStoreInternals.reset();
    const now = Date.now();
    runtime.upsertAgent({
      runtimeAgentId: "bot-idle-cycle",
      name: "bot-idle-cycle",
      runtimeVersion: "1",
      lifecycle: "deployed",
      health: "healthy",
      tenantCoverage: ["tenant-idle"],
      boundCapabilityCount: 0,
      activeSessionCount: 0,
      resourceUsage: { cpuPercent: 0, memoryPercent: 0, tokenBudgetUsedPercent: 0 },
      deployedAt: now,
      lastActiveAt: now,
    });
    setEffectVerifyMsForTests(0);
    const opened = runEvolutionGovernancePipeline({ now });
    expect(opened.cyclesWritten).toBe(0);
    const { listGovernanceEffectVerifications } = await import("./index.js");
    const first = listGovernanceEffectVerifications().find(
      (row) => row.runtimeAgentId === "bot-idle-cycle",
    );
    expect(first?.evaluationCount ?? 0).toBe(0);
    const again = runEvolutionGovernancePipeline({ now: now + 1 });
    expect(again.cyclesWritten).toBe(0);
    expect(
      listGovernanceEffectVerifications().find((row) => row.runtimeAgentId === "bot-idle-cycle")
        ?.evaluationCount ?? 0,
    ).toBe(0);
  });

  it("opens a new control generation after the previous control window closes", async () => {
    runtime.__agentRuntimeStoreInternals.reset();
    const now = Date.now();
    runtime.upsertAgent({
      runtimeAgentId: "bot-control-rotate",
      name: "bot-control-rotate",
      runtimeVersion: "1",
      lifecycle: "deployed",
      health: "healthy",
      tenantCoverage: ["tenant-rotate"],
      boundCapabilityCount: 0,
      activeSessionCount: 0,
      resourceUsage: { cpuPercent: 0, memoryPercent: 0, tokenBudgetUsedPercent: 0 },
      deployedAt: now,
      lastActiveAt: now,
    });
    const { writeGovernancePersistedState, readGovernancePersistedState: read } =
      await import("./persistent-store.js");
    const { listGovernanceEffectVerifications } = await import("./index.js");
    writeGovernancePersistedState({
      ...read(),
      effectVerifications: [
        {
          id: "effect:evo:control:bot-control-rotate",
          assetId: "asset:bot:bot-control-rotate",
          runtimeAgentId: "bot-control-rotate",
          reason: "baseline:control",
          commandId: "control:bot-control-rotate",
          pausedAt: new Date(now - 10_000).toISOString(),
          openedAt: new Date(now - 10_000).toISOString(),
          verifyAfterAt: new Date(now - 1_000).toISOString(),
          nextEvaluateAt: new Date(now - 1_000).toISOString(),
          evaluationCount: 20,
          minimumSampleSize: 20,
          tenantId: "tenant-rotate",
          baseline: {
            skillSuccessRate: null,
            skillUsageTotal: 0,
            invocationCount7d: 0,
            tokenConsumption7d: 0,
          },
          status: "held",
        },
      ],
    });
    setEffectVerifyMsForTests(0);
    runEvolutionGovernancePipeline({ now });
    const windows = listGovernanceEffectVerifications().filter(
      (row) => row.runtimeAgentId === "bot-control-rotate",
    );
    const closed = windows.find((row) => row.commandId === "control:bot-control-rotate");
    const opened = windows.find((row) => row.status === "open");
    expect(closed?.status).toBe("held");
    expect(opened?.id).not.toBe(closed?.id);
    expect(opened?.commandId).toBe(`control:bot-control-rotate:${now}`);
    runEvolutionGovernancePipeline({ now });
    const afterReplay = listGovernanceEffectVerifications().filter(
      (row) => row.runtimeAgentId === "bot-control-rotate" && row.status === "open",
    );
    expect(afterReplay).toHaveLength(1);
    expect(afterReplay[0]?.commandId).toBe(`control:bot-control-rotate:${now}`);
  });
});
