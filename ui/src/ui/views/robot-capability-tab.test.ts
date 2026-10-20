// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { scanNode } from "../capability/employee-capability/terminology-filter.ts";
import type { RobotCapabilityItem } from "../controllers/robot-capability.ts";
import { renderRobotCapabilityTab, type RobotCapabilityTabProps } from "./robot-capability-tab.ts";

function makeItem(overrides: Partial<RobotCapabilityItem> = {}): RobotCapabilityItem {
  return {
    relationId: overrides.relationId ?? "rel-1",
    skillId: overrides.skillId ?? "skill-1",
    name: overrides.name ?? "自动生成周报",
    summary: overrides.summary ?? "根据项目进展生成周报草稿",
    health: overrides.health ?? {
      status: "healthy",
      successRate: 0.98,
      avgLatency: 120,
      lastVerifiedAt: Date.now(),
      failureReasons: [],
    },
    enabled: overrides.enabled ?? true,
    lastInvokedAt: overrides.lastInvokedAt ?? null,
    usageCount: overrides.usageCount ?? 5,
    hasNewerVersion: overrides.hasNewerVersion ?? false,
    secondary: overrides.secondary ?? {
      installedVersion: "1.0.0",
      latestVersion: null,
    },
  };
}

function makeProps(overrides: Partial<RobotCapabilityTabProps> = {}): RobotCapabilityTabProps {
  return {
    loading: false,
    items: overrides.items ?? [makeItem()],
    error: null,
    busyRelationId: null,
    expandedSkillId: null,
    messages: {},
    onExpand: vi.fn(),
    onToggleEnabled: vi.fn(),
    onSwitchVersion: vi.fn(),
    onRemove: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  };
}

function renderToContainer(props: RobotCapabilityTabProps): HTMLDivElement {
  const container = document.createElement("div");
  render(renderRobotCapabilityTab(props), container);
  return container;
}

const TERMINOLOGY_BLACKLIST = [
  "workflow",
  "schema",
  "toolchain",
  "dependency",
  "provider",
  "model",
  "routing",
  "prompt",
  "memory strategy",
  "execution policy",
  "capability governance",
  "registry",
  "asset lifecycle",
  "OpenAI",
  "Anthropic",
  "version",
  "rollback",
  "migration",
];

