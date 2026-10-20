import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-e5-shadow-${Date.now()}`);
vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const runtime = await import("../agent-runtime-store.js");
const {
  listControlPlaneApplicationShadows,
  recordRuntimeAutoApplicationShadow,
  recordSkillAutoApplicationShadow,
  resetControlPlaneApplicationShadowForTests,
  runEvolutionGovernancePipeline,
  runSkillAutoEvolutionPass,
  setEffectVerifyMsForTests,
  setEvolutionGovernanceModeForTests,
  setGovernanceKillSwitch,
  setSkillAutoEvolutionForTests,
} = await import("./index.js");
const {
  ingestPatternSample,
  listPatternCandidates,
  approvePatternCandidate,
  structureHashFromText,
  resetPatternDetectionStoreForTests,
} = await import("../pattern-detection/index.js");
const { listRobotSkillAssets } = await import("../skill-lifecycle-store.js");

function seedLowSuccessAgent(agentId: string) {
  const now = Date.now();
  runtime.upsertAgent({
    runtimeAgentId: agentId,
    name: agentId,
    runtimeVersion: "1",
    lifecycle: "deployed",
    health: "healthy",
    tenantCoverage: ["tenant-e5"],
    boundCapabilityCount: 1,
    activeSessionCount: 0,
    resourceUsage: { cpuPercent: 0, memoryPercent: 0, tokenBudgetUsedPercent: 0 },
    deployedAt: now,
    lastActiveAt: now,
  });
  return runtime.createBinding({
    runtimeAgentId: agentId,
    capabilityId: `cap-${agentId}`,
    capabilityVersion: "1",
    bindingType: "skill",
    routingPriority: 80,
    loadStrategy: "eager",
  });
}

async function seedFlakyInvocations(agentId: string) {
  const { saveSkillAsset } = await import("../skill-lifecycle-store.js");
  const { recordSkillInvocationCompleted } = await import("../skill-invocation/index.js");
  const saved = saveSkillAsset({
    sourceAgentId: agentId,
    lifecycle: "private",
    profile: {
      name: "Flaky e5",
      summary: "fails",
      assetType: "capability",
      visibility: "private",
    },
    runtimeDefinition: { prompts: ["x"], tools: ["notes"] },
  });
  for (let i = 0; i < 10; i += 1) {
    recordSkillInvocationCompleted({
      invocationId: `e5-${agentId}-${i}`,
      skillId: saved.skillId,
      agentId,
      skillVersion: "1",
      outcome: i < 2 ? "success" : "failure",
      latencyMs: 45_000,
      failureCategory: i < 2 ? null : "tool_error",
    });
  }
}

function seedSkillCandidate(agentId: string) {
  const hash = structureHashFromText("# E5 shadow\n1. a\n- b");
  const out = structureHashFromText("# Out\n- ok");
  for (let i = 1; i <= 3; i += 1) {
    ingestPatternSample({
      agentId,
      runId: `e5-run-${agentId}-${i}`,
      taskId: `e5-task-${agentId}-${i}`,
      inputStructureHash: hash,
      outputStructureHash: out,
      success: true,
      suggestedNameHint: "E5 对照技能",
    });
  }
  return listPatternCandidates({ agentId })[0];
}

describe("control-plane Application shadow (E5)", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    runtime.__agentRuntimeStoreInternals.reset();
    resetControlPlaneApplicationShadowForTests();
    resetPatternDetectionStoreForTests();
    setGovernanceKillSwitch(false);
    setEffectVerifyMsForTests(null);
    setEvolutionGovernanceModeForTests("auto");
    setSkillAutoEvolutionForTests(true);
  });

  afterEach(() => {
    setGovernanceKillSwitch(false);
    setEvolutionGovernanceModeForTests(null);
    setSkillAutoEvolutionForTests(null);
    setEffectVerifyMsForTests(null);
    resetControlPlaneApplicationShadowForTests();
    resetPatternDetectionStoreForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("records a shadow Application that does not apply to runtime", () => {
    const shadow = recordRuntimeAutoApplicationShadow({
      commandId: "pause:bot-e5:idle_with_cost:2026-09-21",
      runtimeAgentId: "bot-e5",
      action: "pause",
      liveExecuted: true,
    });
    expect(shadow.cutoverReady).toBe(false);
    expect(shadow.intendedApplication.scope).toBe("shadow");
    expect(shadow.intendedApplication.appliedToRuntime).toBe(false);
    expect(shadow.intendedApplication.surfaceId).toBe("system.runtime-binding-governance");
    expect(shadow.aligned).toBe(true);
  });

  it("records a skill-install shadow without installing", () => {
    const shadow = recordSkillAutoApplicationShadow({
      commandId: "skill-auto-install:cand-1:skill-1",
      agentId: "robot-e5",
      skillId: "skill-1",
      liveExecuted: true,
    });
    expect(shadow.intendedApplication.surfaceId).toBe("capability.skill-installation");
    expect(shadow.intendedApplication.appliedToRuntime).toBe(false);
    expect(shadow.aligned).toBe(true);
    expect(listRobotSkillAssets("robot-e5")).toEqual([]);
  });

  it("auto tick limit writes a matching shadow and still mutates via the live path", async () => {
    const binding = seedLowSuccessAgent("bot-e5-limit");
    await seedFlakyInvocations("bot-e5-limit");
    const result = runEvolutionGovernancePipeline();
    expect(result.pausedAgents).not.toContain("bot-e5-limit");
    expect(runtime.getBinding(binding.bindingId)?.bindingState).toBe("degraded");
    const shadows = listControlPlaneApplicationShadows().filter(
      (row) =>
        row.source === "runtime-auto-tick" && row.liveMutation.runtimeAgentId === "bot-e5-limit",
    );
    expect(shadows.length).toBeGreaterThan(0);
    expect(shadows.every((row) => row.aligned)).toBe(true);
    expect(shadows.every((row) => row.liveMutation.executed)).toBe(true);
    expect(shadows.every((row) => !row.intendedApplication.appliedToRuntime)).toBe(true);
    expect(shadows.some((row) => row.liveMutation.kind === "limit")).toBe(true);
  });

  it("assist tick does not mutate and does not record an executed runtime shadow", async () => {
    setEvolutionGovernanceModeForTests("assist");
    const binding = seedLowSuccessAgent("bot-e5-assist");
    await seedFlakyInvocations("bot-e5-assist");
    runEvolutionGovernancePipeline();
    expect(runtime.getBinding(binding.bindingId)?.bindingState).toBe("active");
    expect(listControlPlaneApplicationShadows().filter((row) => row.liveMutation.executed)).toEqual(
      [],
    );
  });

  it("kill switch writes no shadow rows", async () => {
    setGovernanceKillSwitch(true);
    seedLowSuccessAgent("bot-e5-kill");
    await seedFlakyInvocations("bot-e5-kill");
    runEvolutionGovernancePipeline();
    expect(listControlPlaneApplicationShadows()).toEqual([]);
  });

  it("skill-auto install writes a matching shadow while the live path still installs", () => {
    const candidate = seedSkillCandidate("robot-e5-auto");
    approvePatternCandidate(candidate.candidateId, {
      approvedBy: "ops",
      autoInstallIntent: true,
    });
    const pass = runSkillAutoEvolutionPass();
    expect(pass.installed).toBeGreaterThanOrEqual(1);
    const skillId = pass.skillIds[0];
    expect(listRobotSkillAssets("robot-e5-auto").some((row) => row.id === skillId)).toBe(true);
    const shadows = listControlPlaneApplicationShadows().filter(
      (row) => row.source === "skill-auto-pass",
    );
    expect(shadows).toHaveLength(1);
    expect(shadows[0]?.aligned).toBe(true);
    expect(shadows[0]?.liveMutation.executed).toBe(true);
    expect(shadows[0]?.liveMutation.skillId).toBe(skillId);
    expect(shadows[0]?.intendedApplication.appliedToRuntime).toBe(false);
  });

  it("assist skill-auto does not install and writes no executed skill shadow", () => {
    setEvolutionGovernanceModeForTests("assist");
    const candidate = seedSkillCandidate("robot-e5-assist");
    approvePatternCandidate(candidate.candidateId, {
      approvedBy: "ops",
      autoInstallIntent: true,
    });
    const pass = runSkillAutoEvolutionPass();
    expect(pass.mutationsAllowed).toBe(false);
    expect(pass.installed).toBe(0);
    expect(listRobotSkillAssets("robot-e5-assist")).toEqual([]);
    expect(listControlPlaneApplicationShadows().filter((row) => row.liveMutation.executed)).toEqual(
      [],
    );
  });
});
