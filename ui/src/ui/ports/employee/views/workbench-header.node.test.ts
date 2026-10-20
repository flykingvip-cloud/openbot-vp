// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import { renderWorkbenchHeader } from "./workbench-header.ts";

const workbenchCss = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../../styles/workbench.css"),
  "utf8",
);

afterEach(() => {
  document.body.innerHTML = "";
});

describe("workbench header", () => {
  beforeEach(async () => {
    await i18n.setLocale("zh-CN");
  });

  it("renders a compact header and keeps locale theme user actions in order", () => {
    const onLocaleChange = vi.fn();
    const onThemeChange = vi.fn();
    const onOpenPersonalSettings = vi.fn();
    const onLogout = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);

    render(
      renderWorkbenchHeader({
        title: "每日概览",
        profileLabel: "OB",
        connected: true,
        currentLocale: "zh-CN",
        currentTheme: "light",
        userProfileName: "OpenBot",
        userProfileSignature: "",
        onLocaleChange,
        onThemeChange,
        onOpenPersonalSettings,
        onLogout,
      }),
      container,
    );

    const tools = Array.from(
      container.querySelectorAll<HTMLElement>(".employee-workbench__header-tools > *"),
    );
    expect(container.querySelector(".employee-workbench__header-eyebrow")).toBeNull();
    expect(container.querySelector(".employee-workbench__header-subtitle")).toBeNull();
    expect(container.querySelector(".employee-workbench__header-status")).toBeNull();
    expect(tools).toHaveLength(3);
    expect(tools[0]?.getAttribute("aria-label")).toBe("语言");
    expect(tools[1]?.getAttribute("aria-label")).toBe("主题");
    expect(
      tools[2]?.querySelector(".employee-workbench__header-userpill")?.getAttribute("aria-label"),
    ).toBe("OpenBot");

    (tools[0] as HTMLButtonElement | undefined)?.click();
    (tools[1] as HTMLButtonElement | undefined)?.click();

    expect(onLocaleChange).toHaveBeenCalledWith("en");
    expect(onThemeChange).toHaveBeenCalledWith("dark");

    const userPill = tools[2]?.querySelector<HTMLButtonElement>(
      ".employee-workbench__header-userpill",
    );
    userPill?.click();
    expect(container.querySelector(".employee-workbench__header-usermenu-item")).not.toBeNull();

    const menuItems = container.querySelectorAll<HTMLButtonElement>(
      ".employee-workbench__header-usermenu-item",
    );
    expect(menuItems).toHaveLength(3);
    expect(menuItems[0]?.textContent?.trim()).toBe("个人设置");
    expect(menuItems[1]?.textContent?.trim()).toBe("帮助中心");
    expect(menuItems[2]?.textContent?.trim()).toBe("退出登录");

    menuItems[0]?.click();
    expect(onOpenPersonalSettings).toHaveBeenCalledTimes(1);

    menuItems[2]?.click();
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("opens the same-origin help center from the avatar menu", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const pushState = vi.spyOn(window.history, "pushState");

    render(
      renderWorkbenchHeader({
        title: "每日概览",
        profileLabel: "OB",
        connected: true,
        currentLocale: "zh-CN",
        currentTheme: "light",
        userProfileName: "OpenBot",
        userProfileSignature: "",
        onLocaleChange: vi.fn(),
        onThemeChange: vi.fn(),
        onOpenPersonalSettings: vi.fn(),
        onLogout: vi.fn(),
      }),
      container,
    );

    container.querySelector<HTMLButtonElement>("[data-testid=workbench-header-help]")?.click();
    expect(pushState).toHaveBeenCalled();
    expect(String(pushState.mock.calls.at(-1)?.[2] ?? "")).toMatch(/\/help$/);
  });

  it("keeps the closed user menu from hit-testing over content below the avatar", () => {
    const dropRule = workbenchCss.match(
      /\.employee-workbench__header-usermenu-drop\s*\{([^}]+)\}/,
    )?.[1];
    const panelRule = workbenchCss.match(
      /\.employee-workbench__header-usermenu-panel\s*\{([^}]+)\}/,
    )?.[1];
    expect(dropRule).toMatch(/visibility:\s*hidden/);
    expect(dropRule).toMatch(/pointer-events:\s*none/);
    expect(panelRule).toMatch(/pointer-events:\s*none/);
    expect(panelRule).not.toMatch(/pointer-events:\s*auto/);
    expect(workbenchCss).toContain(
      ".employee-workbench__header-usermenu:hover .employee-workbench__header-usermenu-panel",
    );
    expect(workbenchCss).toMatch(
      /\.employee-workbench__header-usermenu:hover \.employee-workbench__header-usermenu-panel[\s\S]{0,120}pointer-events:\s*auto/,
    );
  });

  it("omits the left title slot when the module should not show a daily overview heading", () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      renderWorkbenchHeader({
        title: "",
        profileLabel: "OB",
        connected: true,
        currentLocale: "zh-CN",
        currentTheme: "light",
        userProfileName: "OpenBot",
        userProfileSignature: "",
        onLocaleChange: vi.fn(),
        onThemeChange: vi.fn(),
        onOpenPersonalSettings: vi.fn(),
        onLogout: vi.fn(),
      }),
      container,
    );

    expect(container.querySelector(".employee-workbench__header-title")).toBeNull();
    expect(container.querySelectorAll(".employee-workbench__header-tools > *")).toHaveLength(3);
  });
});
