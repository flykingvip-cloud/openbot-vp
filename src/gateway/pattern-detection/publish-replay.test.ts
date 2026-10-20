/**
 * Gate: candidate must be approved before draft skill creation;
 * draft must NOT materialise into agent runtime until explicit install of a runnable lifecycle.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-pattern-replay-${Date.now()}`);
vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const {
  approvePatternCandidate,
  ingestPatternSample,
  listPatternCandidates,
  publishPatternCandidateAsDraftSkill,
  resetPatternDetectionStoreForTests,
  structureHashFromText,
} = await import("./index.js");
const { finalizeDraftSkill, installSkillToRobotAsset, toggleRobotSkillAsset } =
  await import("../skill-lifecycle-store.js");
const {
  ensureSkillExecutionBindingHooksRegistered,
  loadSkillExecutionBindingEntries,
  resetSkillExecutionBindingHooksForTests,
  skillExecutionSkillName,
} = await import("../skill-execution-binding/index.js");

function clean() {
  resetPatternDetectionStoreForTests();
  resetSkillExecutionBindingHooksForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  ensureSkillExecutionBindingHooksRegistered();
}

function seedCandidate(agentId: string) {
  const hash = structureHashFromText("# Replayable weekly report\n1. A\n2. B");
  for (let i = 1; i <= 3; i += 1) {
    ingestPatternSample({
      agentId,
      runId: `replay-run-${i}`,
      taskId: `replay-task-${i}`,
      inputStructureHash: hash,
      outputStructureHash: structureHashFromText(`# Out ${i}\n- done`),
      success: true,
      suggestedNameHint: "周报回放技能",
      suggestedSummaryHint: "三次独立任务沉淀的周报能力",
    });
  }
  const candidate = listPatternCandidates({ agentId })[0];
  if (!candidate) {
    throw new Error("expected candidate");
  }
  return candidate;
}

describe("pattern candidate → skill runtime gate", () => {
  beforeEach(clean);
  afterEach(() => {
    resetSkillExecutionBindingHooksForTests();
    resetPatternDetectionStoreForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("fail-before: unapproved candidate cannot publish and does not enter runtime", () => {
    const candidate = seedCandidate("robot-replay");
    expect(candidate.status).toBe("candidate");
    expect(() =>
      publishPatternCandidateAsDraftSkill({
        candidateId: candidate.candidateId,
        sourceAgentId: "robot-replay",
      }),
    ).toThrow(/must be approved/);
    expect(loadSkillExecutionBindingEntries({ agentId: "robot-replay" })).toHaveLength(0);
  });

  it("approved publish creates draft skill that is NOT materialised until install of runnable lifecycle", () => {
    const candidate = seedCandidate("robot-replay");
    approvePatternCandidate(candidate.candidateId);
    const published = publishPatternCandidateAsDraftSkill({
      candidateId: candidate.candidateId,
      sourceAgentId: "robot-replay",
    });
    expect(published.candidate.status).toBe("published");
    expect(published.detail.lifecycle).toBe("draft");
    // Draft + no relation → nothing in execution projection
    expect(loadSkillExecutionBindingEntries({ agentId: "robot-replay" })).toHaveLength(0);

    // Install while still draft must not materialise (non-executable lifecycle)
    installSkillToRobotAsset({ agentId: "robot-replay", skillId: published.skillId });
    expect(loadSkillExecutionBindingEntries({ agentId: "robot-replay" })).toHaveLength(0);

    // Promote draft → private, then re-sync via toggle
    finalizeDraftSkill(published.skillId);
    toggleRobotSkillAsset({
      agentId: "robot-replay",
      skillId: published.skillId,
      enabled: true,
    });
    expect(
      loadSkillExecutionBindingEntries({ agentId: "robot-replay" }).map((e) => e.skill.name),
    ).toContain(skillExecutionSkillName(published.skillId));

    toggleRobotSkillAsset({
      agentId: "robot-replay",
      skillId: published.skillId,
      enabled: false,
    });
    expect(
      loadSkillExecutionBindingEntries({ agentId: "robot-replay" }).map((e) => e.skill.name),
    ).not.toContain(skillExecutionSkillName(published.skillId));
  });

  it("refuses double-publish of the same candidate", () => {
    const candidate = seedCandidate("robot-replay");
    approvePatternCandidate(candidate.candidateId);
    publishPatternCandidateAsDraftSkill({
      candidateId: candidate.candidateId,
      sourceAgentId: "robot-replay",
    });
    expect(() =>
      publishPatternCandidateAsDraftSkill({
        candidateId: candidate.candidateId,
        sourceAgentId: "robot-replay",
      }),
    ).toThrow(/already published/);
  });
});
