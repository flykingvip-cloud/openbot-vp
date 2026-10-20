import { afterEach, describe, expect, it } from "vitest";
import { I18nManager } from "../i18n/lib/translate.ts";
import "./workbench.css";

function renderWorkbenchTitle(className: string) {
  const workbench = document.createElement("section");
  workbench.className = "employee-workbench";

  const title = document.createElement("h2");
  title.className = className;
  title.textContent = "创建机器人";
  workbench.append(title);
  document.body.append(workbench);

  return { workbench, title };
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.lang = "en";
  document.body.replaceChildren();
});

describe("workbench CJK typography", () => {
  it("synchronizes the document language before applying zh-CN typography", async () => {
    localStorage.clear();
    const manager = new I18nManager();

    await manager.setLocale("zh-CN");

    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("normalizes inherited and title tracking for zh-CN", () => {
    document.documentElement.lang = "zh-CN";
    const { workbench, title } = renderWorkbenchTitle("employee-workbench__header-title");

    expect(getComputedStyle(workbench).fontFamily).toContain("PingFang SC");
    expect(getComputedStyle(workbench).letterSpacing).toBe("normal");
    expect(getComputedStyle(title).letterSpacing).toBe("normal");
  });

  it("preserves intentional positive label tracking for zh-CN", () => {
    document.documentElement.lang = "zh-CN";
    const { title } = renderWorkbenchTitle("employee-workbench__header-eyebrow");

    expect(getComputedStyle(title).letterSpacing).toBe("0.88px");
  });

  it("retains compact title tracking for English", () => {
    document.documentElement.lang = "en";
    const { title } = renderWorkbenchTitle("employee-workbench__header-title");

    expect(getComputedStyle(title).letterSpacing).toBe("-0.84px");
  });
});
