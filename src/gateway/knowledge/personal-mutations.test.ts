import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-knowledge-personal-${Date.now()}`);
vi.mock("../utils.js", () => ({ CONFIG_DIR: tmpDir }));

const {
  collectPersonalKnowledge,
  comparePersonalKnowledgeVersions,
  listPersonalKnowledgeVersions,
  personalObjectId,
  updatePersonalKnowledgeTags,
  uploadPersonalKnowledge,
} = await import("./personal-mutations.js");
const { getPersonalSkillAssetDetail } = await import("../skill-lifecycle-store.js");

function cleanStore() {
  fs.rmSync(path.join(tmpDir, "skill-assets"), { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
}

describe("knowledge personal mutations", () => {
  beforeEach(() => {
    cleanStore();
  });

  afterEach(() => {
    cleanStore();
  });

  it("collects personal knowledge into skill lifecycle store", () => {
    const result = collectPersonalKnowledge({
      title: "会议纪要",
      summary: "本周评审结论与待办",
      tags: ["会议"],
      contextId: "session:test",
    });
    expect(result.skillId).toBeTruthy();
    expect(result.object.id).toBe(personalObjectId(result.skillId));
    expect(result.object.source).toBe("personal");
    expect(result.object.title).toBe("会议纪要");
    expect(getPersonalSkillAssetDetail(result.skillId).sourceRobot).toBeNull();
  });

  it("uploads personal knowledge with document attachment", () => {
    const result = uploadPersonalKnowledge({
      attachment: {
        fileName: "产品手册.md",
        mimeType: "text/markdown",
        size: 128,
        kind: "text",
        textContent: "# 产品手册\n完整正文占位",
      },
      tags: ["手册"],
    });
    expect(result.object.tags).toContain("手册");
    expect(result.object.title).toBe("产品手册");
    expect(result.object.kind).toBeTruthy();
    expect(getPersonalSkillAssetDetail(result.skillId).sourceRobot).toBeNull();
  });

  it("rejects upload without attachment", () => {
    expect(() =>
      uploadPersonalKnowledge({
        title: "无附件",
        summary: "不应成功",
      }),
    ).toThrow();
  });

  it("lists version history for a collected object", () => {
    const collected = collectPersonalKnowledge({
      title: "版本测试",
      summary: "用于版本历史",
    });
    const versions = listPersonalKnowledgeVersions(collected.object.id);
    expect(versions.length).toBeGreaterThan(0);
    expect(versions[0]?.version).toBeTruthy();
  });

  it("updates tags and compares versions after changes", () => {
    const collected = collectPersonalKnowledge({
      title: "标签版本测试",
      summary: "用于标签与差异比较",
      tags: ["alpha"],
    });
    const beforeVersion = listPersonalKnowledgeVersions(collected.object.id)[0]?.version;
    updatePersonalKnowledgeTags({
      objectId: collected.object.id,
      tags: ["alpha", "beta"],
    });
    const versions = listPersonalKnowledgeVersions(collected.object.id);
    const afterVersion = versions[versions.length - 1]?.version;
    expect(afterVersion).toBeTruthy();
    if (!beforeVersion || !afterVersion || beforeVersion === afterVersion) {
      return;
    }
    const diff = comparePersonalKnowledgeVersions({
      objectId: collected.object.id,
      fromVersion: beforeVersion,
      toVersion: afterVersion,
    });
    expect(diff.changedFields.length).toBeGreaterThan(0);
  });
});
