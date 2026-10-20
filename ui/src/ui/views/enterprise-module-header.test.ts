// @vitest-environment jsdom
import { html, render } from "lit";
import { describe, expect, it, vi } from "vitest";
import {
  renderEnterpriseModuleHeader,
  renderEnterpriseSubpageHeader,
} from "./enterprise-module-header.ts";

describe("renderEnterpriseModuleHeader", () => {
  it("renders a compact title without subtitle by default", () => {
    const container = document.createElement("div");
    render(renderEnterpriseModuleHeader({ title: "企业能力中心" }), container);
    expect(container.querySelector(".enterprise-module-header")).not.toBeNull();
    expect(container.querySelector(".enterprise-page__title")?.textContent).toBe("企业能力中心");
    expect(container.querySelector(".enterprise-page__subtitle")).toBeNull();
  });

  it("ignores the subtitle but renders the trailing slot", () => {
    const container = document.createElement("div");
    render(
      renderEnterpriseModuleHeader({
        title: "能力应用管理",
        subtitle: "运行效果与反馈回流。",
        trailing: html`
          <span>trailing</span>
        `,
      }),
      container,
    );
    // Module headers no longer render a subtitle (uniform title bar without the description line).
    expect(container.querySelector(".enterprise-page__subtitle")).toBeNull();
    expect(container.querySelector(".enterprise-module-header__trailing")).not.toBeNull();
  });

  it("renders subpage header with back button", () => {
    const container = document.createElement("div");
    const onBack = vi.fn();
    render(
      renderEnterpriseSubpageHeader({
        title: "审核队列",
        onBack,
        trailing: html`
          <button type="button">导出</button>
        `,
      }),
      container,
    );
    expect(container.querySelector(".enterprise-module-header--subpage")).not.toBeNull();
    const backButton = container.querySelector<HTMLButtonElement>(".enterprise-back-btn");
    backButton?.click();
    expect(onBack).toHaveBeenCalled();
  });
});
