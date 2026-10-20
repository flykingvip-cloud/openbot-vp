// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { RobotSkillEntry } from "../controllers/robot-skills.ts";
import { renderRobotSkillsTab } from "./robot-skills-tab.ts";

const forbiddenTerms = [
  "Prompt",
  "workflow",
  "tools",
  "modelPreferences",
  "Provider",
  "Plugin Manager",
  "Capability Governance",
];

function skill(overrides: Partial<RobotSkillEntry> = {}): RobotSkillEntry {
  return {
    id: overrides.id ?? "skill-1",
    profile: {
      id: overrides.id ?? "skill-1",
      name: overrides.profile?.name ?? "自动生成周报",
      summary: overrides.profile?.summary ?? "根据项目进展生成周报草稿",
      usageExamples: [],
      inputDescription: "项目进展和待办",
      outputDescription: "周报草稿",
      tags: ["周报"],
      category: "办公效率",
      avatar: "",
      visibility: "private",
      assetType: "capability",
      ...overrides.profile,
    },
    lifecycle: overrides.lifecycle ?? "draft",
    health: overrides.health ?? {
      status: "healthy",
      successRate: 1,
      avgLatency: 0,
      lastVerifiedAt: null,
      failureReasons: [],
    },
    sourceRobot: overrides.sourceRobot ?? { id: "agent-1", name: "项目助手" },
    usageCount: overrides.usageCount ?? 3,
    lastUsedAt: overrides.lastUsedAt ?? null,
    enabled: overrides.enabled ?? true,
    installedVersion: overrides.installedVersion ?? "1.0.0",
    latestVersion: overrides.latestVersion ?? null,
  };
}

describe("renderRobotSkillsTab", () => {
  it("renders employee-facing robot capabilities and hides runtime terminology", () => {
    const container = document.createElement("div");
    render(
      renderRobotSkillsTab({
        loading: false,
        skills: [skill()],
        error: null,
        busyKey: null,
        messages: {},
        onSelectSkill: vi.fn(),
        onToggleEnabled: vi.fn(),
        onRemove: vi.fn(),
        onRefresh: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).toContain("机器人能力");
    expect(container.textContent).toContain("✓");
    expect(container.textContent).toContain("自动生成周报");
    expect(container.textContent).toContain("健康");
    for (const term of forbiddenTerms) {
      expect(container.textContent).not.toContain(term);
    }
  });

  it("shows a natural empty state when no capability has accumulated", () => {
    const container = document.createElement("div");
    render(
      renderRobotSkillsTab({
        loading: false,
        skills: [],
        error: null,
        busyKey: null,
        messages: {},
        onToggleEnabled: vi.fn(),
        onRemove: vi.fn(),
        onRefresh: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).toContain("还没有沉淀出稳定能力");
  });
});
