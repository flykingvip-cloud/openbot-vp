// @vitest-environment jsdom
// Feature: enterprise-capability-usage-management
// Empty state messages — Requirements 4.10, 5.7, 6.10, 7.10

import { render, type TemplateResult } from "lit-html";
import { describe, expect, it } from "vitest";
import { renderEmptyState } from "../shared/empty-state.ts";

function renderToContainer(template: TemplateResult): HTMLDivElement {
  const container = document.createElement("div");
  render(template, container);
  return container;
}

describe("renderEmptyState", () => {
  it("renders the provided message", () => {
    const container = renderToContainer(renderEmptyState("当前筛选条件下没有匹配的机器人"));
    expect(container.textContent).toContain("当前筛选条件下没有匹配的机器人");
  });

  it("includes the empty-state CSS class for styling", () => {
    const container = renderToContainer(renderEmptyState("暂无使用数据"));
    expect(container.querySelector(".enterprise-usage-empty-state")).not.toBeNull();
  });

  it("renders different messages for different sub-pages", () => {
    const messages = [
      "当前筛选条件下没有匹配的机器人",
      "暂无安装关系",
      "暂无使用数据",
      "暂无低效能力",
      "暂无未使用能力",
      "暂无冲突能力",
    ];
    for (const msg of messages) {
      const container = renderToContainer(renderEmptyState(msg));
      expect(container.textContent).toContain(msg);
    }
  });
});
