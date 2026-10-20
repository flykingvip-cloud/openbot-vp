// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import {
  renderStandardAssetDetailEmptyState,
  renderStandardAssetDetailTabs,
} from "./asset-detail-tabs.ts";

describe("asset detail tabs", () => {
  it("renders the standard lifecycle tabs", () => {
    const container = document.createElement("div");
    render(
      renderStandardAssetDetailTabs({
        activeTab: "overview",
        onChange: vi.fn(),
      }),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("概览");
    expect(text).toContain("定义");
    expect(text).toContain("文件");
    expect(text).toContain("版本");
    expect(text).toContain("运行时");
    expect(text).toContain("安装与分发");
  });

  it("marks the active tab and emits tab changes", () => {
    const container = document.createElement("div");
    const onChange = vi.fn();
    render(
      renderStandardAssetDetailTabs({
        activeTab: "runtime",
        onChange,
      }),
      container,
    );

    const active = container.querySelector(".asset-detail-tabs__tab.is-active");
    expect(active?.textContent).toContain("运行时");

    const installTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".asset-detail-tabs__tab"),
    ).find((button) => button.textContent?.includes("安装与分发"));
    installTab?.click();
    expect(onChange).toHaveBeenCalledWith("install");
  });

  it("renders shared empty states for downstream surfaces", () => {
    const emptyContainer = document.createElement("div");
    render(
      renderStandardAssetDetailEmptyState({
        title: "文件清单待接通",
        description: "当前只接通了技能入口位置。",
      }),
      emptyContainer,
    );
    expect(emptyContainer.textContent).toContain("文件清单待接通");
    expect(emptyContainer.textContent).toContain("当前只接通了技能入口位置。");
  });
});
