import { describe, expect, it } from "vitest";
import {
  containsSkillRuntimeField,
  sanitizeEmployeeSkillDetail,
  sanitizeEmployeeSkillProfile,
  toOrganizableAssetType,
} from "./skill-models.ts";

describe("employee skill models", () => {
  it("keeps employee profile fields and ignores runtime definition fields", () => {
    const profile = sanitizeEmployeeSkillProfile({
      id: "skill-1",
      name: "自动生成周报",
      summary: "根据项目进展生成周报草稿",
      tags: ["周报", "项目"],
      category: "办公效率",
      visibility: "group",
      prompts: ["hidden"],
      tools: ["hidden-tool"],
      modelPreferences: { provider: "hidden" },
    });

    expect(profile).toMatchObject({
      id: "skill-1",
      name: "自动生成周报",
      summary: "根据项目进展生成周报草稿",
      assetType: "capability",
      tags: ["周报", "项目"],
      category: "办公效率",
      visibility: "group",
    });
    expect(containsSkillRuntimeField(profile)).toBe(false);
  });

  it("sanitizes detail view data without exposing runtime definition fields", () => {
    const detail = sanitizeEmployeeSkillDetail({
      id: "skill-1",
      profile: {
        id: "skill-1",
        name: "客户情绪分析",
        summary: "识别客户反馈中的情绪倾向",
        assetType: "capability",
      },
      lifecycle: "draft",
      health: { status: "warning", successRate: 0.72 },
      dependencyGraph: {
        installedRobots: [{ agentId: "agent-1", name: "客服助手" }],
      },
      runtimeDefinition: {
        prompts: ["hidden"],
        workflow: { hidden: true },
        tools: ["hidden-tool"],
      },
      versions: [
        {
          version: "1.0.0",
          summary: "初始草稿",
          profile: {
            id: "skill-1",
            name: "客户情绪分析",
            summary: "初始",
            assetType: "capability",
          },
          executionPolicies: { hidden: true },
        },
      ],
    });

    expect(detail.profile.name).toBe("客户情绪分析");
    expect(detail.lifecycle).toBe("draft");
    expect(detail.health.status).toBe("warning");
    expect(detail.dependencyGraph.installedRobots).toEqual([
      { agentId: "agent-1", name: "客服助手" },
    ]);
    expect(containsSkillRuntimeField(detail)).toBe(false);
  });

  it("maps knowledge documents off the organize-asset type list", () => {
    expect(toOrganizableAssetType("knowledge")).toBe("capability");
    expect(toOrganizableAssetType("workflow")).toBe("workflow");
    expect(toOrganizableAssetType("template")).toBe("template");
    expect(toOrganizableAssetType("tool")).toBe("tool");
    expect(toOrganizableAssetType("mcp")).toBe("mcp");
  });
});
