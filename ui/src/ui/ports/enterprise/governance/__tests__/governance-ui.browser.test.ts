/* @vitest-environment jsdom */
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import {
  GOVERNANCE_CONFIG_FIELDS,
  renderGovernanceConfigPanel,
  renderGovernanceActionDialog,
} from "../governance-ui.ts";
import { DEFAULT_GOVERNANCE_CONFIG } from "../types.ts";
import type { GovernanceItem, MeshOwnership } from "../types.ts";

const baseOwnership: MeshOwnership = {
  positionId: "pos-eng",
  positionLabel: "Engineering",
  createdByUserId: "creator-1",
  createdByUserLabel: "Creator",
  currentManagerUserId: "manager-1",
  currentManagerLabel: "Alice Manager",
  createdAt: "2025-01-01T00:00:00.000Z",
};

describe("renderGovernanceConfigPanel", () => {
  it("renders all 7 config fields", () => {
    const container = document.createElement("div");
    render(
      renderGovernanceConfigPanel({
        config: DEFAULT_GOVERNANCE_CONFIG,
        onUpdate: () => {},
      }),
      container,
    );

    const inputs = container.querySelectorAll("input[type=number]");
    expect(inputs).toHaveLength(GOVERNANCE_CONFIG_FIELDS.length);
    expect(GOVERNANCE_CONFIG_FIELDS.length).toBe(7);
  });

  it("renders field labels", () => {
    const container = document.createElement("div");
    render(
      renderGovernanceConfigPanel({
        config: DEFAULT_GOVERNANCE_CONFIG,
        onUpdate: () => {},
      }),
      container,
    );

    expect(container.textContent).toContain("连续错误次数阈值");
    expect(container.textContent).toContain("离线告警时间阈值");
    expect(container.textContent).toContain("僵尸机器人判定天数");
    expect(container.textContent).toContain("错误率告警阈值");
    expect(container.textContent).toContain("成本突增倍数");
    expect(container.textContent).toContain("质量下降百分点");
    expect(container.textContent).toContain("协作小组僵尸判定天数");
  });

  it("calls onUpdate when input changes", () => {
    const onUpdate = vi.fn();
    const container = document.createElement("div");
    render(
      renderGovernanceConfigPanel({
        config: DEFAULT_GOVERNANCE_CONFIG,
        onUpdate,
      }),
      container,
    );

    const firstInput = container.querySelector("input[type=number]") as HTMLInputElement;
    firstInput.value = "10";
    firstInput.dispatchEvent(new Event("change"));

    expect(onUpdate).toHaveBeenCalledWith({ consecutiveErrorThreshold: 10 });
  });

  it("converts percent values correctly", () => {
    const onUpdate = vi.fn();
    const container = document.createElement("div");
    render(
      renderGovernanceConfigPanel({
        config: DEFAULT_GOVERNANCE_CONFIG,
        onUpdate,
      }),
      container,
    );

    // Find the error rate input (should display as "30" for 0.30)
    const inputs = Array.from(container.querySelectorAll<HTMLInputElement>("input[type=number]"));
    const errorRateInput = inputs[3]; // index 3 = errorRateThreshold
    expect(errorRateInput.value).toBe("30");

    errorRateInput.value = "50";
    errorRateInput.dispatchEvent(new Event("change"));

    expect(onUpdate).toHaveBeenCalledWith({ errorRateThreshold: 0.5 });
  });

  it("shows close button when onClose provided", () => {
    const onClose = vi.fn();
    const container = document.createElement("div");
    render(
      renderGovernanceConfigPanel({
        config: DEFAULT_GOVERNANCE_CONFIG,
        onUpdate: () => {},
        onClose,
      }),
      container,
    );

    const closeBtn = container.querySelector(
      ".enterprise-mesh-governance-config__close",
    ) as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    closeBtn.click();
    expect(onClose).toHaveBeenCalled();
  });
});

