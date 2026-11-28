// @vitest-environment jsdom
// Comprehensive sidebar nav routing test for the platform shell.
// Goal: confirm that clicking each top-level nav item from /platform navigates
// to the correct surface AND renders that surface's content.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { preloadPlatformPortBundle } from "./ports/cross-port-shell-lazy.ts";
import "../styles.css";
import { resetKeyAccountPageState } from "./ports/platform/key-accounts/page.ts";
import { mountApp as mountTestApp, registerAppMountHooks } from "./test-helpers/app-mount.ts";

registerAppMountHooks();

beforeAll(async () => {
  await preloadPlatformPortBundle();
});

function mountApp(pathname: string) {
  return mountTestApp(pathname);
}

const NAV_TARGETS: Array<{ label: string; href: string; tab: string; expect: string }> = [
  {
    label: "发布概览",
    href: "/platform/productization",
    tab: "platformProductization",
    expect: "发布概览",
  },
  {
    label: "制品",
    href: "/platform/productization/artifacts",
    tab: "platformProductization",
    expect: "制品总览",
  },
  {
    label: "L1 只读",
    href: "/platform/productization/l1",
    tab: "platformProductization",
    expect: "L1 只读占位",
  },
  {
    label: "表面矩阵",
    href: "/platform/productization/surfaces",
    tab: "platformProductization",
    expect: "表面矩阵",
  },
  {
    label: "发布窗口",
    href: "/platform/productization/windows",
    tab: "platformProductization",
    expect: "发布窗口",
  },
  {
    label: "审计",
    href: "/platform/productization/audit",
    tab: "platformProductization",
    expect: "审计",
  },
  {
    label: "交付状态",
    href: "/platform/key-accounts",
    tab: "platformKeyAccounts",
    expect: "客户交付状态",
  },
  {
    label: "伙伴台账",
    href: "/platform/key-accounts/partners",
    tab: "platformKeyAccounts",
    expect: "伙伴台账",
  },
  {
    label: "伙伴详情",
    href: "/platform/key-accounts/partners/KA-0011",
    tab: "platformKeyAccounts",
    expect: "伙伴详情",
  },
  {
    label: "白牌配置",
    href: "/platform/key-accounts/white-label",
    tab: "platformKeyAccounts",
    expect: "白牌配置",
  },
  {
    label: "预装包关联",
    href: "/platform/key-accounts/preinstall",
    tab: "platformKeyAccounts",
    expect: "预装包关联",
  },
  {
    label: "结算对账入口",
    href: "/platform/key-accounts/settlement",
    tab: "platformKeyAccounts",
    expect: "结算对账入口",
  },
  {
    label: "域内审计",
    href: "/platform/key-accounts/audit",
    tab: "platformKeyAccounts",
    expect: "域内审计",
  },
  {
    label: "合作条款摘要",
    href: "/platform/key-accounts/terms",
    tab: "platformKeyAccounts",
    expect: "合作条款摘要",
  },
  // 平台总览 is the entry — already on /platform when we mount.
  { label: "租户管理", href: "/platform/tenants", tab: "platformTenants", expect: "租户管理" },
  {
    label: "能力中心",
    href: "/platform/capabilities",
    tab: "platformCapabilities",
    expect: "能力中心",
  },
  { label: "模型管理", href: "/platform/models", tab: "platformModels", expect: "模型管理" },
  {
    label: "资产管理",
    href: "/platform/agents",
    tab: "platformAgents",
    expect: "资产管理",
  },
  { label: "高级治理", href: "/platform/advanced", tab: "platformAdvanced", expect: "高级治理" },
  {
    label: "系统设置",
    href: "/platform/system-settings",
    tab: "platformSystemSettings",
    expect: "系统设置",
  },
];

