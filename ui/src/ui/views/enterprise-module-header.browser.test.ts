// @vitest-environment jsdom
import { html, render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderEnterpriseModuleHeader } from "./enterprise-module-header.ts";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("renderEnterpriseModuleHeader refresh + subtitle", () => {
  it("does not render a subtitle even when one is provided", () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderEnterpriseModuleHeader({
        title: "企业总览",
        subtitle: "全局经营快照与待办闭环。",
      }),
      container,
    );

    // Module headers no longer show the description line under the title.
    expect(container.querySelector(".enterprise-page__subtitle")).toBeNull();
  });

  it("disables the refresh button and shows 刷新中… while pending", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onRefresh = vi.fn();
    render(
      renderEnterpriseModuleHeader({
        title: "企业总览",
        refresh: { onRefresh, pending: true },
      }),
      container,
    );

    const button = container.querySelector<HTMLButtonElement>(
      ".enterprise-module-header__trailing button",
    );
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(true);
    expect(button?.textContent).toContain("刷新中…");
    expect(button?.textContent).not.toContain("刷新中…刷新");
  });

  it("renders an enabled 刷新 button when refresh is not pending", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onRefresh = vi.fn();
    render(
      renderEnterpriseModuleHeader({
        title: "企业总览",
        refresh: { onRefresh, pending: false },
      }),
      container,
    );

    const button = container.querySelector<HTMLButtonElement>(
      ".enterprise-module-header__trailing button",
    );
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(false);
    expect(button?.textContent).toContain("刷新");
    expect(button?.textContent).not.toContain("刷新中…");

    button?.click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("treats an omitted pending flag the same as not pending", () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderEnterpriseModuleHeader({
        title: "企业总览",
        refresh: { onRefresh: () => undefined },
      }),
      container,
    );

    const button = container.querySelector<HTMLButtonElement>(
      ".enterprise-module-header__trailing button",
    );
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(false);
    expect(button?.textContent).toContain("刷新");
    expect(button?.textContent).not.toContain("刷新中…");
  });

  it("renders no refresh button when the refresh prop is omitted", () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(renderEnterpriseModuleHeader({ title: "企业总览" }), container);

    expect(container.querySelector("button")).toBeNull();
    // With no refresh and no trailing, the trailing slot is not rendered at all.
    expect(container.querySelector(".enterprise-module-header__trailing")).toBeNull();
  });

  it("still renders the trailing slot (without a refresh button) when only trailing is provided", () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderEnterpriseModuleHeader({
        title: "企业总览",
        trailing: html`
          <span class="trailing-marker">导出</span>
        `,
      }),
      container,
    );

    const trailing = container.querySelector(".enterprise-module-header__trailing");
    expect(trailing).not.toBeNull();
    expect(trailing?.querySelector(".trailing-marker")?.textContent).toContain("导出");
    // No refresh prop means no refresh <button> is rendered alongside trailing.
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders a clickable title when onTitleClick is provided", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onTitleClick = vi.fn();
    render(
      renderEnterpriseModuleHeader({
        title: "组织与数字人",
        onTitleClick,
      }),
      container,
    );

    const title = container.querySelector<HTMLButtonElement>("button.enterprise-page__title--link");
    expect(title).not.toBeNull();
    expect(title?.textContent).toContain("组织与数字人");
    title?.click();
    expect(onTitleClick).toHaveBeenCalledTimes(1);
  });
});
