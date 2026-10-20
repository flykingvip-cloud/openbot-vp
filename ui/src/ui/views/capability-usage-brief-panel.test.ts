// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { scanNode } from "../capability/employee-capability/terminology-filter.ts";
import type { CapabilityUsageBrief } from "../capability/employee-capability/types.ts";
import { renderCapabilityUsageBriefPanel } from "./capability-usage-brief-panel.ts";

function makeUsage(overrides: Partial<CapabilityUsageBrief> = {}): CapabilityUsageBrief {
  return {
    robots: [
      { id: "robot-1", name: "销售助手" },
      { id: "robot-2", name: "客服助手" },
    ],
    totalUsageCount: 18,
    lastUsedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("renderCapabilityUsageBriefPanel", () => {
  it("renders robots and confirmation actions before a guarded action", () => {
    const container = document.createElement("div");
    render(
      renderCapabilityUsageBriefPanel({
        usage: makeUsage(),
        loading: false,
        actionLabel: "删除",
        onOpenRobot: vi.fn(),
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      }),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("正在被这些机器人使用");
    expect(text).toContain("删除前，请先确认这些机器人会受到影响。");
    expect(text).toContain("销售助手");
    expect(text).toContain("客服助手");
    expect(text).toContain("确认继续");
  });

  it("renders nothing when robot list is empty", () => {
    const container = document.createElement("div");
    render(
      renderCapabilityUsageBriefPanel({
        usage: makeUsage({ robots: [] }),
        loading: false,
        actionLabel: "编辑",
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).toBe("");
  });

  it("renders loading state", () => {
    const container = document.createElement("div");
    render(
      renderCapabilityUsageBriefPanel({
        usage: null,
        loading: true,
        actionLabel: "编辑",
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).toContain("加载中");
  });

  it("opens the selected robot", () => {
    const container = document.createElement("div");
    const onOpenRobot = vi.fn();
    render(
      renderCapabilityUsageBriefPanel({
        usage: makeUsage(),
        loading: false,
        actionLabel: "删除",
        onOpenRobot,
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      }),
      container,
    );

    const button = container.querySelector(".capability-usage-brief-panel__robot-link");
    expect(button).not.toBeNull();
    (button as HTMLButtonElement).click();
    expect(onOpenRobot).toHaveBeenCalledWith("robot-1");
  });

  it("wires confirm and cancel actions", () => {
    const container = document.createElement("div");
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      renderCapabilityUsageBriefPanel({
        usage: makeUsage(),
        loading: false,
        actionLabel: "删除",
        onConfirm,
        onCancel,
      }),
      container,
    );

    const buttons = container.querySelectorAll("button");
    buttons[2].click();
    buttons[3].click();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("passes the employee capability terminology scan", () => {
    const container = document.createElement("div");
    render(
      renderCapabilityUsageBriefPanel({
        usage: makeUsage(),
        loading: false,
        actionLabel: "删除",
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      }),
      container,
    );

    expect(scanNode(container)).toBeUndefined();
  });
});
