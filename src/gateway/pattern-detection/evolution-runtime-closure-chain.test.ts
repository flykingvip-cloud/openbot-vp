/**
 * Acceptance chain (store-level e2e, no full gateway process):
 * candidate → approve → publish draft → finalize → install → tool invoke → started/completed → health
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-erc-e2e-${Date.now()}`);
vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const {
  approvePatternCandidate,
  ingestPatternSample,
  listPatternCandidates,
  publishPatternCandidateAsDraftSkill,
  structureHashFromText,
  structureHashFromToolTrace,
} = await import("./index.js");
const {
  finalizeDraftSkill,
  getPersonalSkillAssetDetail,
  installSkillToRobotAsset,
  listRobotSkillAssets,
} = await import("../skill-lifecycle-store.js");
const {
  ensureSkillExecutionBindingHooksRegistered,
  loadSkillExecutionBindingEntries,
  resetSkillExecutionBindingHooksForTests,
  skillExecutionSkillName,
} = await import("../skill-execution-binding/index.js");
const { recordLifecycleSkillsLoadedOnRun, readSkillInvocationEvents } =
  await import("../skill-invocation/index.js");

const { resetPatternDetectionStoreForTests } = await import("./index.js");

describe("evolution-runtime-closure e2e chain", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    resetPatternDetectionStoreForTests();
    resetSkillExecutionBindingHooksForTests();
    ensureSkillExecutionBindingHooksRegistered();
  });
  afterEach(() => {
    resetSkillExecutionBindingHooksForTests();
    resetPatternDetectionStoreForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("candidate → approve → draft publish → finalize+install → tool invoke → health", () => {
    const agentId = "robot-erc-e2e";
    const inHash = structureHashFromText("# Weekly brief request\n1. summarize sales");
    const outHash = structureHashFromText("# Weekly brief\n- revenue\n- risks");
    const tools = ["notes", "read"];
    const toolTrace = structureHashFromToolTrace(tools);

    for (let i = 1; i <= 3; i += 1) {
      ingestPatternSample({
        agentId,
        runId: `e2e-run-${i}`,
        taskId: null,
        sessionKey: `agent:${agentId}:main`,
        inputStructureHash: inHash,
        outputStructureHash: outHash,
        toolTraceHash: toolTrace,
        toolsUsed: tools,
        success: true,
        suggestedNameHint: "周报简报",
        suggestedSummaryHint: "稳定的周报简报流程",
      });
    }

    const candidates = listPatternCandidates({ agentId });
    expect(candidates).toHaveLength(1);
    const candidate = candidates[0];
    expect(candidate.independentTaskCount).toBe(3);
    expect(candidate.contract.toolsRequired).toEqual(expect.arrayContaining(["notes", "read"]));

    // Gate: cannot publish without approve
    expect(() =>
      publishPatternCandidateAsDraftSkill({
        candidateId: candidate.candidateId,
        sourceAgentId: agentId,
      }),
    ).toThrow(/must be approved/);

    approvePatternCandidate(candidate.candidateId);
    const published = publishPatternCandidateAsDraftSkill({
      candidateId: candidate.candidateId,
      sourceAgentId: agentId,
    });
    expect(published.detail.lifecycle).toBe("draft");
    expect(listRobotSkillAssets(agentId)).toHaveLength(0);
    expect(loadSkillExecutionBindingEntries({ agentId })).toHaveLength(0);

    // Install while draft: relation may exist but must not materialise
    installSkillToRobotAsset({ agentId, skillId: published.skillId });
    expect(loadSkillExecutionBindingEntries({ agentId })).toHaveLength(0);

    finalizeDraftSkill(published.skillId);
    // finalize re-syncs enabled relations → materialise
    const bound = loadSkillExecutionBindingEntries({ agentId });
    expect(bound.map((e) => e.skill.name)).toContain(skillExecutionSkillName(published.skillId));

    // Tool-matched invocation via unique owner + toolCallId
    const bindingName = skillExecutionSkillName(published.skillId);
    const events = recordLifecycleSkillsLoadedOnRun({
      agentId,
      runId: "e2e-invoke-1",
      skillNames: [bindingName],
      outcome: "success",
      latencyMs: 120,
      toolsUsed: [{ toolName: "notes", success: true, toolCallId: "e2e-call-1" }],
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.outcome).toBe("success");
    expect(events[0]?.businessOutcome).toBe("unique_owner");

    const allEvents = readSkillInvocationEvents({ skillId: published.skillId });
    expect(allEvents.filter((e) => e.type === "skill_invocation_started")).toHaveLength(1);
    expect(allEvents.filter((e) => e.type === "skill_invocation_completed")).toHaveLength(1);

    const relation = listRobotSkillAssets(agentId).find((r) => r.id === published.skillId);
    expect(relation?.usageCount).toBe(1);
    expect(relation?.lastInvokedAt).toBeTruthy();

    const detail = getPersonalSkillAssetDetail(published.skillId);
    // Health window updated via completed path
    expect(detail.health.successRate).toBeGreaterThanOrEqual(0);
    expect(detail.lifecycle).toBe("private");
  });
});