describe("platform sidebar nav e2e", () => {
  for (const target of NAV_TARGETS) {
    it(`clicks ${target.label} → ${target.href} renders correct surface`, async () => {
      const app = mountApp("/platform");
      await app.updateComplete;
      expect(app.tab).toBe("platformDashboard");

      const link = app.querySelector<HTMLAnchorElement>(`a.nav-item[href="${target.href}"]`);
      expect(link, `nav link for ${target.href} must exist`).not.toBeNull();
      link!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
      await app.updateComplete;

      expect(app.tab, `tab should switch to ${target.tab}`).toBe(target.tab);
      expect(window.location.pathname).toBe(target.href);
      const surface = app.querySelector(".platform-surface");
      expect(surface, `platform surface should be rendered`).not.toBeNull();
      const surfaceTitle = app
        .querySelector(".platform-surface-header__title")
        ?.textContent?.trim();
      expect(surfaceTitle, `surface header title for ${target.tab}`).toContain(
        target.expect.split("\n")[0],
      );
      if (
        target.href !== "/platform/productization/artifacts" &&
        target.tab === "platformProductization"
      ) {
        expect(surface?.textContent).toContain("SaaS 是唯一主运营路径");
        expect(surface?.textContent).not.toContain("OEM 主路径");
        expect(surface?.textContent).not.toContain("私有整包出货");
      }
    });
  }
});

