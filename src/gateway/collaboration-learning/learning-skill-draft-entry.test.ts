import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-p1d-entry-${process.pid}-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const { saveSkillAsset, finalizeDraftSkill } = await import("../skill-lifecycle-store.js");
const {
  finalizeLearningCuratedSkillDraft,
  isLearningCuratedSkillLineage,
  listLearningCuratedSkillDrafts,
} = await import("./learning-skill-draft-entry.js");

describe("learning-skill-draft-entry", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("isLearningCuratedSkillLineage matches learning: prefix only", () => {
    expect(isLearningCuratedSkillLineage("learning:agent:bot")).toBe(true);
    expect(isLearningCuratedSkillLineage("enterprise-capability:x")).toBe(false);
    expect(isLearningCuratedSkillLineage(undefined)).toBe(false);
  });

  it("lists only owned learning drafts", () => {
    const learning = saveSkillAsset({
      sourceAgentId: "bot-a",
      ownerUserId: "alice@example.com",
      contextId: "learning:agent:bot-a",
      lifecycle: "draft",
      autoInstallEnabled: false,
      profile: {
        name: "经验沉淀：A",
        summary: "lesson A",
        assetType: "capability",
        visibility: "private",
      },
    });
    saveSkillAsset({
      sourceAgentId: "bot-a",
      ownerUserId: "bob@example.com",
      contextId: "learning:agent:bot-a",
      lifecycle: "draft",
      autoInstallEnabled: false,
      profile: {
        name: "经验沉淀：B",
        summary: "lesson B",
        assetType: "capability",
        visibility: "private",
      },
    });
    saveSkillAsset({
      sourceAgentId: "bot-a",
      ownerUserId: "alice@example.com",
      contextId: "manual-save",
      lifecycle: "draft",
      autoInstallEnabled: false,
      profile: {
        name: "Manual",
        summary: "not from learning",
        assetType: "capability",
        visibility: "private",
      },
    });

    const listed = listLearningCuratedSkillDrafts(["alice@example.com"]);
    expect(listed.map((s) => s.id)).toEqual([learning.skillId]);
  });

  it("finalize is idempotent-fail on non-draft and advances draft→private", () => {
    const saved = saveSkillAsset({
      sourceAgentId: "bot-a",
      ownerUserId: "alice@example.com",
      contextId: "learning:agent:bot-a",
      lifecycle: "draft",
      autoInstallEnabled: false,
      profile: {
        name: "经验沉淀：C",
        summary: "lesson C",
        assetType: "capability",
        visibility: "private",
      },
    });
    const result = finalizeLearningCuratedSkillDraft({
      skillId: saved.skillId,
      ownerIds: ["alice@example.com"],
    });
    expect(result.skill.lifecycle).toBe("private");
    expect(result.nextStep).toBe("robot-skills.install");

    expect(() =>
      finalizeLearningCuratedSkillDraft({
        skillId: saved.skillId,
        ownerIds: ["alice@example.com"],
      }),
    ).toThrow(/not in draft state/);

    // Direct store finalize path stays consistent.
    expect(() => finalizeDraftSkill(saved.skillId)).toThrow(/not in draft state/);
  });
});
