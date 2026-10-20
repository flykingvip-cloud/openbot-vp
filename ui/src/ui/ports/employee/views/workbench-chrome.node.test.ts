// @vitest-environment jsdom
import { html, render } from "lit";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n, t } from "../../../../i18n/index.ts";
import { zh_CN } from "../../../../i18n/locales/zh-CN.ts";
import {
  renderModuleItem,
  renderNavItem,
  renderSidebarGroupHeader,
  renderWorkbenchBrand,
} from "./workbench-chrome.ts";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("workbench chrome", () => {
  beforeAll(async () => {
    i18n.registerTranslation("zh-CN", zh_CN);
    await i18n.setLocale("zh-CN");
  });

  it("uses knowledge workspace naming in zh-CN nav i18n", () => {
    expect(t("frontstage.workbench.nav.knowledgeVerse")).toBe("知识宇宙");
  });

  it("renders nav icons and unread badges", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`<aside class="employee-workbench__sidebar employee-workbench__sidebar--flat">
        <div class="employee-workbench__group-stack employee-workbench__group-stack--flat">
          ${renderNavItem({
            title: "市场助手",
            rawTitle: "市场助手",
            subtitle: "主工作线程",
            iconKey: "sparkles",
            tone: "violet",
            count: 5,
            onClick: () => undefined,
          })}
        </div>
      </aside>`,
      container,
    );
    await Promise.resolve();

    expect(container.querySelector(".employee-workbench__nav-icon")).not.toBeNull();
    expect(container.querySelector(".employee-workbench__nav-badge")?.textContent?.trim()).toBe(
      "5",
    );
    expect(
      container.querySelector(".employee-workbench__nav-item")?.getAttribute("aria-label"),
    ).toBe("市场助手");
  });

  it("shows a floating tooltip for collapsed nav items", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`<div class="employee-workbench collapsed">
        ${renderNavItem({
          title: "skill incubation",
          rawTitle: "skill incubation",
          iconKey: "sparkles",
          tone: "violet",
          onClick: () => undefined,
        })}
      </div>`,
      container,
    );
    await Promise.resolve();

    const navItem = container.querySelector<HTMLElement>(".employee-workbench__nav-item");
    navItem?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

    const tooltip = document.getElementById("employee-workbench-nav-tooltip-floating");
    expect(tooltip?.classList.contains("visible")).toBe(true);
    expect(tooltip?.textContent?.trim()).toBe("skill incubation");

    navItem?.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    expect(tooltip?.classList.contains("visible")).toBe(false);
  });

  it("renders module items with icons and shows collapsed tooltips", async () => {
    const onClick = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`<div class="employee-workbench collapsed">
        ${renderModuleItem({
          title: "知识宇宙",
          iconKey: "book",
          tone: "blue",
          active: true,
          onClick,
        })}
      </div>`,
      container,
    );
    await Promise.resolve();

    const moduleItem = container.querySelector<HTMLElement>(".employee-workbench__module-item");
    expect(container.querySelector(".employee-workbench__module-icon")).not.toBeNull();
    expect(moduleItem?.getAttribute("aria-label")).toBe("知识宇宙");

    moduleItem?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    const tooltip = document.getElementById("employee-workbench-nav-tooltip-floating");
    expect(tooltip?.classList.contains("visible")).toBe(true);
    expect(tooltip?.textContent?.trim()).toBe("知识宇宙");

    moduleItem?.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders group headers with collapse state and add action", async () => {
    const onToggle = vi.fn();
    const onAdd = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderSidebarGroupHeader({
        title: "AI助理",
        collapsed: true,
        onToggle,
        onAdd,
      })}`,
      container,
    );
    await Promise.resolve();

    container.querySelector<HTMLButtonElement>(".employee-workbench__group-toggle")?.click();
    container.querySelector<HTMLButtonElement>(".employee-workbench__group-add")?.click();

    expect(container.querySelector(".employee-workbench__group-caret.collapsed")).not.toBeNull();
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it("renders the default brand slot without subtitle or upload control", async () => {
    const onFileChange = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchBrand({
        uploadLabel: "更换 Logo",
        resetLabel: "恢复默认 Logo",
        logoAlt: "当前导航 Logo",
        defaultTitle: "openbot",
        defaultSubtitle: "顶部导航 Logo 位",
        onBrandLogoFileChange: onFileChange,
      })}`,
      container,
    );
    await Promise.resolve();

    expect(container.querySelector(".employee-workbench__brand-title")?.textContent?.trim()).toBe(
      "openbot",
    );
    expect(container.querySelector(".employee-workbench__brand-subtitle")).toBeNull();
    expect(container.querySelector(".employee-workbench__brand-input")).toBeNull();
    expect(onFileChange).not.toHaveBeenCalled();
  });

  it("renders a custom brand logo and resets it", async () => {
    const onReset = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchBrand({
        brandLogoSrc: "data:image/png;base64,AAAA",
        customBrandLogoEnabled: true,
        uploadLabel: "Change logo",
        resetLabel: "Reset logo",
        logoAlt: "Current navigation logo",
        defaultTitle: "openbot",
        defaultSubtitle: "Top navigation logo slot",
        onBrandLogoFileChange: () => undefined,
        onResetBrandLogo: onReset,
      })}`,
      container,
    );
    await Promise.resolve();

    expect(container.querySelector(".employee-workbench__brand-logo")).not.toBeNull();
    container.querySelector<HTMLButtonElement>('button[aria-label="Reset logo"]')?.click();
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("renders the bundled brand wordmark when provided", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchBrand({
        bundledBrandLogoSrc: "/openbot-logo.png",
        uploadLabel: "Change logo",
        resetLabel: "Reset logo",
        logoAlt: "Current navigation logo",
        defaultTitle: "openbot",
        defaultSubtitle: "Top navigation logo slot",
        onBrandLogoFileChange: () => undefined,
      })}`,
      container,
    );
    await Promise.resolve();

    const logo = container.querySelector<HTMLImageElement>(".employee-workbench__brand-logo");
    expect(logo?.getAttribute("src")).toBe("/openbot-logo.png");
    expect(
      container.querySelector(".employee-workbench__brand-fallback")?.hasAttribute("hidden"),
    ).toBe(true);
  });

  it("reveals the brand mark when a bundled wordmark fails to load", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchBrand({
        bundledBrandLogoSrc: "/openbot-logo.png",
        uploadLabel: "Change logo",
        resetLabel: "Reset logo",
        logoAlt: "Current navigation logo",
        defaultTitle: "openbot",
        defaultSubtitle: "Top navigation logo slot",
        onBrandLogoFileChange: () => undefined,
      })}`,
      container,
    );
    await Promise.resolve();

    const logo = container.querySelector<HTMLImageElement>(".employee-workbench__brand-logo");
    expect(logo).not.toBeNull();
    logo?.dispatchEvent(new Event("error"));
    await Promise.resolve();

    expect(logo?.hidden).toBe(true);
    expect(container.querySelector(".employee-workbench__brand-mark")).not.toBeNull();
    expect(
      container.querySelector(".employee-workbench__brand-fallback")?.hasAttribute("hidden"),
    ).toBe(false);
  });

  it("hides a custom logo frame and reveals the brand mark on image error", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchBrand({
        brandLogoSrc: "data:image/png;base64,AAAA",
        customBrandLogoEnabled: true,
        uploadLabel: "Change logo",
        resetLabel: "Reset logo",
        logoAlt: "Current navigation logo",
        defaultTitle: "openbot",
        defaultSubtitle: "Top navigation logo slot",
        onBrandLogoFileChange: () => undefined,
      })}`,
      container,
    );
    await Promise.resolve();

    const logo = container.querySelector<HTMLImageElement>(".employee-workbench__brand-logo");
    logo?.dispatchEvent(new Event("error"));
    await Promise.resolve();

    expect(logo?.hidden).toBe(true);
    expect(
      container.querySelector<HTMLElement>(".employee-workbench__brand-logo-frame")?.hidden,
    ).toBe(true);
    expect(container.querySelector(".employee-workbench__brand-mark")).not.toBeNull();
  });
});
