import { describe, expect, it } from "vitest";
import type { CapabilitySummary } from "../capability/employee-capability/types.ts";
import { filterCapabilities, filterItemsBySegment } from "./my-accumulation.ts";
import type { MyCapabilityListItem } from "./my-accumulation.ts";

function capability(index: number): CapabilitySummary {
  const isEven = index % 2 === 0;
  return {
    id: `cap-${index}`,
    name: isEven ? `客户情绪分析 ${index}` : `自动生成周报 ${index}`,
    summary: isEven ? "分析客户消息中的情绪倾向" : "整理项目进展并生成周报",
    usageExamples: [],
    inputDescription: "",
    outputDescription: "",
    tags: isEven ? ["客户", "分析"] : ["周报", "效率"],
    category: isEven ? "客户服务" : "效率工具",
    avatar: null,
    health: "运行稳定",
    shareVisibility: isEven ? "私有" : "已共享到协作小组",
    maturity: null,
    attribution: {
      sourceRobot: { id: isEven ? "robot-a" : "robot-b", name: isEven ? "销售助手" : "工作助手" },
      sourceTaskSummary: "日常任务",
      firstFormedScenario: "首次在工作中形成",
      highFrequencyScenarios: [],
    },
    usage: { robots: [], totalUsageCount: 0, lastUsedAt: null },
    usageMetrics: { robotCount: 0, groupCount: 0, totalUsageCount: 0, lastUsedAt: null },
    recentUpdate: null,
    versionInfo: { currentVersion: "1.0.0", versionCount: 1, submittedVersion: null },
    isDraft: false,
    createdAt: index,
    updatedAt: index,
    enterpriseLifecycle: {
      stage: "draft",
      stageLabel: "资产草稿",
      nextStep: "补充信息后可共享或提交企业。",
    },
  };
}

describe("my accumulation properties", () => {
  it("keeps list item boundaries free of hidden fields", () => {
    // Feature: skill-lifecycle-asset-system, Property 10: MyCapabilityListItem 字段边界
    for (let index = 0; index < 100; index += 1) {
      const cap = capability(index);
      const listItem = {
        id: cap.id,
        name: cap.name,
        summary: cap.summary,
        health: cap.health,
        shareVisibility: cap.shareVisibility,
        isDraft: cap.isDraft,
        recentUpdate: cap.recentUpdate,
        updatedAt: cap.updatedAt,
        sourceRobotName: cap.attribution.sourceRobot.name,
        usageBrief: { robotCount: cap.usage.robots.length, lastUsedAt: cap.usage.lastUsedAt },
        usageMetrics: cap.usageMetrics,
        versionInfo: cap.versionInfo,
        enterpriseLifecycle: cap.enterpriseLifecycle,
      };
      const serialized = JSON.stringify(listItem);
      expect(serialized).toContain("currentVersion");
      expect(serialized).toContain("stageLabel");
      expect(serialized).not.toContain("runtimeDependency");
      expect(serialized).not.toContain("runtimeHealth");
    }
  });

  it("filters every returned capability according to all predicates", () => {
    // Feature: skill-lifecycle-asset-system, Property 11: 搜索/筛选正确性
    const capabilities = Array.from({ length: 100 }, (_, index) => capability(index));
    const filtered = filterCapabilities(capabilities, {
      searchQuery: "周报",
      filterTag: "效率",
      filterCategory: "效率工具",
      filterSource: "工作助手",
      filterShareVisibility: "已共享到协作小组",
    });

    for (const item of filtered) {
      expect(`${item.name} ${item.summary}`.toLocaleLowerCase()).toContain("周报");
      expect(item.tags).toContain("效率");
      expect(item.category).toBe("效率工具");
      expect(item.attribution.sourceRobot.name).toBe("工作助手");
      expect(item.shareVisibility).toBe("已共享到协作小组");
    }
  });

  it("routes gateway list items into the five 我的资产 tabs", () => {
    const items = [
      {
        id: "draft",
        name: "草稿周报",
        summary: "还在整理",
        health: "运行稳定",
        shareVisibility: "私有",
        isDraft: true,
        recentUpdate: null,
        updatedAt: 1,
        sourceRobotName: "销售助手",
        usageBrief: { robotCount: 0, lastUsedAt: null },
        usageMetrics: { robotCount: 0, groupCount: 0, totalUsageCount: 0, lastUsedAt: null },
        versionInfo: { currentVersion: "0.1.0", versionCount: 1, submittedVersion: null },
      },
      {
        id: "reviewing",
        name: "审核中周报",
        summary: "已提交",
        health: "运行稳定",
        shareVisibility: "审核中",
        isDraft: false,
        recentUpdate: null,
        updatedAt: 2,
        sourceRobotName: "销售助手",
        usageBrief: { robotCount: 0, lastUsedAt: null },
        usageMetrics: { robotCount: 0, groupCount: 0, totalUsageCount: 0, lastUsedAt: null },
        versionInfo: { currentVersion: "1.0.0", versionCount: 1, submittedVersion: null },
      },
      {
        id: "enterprise",
        name: "已入企业周报",
        summary: "已入库",
        health: "运行稳定",
        shareVisibility: "已进入企业资产库",
        isDraft: false,
        recentUpdate: null,
        updatedAt: 3,
        sourceRobotName: "销售助手",
        usageBrief: { robotCount: 1, lastUsedAt: 1 },
        usageMetrics: { robotCount: 1, groupCount: 0, totalUsageCount: 1, lastUsedAt: 1 },
        versionInfo: { currentVersion: "1.0.0", versionCount: 1, submittedVersion: null },
      },
      {
        id: "optimize",
        name: "需优化周报",
        summary: "被退回",
        health: "需要重新整理",
        shareVisibility: "需要修改后再次提交",
        isDraft: false,
        recentUpdate: null,
        updatedAt: 4,
        sourceRobotName: "销售助手",
        usageBrief: { robotCount: 0, lastUsedAt: null },
        usageMetrics: { robotCount: 0, groupCount: 0, totalUsageCount: 0, lastUsedAt: null },
        versionInfo: { currentVersion: "1.0.0", versionCount: 1, submittedVersion: null },
        enterpriseLifecycle: {
          stage: "needs_revision",
          stageLabel: "需要修改",
          nextStep: "按审核意见补充后再次提交",
        },
      },
    ] satisfies MyCapabilityListItem[];

    expect(filterItemsBySegment(items, "all")).toHaveLength(4);
    expect(filterItemsBySegment(items, "drafts").map((item) => item.id)).toEqual(["draft"]);
    expect(filterItemsBySegment(items, "reviewing").map((item) => item.id)).toEqual(["reviewing"]);
    expect(filterItemsBySegment(items, "contributed").map((item) => item.id)).toEqual([
      "enterprise",
    ]);
    expect(filterItemsBySegment(items, "optimize").map((item) => item.id)).toEqual(["optimize"]);
  });
});