describe("renderRobotCapabilityTab", () => {
  describe("default list view", () => {
    it("renders only name + summary + health icon per item", () => {
      const container = renderToContainer(makeProps());
      const text = container.textContent ?? "";

      expect(container.querySelector(".robot-capability-tab--flat")).not.toBeNull();
      expect(container.querySelector(".robot-capability-tab__list")).not.toBeNull();
      expect(text).toContain("自动生成周报");
      expect(text).toContain("根据项目进展生成周报草稿");
      expect(text).toContain("运行正常");
    });

    it("does NOT display version numbers or technical metadata in default view", () => {
      const container = renderToContainer(
        makeProps({
          items: [
            makeItem({
              hasNewerVersion: true,
              secondary: { installedVersion: "1.0.0", latestVersion: "2.0.0" },
            }),
          ],
        }),
      );
      const text = container.textContent ?? "";

      // Version numbers should not appear in the default (non-expanded) view
      expect(text).not.toContain("1.0.0");
      expect(text).not.toContain("2.0.0");
      // No upgrade badge in list view
      expect(text).not.toContain("有更新的版本可切换");
    });

    it("does NOT show source labels or technical metadata", () => {
      const container = renderToContainer(makeProps());
      const text = container.textContent ?? "";

      for (const term of TERMINOLOGY_BLACKLIST) {
        expect(text.toLowerCase()).not.toContain(term.toLowerCase());
      }
    });
  });

  describe("empty state", () => {
    it("shows correct employee-friendly message when items is empty", () => {
      const container = renderToContainer(makeProps({ items: [] }));
      const text = container.textContent ?? "";

      expect(text).toContain("能力将从机器人日常工作中自然积累");
    });
  });

  describe("expanded detail view", () => {
    it("shows health detail badge in expanded view", () => {
      const item = makeItem({ skillId: "skill-1" });
      const container = renderToContainer(
        makeProps({
          items: [item],
          expandedSkillId: "skill-1",
        }),
      );
      const text = container.textContent ?? "";

      // Detail badge shows metrics
      expect(text).toContain("运行正常");
      expect(text).toContain("成功率");
    });

    it("shows version hint only when hasNewerVersion is true in expanded view", () => {
      const item = makeItem({
        skillId: "skill-1",
        hasNewerVersion: true,
        secondary: { installedVersion: "1.0.0", latestVersion: "2.0.0" },
      });
      const container = renderToContainer(
        makeProps({
          items: [item],
          expandedSkillId: "skill-1",
        }),
      );
      const text = container.textContent ?? "";

      expect(text).toContain("有更新的版本可切换");
    });

    it("does NOT show version hint when hasNewerVersion is false", () => {
      const item = makeItem({
        skillId: "skill-1",
        hasNewerVersion: false,
      });
      const container = renderToContainer(
        makeProps({
          items: [item],
          expandedSkillId: "skill-1",
        }),
      );
      const text = container.textContent ?? "";

      expect(text).not.toContain("有更新的版本可切换");
    });
  });

  describe("secondary actions in more menu", () => {
    it("secondary actions are in a more menu, not primary buttons", () => {
      const item = makeItem({ skillId: "skill-1" });
      const container = renderToContainer(
        makeProps({
          items: [item],
          expandedSkillId: "skill-1",
        }),
      );

      // The "more" menu trigger should exist
      const moreMenu = container.querySelector(".robot-capability-tab__more-menu");
      expect(moreMenu).not.toBeNull();

      // The trigger should be "…"
      const trigger = container.querySelector(".robot-capability-tab__more-trigger");
      expect(trigger?.textContent?.trim()).toBe("…");

      // Actions should be inside the dropdown
      const actions = container.querySelectorAll(".robot-capability-tab__more-action");
      expect(actions.length).toBeGreaterThanOrEqual(2); // at least enable/disable + remove
    });

    it("shows switch version action only when hasNewerVersion is true", () => {
      const item = makeItem({
        skillId: "skill-1",
        hasNewerVersion: true,
        secondary: { installedVersion: "1.0.0", latestVersion: "2.0.0" },
      });
      const container = renderToContainer(
        makeProps({
          items: [item],
          expandedSkillId: "skill-1",
        }),
      );

      const actions = container.querySelectorAll(".robot-capability-tab__more-action");
      const actionTexts = Array.from(actions).map((a) => a.textContent?.trim());
      expect(actionTexts).toContain("切换到新版本");
    });

    it("does NOT show switch version action when hasNewerVersion is false", () => {
      const item = makeItem({
        skillId: "skill-1",
        hasNewerVersion: false,
      });
      const container = renderToContainer(
        makeProps({
          items: [item],
          expandedSkillId: "skill-1",
        }),
      );

      const actions = container.querySelectorAll(".robot-capability-tab__more-action");
      const actionTexts = Array.from(actions).map((a) => a.textContent?.trim());
      expect(actionTexts).not.toContain("切换到新版本");
    });
  });

  describe("loading state", () => {
    it("shows spinner when loading is true", () => {
      const container = renderToContainer(makeProps({ loading: true }));

      expect(container.querySelector(".robot-capability-tab__loading")).not.toBeNull();
      expect(container.textContent).toContain("加载中");
    });
  });

  describe("error state", () => {
    it("shows error message with retry button", () => {
      const onRefresh = vi.fn();
      const container = renderToContainer(makeProps({ error: "网络连接失败", onRefresh }));

      expect(container.textContent).toContain("网络连接失败");
      const retryBtn = container.querySelector(".robot-capability-tab__error button");
      expect(retryBtn).not.toBeNull();
      expect(retryBtn?.textContent?.trim()).toBe("重试");
    });
  });

  describe("recommendation install", () => {
    it("replaces the install button with the next step when install is blocked", () => {
      const onInstallRecommended = vi.fn();
      const container = renderToContainer(
        makeProps({
          recommendations: [
            {
              skillId: "cap-whisper",
              name: "语音转写",
              summary: "把语音转成文字",
              category: "",
              tags: [],
              source: "enterprise",
              sourceLabel: "企业资产库",
              health: "healthy",
              usageCount: 0,
              matchScore: 1,
            },
          ],
          installHints: { "cap-whisper": "需要先完成服务配置" },
          onInstallRecommended,
        }),
      );

      expect(container.textContent).toContain("需要先完成服务配置");
      const installButtons = Array.from(container.querySelectorAll("button")).filter(
        (button) => button.textContent?.trim() === "安装",
      );
      expect(installButtons).toHaveLength(0);
      expect(onInstallRecommended).not.toHaveBeenCalled();
      expect(() => scanNode(container, "robot-capability-tab-preflight")).not.toThrow();
    });
  });

  describe("terminology blacklist scan", () => {
    it("rendered output passes terminology blacklist scan", () => {
      const items = [
        makeItem({ name: "客户情绪分析", summary: "识别客户反馈中的情绪倾向" }),
        makeItem({
          relationId: "rel-2",
          skillId: "skill-2",
          name: "自动生成日报",
          summary: "汇总当天工作进展",
        }),
      ];
      const container = renderToContainer(
        makeProps({
          items,
          expandedSkillId: "skill-1",
        }),
      );

      // scanNode will throw if any blacklisted term is found
      expect(() => scanNode(container, "robot-capability-tab")).not.toThrow();
    });
  });
});
