/* @vitest-environment jsdom */

import { render } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlUiPlatformAuthState } from "../../../../src/gateway/control-ui-contract.js";
import { i18n } from "../../i18n/index.ts";
import { renderAuthHome, renderTrialApplyPage } from "./auth-home.ts";

function baseProps() {
  return {
    brandLogoSrc: null,
    basePath: "",
    currentLocale: "zh-CN" as const,
    state: {
      enabled: true,
      hasUsers: true,
      hasPlatformAdmins: true,
      availableModes: [
        "enterprise-create",
        "enterprise-activate",
        "login",
        "forgot-password",
        "password-reset",
      ],
    } as unknown as ControlUiPlatformAuthState,
    mode: "enterprise-create" as const,
    busy: false,
    error: null,
    notice: null,
    email: "",
    password: "",
    displayName: "",
    tenantName: "",
    expectedUsers: "",
    useCase: "",
    companySize: "",
    needsDemo: "",
    industry: "",
    trialStep: 1 as const,
    inviteCode: "",
    onModeChange: vi.fn(),
    onEmailChange: vi.fn(),
    onPasswordChange: vi.fn(),
    onDisplayNameChange: vi.fn(),
    onTenantNameChange: vi.fn(),
    onExpectedUsersChange: vi.fn(),
    onUseCaseChange: vi.fn(),
    onCompanySizeChange: vi.fn(),
    onNeedsDemoChange: vi.fn(),
    onIndustryChange: vi.fn(),
    onTrialStepChange: vi.fn(),
    onInviteCodeChange: vi.fn(),
    onLocaleChange: vi.fn(),
    onForgotAccountHelp: vi.fn(),
    onSubmit: vi.fn(),
  };
}

describe("trial apply navigation", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/trial-apply");
  });

  it("navigates back home with SPA history instead of full-page location assignment", () => {
    const pushState = vi.spyOn(window.history, "pushState");
    const popStateHandler = vi.fn();
    window.addEventListener("popstate", popStateHandler);

    const container = document.createElement("div");
    render(renderTrialApplyPage(baseProps()), container);

    const backLink = container.querySelector(".trial-apply-page__back") as HTMLAnchorElement;
    backLink.click();

    expect(pushState).toHaveBeenCalledWith({}, "", "/");
    expect(window.location.pathname).toBe("/");
    expect(popStateHandler).toHaveBeenCalledOnce();

    window.removeEventListener("popstate", popStateHandler);
    pushState.mockRestore();
  });
});

function stubConsoleHost(host: string, href = `https://${host}/enterprise/login`) {
  const assign = vi.fn();
  const original = window.location;
  const url = new URL(href);
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      host,
      hostname: host,
      href: url.href,
      origin: url.origin,
      protocol: url.protocol,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      assign,
    },
  });
  return {
    assign,
    restore() {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    },
  };
}

function homeNavLink(container: HTMLElement): HTMLAnchorElement {
  const link = Array.from(container.querySelectorAll("a.auth-home__nav-entry")).find((entry) =>
    entry.textContent?.includes("首页"),
  );
  if (!(link instanceof HTMLAnchorElement)) {
    throw new Error("missing 首页 nav link");
  }
  return link;
}

describe("console host 首页 nav", () => {
  beforeEach(async () => {
    await i18n.setLocale("zh-CN");
  });

  it.each(["biz.openbot.love", "admin.openbot.love"])(
    "hard-navigates %s 首页 to the employee site",
    (host) => {
      const location = stubConsoleHost(host);
      const pushState = vi.spyOn(window.history, "pushState");
      const container = document.createElement("div");
      render(
        renderAuthHome({
          ...baseProps(),
          mode: "login",
          entryVariant: host.startsWith("admin") ? "platform" : "enterprise",
        }),
        container,
      );

      const link = homeNavLink(container);
      expect(link.getAttribute("href")).toBe("https://www.openbot.love/");
      link.click();

      expect(location.assign).toHaveBeenCalledWith("https://www.openbot.love/");
      expect(pushState).not.toHaveBeenCalled();
      location.restore();
      pushState.mockRestore();
    },
  );

  it("leaves biz even when 首页 is clicked from the public card with an employee session query", () => {
    const location = stubConsoleHost(
      "biz.openbot.love",
      "https://biz.openbot.love/?session=agent%3Amain%3Aemployee%3A90fed19a-1c8b-4420-87e0-bcc6165e32fa",
    );
    const pushState = vi.spyOn(window.history, "pushState");
    const container = document.createElement("div");
    render(renderAuthHome({ ...baseProps(), mode: "login", entryVariant: "public" }), container);

    const link = homeNavLink(container);
    expect(link.getAttribute("href")).toBe("https://www.openbot.love/");
    expect(link.getAttribute("href")).not.toContain("session=");
    link.click();

    expect(location.assign).toHaveBeenCalledWith("https://www.openbot.love/");
    expect(pushState).not.toHaveBeenCalled();
    location.restore();
    pushState.mockRestore();
  });
});
