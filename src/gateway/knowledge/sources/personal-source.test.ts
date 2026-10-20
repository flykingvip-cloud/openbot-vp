import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-knowledge-personal-source-${Date.now()}`);
vi.mock("../../../utils.js", () => ({ CONFIG_DIR: tmpDir }));

const { saveSkillAsset } = await import("../../skill-lifecycle-store.js");
const {
  buildPersonalSourceSummary,
  loadPersonalKnowledgeObjectBySkillId,
  loadPersonalKnowledgeObjects,
} = await import("./personal-source.js");

function cleanStore() {
  fs.rmSync(path.join(tmpDir, "skill-assets"), { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
}

function saveKnowledge(params: { name: string; ownerUserId?: string | null }) {
  return saveSkillAsset({
    ownerUserId: params.ownerUserId ?? null,
    lifecycle: "private",
    profile: {
      name: params.name,
      summary: `${params.name} summary`,
      assetType: "knowledge",
      tags: ["知识"],
      category: "知识收录",
      visibility: "private",
    },
  });
}

describe("personal knowledge source", () => {
  beforeEach(cleanStore);

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty when caller identity is missing (fail-closed)", () => {
    saveKnowledge({ name: "Orphan note", ownerUserId: "user-a" });
    expect(loadPersonalKnowledgeObjects()).toEqual([]);
    expect(loadPersonalKnowledgeObjects({ ownerUserId: null })).toEqual([]);
    expect(loadPersonalKnowledgeObjects({ ownerUserId: "   " })).toEqual([]);
  });

  it("only projects knowledge assets owned by the caller", () => {
    const mine = saveKnowledge({ name: "我的笔记", ownerUserId: "user-a" });
    saveKnowledge({ name: "别人的笔记", ownerUserId: "user-b" });
    // Legacy unowned assets must not appear for any caller.
    saveKnowledge({ name: "无主遗留", ownerUserId: null });

    const objects = loadPersonalKnowledgeObjects({ ownerUserId: "user-a" });
    expect(objects.map((item) => item.title)).toEqual(["我的笔记"]);
    expect(objects[0]?.id).toBe(`obj:personal:${mine.skillId}`);

    expect(
      loadPersonalKnowledgeObjects({ ownerUserId: "user-b" }).map((item) => item.title),
    ).toEqual(["别人的笔记"]);
  });

  it("loads a single skill by id without exposing the unscoped store", () => {
    const saved = saveKnowledge({ name: "单条沉淀", ownerUserId: "user-a" });
    const object = loadPersonalKnowledgeObjectBySkillId(saved.skillId);
    expect(object?.title).toBe("单条沉淀");
    expect(loadPersonalKnowledgeObjectBySkillId("missing-skill")).toBeNull();
  });

  it("returns summary counts for personal objects", () => {
    saveKnowledge({ name: "计数笔记", ownerUserId: "user-a" });
    const objects = loadPersonalKnowledgeObjects({ ownerUserId: "user-a" });
    const summary = buildPersonalSourceSummary(objects);
    expect(summary.documentCount).toBe(1);
    expect(summary.recentUpdates).toBeGreaterThanOrEqual(0);
  });
});
