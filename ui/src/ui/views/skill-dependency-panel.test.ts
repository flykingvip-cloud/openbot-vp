// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { SkillDependencyGraphSnapshot } from "../controllers/skill-dependency.ts";
import { renderSkillDependencyPanel } from "./skill-dependency-panel.ts";

function makeGraph(
  overrides: Partial<SkillDependencyGraphSnapshot> = {},
): SkillDependencyGraphSnapshot {
  return {
    installedRobotCount: 2,
    sharedGroupCount: 1,
    dependentSkillCount: 1,
    enterpriseConsumerCount: 1,
    hasAnyConsumer: true,
    installedRobots: [
      { id: "robot-1", name: "销售助手" },
      { id: "robot-2", name: "客服助手" },
    ],
    sharedGroups: [{ id: "group-1", name: "市场部" }],
    dependentSkills: [{ id: "skill-2", name: "数据分析" }],
    enterpriseConsumers: [{ kind: "department", id: "dept-1", label: "技术部" }],
    ...overrides,
  };
}

describe("renderSkillDependencyPanel", () => {
  it("renders summary counts", () => {
    const container = document.createElement("div");
    render(
      renderSkillDependencyPanel({
        target: "edit",
        graph: makeGraph(),
        onDrillDown: vi.fn(),
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      }),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("2 个机器人使用");
    expect(text).toContain("1 个协作小组共享");
    expect(text).toContain("1 个能力依赖");
    expect(text).toContain("1 个企业场景使用");
  });

  it("shows info message for edit target", () => {
    const container = document.createElement("div");
    render(
      renderSkillDependencyPanel({
        target: "edit",
        graph: makeGraph(),
        onDrillDown: vi.fn(),
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      }),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("编辑将影响以下使用方");
    expect(text).not.toContain("确认删除将影响以下使用方");
  });

  it("shows warning message for delete target", () => {
    const container = document.createElement("div");
    render(
      renderSkillDependencyPanel({
        target: "delete",
        graph: makeGraph(),
        onDrillDown: vi.fn(),
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      }),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("确认删除将影响以下使用方");
    expect(text).not.toContain("编辑将影响以下使用方");
  });

  it("shows correct confirm button label for edit", () => {
    const container = document.createElement("div");
    render(
      renderSkillDependencyPanel({
        target: "edit",
        graph: makeGraph(),
        onDrillDown: vi.fn(),
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      }),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("确认编辑");
  });

  it("shows correct confirm button label for delete", () => {
    const container = document.createElement("div");
    render(
      renderSkillDependencyPanel({
        target: "delete",
        graph: makeGraph(),
        onDrillDown: vi.fn(),
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      }),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("确认删除");
  });

  it("renders cancel button", () => {
    const container = document.createElement("div");
    render(
      renderSkillDependencyPanel({
        target: "edit",
        graph: makeGraph(),
        onDrillDown: vi.fn(),
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      }),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("取消");
  });

  it("drill-down links are clickable", () => {
    const container = document.createElement("div");
    const onDrillDown = vi.fn();
    render(
      renderSkillDependencyPanel({
        target: "edit",
        graph: makeGraph(),
        onDrillDown,
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      }),
      container,
    );

    const drillLinks = container.querySelectorAll(".skill-dependency-panel__drill-link");
    expect(drillLinks.length).toBeGreaterThan(0);

    // Click the first robot link
    (drillLinks[0] as HTMLButtonElement).click();
    expect(onDrillDown).toHaveBeenCalledWith("robot", "robot-1");
  });

  it("wires confirm and cancel actions", () => {
    const container = document.createElement("div");
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      renderSkillDependencyPanel({
        target: "edit",
        graph: makeGraph(),
        onDrillDown: vi.fn(),
        onConfirm,
        onCancel,
      }),
      container,
    );

    const cancelBtn = container.querySelector(
      ".skill-dependency-panel__btn--cancel",
    ) as HTMLButtonElement;
    const confirmBtn = container.querySelector(
      ".skill-dependency-panel__btn--confirm",
    ) as HTMLButtonElement;

    cancelBtn.click();
    confirmBtn.click();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("renders entity names in drill-down lists", () => {
    const container = document.createElement("div");
    render(
      renderSkillDependencyPanel({
        target: "edit",
        graph: makeGraph(),
        onDrillDown: vi.fn(),
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      }),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("销售助手");
    expect(text).toContain("客服助手");
    expect(text).toContain("市场部");
    expect(text).toContain("数据分析");
    expect(text).toContain("技术部");
  });

  it("does not render empty categories", () => {
    const container = document.createElement("div");
    render(
      renderSkillDependencyPanel({
        target: "edit",
        graph: makeGraph({
          sharedGroups: [],
          sharedGroupCount: 0,
          dependentSkills: [],
          dependentSkillCount: 0,
        }),
        onDrillDown: vi.fn(),
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      }),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).not.toContain("共享协作小组");
    expect(text).not.toContain("依赖此能力");
    // But should still show robots and enterprise
    expect(text).toContain("已安装机器人");
    expect(text).toContain("企业使用场景");
  });
});
