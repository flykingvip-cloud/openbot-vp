import { describe, expect, it, vi } from "vitest";
import {
  buildTaskSkillCandidates,
  extractJsonObject,
  extractTaskSkillRequirements,
  fallbackTaskGapsFromTemplate,
  taskGapsFromSuggestedKeys,
  toPendingTaskContext,
} from "./task-requirement-extract.ts";

const candidates = [
  { key: "crm", label: "CRM 技能", summary: "客户管理" },
  { key: "contract_review", label: "合同审查" },
  { key: "market_research", label: "市场调研" },
];

describe("extractJsonObject", () => {
  it("parses fenced and raw JSON", () => {
    expect(extractJsonObject('```json\n{"skillKeys":["crm"]}\n```')).toEqual({
      skillKeys: ["crm"],
    });
    expect(extractJsonObject('here {"skillKeys":["crm"]} ok')).toEqual({
      skillKeys: ["crm"],
    });
  });

  it("returns null on garbage", () => {
    expect(extractJsonObject("nope")).toBeNull();
  });
});

describe("buildTaskSkillCandidates", () => {
  it("unions template required skills with recommendations", () => {
    const list = buildTaskSkillCandidates({
      template: {
        requiredCapabilities: [
          { key: "crm", kind: "skill", label: "CRM", required: true },
          { key: "oauth_x", kind: "oauth", label: "X", required: true },
          { key: "optional", kind: "skill", label: "Opt", required: false },
        ],
      },
      recommendations: [
        { skillId: "market_research", name: "市场调研", summary: "竞品" },
        { skillId: "crm", name: "CRM dup" },
      ],
    });
    expect(list.map((c) => c.key).toSorted()).toEqual(["crm", "market_research"]);
    expect(list.find((c) => c.key === "crm")?.label).toBe("CRM");
  });
});

describe("taskGapsFromSuggestedKeys", () => {
  it("marks installed as satisfied and drops invent keys via caller filter", () => {
    const gaps = taskGapsFromSuggestedKeys({
      suggestedSkillKeys: ["crm", "contract_review"],
      candidates,
      installedSkillKeys: ["crm"],
    });
    expect(gaps).toEqual([
      { key: "crm", label: "CRM 技能", kind: "skill", status: "satisfied" },
      { key: "contract_review", label: "合同审查", kind: "skill", status: "missing" },
    ]);
  });
});

describe("extractTaskSkillRequirements", () => {
  it("returns null when no llm / empty draft / empty candidates", async () => {
    expect(
      await extractTaskSkillRequirements({
        draftText: "你好",
        candidates,
        installedSkillKeys: [],
        llm: null,
      }),
    ).toBeNull();
    expect(
      await extractTaskSkillRequirements({
        draftText: "  ",
        candidates,
        installedSkillKeys: [],
        llm: async () => ({ text: "{}", inputTokens: 0, outputTokens: 0 }),
      }),
    ).toBeNull();
  });

  it("filters invent keys and builds gaps", async () => {
    const llm = vi.fn(async () => ({
      text: '{"skillKeys":["crm","invented","market_research"],"reason":"需要客户与调研"}',
      inputTokens: 0,
      outputTokens: 0,
    }));
    const result = await extractTaskSkillRequirements({
      draftText: "帮我分析竞品并同步 CRM",
      candidates,
      installedSkillKeys: ["crm"],
      llm,
    });
    expect(result).toEqual({
      suggestedSkillKeys: ["crm", "market_research"],
      taskGaps: [
        { key: "crm", label: "CRM 技能", kind: "skill", status: "satisfied" },
        { key: "market_research", label: "市场调研", kind: "skill", status: "missing" },
      ],
      extractStatus: "ready",
    });
    expect(llm).toHaveBeenCalledOnce();
  });

  it("returns null when LLM text is unusable", async () => {
    expect(
      await extractTaskSkillRequirements({
        draftText: "任务",
        candidates,
        installedSkillKeys: [],
        llm: async () => ({ text: "not json", inputTokens: 0, outputTokens: 0 }),
      }),
    ).toBeNull();
  });
});

describe("fallbackTaskGapsFromTemplate", () => {
  it("uses unmet template required skills", () => {
    const result = fallbackTaskGapsFromTemplate({
      candidates,
      installedSkillKeys: [],
      templateRequiredSkillKeys: ["crm", "contract_review"],
    });
    expect(result.extractStatus).toBe("failed_fallback");
    expect(result.suggestedSkillKeys).toEqual(["crm", "contract_review"]);
    expect(result.taskGaps.every((g) => g.status === "missing")).toBe(true);
  });
});

describe("toPendingTaskContext", () => {
  it("stores draft and skill-only gaps", () => {
    const pending = toPendingTaskContext({
      draftText: "  写市场分析  ",
      source: "composer",
      atMs: 42,
      extract: {
        suggestedSkillKeys: ["market_research"],
        taskGaps: [
          {
            key: "market_research",
            label: "市场调研",
            kind: "skill",
            status: "missing",
          },
        ],
        extractStatus: "ready",
      },
    });
    expect(pending).toEqual({
      draftText: "写市场分析",
      source: "composer",
      suggestedSkillKeys: ["market_research"],
      taskGaps: [
        {
          key: "market_research",
          label: "市场调研",
          kind: "skill",
          status: "missing",
        },
      ],
      extractedAtMs: 42,
      extractStatus: "ready",
    });
  });
});
