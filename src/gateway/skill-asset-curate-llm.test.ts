// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { AgentKnowledgeLlmCaller } from "./knowledge/agent-knowledge-generator.js";
import { curateSkillAssetProfile, parseCuratedProfile } from "./skill-asset-curate-llm.js";

function stubLlm(text: string | null): AgentKnowledgeLlmCaller {
  return async () => (text === null ? null : { text, inputTokens: 10, outputTokens: 20 });
}

const TREE_DELIVERABLE = {
  title: "validate_pptx.py",
  body: "质量检查与验收\n├── scripts/\n│   ├── validate_pptx.py # PPTX 结构校验器\n└── assets/",
};

describe("curateSkillAssetProfile", () => {
  it("organizes a raw directory-tree deliverable into a structured profile (not raw copy)", async () => {
    const llm = stubLlm(
      JSON.stringify({
        name: "PPTX 结构校验能力",
        summary: "校验 PPTX 文件结构是否符合规范，并输出问题清单与修复建议。",
        assetType: "capability",
        inputDescription: "提供需要校验的 PPTX 文件路径或内容。",
        outputDescription: "## 校验结果\n- 结构问题清单\n- 修复建议",
        usageExamples: ["批量校验导出的 PPT 模板", "交付前做结构自检"],
        tags: ["PPTX", "质量校验", "结构检查"],
        category: "研发提效",
      }),
    );

    const patch = await curateSkillAssetProfile({ deliverable: TREE_DELIVERABLE, llm });
    expect(patch).not.toBeNull();
    expect(patch?.name).toBe("PPTX 结构校验能力");
    // The summary is the curated sentence, NOT the raw directory tree.
    expect(patch?.summary).toContain("校验 PPTX");
    expect(patch?.summary).not.toContain("├──");
    expect(patch?.assetType).toBe("capability");
    expect(patch?.tags).toEqual(["PPTX", "质量校验", "结构检查"]);
    expect(patch?.category).toBe("研发提效");
    expect(patch?.usageExamples).toHaveLength(2);
    expect(patch?.outputDescription).toContain("校验结果");
  });

  it("tolerates ```json fenced output", async () => {
    const llm = stubLlm('```json\n{"name":"周报生成器","summary":"自动整理本周工作为周报"}\n```');
    const patch = await curateSkillAssetProfile({
      deliverable: { title: "x", body: "本周完成了……" },
      llm,
    });
    expect(patch?.name).toBe("周报生成器");
    expect(patch?.summary).toBe("自动整理本周工作为周报");
  });

  it("returns null when the model yields nothing (caller falls back to heuristics)", async () => {
    const patch = await curateSkillAssetProfile({
      deliverable: { title: "x", body: "y" },
      llm: stubLlm(null),
    });
    expect(patch).toBeNull();
  });

  it("returns null on non-JSON output", async () => {
    const patch = await curateSkillAssetProfile({
      deliverable: { title: "x", body: "y" },
      llm: stubLlm("抱歉，这段内容不足以整理成可复用资产。"),
    });
    expect(patch).toBeNull();
  });

  it("returns null on LLM error without throwing", async () => {
    const llm: AgentKnowledgeLlmCaller = async () => {
      throw new Error("boom");
    };
    await expect(
      curateSkillAssetProfile({ deliverable: { title: "x", body: "y" }, llm }),
    ).resolves.toBeNull();
  });

  it("does not call the model for an empty deliverable body", async () => {
    const llm = vi.fn<AgentKnowledgeLlmCaller>(async () => ({
      text: "{}",
      inputTokens: 0,
      outputTokens: 0,
    }));
    const patch = await curateSkillAssetProfile({ deliverable: { title: "x", body: "   " }, llm });
    expect(patch).toBeNull();
    expect(llm).not.toHaveBeenCalled();
  });

  it("reports token usage to the onUsage hook", async () => {
    const onUsage = vi.fn();
    await curateSkillAssetProfile({
      deliverable: { title: "x", body: "内容" },
      llm: stubLlm('{"name":"a","summary":"b"}'),
      onUsage,
    });
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 10, outputTokens: 20 });
  });
});

describe("parseCuratedProfile", () => {
  it("rejects an object with no name/summary/output", () => {
    expect(parseCuratedProfile({ tags: ["a"], category: "x" })).toBeNull();
  });

  it("keeps a usable object even if only outputDescription is present", () => {
    const patch = parseCuratedProfile({ outputDescription: "## 步骤\n1. 做事" });
    expect(patch?.outputDescription).toContain("步骤");
  });

  it("drops an invalid assetType but keeps the rest", () => {
    const patch = parseCuratedProfile({ name: "n", summary: "s", assetType: "bogus" });
    expect(patch?.assetType).toBeUndefined();
    expect(patch?.name).toBe("n");
  });

  it("dedupes and caps tags / usageExamples", () => {
    const patch = parseCuratedProfile({
      name: "n",
      summary: "s",
      tags: ["a", "a", "b", "c", "d", "e", "f", "g"],
      usageExamples: ["u1", "u1", "u2", "u3", "u4", "u5"],
    });
    expect(patch?.tags).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(patch?.usageExamples).toEqual(["u1", "u2", "u3", "u4"]);
  });
});
