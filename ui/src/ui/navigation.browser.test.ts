// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n/index.ts";
import "../styles.css";
import {
  preloadEmployeeWorkbenchBundle,
  preloadPlatformPortBundle,
} from "./ports/cross-port-shell-lazy.ts";
import { mountApp as mountTestApp, registerAppMountHooks } from "./test-helpers/app-mount.ts";

registerAppMountHooks();

// The employee workbench and the platform shell are lazy chunks. Until a chunk has loaded,
// the app renders a loading placeholder in its place and re-renders once it arrives. These
// tests check routing and the rendered shells, so load both chunks once before any test runs.
// Otherwise a test passes or fails depending on whether an earlier test already triggered the
// load, and checks that the employee workbench is absent pass even when routing is wrong.
beforeAll(async () => {
  await Promise.all([preloadEmployeeWorkbenchBundle(), preloadPlatformPortBundle()]);
});

beforeEach(async () => {
  await i18n.setLocale("en");
});

function mountApp(pathname: string) {
  return mountTestApp(pathname);
}

function nextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

// The Mesh surface renders its module header from `tabs.enterpriseMesh`. Check that header
// rather than a word anywhere in the shell: the left nav always carries the same label, so a
// page-wide match passes even when the Mesh surface is missing. Following the locale keeps
// the check independent of which product name the copy uses.
function expectMeshSurfaceTitle(root: ParentNode) {
  const expected = i18n.t("tabs.enterpriseMesh");
  expect(expected).not.toBe("tabs.enterpriseMesh");
  const title = root.querySelector(
    ".enterprise-surface--mesh > .enterprise-module-header .enterprise-page__title",
  );
  expect(title?.textContent?.trim()).toBe(expected);
}

function expectSharedTopbarChrome(root: ParentNode) {
  expect(root.querySelector(".brand-logo--wide")).not.toBeNull();
  expect(root.querySelector(".brand-text")).toBeNull();
  expect(root.querySelector(".theme-toggle")).toBeNull();
  expect(root.querySelectorAll(".topbar-round-btn").length).toBeGreaterThanOrEqual(2);
}