describe("renderGovernanceActionDialog", () => {
  function makeIssue(level: "critical" | "warning" | "info" = "critical"): GovernanceItem {
    return {
      id: `consecutive_errors:agent:agent-1`,
      level,
      category: "consecutive_errors",
      target: {
        kind: "agent",
        id: "agent-1",
        name: "Test Bot",
        ownership: baseOwnership,
      },
      title: "Test Bot 连续错误 5 次",
      evidence: { consecutiveErrors: 5 },
      suggestedAction: "建议暂停机器人并排查错误原因",
      detectedAt: "2026-05-17T12:00:00.000Z",
    };
  }

  it("renders critical actions: 暂停 / 限流 / 下线", () => {
    const container = document.createElement("div");
    render(
      renderGovernanceActionDialog({
        issue: makeIssue("critical"),
        onExecute: () => {},
        onCancel: () => {},
      }),
      container,
    );

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".enterprise-mesh-governance-dialog__action"),
    );
    const buttonTexts = buttons.map((b) => b.textContent?.trim() ?? "");
    expect(buttonTexts).toContain("暂停");
    expect(buttonTexts).toContain("限流");
    expect(buttonTexts).toContain("下线");
    expect(buttonTexts).not.toContain("归档");
  });

  it("renders warning actions: 降级模型 / 设置预算上限 / 标记为已知问题", () => {
    const container = document.createElement("div");
    render(
      renderGovernanceActionDialog({
        issue: makeIssue("warning"),
        onExecute: () => {},
        onCancel: () => {},
      }),
      container,
    );

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".enterprise-mesh-governance-dialog__action"),
    );
    const buttonTexts = buttons.map((b) => b.textContent?.trim() ?? "");
    expect(buttonTexts).toContain("降级模型");
    expect(buttonTexts).toContain("设置预算上限");
    expect(buttonTexts).toContain("标记为已知问题");
    expect(buttonTexts).not.toContain("暂停");
  });

  it("renders info actions: 归档 / 合并 / 忽略", () => {
    const container = document.createElement("div");
    render(
      renderGovernanceActionDialog({
        issue: makeIssue("info"),
        onExecute: () => {},
        onCancel: () => {},
      }),
      container,
    );

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".enterprise-mesh-governance-dialog__action"),
    );
    const buttonTexts = buttons.map((b) => b.textContent?.trim() ?? "");
    expect(buttonTexts).toContain("归档");
    expect(buttonTexts).toContain("合并");
    expect(buttonTexts).toContain("忽略");
    expect(buttonTexts).not.toContain("暂停");
  });

  it("displays ownership info in the dialog", () => {
    const container = document.createElement("div");
    render(
      renderGovernanceActionDialog({
        issue: makeIssue(),
        onExecute: () => {},
        onCancel: () => {},
      }),
      container,
    );

    expect(container.textContent).toContain("Engineering");
    expect(container.textContent).toContain("Alice Manager");
  });

  it("calls onExecute when action button clicked", () => {
    const onExecute = vi.fn();
    const container = document.createElement("div");
    render(
      renderGovernanceActionDialog({
        issue: makeIssue("critical"),
        onExecute,
        onCancel: () => {},
      }),
      container,
    );

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".enterprise-mesh-governance-dialog__action"),
    );
    expect(buttons.length).toBeGreaterThan(0);
    buttons[0].click();
    expect(onExecute).toHaveBeenCalledWith("pause");
  });

  it("disables actions when pending", () => {
    const container = document.createElement("div");
    render(
      renderGovernanceActionDialog({
        issue: makeIssue("critical"),
        onExecute: () => {},
        onCancel: () => {},
        pending: true,
      }),
      container,
    );

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".enterprise-mesh-governance-dialog__action"),
    );
    for (const btn of buttons) {
      expect(btn.disabled).toBe(true);
    }
  });

  it("displays error message", () => {
    const container = document.createElement("div");
    render(
      renderGovernanceActionDialog({
        issue: makeIssue("critical"),
        onExecute: () => {},
        onCancel: () => {},
        error: "执行失败：机器人已被其他管理员处理",
      }),
      container,
    );

    expect(container.textContent).toContain("执行失败");
  });

  it("calls onCancel when close button clicked", () => {
    const onCancel = vi.fn();
    const container = document.createElement("div");
    render(
      renderGovernanceActionDialog({
        issue: makeIssue("critical"),
        onExecute: () => {},
        onCancel,
      }),
      container,
    );

    const closeBtn = container.querySelector(
      ".enterprise-mesh-governance-dialog__close",
    ) as HTMLButtonElement;
    closeBtn.click();
    expect(onCancel).toHaveBeenCalled();
  });
});
