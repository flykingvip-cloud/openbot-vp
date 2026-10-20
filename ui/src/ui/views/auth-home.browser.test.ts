/* @vitest-environment jsdom */

import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlUiPlatformAuthMode } from "../../../../src/gateway/control-ui-contract.js";
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
      ] as ControlUiPlatformAuthMode[],
    },
    mode: "employee-register" as const,
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

describe("auth home", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    window.history.replaceState({}, "", "/");
    await i18n.setLocale("zh-CN");
  });

  it("renders the restored landing page shell with enterprise and employee auth entries", () => {
    const container = document.createElement("div");

    render(renderAuthHome(baseProps()), container);

    expect(container.querySelector(".auth-home")).not.toBeNull();
    expect(container.textContent).toContain("面向团队的 AI 工作台");
    expect(container.textContent).toContain("首页");
    expect(container.textContent).toContain("企业登录");
    // 平台登录已从公共站点导航移除；平台管理员通过独立域名 admin.openbot.love 登录。
    expect(container.textContent).not.toContain("平台登录");
    expect(container.textContent).toContain("注册");
    expect(container.textContent).toContain("登录");
    expect(container.textContent).not.toContain("超管登录");
    expect(container.textContent).not.toContain("平台管理员登录");
    expect(container.textContent).toContain("查看演示");
    expect(container.textContent).toContain("申请试用");
    expect(container.textContent).toContain("将任务交给 AI");
    expect(container.textContent).toContain("构建数字资产");
    expect(container.textContent).toContain("人机协作");
    // 定价已从首页收敛到「产品 → 定价」独立路由；首页不再内嵌套餐预览区。
    expect(container.textContent).not.toContain("预览企业套餐");
    expect(container.querySelector("#pricing-preview")).toBeNull();
  });

  it("routes product pricing nav to the standalone pricing route", () => {
    const container = document.createElement("div");

    render(renderAuthHome(baseProps()), container);

    const pricingLink = Array.from(container.querySelectorAll("a")).find(
      (node) => node.textContent?.trim() === "定价",
    );
    expect(pricingLink?.getAttribute("href")).toBe("/pricing");
  });

  it("wires the homepage help nav to the same-origin help center", () => {
    const container = document.createElement("div");

    render(renderAuthHome(baseProps()), container);

    const helpNav = Array.from(container.querySelectorAll("a")).find(
      (node) => node.textContent?.trim() === "帮助中心",
    );
    expect(helpNav?.getAttribute("href")).toBe("/help");
    expect(helpNav?.getAttribute("target")).not.toBe("_blank");
    expect(helpNav?.getAttribute("href")).not.toContain("docs.openbot.love");
  });

  it("renders the register flow by default", () => {
    const container = document.createElement("div");

    render(renderAuthHome(baseProps()), container);

    expect(container.textContent).toContain("邮箱");
    expect(container.textContent).toContain("用户名称");
    expect(container.textContent).toContain("邀请码核验");
    expect(container.textContent).toContain("密码");
    const fields = Array.from(container.querySelectorAll(".auth-home__field span")).map((node) =>
      node.textContent?.trim(),
    );
    expect(fields).toEqual(["用户名称", "注册邮箱", "邀请码核验", "登录密码"]);
    const passwordInput = container.querySelector<HTMLInputElement>(
      '.auth-home__field input[type="password"]',
    );
    expect(passwordInput?.getAttribute("placeholder")).toBe("至少 8 位");
    expect(container.textContent).not.toContain("员工激活码由企业管理员发放");
  });

  it("keeps the public auth switch stable even when the server returns a narrow mode list", () => {
    const container = document.createElement("div");

    render(
      renderAuthHome({
        ...baseProps(),
        mode: "employee-register",
        state: {
          enabled: true,
          hasUsers: true,
          hasPlatformAdmins: true,
          requiresPlatformBootstrap: false,
          availableModes: ["enterprise-create"],
        },
      }),
      container,
    );

    const modeButtons = Array.from(container.querySelectorAll(".auth-home__mode-button")).map(
      (button) => button.textContent?.trim(),
    );
    expect(modeButtons).toEqual(["注册", "登录"]);
  });

  it("falls back to register when the homepage loads with a blank admin activation mode", () => {
    const container = document.createElement("div");

    render(
      renderAuthHome({
        ...baseProps(),
        mode: "enterprise-activate",
      }),
      container,
    );

    const modeButtons = Array.from(container.querySelectorAll(".auth-home__mode-button")).map(
      (button) => button.textContent?.trim(),
    );
    expect(modeButtons).toEqual(["注册", "登录"]);
  });

  it("falls back to the regular employee login when the homepage is asked to open an admin mode", () => {
    const container = document.createElement("div");

    render(
      renderAuthHome({
        ...baseProps(),
        mode: "platform-admin-login",
        state: {
          ...baseProps().state,
          availableModes: [
            "platform-super-admin-login",
            "platform-admin-login",
            "employee-register",
            "login",
          ],
        },
      }),
      container,
    );

    const modeButtons = Array.from(container.querySelectorAll(".auth-home__mode-button")).map(
      (button) => button.textContent?.trim(),
    );
    const fields = Array.from(container.querySelectorAll(".auth-home__field span")).map((node) =>
      node.textContent?.trim(),
    );

    expect(modeButtons).toEqual(["注册", "登录"]);
    expect(fields).toEqual(["邮箱", "登录密码"]);
    expect(container.textContent).not.toContain("超管登录");
    expect(container.textContent).not.toContain("平台管理员登录");
    expect(container.textContent).not.toContain("使用企业邮箱和登录密码进入工作台");
  });

  it("uses distinct submit labels for register and admin activation", () => {
    const registerContainer = document.createElement("div");
    const activationContainer = document.createElement("div");

    render(
      renderAuthHome({
        ...baseProps(),
        mode: "employee-register",
      }),
      registerContainer,
    );
    render(
      renderAuthHome({
        ...baseProps(),
        mode: "enterprise-activate",
        inviteCode: "ADMIN-0001",
        state: {
          ...baseProps().state,
          pendingActivation: {
            kind: "enterprise-admin-activation",
            email: "admin@company.com",
            code: "ADMIN-0001",
            expiresAt: "2026-04-13T00:00:00.000Z",
          },
        },
      }),
      activationContainer,
    );

    expect(registerContainer.querySelector(".auth-home__submit")?.textContent?.trim()).toBe("注册");
    expect(activationContainer.querySelector(".auth-home__submit")?.textContent?.trim()).toBe(
      "完成激活",
    );
  });

  it("falls back to the regular homepage auth card when a stale enterprise-create mode is present", () => {
    const container = document.createElement("div");

    render(
      renderAuthHome({
        ...baseProps(),
        mode: "enterprise-create",
      }),
      container,
    );

    expect(container.textContent).toContain("企业名称");
    expect(container.textContent).toContain("工作邮箱");
    expect(container.textContent).toContain("预计使用人数");
  });

  it("renders enterprise admin login when requested through the dedicated enterprise login entry", () => {
    const container = document.createElement("div");

    window.history.replaceState(
      {},
      "",
      "/enterprise/login?workbench=settings&settingsView=personal&seatOffer=offer-1#seat-offer",
    );

    render(
      renderAuthHome({
        ...baseProps(),
        mode: "enterpriseLogin" as ControlUiPlatformAuthMode,
        state: {
          ...baseProps().state,
          pendingActivation: {
            kind: "enterprise-admin-activation",
            email: "admin@company.com",
            code: "ADMIN-0001",
            expiresAt: "2026-04-13T00:00:00.000Z",
          },
        },
      }),
      container,
    );

    expect(container.textContent).toContain("企业管理员激活码");
    expect(container.textContent).toContain("完成激活");
    const fields = Array.from(container.querySelectorAll(".auth-home__field span")).map((node) =>
      node.textContent?.trim(),
    );
    expect(fields).toEqual(["用户名称", "注册邮箱", "登录密码", "邀请码核验"]);
  });

  it("forces the public homepage auth card into login mode when a seatOffer deep link is present", () => {
    const container = document.createElement("div");

    window.history.replaceState(
      {},
      "",
      "/?workbench=settings&settingsView=personal&seatOffer=offer-1#seat-offer",
    );

    render(renderAuthHome(baseProps()), container);

    const modeButtons = Array.from(container.querySelectorAll(".auth-home__mode-button")).map(
      (button) => button.textContent?.trim(),
    );
    const fields = Array.from(container.querySelectorAll(".auth-home__field span")).map((node) =>
      node.textContent?.trim(),
    );

    expect(modeButtons).toEqual(["注册", "登录"]);
    expect(fields).toEqual(["邮箱", "登录密码"]);
  });

  it("submits the dedicated enterprise login page using the resolved login mode", () => {
    const container = document.createElement("div");
    const onSubmit = vi.fn();

    render(
      renderAuthHome({
        ...baseProps(),
        mode: "enterprise-activate",
        entryVariant: "enterprise",
        email: "admin@company.com",
        password: "password-123",
        onSubmit,
      }),
      container,
    );

    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(onSubmit).toHaveBeenCalledWith("login");
  });

  it("renders platform admin login when requested through the dedicated platform login entry", () => {
    const container = document.createElement("div");

    render(
      renderAuthHome({
        ...baseProps(),
        mode: "platformLogin" as ControlUiPlatformAuthMode,
        state: {
          ...baseProps().state,
          availableModes: [
            "platform-super-admin-login",
            "platform-admin-login",
            "employee-register",
            "login",
          ],
        },
      }),
      container,
    );

    expect(container.textContent).toContain("平台管理员");
    const modeButtons = Array.from(container.querySelectorAll(".auth-home__mode-button")).map(
      (button) => button.textContent?.trim(),
    );
    expect(modeButtons).toEqual(["平台管理员"]);
  });

  it("submits the dedicated platform login page using the resolved login mode", () => {
    const container = document.createElement("div");
    const onSubmit = vi.fn();

    render(
      renderAuthHome({
        ...baseProps(),
        mode: "platform-admin-login",
        entryVariant: "platform",
        email: "ops@example.com",
        password: "password-123",
        state: {
          ...baseProps().state,
          availableModes: [
            "platform-super-admin-login",
            "platform-admin-login",
            "employee-register",
            "login",
          ],
        },
        onSubmit,
      }),
      container,
    );

    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(onSubmit).toHaveBeenCalledWith("platform-admin-login");
  });

  it("renders the dedicated standalone trial application page", () => {
    const container = document.createElement("div");

    render(
      renderTrialApplyPage({
        ...baseProps(),
        mode: "enterprise-create",
      }),
      container,
    );

    expect(container.querySelector(".trial-apply-page")).not.toBeNull();
    expect(container.textContent).not.toContain("5分钟搭建你的企业 AI 工作系统");
    expect(container.textContent).toContain("企业名称");
    expect(container.textContent).toContain("工作邮箱");
    expect(container.textContent).toContain("预计使用人数");
    expect(container.textContent).toContain("立即创建试用环境");
    expect(container.textContent).toContain("把 AI 对话、知识库和流程执行连成一个工作系统");
    expect(container.textContent).not.toContain("先留下企业信息，我们会立即判断试用开通路径。");
    expect(container.textContent).not.toContain("无需信用卡 · 30 秒完成申请");
    expect(container.querySelector(".trial-apply-page__microcopy")).toBeNull();
    expect(container.querySelector(".trial-apply-page__routing")).toBeNull();
    expect(container.querySelector(".trial-apply-page__trust")).toBeNull();
    expect(container.querySelector(".trial-apply-page__trust-row")).toBeNull();
    expect(container.querySelectorAll(".trial-apply-page__segment")).toHaveLength(0);
    expect(container.querySelectorAll(".trial-apply-page__compact-field")).toHaveLength(3);
    const teamSizeSelect = container.querySelector<HTMLSelectElement>(
      ".trial-apply-page__compact-field select",
    );
    expect(teamSizeSelect?.options.length).toBe(5);
    expect(container.querySelector(".trial-apply-page__visual-shot")?.getAttribute("src")).toBe(
      "/trial-apply-product-ui.jpg",
    );
  });

  it("removes the compact field outer border once the user has entered text", () => {
    const container = document.createElement("div");

    render(
      renderTrialApplyPage({
        ...baseProps(),
        mode: "enterprise-create",
        tenantName: "OpenBot 科技",
        email: "name@company.com",
      }),
      container,
    );

    const fields = Array.from(
      container.querySelectorAll(".trial-apply-page__compact-field"),
    ).filter((field) => field.querySelector("input"));
    expect(fields).toHaveLength(2);
    expect(fields.every((field) => field.classList.contains("is-filled"))).toBe(true);
  });

  it("renders the second step of the standalone trial page with use-case choices", () => {
    const container = document.createElement("div");

    render(
      renderTrialApplyPage({
        ...baseProps(),
        mode: "enterprise-create",
        trialStep: 2,
      }),
      container,
    );

    expect(container.textContent).toContain("第 2 / 2 步");
    expect(container.textContent).toContain("联系人姓名");
    expect(container.textContent).toContain("使用场景");
    expect(container.textContent).toContain("AI 客服");
    expect(container.textContent).toContain("提交申请并开通试用");
    expect(container.textContent).toContain("返回上一步");
  });

  it("shows forgot account and forgot password actions below the login button", () => {
    const container = document.createElement("div");
    const props = {
      ...baseProps(),
      mode: "login" as const,
      onModeChange: vi.fn(),
      onForgotAccountHelp: vi.fn(),
    };

    render(renderAuthHome(props), container);

    const buttons = Array.from(container.querySelectorAll(".auth-home__text-button"));
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      "忘记密码？",
      "登录遇到问题？",
    ]);

    (buttons[0] as HTMLButtonElement).click();
    expect(props.onModeChange).toHaveBeenCalledWith("forgot-password");

    (buttons[1] as HTMLButtonElement).click();
    expect(props.onForgotAccountHelp).toHaveBeenCalledTimes(1);
  });

  it("renders the password reset flow in English", async () => {
    await i18n.setLocale("en");
    const container = document.createElement("div");

    render(
      renderAuthHome({
        ...baseProps(),
        currentLocale: "en",
        mode: "password-reset",
      }),
      container,
    );

    expect(container.textContent).toContain("Reset password");
    expect(container.textContent).toContain("Code");
    expect(container.textContent).toContain("New password");
  });

  it("routes trial success CTA to the enterprise login page", () => {
    const container = document.createElement("div");

    render(
      renderTrialApplyPage({
        ...baseProps(),
        mode: "enterprise-activate",
        notice: "试用已开通，请前往企业管理员登录页。",
      }),
      container,
    );

    const loginLink = container.querySelector(".auth-home__primary-button");
    expect(loginLink?.getAttribute("href")).toBe("/enterprise/login");
  });

  it("prefills employee register fields from the employee invite link", () => {
    window.history.replaceState(
      {},
      "",
      "/?authMode=employee-register&email=member%40example.com&code=EMP-MEMBERX&name=%E5%BC%A0%E4%B8%89#auth",
    );
    const container = document.createElement("div");

    render(renderAuthHome(baseProps()), container);

    const inputs = Array.from(
      container.querySelectorAll<HTMLInputElement>(".auth-home__field input"),
    );
    expect(inputs.map((input) => input.value)).toEqual([
      "张三",
      "member@example.com",
      "EMP-MEMBERX",
      "",
    ]);
    expect(container.textContent).not.toContain("员工激活码由企业管理员发放");
  });
});
