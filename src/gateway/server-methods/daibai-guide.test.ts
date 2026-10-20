import { describe, expect, it } from "vitest";
import { buildStewardGuideSnapshot, isDaibaiOnboardingGuideMessage } from "./daibai-guide.js";

describe("isDaibaiOnboardingGuideMessage", () => {
  it("detects first-login guide prompts", () => {
    expect(
      isDaibaiOnboardingGuideMessage(
        "请你以新用户引导员的身份，用对话方式给我一个简洁的首次登录操作指南",
      ),
    ).toBe(true);
    expect(isDaibaiOnboardingGuideMessage("请帮我检查当前支持状态")).toBe(false);
  });
});

describe("buildStewardGuideSnapshot", () => {
  it("returns empty-capability guidance when no skills are installed", () => {
    const guide = buildStewardGuideSnapshot({});
    expect(guide.headline).toContain("熟悉平台能力");
    expect(guide.availableNow).toEqual([]);
    expect(guide.stewardActions.length).toBeGreaterThan(0);
    expect(guide.nextSteps.length).toBeGreaterThan(0);
  });

  it("includes memory hints in next steps", () => {
    const guide = buildStewardGuideSnapshot({
      memory: {
        tenantId: null,
        userId: "u1",
        preferences: {},
        recentResolvedTopics: [],
        capabilityUsageHints: ["billing", "knowledge"],
        lastIntents: [],
        updatedAtMs: 1,
      },
    });
    expect(guide.nextSteps.some((step) => step.includes("billing"))).toBe(true);
  });

  it("sources stewardActions from the action catalog (not a hardcoded list)", () => {
    const guide = buildStewardGuideSnapshot({});
    const ids = guide.stewardActions.map((a) => a.actionId);
    // Catalog-registered support + robot-skills actions surface as "what I can do for you".
    expect(ids).toContain("support.case.create");
    expect(ids.some((id) => id.startsWith("robot-skills."))).toBe(true);
  });

  it("uses injected full-tier recommendations when provided (position/platform via ask)", () => {
    const guide = buildStewardGuideSnapshot({
      recommendations: [
        { capabilityId: "cap-1", name: "发票识别", reason: "平台已向当前企业开放" },
        { capabilityId: "cap-2", name: "排班助手", reason: "企业已推送到销售岗位市场" },
      ],
    });
    expect(guide.recommendations.map((r) => r.capabilityId)).toEqual(["cap-1", "cap-2"]);
    expect(guide.recommendations[0]?.reason).toContain("平台");
  });

  it("returns team-building copy for first-login guide", () => {
    const guide = buildStewardGuideSnapshot({ onboarding: true });
    expect(guide.headline).toContain("数字员工团队");
    expect(guide.headline).not.toMatch(/欢迎入驻\s*openbot/i);
    expect(guide.nextSteps.join("\n")).not.toMatch(/欢迎入驻\s*openbot/i);
    expect(guide.nextSteps[0]).toContain("候选名录");
    expect(guide.nextSteps[1]).toBe("结合你的岗位职责和日常工作事务，点击“+”直接定制数字人。");
    expect(guide.nextSteps.some((step) => step.includes("每日概览"))).toBe(false);
    expect(guide.nextSteps.length).toBeGreaterThanOrEqual(3);
    expect(guide.nextSteps.some((step) => step.includes("支持单"))).toBe(false);
  });
});
