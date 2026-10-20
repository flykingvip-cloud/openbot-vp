import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-skill-bind-reg-${Date.now()}`);
vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const {
  ingestPatternSample,
  listPatternCandidates,
  approvePatternCandidate,
  publishPatternCandidateAsDraftSkill,
  structureHashFromText,
  resetPatternDetectionStoreForTests,
} = await import("../pattern-detection/index.js");
const { finalizeDraftSkill, installSkillToRobotAsset, listRobotSkillAssets } =
  await import("../skill-lifecycle-store.js");
const {
  ensureSkillExecutionBindingHooksRegistered,
  loadSkillExecutionBindingEntries,
  resetSkillExecutionBindingHooksForTests,
  skillExecutionSkillName,
  resolveAgentSkillExecutionBindingsDir,
} = await import("../skill-execution-binding/index.js");

function seedAndPublish(agentId: string) {
  const inHash = structureHashFromText("# Flight request\n1. step");
  const outHash = structureHashFromText("# Flight result\n- done");
  for (let i = 1; i <= 3; i += 1) {
    ingestPatternSample({
      agentId,
      runId: `bind-reg-${agentId}-${i}`,
      taskId: `bind-reg-task-${agentId}-${i}`,
      inputStructureHash: inHash,
      outputStructureHash: outHash,
      success: true,
      suggestedNameHint: "绑定回归技能",
    });
  }
  const candidate = listPatternCandidates({ agentId })[0];
  expect(candidate).toBeTruthy();
  approvePatternCandidate(candidate.candidateId, {
    approvedBy: "ops",
    autoInstallIntent: true,
  });
  return publishPatternCandidateAsDraftSkill({
    candidateId: candidate.candidateId,
    sourceAgentId: agentId,
  });
}

describe("skill execution binding load path", () => {
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

  it("keeps sourceInfo skills after finalize+install (fail-before required source)", () => {
    const agentId = "robot-bind-reg";
    const published = seedAndPublish(agentId);
    finalizeDraftSkill(published.skillId);
    installSkillToRobotAsset({ agentId, skillId: published.skillId });
    expect(listRobotSkillAssets(agentId).some((row) => row.id === published.skillId)).toBe(true);

    const bindRoot = resolveAgentSkillExecutionBindingsDir(agentId, tmpDir);
    const loaded = loadSkillsFromDir({ dir: bindRoot, source: "openbot-lifecycle-binding" });
    expect(loaded.skills.length).toBeGreaterThan(0);
    expect(loaded.skills[0]).toEqual(
      expect.objectContaining({
        name: skillExecutionSkillName(published.skillId),
        sourceInfo: expect.objectContaining({ source: "openbot-lifecycle-binding" }),
      }),
    );
    expect(loaded.skills[0] as { source?: unknown }).not.toHaveProperty("source");
    expect(
      loadSkillExecutionBindingEntries({ agentId, configDir: tmpDir }).map((row) => row.skill.name),
    ).toContain(skillExecutionSkillName(published.skillId));
  });

  it("rematerialises when install happens on draft and finalize follows", () => {
    const agentId = "flight-bind-reg";
    const published = seedAndPublish(agentId);
    installSkillToRobotAsset({ agentId, skillId: published.skillId });
    expect(
      loadSkillExecutionBindingEntries({ agentId, configDir: tmpDir }).map((row) => row.skill.name),
    ).not.toContain(skillExecutionSkillName(published.skillId));
    finalizeDraftSkill(published.skillId);
    expect(
      loadSkillExecutionBindingEntries({ agentId, configDir: tmpDir }).map((row) => row.skill.name),
    ).toContain(skillExecutionSkillName(published.skillId));
  });
});
