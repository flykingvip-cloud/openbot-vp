import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-curation-trigger-${Date.now()}`);
vi.mock("../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});
vi.mock("../config/config.js", () => ({
  loadConfig: () => ({ meta: { lastTouchedVersion: "2026.3.9" } }),
}));

// Mock the LLM caller factory — return a fake caller that produces a curation patch
const mockLlmCaller = vi.fn();
vi.mock("./knowledge/agent-knowledge-generator.js", () => ({
  createAgentKnowledgeLlmCaller: () => mockLlmCaller,
}));

const { triggerAssetCuration } = await import("./skill-asset-curation-trigger.js");
const { saveSkillAsset, getPersonalSkillAssetDetail } = await import("./skill-lifecycle-store.js");

function cleanStore() {
  const fs = require("node:fs");
  const storePath = path.join(tmpDir, "openbot-skill-assets.json");
  try {
    fs.unlinkSync(storePath);
  } catch {}
}

describe("skill-asset-curation-trigger", () => {
  beforeEach(() => {
    cleanStore();
    mockLlmCaller.mockReset();
  });
  afterEach(cleanStore);

  it("enriches empty profile fields from LLM curation output", async () => {
    // Save a minimal asset (only name + summary)
    const result = saveSkillAsset({
      sourceAgentId: "robot-alpha",
      profile: { name: "客户沟通整理", summary: "把客户对话整理为摘要" },
    });

    // Mock LLM returns a curation patch
    mockLlmCaller.mockResolvedValueOnce({
      text: JSON.stringify({
        name: "客户沟通摘要生成", // should NOT overwrite existing name
        summary: "新摘要", // should NOT overwrite existing summary
        outputDescription: "结构化的客户对话摘要，包含关键议题和行动项",
        inputDescription: "客户对话消息记录",
        usageExamples: ["处理售后投诉", "汇总需求对话"],
        tags: ["客户", "沟通", "摘要"],
        category: "客户服务",
        assetType: "capability",
      }),
      inputTokens: 100,
      outputTokens: 50,
    });

    await triggerAssetCuration({ skillId: result.skillId, sourceAgentId: "robot-alpha" });

    const detail = getPersonalSkillAssetDetail(result.skillId);
    // name and summary NOT overwritten (user-provided)
    expect(detail.profile.name).toBe("客户沟通整理");
    expect(detail.profile.summary).toBe("把客户对话整理为摘要");
    // Empty fields enriched from LLM
    expect(detail.profile.outputDescription).toBe("结构化的客户对话摘要，包含关键议题和行动项");
    expect(detail.profile.inputDescription).toBe("客户对话消息记录");
    expect(detail.profile.usageExamples).toEqual(["处理售后投诉", "汇总需求对话"]);
    expect(detail.profile.tags).toEqual(["客户", "沟通", "摘要"]);
    expect(detail.profile.category).toBe("客户服务");
  });

  it("does not overwrite user-provided fields", async () => {
    const result = saveSkillAsset({
      sourceAgentId: "robot-alpha",
      profile: {
        name: "用户定义的名称",
        summary: "用户的摘要",
        outputDescription: "用户手动填写的输出说明",
        tags: ["用户标签"],
      },
    });

    mockLlmCaller.mockResolvedValueOnce({
      text: JSON.stringify({
        outputDescription: "LLM想覆盖的输出",
        tags: ["LLM标签"],
        inputDescription: "LLM补充的输入说明",
      }),
      inputTokens: 50,
      outputTokens: 30,
    });

    await triggerAssetCuration({ skillId: result.skillId });

    const detail = getPersonalSkillAssetDetail(result.skillId);
    // User-provided fields preserved
    expect(detail.profile.outputDescription).toBe("用户手动填写的输出说明");
    expect(detail.profile.tags).toEqual(["用户标签"]);
    // Empty fields enriched
    expect(detail.profile.inputDescription).toBe("LLM补充的输入说明");
  });

  it("does nothing when LLM returns null (no model configured)", async () => {
    // Override mock to simulate no model
    vi.doMock("./knowledge/agent-knowledge-generator.js", () => ({
      createAgentKnowledgeLlmCaller: () => null,
    }));
    // Re-import to pick up the new mock
    const mod = await import("./skill-asset-curation-trigger.js");
    const result = saveSkillAsset({
      sourceAgentId: "robot-alpha",
      profile: { name: "无模型测试", summary: "测试摘要" },
    });

    await mod.triggerAssetCuration({ skillId: result.skillId });

    const detail = getPersonalSkillAssetDetail(result.skillId);
    // No enrichment happened
    expect(detail.profile.outputDescription).toBe("");
    vi.doUnmock("./knowledge/agent-knowledge-generator.js");
  });

  it("does not throw when curation fails", async () => {
    const result = saveSkillAsset({
      sourceAgentId: "robot-alpha",
      profile: { name: "异常测试", summary: "测试" },
    });

    mockLlmCaller.mockRejectedValueOnce(new Error("LLM timeout"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(triggerAssetCuration({ skillId: result.skillId })).resolves.toBeUndefined();

    consoleSpy.mockRestore();
  });
});
