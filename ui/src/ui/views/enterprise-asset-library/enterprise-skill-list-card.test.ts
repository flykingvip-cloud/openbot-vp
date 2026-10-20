// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { EnterpriseAssetListItem } from "../../capability/enterprise-capability/types.ts";
import {
  formatSkillCardMeta,
  renderEnterpriseSkillListCard,
} from "./enterprise-skill-list-card.ts";

function createItem(overrides: Partial<EnterpriseAssetListItem> = {}): EnterpriseAssetListItem {
  return {
    id: "cap-1",
    name: "招聘 JD 生成",
    description: "根据岗位要求自动生成符合企业规范的招聘 JD",
    usageScenarios: ["HR招聘"],
    applicableScope: { kind: "enterprise" },
    domain: "HR",
    maturity: "多人复用",
    healthStatus: "效果稳定",
    lifecycle: "published",
    valueSummary: {
      monthlyExecutions: 1284,
      departmentCoverageCount: 5,
      reuseGrowthRate30d: 12,
    },
    reuseData: {
      robotCount: 8,
      employeeCount: 15,
      departmentCount: 5,
      trend30Days: [],
      growthPercentage: 12,
    },
    sourceEmployeeName: "平台",
    avatar: null,
    ...overrides,
  };
}

describe("formatSkillCardMeta", () => {
  it("joins monthly usage, robot count, and growth as one line", () => {
    const meta = formatSkillCardMeta(createItem());
    expect(meta).toContain("本月已被调用");
    expect(meta).toContain("8 个机器人");
    expect(meta).toContain("近 30 天复用增长");
    expect(meta).not.toContain("服务 ");
  });

  it("prefixes MCP server name when present", () => {
    const meta = formatSkillCardMeta(
      createItem({ assetType: "mcp", mcpServerName: "consult-win-advisor" }),
    );
    expect(meta.startsWith("服务 consult-win-advisor")).toBe(true);
  });
});

describe("renderEnterpriseSkillListCard", () => {
  it("renders source, name, description, meta, and actions", () => {
    const container = document.createElement("div");
    render(
      renderEnterpriseSkillListCard({
        item: createItem(),
        onInstallToRobot: vi.fn(),
        onViewDetail: vi.fn(),
      }),
      container,
    );

    expect(container.querySelector(".enterprise-skill-card")).not.toBeNull();
    expect(container.textContent).toContain("来源：平台");
    expect(container.textContent).toContain("招聘 JD 生成");
    expect(container.textContent).toContain("推送到岗位");
    expect(container.textContent).toContain("查看详情");
    expect(container.querySelector(".asset-table")).toBeNull();
    expect(container.querySelector(".enterprise-skill-card__type-badge")).toBeNull();
  });

  it("renders an MCP badge, server name, and push-mount action", () => {
    const container = document.createElement("div");
    render(
      renderEnterpriseSkillListCard({
        item: createItem({
          name: "打单参谋",
          assetType: "mcp",
          mcpServerName: "consult-win-advisor",
        }),
        onInstallToRobot: vi.fn(),
        onViewDetail: vi.fn(),
        installLabel: "推送挂载",
      }),
      container,
    );

    expect(container.querySelector(".enterprise-skill-card__type-badge")?.textContent).toBe("MCP");
    expect(container.textContent).toContain("服务 consult-win-advisor");
    expect(container.textContent).toContain("推送挂载");
    expect(container.textContent).not.toContain("推送到岗位");
  });

  it("does not render domain or scenario tag columns in the card", () => {
    const container = document.createElement("div");
    render(
      renderEnterpriseSkillListCard({
        item: createItem({ domain: "法务", usageScenarios: ["法务"] }),
        onInstallToRobot: vi.fn(),
        onViewDetail: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).not.toContain("使用场景");
    expect(container.querySelector(".asset-table__tag")).toBeNull();
  });
});