describe("control UI routing", () => {
  it("opens the frontstage me view at the root path", async () => {
    const app = mountApp("/");
    await app.updateComplete;

    expect(app.tab).toBe("me");
    expect(window.location.pathname).toBe("/");
  });

  it("opens the dedicated enterprise trial apply page on its own route", async () => {
    const app = mountApp("/trial/apply");
    await app.updateComplete;

    expect(app.tab).toBe("trialApply");
    expect(window.location.pathname).toBe("/trial/apply");
    expect(app.querySelector(".trial-apply-page")).not.toBeNull();
  });

  it("renders an explicit enterprise login disabled state instead of a blank page", async () => {
    const app = mountApp("/enterprise/login");
    await app.updateComplete;

    expect(app.tab).toBe("enterpriseLogin");
    expect(app.textContent ?? "").toContain("企业登录尚未启用");
    expect(app.textContent ?? "").toContain("申请企业试用");
  });

  it("leaves the enterprise login form when an enterprise admin session is already confirmed", async () => {
    const app = mountApp("/enterprise/login");
    await app.updateComplete;

    expect(app.tab).toBe("enterpriseLogin");
    expect(app.querySelector("form.auth-home__form")).toBeNull();

    app.platformAuthNotice = "已登录企业工作台。";
    app.platformAuthState = {
      enabled: true,
      hasUsers: true,
      sessionKind: "enterprise-admin",
      sessionDomain: "enterprise",
      membershipRole: "enterprise-admin",
      session: {
        provider: "trusted-proxy",
        user: "owner@example.com",
        tenantId: "acme",
        role: "operator",
      },
    };
    await app.updateComplete;

    expect(app.tab).toBe("enterpriseOverview");
    expect(window.location.pathname).toBe("/enterprise/acme/overview");
    expect(app.querySelector("form.auth-home__form")).toBeNull();
    expect(app.querySelector(".auth-home")).toBeNull();
    expect(app.textContent ?? "").not.toContain("企业管理员登录");

    window.history.pushState({}, "", "/enterprise/login");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await app.updateComplete;

    expect(app.tab).toBe("enterpriseOverview");
    expect(window.location.pathname).toBe("/enterprise/acme/overview");
    expect(app.querySelector("form.auth-home__form")).toBeNull();
    expect(app.querySelector(".auth-home")).toBeNull();
  });

  it("clears a stale enterprise login success notice when the session is not enterprise-admin", async () => {
    const app = mountApp("/enterprise/login");
    await app.updateComplete;

    app.platformAuthNotice = "已登录企业工作台。";
    app.platformAuthState = {
      enabled: true,
      hasUsers: true,
      sessionKind: "member",
      membershipRole: "member",
      sessionDomain: "employee",
      session: {
        provider: "trusted-proxy",
        user: "member@example.com",
        tenantId: "acme",
        role: "operator",
      },
    };
    window.history.pushState({}, "", "/enterprise/login");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await app.updateComplete;

    expect(app.tab).toBe("enterpriseLogin");
    expect(window.location.pathname).toBe("/enterprise/login");
    expect(app.platformAuthNotice).toBeNull();
    expect(app.textContent ?? "").not.toContain("已登录企业工作台。");
    expect(app.querySelector("form.auth-home__form")).not.toBeNull();
    expect(app.querySelector('[data-testid="confirmed-login-continue"]')).toBeNull();
  });

  it("offers a workbench continue link when an enterprise admin cannot auto-enter the console", async () => {
    const app = mountApp("/enterprise/login");
    await app.updateComplete;

    app.platformAuthNotice = "已登录企业工作台。";
    app.platformAuthState = {
      enabled: true,
      hasUsers: true,
      sessionKind: "enterprise-admin",
      sessionDomain: "enterprise",
      session: {
        provider: "trusted-proxy",
        user: "owner@example.com",
        tenantId: "acme",
      },
    };
    await app.updateComplete;

    expect(app.tab).toBe("enterpriseLogin");
    expect(app.querySelector("form.auth-home__form")).toBeNull();
    const continueLink = app.querySelector<HTMLAnchorElement>(
      '[data-testid="confirmed-login-continue"]',
    );
    expect(continueLink?.textContent?.trim()).toBe("进入企业工作台");
    expect(continueLink?.getAttribute("href")).toBe("/enterprise");
    expect(app.textContent ?? "").toContain("已登录企业工作台。");
  });

  it("renders an explicit platform login disabled state instead of a blank page", async () => {
    const app = mountApp("/platform/login");
    await app.updateComplete;

    expect(app.tab).toBe("platformLogin");
    expect(app.textContent ?? "").toContain("平台登录尚未启用");
    expect(app.textContent ?? "").toContain("申请企业试用");
  });

  it("renders the workbench home shell without the legacy sidebar nav", async () => {
    const app = mountApp("/");
    await app.updateComplete;

    expect(app.querySelector(".shell--workspace")).not.toBeNull();
    expect(app.querySelector(".employee-workbench")).not.toBeNull();
    expect(app.querySelector(".nav")).toBeNull();
  });

  it("renders the workbench home with the employee workbench sidebar", async () => {
    localStorage.setItem(
      "openbot.control.settings.v1",
      JSON.stringify({
        gatewayUrl: "ws://127.0.0.1:18789",
        navCollapsed: false,
        navCompactLayoutApplied: true,
      }),
    );

    const app = mountApp("/");
    await app.updateComplete;

    const sidebar = app.querySelector(".employee-workbench__sidebar");
    expect(sidebar).not.toBeNull();
    expect(sidebar?.textContent).toContain("AI assistant");
    expect(app.querySelectorAll(".employee-workbench__group-header").length).toBeGreaterThan(0);
    expect(app.querySelectorAll(".employee-workbench__group-add")).toHaveLength(2);
    expect(app.querySelector(".employee-workbench__modules")).not.toBeNull();
  });

  it("uses console-oriented wording for frontstage bridge actions", async () => {
    const app = mountApp("/contacts");
    await app.updateComplete;

    expect(app.textContent).toContain("Open in console");
    expect(app.textContent).not.toContain("Manage personas");
  });

  it("shows the workbench collapse toggle and persists the collapsed rail state", async () => {
    const app = mountApp("/");
    await app.updateComplete;

    const shell = app.querySelector<HTMLElement>(".employee-workbench");
    const toggle = app.querySelector<HTMLButtonElement>(".employee-workbench__brand-action");

    expect(shell?.classList.contains("collapsed")).toBe(true);
    expect(toggle).not.toBeNull();

    toggle?.click();
    await app.updateComplete;
    await nextFrame();

    expect(app.querySelector(".employee-workbench")?.classList.contains("collapsed")).toBe(false);
    expect(app.querySelector(".employee-workbench__brand-action")).not.toBeNull();
  });

  it("renders the workbench sidebar with its own scroll area", async () => {
    const app = mountApp("/");
    await app.updateComplete;

    const scrollArea = app.querySelector(".employee-workbench__sidebar-scroll");
    expect(scrollArea).not.toBeNull();
    if (scrollArea) {
      expect(scrollArea.closest(".employee-workbench__sidebar")).not.toBeNull();
    }
  });

  it("keeps the workbench stage visible on the home view", async () => {
    const app = mountApp("/");
    await app.updateComplete;

    const stage = app.querySelector(".employee-workbench__stage-shell");
    expect(stage).not.toBeNull();
    if (stage) {
      expect(getComputedStyle(stage).display).not.toBe("none");
    }
  });

  it("reuses the custom brand logo in the shared topbar shell", async () => {
    localStorage.setItem(
      "openbot.control.settings.v1",
      JSON.stringify({
        customBrandLogoDataUrl: "data:image/png;base64,AAAA",
      }),
    );

    const app = mountApp("/contacts");
    await app.updateComplete;

    const logo = app.querySelector<HTMLImageElement>(".brand-logo--wide img");
    expect(logo).not.toBeNull();
    expect(logo?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expectSharedTopbarChrome(app);
  });

  it("syncs custom brand assets into head icon links", async () => {
    localStorage.setItem(
      "openbot.control.settings.v1",
      JSON.stringify({
        customBrandLogoDataUrl: "data:image/png;base64,AAAA",
      }),
    );

    const app = mountApp("/");
    await app.updateComplete;

    const iconLink = document.head.querySelector<HTMLLinkElement>(
      'link[rel="icon"][data-openbot-brand="icon"]',
    );
    const touchLink = document.head.querySelector<HTMLLinkElement>(
      'link[rel="apple-touch-icon"][data-openbot-brand="touch"]',
    );
    expect(iconLink?.href).toContain("data:image/png;base64,AAAA");
    expect(touchLink?.href).toContain("data:image/png;base64,AAAA");
  });

  it("hydrates the tab from the location", async () => {
    const app = mountApp("/ops/runtime");
    await app.updateComplete;

    expect(app.tab).toBe("platformAdvanced");
    expect(window.location.pathname).toBe("/platform/advanced");
  });

  it("normalizes the mistyped ops root instead of falling back to the employee home", async () => {
    const app = mountApp("/ope");
    await app.updateComplete;

    expect(app.tab).toBe("platformDashboard");
    expect(window.location.pathname).toBe("/platform");
    expect(app.querySelector(".employee-workbench")).toBeNull();
  });

  it("preserves the platform route instead of falling back to the employee home", async () => {
    const app = mountApp("/platform");
    await app.updateComplete;

    expect(app.tab).toBe("platformDashboard");
    expect(window.location.pathname).toBe("/platform");
    expect(app.querySelector(".employee-workbench")).toBeNull();
    expect(app.querySelector(".page-title")).toBeNull();
    expect(app.querySelector(".platform-surface-header__title")?.textContent?.trim()).toBe(
      "平台总览",
    );
    expectSharedTopbarChrome(app);
    expect(app.querySelector(".nav-platform-tree")).not.toBeNull();
    expect(app.querySelector(".nav")?.textContent).toContain("平台总览");
    expect(app.querySelector(".nav")?.textContent).toContain("租户管理");
    expect(app.querySelector(".nav")?.textContent).toContain("能力中心");
    expect(app.querySelector(".nav")?.textContent).toContain("模型管理");
    expect(app.querySelector(".nav")?.textContent).toContain("资产管理");
    expect(app.querySelector(".nav")?.textContent).toContain("高级治理");
    expect(app.querySelector(".nav")?.textContent).toContain("系统设置");
    expect(app.querySelector(".nav-shell-card")).toBeNull();
    expect(app.querySelector(".nav-group--primary .nav-label")).toBeNull();
    expect(app.querySelector(".nav-item.active .nav-item__text")?.textContent).toContain(
      "平台总览",
    );
    expect(app.querySelector(".nav-item.active .nav-item__meta")).toBeNull();
    expect(app.querySelector(".nav-item.active .nav-item__sub")).toBeNull();
  });

  it("preserves the enterprise route instead of falling back to the employee home", async () => {
    const app = mountApp("/enterprise");
    await app.updateComplete;

    expect(app.tab).toBe("enterpriseOverview");
    expect(window.location.pathname).toBe("/enterprise");
    expect(app.querySelector(".employee-workbench")).toBeNull();
    expect(app.textContent).not.toContain("Choose a tenant");
    expect(app.textContent).toContain("当前还没有可用租户");
    expectSharedTopbarChrome(app);
    expect(app.querySelector(".nav")?.textContent).toContain("Overview");
    expect(app.querySelector(".nav")?.textContent).toContain("Organization");
    expect(app.querySelector(".nav")?.textContent).not.toContain(
      "Capability Application Management",
    );
    expect(app.querySelector(".nav")?.textContent).toContain("Mesh");
    expect(app.querySelector(".nav")?.textContent).toContain("Cost & Budget");
    expect(app.querySelector(".nav")?.textContent).toContain("Settings");
    expect(app.querySelector(".nav-shell-card")).toBeNull();
    expect(app.querySelector('a.nav-item[href="/enterprise/organization"]')).not.toBeNull();
    expect(app.querySelector(".nav-item--gated .nav-item__meta")?.textContent).toContain(
      "Tenant required",
    );
    expect(app.querySelector(".nav-group--primary .nav-label")).toBeNull();
  });

  it("navigates to enterprise module resolver routes before tenant selection", async () => {
    const app = mountApp("/enterprise");
    await app.updateComplete;

    const link = app.querySelector<HTMLAnchorElement>(
      'a.nav-item[href="/enterprise/organization"]',
    );
    expect(link).not.toBeNull();
    link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));

    await app.updateComplete;
    expect(app.tab).toBe("enterpriseOrganization");
    expect(window.location.pathname).toBe("/enterprise/organization");
    expect(app.textContent).not.toContain("Choose a tenant");
    expect(app.textContent).toContain("当前还没有可用租户");
    expect(app.textContent).toContain("用户");
    expect(app.textContent).toContain("团队与群组");
    expect(app.textContent).toContain("角色与权限");
  });

  it("respects /ui base paths", async () => {
    const app = mountApp("/ui/ops/recovery");
    await app.updateComplete;

    expect(app.basePath).toBe("/ui");
    expect(app.tab).toBe("platformSystemSettings");
    expect(window.location.pathname).toBe("/ui/platform/system-settings");
  });

  it("infers nested base paths", async () => {
    const app = mountApp("/apps/openclaw/ops/recovery");
    await app.updateComplete;

    expect(app.basePath).toBe("/apps/openclaw");
    expect(app.tab).toBe("platformSystemSettings");
    expect(window.location.pathname).toBe("/apps/openclaw/platform/system-settings");
  });

  it("keeps nested platform routes on their own surface", async () => {
    const app = mountApp("/ui/platform");
    await app.updateComplete;

    expect(app.basePath).toBe("/ui");
    expect(app.tab).toBe("platformDashboard");
    expect(window.location.pathname).toBe("/ui/platform");
  });

  it("opens the dedicated platform system settings route", async () => {
    const app = mountApp("/platform/system-settings");
    await app.updateComplete;

    expect(app.tab).toBe("platformSystemSettings");
    expect(window.location.pathname).toBe("/platform/system-settings");
    expect(app.textContent).toContain("系统设置");
  });

  it("honors explicit base path overrides", async () => {
    window.__OPENBOT_CONTROL_UI_BASE_PATH__ = "/openclaw";
    const app = mountApp("/openclaw/ops/runtime");
    await app.updateComplete;

    expect(app.basePath).toBe("/openclaw");
    expect(app.tab).toBe("platformAdvanced");
    expect(window.location.pathname).toBe("/openclaw/platform/advanced");
  });

  it("updates the URL when opening control from the primary nav", async () => {
    const app = mountApp("/contacts");
    await app.updateComplete;

    const link = app.querySelector<HTMLAnchorElement>('a.nav-item[href="/enterprise"]');
    expect(link).not.toBeNull();
    link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));

    await app.updateComplete;
    expect(app.tab).toBe("enterpriseOverview");
    expect(window.location.pathname).toBe("/enterprise");
  });

  it("uses platform branding when opening legacy ops routes", async () => {
    const app = mountApp("/ops");
    await app.updateComplete;

    expect(window.location.pathname).toBe("/platform");
    expectSharedTopbarChrome(app);
    expect(app.querySelector(".nav-shell-card")).toBeNull();
    expect(app.querySelector(".nav")?.textContent).not.toContain("Frontstage");
    expect(app.textContent).not.toContain("AI Operations Workspace");
  });

  it("updates the URL when clicking platform nav items after entering from legacy ops routes", async () => {
    const app = mountApp("/ops");
    await app.updateComplete;

    const links = Array.from(
      app.querySelectorAll<HTMLAnchorElement>('a.nav-item[href^="/platform/"]'),
    );
    expect(links.length).toBeGreaterThan(1);
    const link = links.find((entry) => entry.getAttribute("href") === "/platform/advanced") ?? null;
    expect(link).not.toBeNull();
    link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));

    await app.updateComplete;
    expect(app.tab).toBe("platformAdvanced");
    expect(window.location.pathname).toBe("/platform/advanced");
  });

  it("retires the legacy builder root alias once builder has its own namespace", async () => {
    const app = mountApp("/agents");
    await app.updateComplete;

    expect(app.tab).toBe("me");
    expect(window.location.pathname).toBe("/");
  });

  it("redirects legacy /builder routes into platform surfaces", async () => {
    const app = mountApp("/builder");
    await app.updateComplete;

    expect(app.tab).toBe("platformCapabilities");
    expect(window.location.pathname).toBe("/platform/capabilities");
    expectSharedTopbarChrome(app);
  });

  it("does not route retired cross-port control aliases into builder surfaces", async () => {
    const app = mountApp("/control/agents");
    await app.updateComplete;

    expect(app.tab).toBe("me");
    expect(window.location.pathname).toBe("/");
  });

  it("redirects retired builder sub-routes into platform surfaces", async () => {
    const app = mountApp("/builder/skills");
    await app.updateComplete;

    expect(app.tab).toBe("platformCapabilities");
    expect(window.location.pathname).toBe("/platform/capabilities");
    expectSharedTopbarChrome(app);
  });

  it("renders enterprise modules in the left nav", async () => {
    const app = mountApp("/enterprise/acme/overview");
    await app.updateComplete;

    const link = app.querySelector<HTMLAnchorElement>(
      'a.nav-item[href="/enterprise/acme/organization/users"]',
    );
    const capabilityCenterLink = app.querySelector<HTMLAnchorElement>(
      'a.nav-item[href="/enterprise/acme/capabilities"]',
    );
    expect(link).not.toBeNull();
    expect(capabilityCenterLink).not.toBeNull();
    expect(app.textContent).toContain("Organization");
    expect(app.textContent).toContain("Capability Center");
    expect(app.querySelector(".console-subnav")).toBeNull();
    expect(app.querySelector(".page-title")).toBeNull();
    expect(app.querySelector(".page-sub")).toBeNull();
  });

  it("renders platform modules in the left nav", async () => {
    const app = mountApp("/platform");
    await app.updateComplete;

    const link = app.querySelector<HTMLAnchorElement>('a.nav-item[href="/platform/tenants"]');
    expect(link).not.toBeNull();
    expect(app.textContent).toContain("租户管理");
    expect(app.textContent).toContain("能力中心");
    expect(app.querySelector(".console-subnav")).toBeNull();
  });

  it("navigates within the platform shell using left nav routes", async () => {
    const app = mountApp("/platform");
    await app.updateComplete;

    const link = app.querySelector<HTMLAnchorElement>('a.nav-item[href="/platform/models"]');
    expect(link).not.toBeNull();
    link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));

    await app.updateComplete;
    expect(app.tab).toBe("platformModels");
    expect(window.location.pathname).toBe("/platform/models");
    expect(app.textContent).toContain("模型管理");
  });

  it("navigates within the enterprise shell using tenant-bound left nav routes", async () => {
    const app = mountApp("/enterprise/acme/overview");
    await app.updateComplete;

    const link = app.querySelector<HTMLAnchorElement>(
      'a.nav-item[href="/enterprise/acme/mesh/overview"]',
    );
    expect(link).not.toBeNull();
    link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));

    await app.updateComplete;
    expect(app.tab).toBe("enterpriseMesh");
    expect(window.location.pathname).toBe("/enterprise/acme/mesh/overview");
    expectMeshSurfaceTitle(app);
    expect(app.querySelector(".page-title")).toBeNull();
    expect(app.querySelector(".page-sub")).toBeNull();
  });

  it("preserves enterprise organization routes without rendering a shell page header", async () => {
    const app = mountApp("/enterprise/acme/organization/users");
    await app.updateComplete;

    expect(app.tab).toBe("enterpriseOrganization");
    expect(window.location.pathname).toBe("/enterprise/acme/organization/users");
    expect(app.querySelector(".page-title")).toBeNull();
    expect(app.querySelector(".page-sub")).toBeNull();
    expect(app.textContent ?? "").toMatch(/组织与岗位|Organization/);
  });

  it("navigates within the enterprise shell to the capability center", async () => {
    const app = mountApp("/enterprise/acme/overview");
    await app.updateComplete;

    const link = app.querySelector<HTMLAnchorElement>(
      'a.nav-item[href="/enterprise/acme/capabilities"]',
    );
    expect(link).not.toBeNull();
    link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));

    await app.updateComplete;
    expect(app.tab).toBe("enterpriseCapabilityCenter");
    expect(window.location.pathname).toBe("/enterprise/acme/capabilities");
    expect(app.textContent ?? "").toMatch(/企业能力中心|Capability Center/);
  });

  it("preserves enterprise mesh deep-links when opening object routes directly", async () => {
    const app = mountApp("/enterprise/acme/mesh/overview/groups/support");
    await app.updateComplete;

    expect(app.tab).toBe("enterpriseMesh");
    expect(window.location.pathname).toBe("/enterprise/acme/mesh/overview/groups/support");
    expectMeshSurfaceTitle(app);
    // The deep-linked group opens as a read-only drawer in the assets page. That page renders
    // into its own shadow root, so the drawer never appears in `app.textContent`.
    const assetsPage = app.querySelector(".enterprise-surface--mesh governance-assets-page");
    expect(assetsPage).not.toBeNull();
    await vi.waitFor(() => {
      const drawer = assetsPage?.shadowRoot?.querySelector(
        '.drawer.open[role="dialog"][aria-label="机巢只读详情"]',
      );
      expect(drawer ?? null, "read-only drawer for the deep-linked group").not.toBeNull();
      expect(drawer?.querySelector(".drawer-title")?.textContent ?? "").toContain("support");
    });
  });

  it("opens enterprise settings child routes without rendering a shell page header", async () => {
    const app = mountApp("/enterprise/acme/settings/integrations");
    await app.updateComplete;

    expect(app.tab).toBe("enterpriseSettings");
    expect(window.location.pathname).toBe("/enterprise/acme/settings/integrations");
    expect(app.querySelector(".page-title")).toBeNull();
    expect(app.querySelector(".page-sub")).toBeNull();
    expect(app.textContent ?? "").toMatch(/模型与 API Key|企业通道/);
  });

  it("redirects ops runtime deep-links into the platform advanced surface", async () => {
    const app = mountApp("/ops/runtime/runtime-42");
    await app.updateComplete;

    expect(app.tab).toBe("platformAdvanced");
    expect(window.location.pathname).toBe("/platform/advanced/runtime/runtime-42");
    expect(app.textContent).toContain("高级治理");
  });

  it("redirects legacy usage-management sub-routes into the capability center", async () => {
    // 模块已整合：旧 `/usage-management/{sub}` 深链落到能力中心对应 Tab。
    const cases = [
      { sub: "robots", tab: "robots" },
      { sub: "analytics", tab: "analytics" },
      { sub: "governance", tab: "governance" },
      { sub: "installs", tab: "install" },
    ] as const;
    for (const { sub, tab } of cases) {
      const app = mountApp(`/enterprise/acme/usage-management/${sub}`);
      await app.updateComplete;

      expect(app.tab).toBe("enterpriseCapabilityCenter");
      expect(window.location.pathname).toBe("/enterprise/acme/capabilities");
      expect(window.location.search).toContain(`tab=${tab}`);
    }
  });

  it("redirects legacy builder object routes without preserving builder UI", async () => {
    const app = mountApp("/builder/tools/channel-core");
    await app.updateComplete;

    expect(app.tab).toBe("platformAdvanced");
    expect(window.location.pathname).toBe("/platform/advanced");
  });

  it("redirects legacy /chat to the workbench home", async () => {
    const app = mountApp("/chat?session=agent:main:subagent:task-123");
    await app.updateComplete;

    expect(app.tab).toBe("me");
    expect(app.sessionKey).toBe("agent:main:subagent:task-123");
    expect(window.location.pathname).toBe("/");
  });

  it("keeps workbench chat usable on narrow viewports", async () => {
    const app = mountApp("/");
    await app.updateComplete;

    expect(window.matchMedia("(max-width: 768px)").matches).toBe(true);

    const chatThread = app.querySelector(".chat-thread");
    expect(chatThread).not.toBeNull();
  });

  it("auto-scrolls chat history to the latest message", async () => {
    const app = mountApp("/");
    await app.updateComplete;

    const initialContainer: HTMLElement | null = app.querySelector(".chat-thread");
    expect(initialContainer).not.toBeNull();
    if (!initialContainer) {
      return;
    }
    let scrollTop = 0;
    initialContainer.style.maxHeight = "180px";
    initialContainer.style.overflow = "auto";
    Object.defineProperty(initialContainer, "clientHeight", {
      configurable: true,
      value: 180,
    });
    Object.defineProperty(initialContainer, "scrollHeight", {
      configurable: true,
      value: 2400,
    });
    Object.defineProperty(initialContainer, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });
    initialContainer.scrollTo = ((options?: ScrollToOptions | number, y?: number) => {
      if (typeof options === "number") {
        scrollTop = y ?? options;
        return;
      }
      scrollTop = options?.top ?? scrollTop;
    }) as typeof initialContainer.scrollTo;

    app.chatMessages = Array.from({ length: 60 }, (_, index) => ({
      role: "assistant",
      content: `Line ${index} - ${"x".repeat(200)}`,
      timestamp: Date.now() + index,
    }));

    await app.updateComplete;
    for (let i = 0; i < 6; i++) {
      await nextFrame();
    }

    const container = app.querySelector(".chat-thread");
    expect(container).not.toBeNull();
    if (!container) {
      return;
    }
    const maxScroll = container.scrollHeight - container.clientHeight;
    expect(maxScroll).toBeGreaterThan(0);
    for (let i = 0; i < 10; i++) {
      if (container.scrollTop === container.scrollHeight) {
        break;
      }
      await nextFrame();
    }
    expect(container.scrollTop).toBe(container.scrollHeight);
  });

  it("strips query token params without importing them", async () => {
    const app = mountApp("/ui/ops/incidents?token=abc123");
    await app.updateComplete;

    expect(app.settings.token).toBe("");
    expect(JSON.parse(localStorage.getItem("openbot.control.settings.v1") ?? "{}").token).toBe(
      undefined,
    );
    expect(window.location.pathname).toBe("/ui/platform");
    expect(window.location.search).toBe("");
  });

  it("strips password URL params without importing them", async () => {
    const app = mountApp("/ui/ops/incidents?password=sekret");
    await app.updateComplete;

    expect(app.password).toBe("");
    expect(window.location.pathname).toBe("/ui/platform");
    expect(window.location.search).toBe("");
  });

  it("hydrates token from URL hash when settings already set", async () => {
    localStorage.setItem(
      "openbot.control.settings.v1",
      JSON.stringify({ token: "existing-token", gatewayUrl: "wss://gateway.example/openclaw" }),
    );
    const app = mountApp("/ui/ops/incidents#token=abc123");
    await app.updateComplete;

    expect(app.settings.token).toBe("abc123");
    expect(JSON.parse(localStorage.getItem("openbot.control.settings.v1") ?? "{}")).toMatchObject({
      gatewayUrl: "wss://gateway.example/openclaw",
    });
    expect(JSON.parse(localStorage.getItem("openbot.control.settings.v1") ?? "{}").token).toBe(
      undefined,
    );
    expect(window.location.pathname).toBe("/ui/platform");
    expect(window.location.hash).toBe("");
  });

  it("hydrates token from URL hash and strips it", async () => {
    const app = mountApp("/ui/ops/incidents#token=abc123");
    await app.updateComplete;

    expect(app.settings.token).toBe("abc123");
    expect(JSON.parse(localStorage.getItem("openbot.control.settings.v1") ?? "{}").token).toBe(
      undefined,
    );
    expect(window.location.pathname).toBe("/ui/platform");
    expect(window.location.hash).toBe("");
  });

  it("keeps a hash token pending until the gateway URL change is confirmed", async () => {
    const app = mountApp(
      "/ui/ops/incidents?gatewayUrl=wss://other-gateway.example/openclaw#token=abc123",
    );
    await app.updateComplete;

    expect(app.settings.gatewayUrl).not.toBe("wss://other-gateway.example/openclaw");
    expect(app.settings.token).toBe("");

    const confirmButton = Array.from(app.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Confirm",
    );
    expect(confirmButton).not.toBeUndefined();
    confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await app.updateComplete;

    expect(app.settings.gatewayUrl).toBe("wss://other-gateway.example/openclaw");
    expect(app.settings.token).toBe("abc123");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
  });

  it("restores the token after a same-tab refresh", async () => {
    const first = mountApp("/ui/ops/incidents#token=abc123");
    await first.updateComplete;
    first.remove();

    const refreshed = mountApp("/ui/ops/incidents");
    await refreshed.updateComplete;

    expect(refreshed.settings.token).toBe("abc123");
    expect(JSON.parse(localStorage.getItem("openbot.control.settings.v1") ?? "{}").token).toBe(
      undefined,
    );
  });
});