describe("platform key-account P2 interactions", () => {
  beforeEach(() => {
    resetKeyAccountPageState();
  });

  async function open(pathname: string) {
    const app = mountApp(pathname);
    await app.updateComplete;
    return app;
  }

  function setValue(input: HTMLInputElement | HTMLSelectElement, value: string) {
    input.value = value;
    input.dispatchEvent(
      new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
  }

  it("changes partner status after confirm and shows the reason in audit", async () => {
    const app = await open("/platform/key-accounts/partners/KA-0018");
    expect(
      app.querySelector("[data-ka-partner-status]")?.getAttribute("data-ka-partner-status"),
    ).toBe("intent");
    const select = app.querySelector<HTMLSelectElement>("[data-ka-status-select]");
    const reason = app.querySelector<HTMLInputElement>("[data-ka-status-reason]");
    expect(select).not.toBeNull();
    expect(reason).not.toBeNull();
    setValue(select!, "active");
    setValue(reason!, "演示确认合作");
    await app.updateComplete;
    app.querySelector<HTMLButtonElement>("[data-ka-status-submit]")!.form!.requestSubmit();
    await app.updateComplete;
    expect(app.querySelector("[data-ka-status-confirm='ready']")?.textContent).toContain("合作中");
    expect(app.querySelector("[data-ka-partner-status]")?.textContent).toContain("意向");
    await app.updateComplete;
    app.querySelector<HTMLButtonElement>("[data-ka-status-submit]")!.form!.requestSubmit();
    await app.updateComplete;
    expect(
      app.querySelector("[data-ka-partner-status]")?.getAttribute("data-ka-partner-status"),
    ).toBe("active");
    expect(app.textContent).toContain("演示确认合作");

    const auditLink = [...app.querySelectorAll("a")].find(
      (link) => link.textContent?.trim() === "查看审计",
    );
    expect(auditLink).toBeTruthy();
    auditLink!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    await app.updateComplete;
    expect(window.location.pathname).toBe("/platform/key-accounts/audit");
    expect(app.textContent).toContain("伙伴状态变更");
    expect(app.textContent).toContain("演示确认合作");
    expect(app.textContent).not.toContain("生成账单");
  });

  it("saves, publishes, and rolls back a white-label draft", async () => {
    const app = await open("/platform/key-accounts/white-label?partner=KA-0011");
    expect(app.querySelector("[data-ka-published]")?.getAttribute("data-ka-published")).toBe(
      "WL-v3",
    );
    expect(app.querySelector("[data-ka-preview='readonly']")).not.toBeNull();
    const name = app.querySelector<HTMLInputElement>("[data-ka-label-name]");
    expect(name).not.toBeNull();
    setValue(name!, "北境渠道封面");
    app.querySelector<HTMLButtonElement>("[data-ka-label-save]")!.click();
    await app.updateComplete;
    expect(app.textContent).toContain("白牌草稿已保存在演示数据中");
    expect(app.querySelector("[data-ka-published]")?.getAttribute("data-ka-published")).toBe(
      "WL-v3",
    );
    app.querySelector<HTMLButtonElement>("[data-ka-label-publish]")!.click();
    await app.updateComplete;
    expect(app.querySelector("[data-ka-published]")?.getAttribute("data-ka-published")).toBe(
      "WL-v4",
    );
    expect(app.textContent).toContain("app-pre-202610-a");
    app.querySelector<HTMLButtonElement>("[data-ka-label-rollback]")!.click();
    await app.updateComplete;
    expect(app.querySelector("[data-ka-published]")?.getAttribute("data-ka-published")).toBe(
      "WL-v3",
    );
    expect(
      app.querySelector("[data-ka-preview='readonly'] input, [data-ka-preview='readonly'] button"),
    ).toBeNull();
  });

  it("associates a signed productization package and rejects an unsigned id", async () => {
    const app = await open("/platform/key-accounts/preinstall?partner=KA-0018");
    const select = app.querySelector<HTMLSelectElement>("[data-ka-package-select]");
    expect(select).not.toBeNull();
    const optionIds = [...select!.options].map((option) => option.value);
    expect(optionIds).toContain("app-pre-202610-a");
    expect(optionIds).toContain("app-pre-202610-b");
    expect(optionIds).not.toContain("app-pre-unsigned-draft");
    setValue(select!, "app-pre-202610-a");
    app.querySelector<HTMLButtonElement>("[data-ka-package-submit]")!.click();
    await app.updateComplete;
    expect(app.querySelector("[data-ka-package-row='app-pre-202610-a']")?.textContent).toContain(
      "已验签",
    );
    const paste = app.querySelector<HTMLInputElement>("[data-ka-package-paste]");
    setValue(paste!, "app-pre-unsigned-draft");
    app.querySelector<HTMLButtonElement>("[data-ka-package-submit]")!.click();
    await app.updateComplete;
    expect(app.textContent).toContain("不是已签名 App 预装包");
    expect(app.querySelector("[data-ka-package-row='app-pre-unsigned-draft']")).toBeNull();
    expect(app.querySelectorAll("[data-ka-package-row]")).toHaveLength(1);
  });

  it("opens the settlement placeholder from the entry deep link", async () => {
    const app = await open("/platform");
    const nav = app.querySelector<HTMLAnchorElement>(
      'a.nav-item[href="/platform/key-accounts/settlement"]',
    );
    expect(nav).not.toBeNull();
    nav!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    await app.updateComplete;
    expect(window.location.pathname).toBe("/platform/key-accounts/settlement");
    const openReconcile = app.querySelector<HTMLAnchorElement>("[data-ka-open-reconcile]");
    expect(openReconcile?.getAttribute("href")).toBe(
      "/platform/key-accounts/settlement/reconcile?partner=KA-0011",
    );
    expect(openReconcile?.getAttribute("href")).not.toContain("#");
    openReconcile!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    await app.updateComplete;
    expect(window.location.pathname).toBe("/platform/key-accounts/settlement/reconcile");
    expect(window.location.search).toBe("?partner=KA-0011");
    expect(app.querySelector("[data-settlement-view='placeholder']")).not.toBeNull();
    expect(app.querySelector(".platform-surface-header__title")?.textContent).toContain(
      "结算对账视图",
    );
    const text = app.querySelector(".platform-surface")?.textContent ?? "";
    expect(text).toContain("结算对账占位");
    expect(text).toContain("settle-ka-0011");
    expect(text).not.toContain("生成账单");
    expect(text).not.toContain("确认收款");
    expect(text).not.toContain("调整分成");
  });

  it("opens the read-only shipment batches from partner detail", async () => {
    const app = await open("/platform");
    const detail = app.querySelector<HTMLAnchorElement>(
      'a.nav-item[href="/platform/key-accounts/partners/KA-0011"]',
    );
    expect(detail).not.toBeNull();
    detail!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    await app.updateComplete;
    const shipments = app.querySelector<HTMLAnchorElement>(
      'a[href="/platform/key-accounts/shipments?partner=KA-0011"]',
    );
    expect(shipments).not.toBeNull();
    shipments!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    await app.updateComplete;
    expect(window.location.pathname).toBe("/platform/key-accounts/shipments");
    expect(app.querySelector("[data-ka-readonly='shipments']")?.textContent).toContain(
      "SHIP-202610-011",
    );
    expect(app.textContent).not.toContain("生成账单");
  });
});
