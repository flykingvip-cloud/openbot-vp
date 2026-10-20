import { describe, expect, it } from "vitest";
import { buildEscalationDraft } from "./daibai-escalation.js";

describe("buildEscalationDraft", () => {
  it("fills context bundle from memory and message", () => {
    const draft = buildEscalationDraft({
      message: "这个功能报错了",
      sessionKey: "main",
      memory: {
        tenantId: "t1",
        userId: "u1",
        preferences: { onboardingStep: "skills" },
        recentResolvedTopics: ["预算问题"],
        capabilityUsageHints: ["robot-skills.toggle"],
        lastIntents: [{ summary: "帮我安装技能", atMs: 1 }],
        updatedAtMs: 1,
      },
      failureReason: "权限不足",
    });
    expect(draft.category).toBe("bug_report");
    expect(draft.contextBundle.userMessage).toBe("这个功能报错了");
    expect(draft.contextBundle.sourceSessionKey).toBe("main");
    expect(draft.contextBundle.recentPlanSummary).toContain("帮我安装技能");
    expect(draft.contextBundle.errorEvidence).toContain("权限不足");
    expect(draft.contextBundle.onboardingSummary?.currentStep).toBe("skills");
  });

  it("defaults category to unknown for ambiguous messages", () => {
    const draft = buildEscalationDraft({ message: "随便聊聊" });
    expect(draft.category).toBe("unknown");
  });

  it("passes through an explicit blueprintSummary when provided", () => {
    const draft = buildEscalationDraft({
      message: "蓝图执行失败",
      blueprintSummary: { blueprintId: "bp_1", version: "2", status: "failed" },
    });
    expect(draft.contextBundle.blueprintSummary).toEqual({
      blueprintId: "bp_1",
      version: "2",
      status: "failed",
    });
  });

  it("derives blueprintSummary from memory blueprintId when present", () => {
    const draft = buildEscalationDraft({
      message: "x",
      memory: {
        tenantId: null,
        userId: "u1",
        preferences: { blueprintId: "bp_mem" },
        recentResolvedTopics: [],
        capabilityUsageHints: [],
        lastIntents: [],
        updatedAtMs: 1,
      },
    });
    expect(draft.contextBundle.blueprintSummary).toEqual({ blueprintId: "bp_mem" });
  });

  it("omits blueprintSummary when no source is available (no fabrication)", () => {
    const draft = buildEscalationDraft({ message: "这个功能报错了" });
    expect(draft.contextBundle.blueprintSummary).toBeUndefined();
  });

  it("never surfaces the onboarding guide话术 as recentPlanSummary", () => {
    const onboardingPrompt =
      "请你以新用户引导员的身份，用对话方式给我一个简洁的首次登录操作指南，并说明接下来你还能继续代办什么。";
    const draft = buildEscalationDraft({
      message: "有哪些推荐能力？",
      memory: {
        tenantId: null,
        userId: "u1",
        preferences: {},
        recentResolvedTopics: [],
        capabilityUsageHints: [],
        lastIntents: [
          { summary: onboardingPrompt, atMs: 1 },
          { summary: onboardingPrompt, atMs: 2 },
        ],
        updatedAtMs: 2,
      },
    });
    expect(draft.contextBundle.recentPlanSummary).toBeUndefined();
  });

  it("dedupes repeated recent intents before joining", () => {
    const draft = buildEscalationDraft({
      message: "这个功能报错了",
      memory: {
        tenantId: null,
        userId: "u1",
        preferences: {},
        recentResolvedTopics: [],
        capabilityUsageHints: [],
        lastIntents: [
          { summary: "导出报表失败", atMs: 1 },
          { summary: "导出报表失败", atMs: 2 },
        ],
        updatedAtMs: 2,
      },
    });
    expect(draft.contextBundle.recentPlanSummary).toBe("导出报表失败");
  });
});
