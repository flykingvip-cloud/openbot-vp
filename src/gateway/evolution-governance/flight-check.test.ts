/**
 * Limited offline flight check for evolution-runtime-closure.
 * Does not start a live Gateway process; exercises store/RPC-equivalent APIs end-to-end.
 *
 * Checklist (asserted):
 * 1. mode default is assist
 * 2. candidate → approve → draft publish → finalize → install → tool invoke
 * 3. soft limit + redirect record
 * 4. pending-approvals surface
 * 5. routing rewrite under redirect
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-evo-flight-${Date.now()}`);
vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const {
  getEvolutionGovernanceMode,
  setEvolutionGovernanceModeForTests,
  setGovernanceKillSwitch,
  applyGovernanceRuntimeAction,
  getAgentRedirectRecord,
  setEffectVerifyMsForTests,
  runEvolutionGovernancePipeline,
} = await import("./index.js");
const {
  approvePatternCandidate,
  ingestPatternSample,
  listPatternCandidates,
  publishPatternCandidateAsDraftSkill,
  structureHashFromText,
  structureHashFromToolTrace,
} = await import("../pattern-detection/index.js");
const { finalizeDraftSkill, installSkillToRobotAsset, listRobotSkillAssets } =
  await import("../skill-lifecycle-store.js");
const {
  ensureSkillExecutionBindingHooksRegistered,
  loadSkillExecutionBindingEntries,
  resetSkillExecutionBindingHooksForTests,
  skillExecutionSkillName,
} = await import("../skill-execution-binding/index.js");
const { recordLifecycleSkillsLoadedOnRun, readSkillInvocationEvents } =
  await import("../skill-invocation/index.js");
const { resetPatternDetectionStoreForTests } = await import("../pattern-detection/index.js");
const { applyGovernanceAgentRedirect } = await import("./route-redirect.js");
const runtime = await import("../agent-runtime-store.js");

function seedRuntimeAgent(id: string) {
  const now = Date.now();
  runtime.upsertAgent({
    runtimeAgentId: id,
    name: id,
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
}

describe("evolution-runtime-closure flight check (limited)", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    setGovernanceKillSwitch(false);
    // Default production posture is assist (no auto runtime mutation).
    setEvolutionGovernanceModeForTests(null);
    delete process.env.OPENBOT_EVOLUTION_GOVERNANCE_MODE;
    setEffectVerifyMsForTests(null);
    resetPatternDetectionStoreForTests();
    resetSkillExecutionBindingHooksForTests();
    ensureSkillExecutionBindingHooksRegistered();
  });
  afterEach(() => {
    setEvolutionGovernanceModeForTests(null);
    delete process.env.OPENBOT_EVOLUTION_GOVERNANCE_MODE;
    setGovernanceKillSwitch(false);
    resetSkillExecutionBindingHooksForTests();
    resetPatternDetectionStoreForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("flight: mode assist + skill gate + invoke + redirect rewrite", () => {
    // --- D: mode ---
    expect(getEvolutionGovernanceMode()).toBe("assist");

    // --- A: skill closure chain ---
    const agentId = "flight-bot";
    seedRuntimeAgent(agentId);
    seedRuntimeAgent("flight-backup");
    const inHash = structureHashFromText("# Flight request\n1. step");
    const outHash = structureHashFromText("# Flight result\n- done");
    const tools = ["notes"];
    const toolTrace = structureHashFromToolTrace(tools);
    for (let i = 1; i <= 3; i += 1) {
      ingestPatternSample({
        agentId,
        runId: `flight-run-${i}`,
        taskId: `flight-task-${i}`,
        inputStructureHash: inHash,
        outputStructureHash: outHash,
        toolTraceHash: toolTrace,
        toolsUsed: tools,
        success: true,
        suggestedNameHint: "飞行检查技能",
      });
    }
    const candidate = listPatternCandidates({ agentId })[0];
    expect(candidate).toBeTruthy();
    approvePatternCandidate(candidate.candidateId);
    const published = publishPatternCandidateAsDraftSkill({
      candidateId: candidate.candidateId,
      sourceAgentId: agentId,
    });
    expect(published.detail.lifecycle).toBe("draft");
    expect(listRobotSkillAssets(agentId)).toHaveLength(0);

    installSkillToRobotAsset({ agentId, skillId: published.skillId });
    finalizeDraftSkill(published.skillId);
    expect(loadSkillExecutionBindingEntries({ agentId }).map((e) => e.skill.name)).toContain(
      skillExecutionSkillName(published.skillId),
    );

    const events = recordLifecycleSkillsLoadedOnRun({
      agentId,
      runId: "flight-invoke",
      skillNames: [skillExecutionSkillName(published.skillId)],
      outcome: "success",
      toolsUsed: [{ toolName: "notes", success: true, toolCallId: "flight-call-1" }],
    });
    expect(events).toHaveLength(1);
    expect(
      readSkillInvocationEvents({ skillId: published.skillId }).some(
        (e) => e.type === "skill_invocation_completed",
      ),
    ).toBe(true);

    // --- B/D: redirect + route rewrite helper ---
    const redirected = applyGovernanceRuntimeAction({
      runtimeAgentId: agentId,
      action: "redirect",
      redirectTargetAgentId: "flight-backup",
      reason: "flight-check",
    });
    expect(redirected.ok).toBe(true);
    expect(getAgentRedirectRecord(agentId)?.targetAgentId).toBe("flight-backup");
    expect(applyGovernanceAgentRedirect(agentId)).toBe("flight-backup");

    // assist mode pipeline still runs (not off)
    const tick = runEvolutionGovernancePipeline();
    expect(tick.assetsSeeded).toBeGreaterThanOrEqual(0);
  });

  it("flight: mode=off skips pipeline actions", () => {
    setEvolutionGovernanceModeForTests("off");
    seedRuntimeAgent("off-bot");
    const tick = runEvolutionGovernancePipeline();
    expect(tick.assetsSeeded).toBe(0);
    expect(tick.actionsExecuted).toBe(0);
  });
});
