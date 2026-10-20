/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlUiPlatformAuthState } from "../../../../src/gateway/control-ui-contract.js";
import { i18n } from "../../i18n/index.ts";
import { authHomeModeForControlledLogin } from "./auth-home-entry-mode.ts";
import { renderAuthHome } from "./auth-home.ts";

function authState(): ControlUiPlatformAuthState {
  return {
    enabled: true,
    hasUsers: true,
    hasPlatformAdmins: true,
    requiresPlatformBootstrap: false,
    availableModes: ["login", "forgot-password", "password-reset", "platform-admin-login"],
  } as ControlUiPlatformAuthState;
}

function props(overrides: Record<string, unknown> = {}) {
  return {
    currentLocale: "zh-CN" as const,
    state: authState(),
    mode: "login" as const,
    busy: false,
    error: null,
    notice: null,
    email: "member@example.com",
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
    ...overrides,
  };
}

describe("auth-home password reset", () => {
  let container: HTMLElement;

  beforeEach(async () => {
    await i18n.setLocale("zh-CN");
    container = document.createElement("div");
    document.body.replaceChildren(container);
    window.history.replaceState({}, "", "/");
  });

  it.each([
    ["www.openbot.love", "/", "employee", "public"],
    ["openbot.love", "/", "employee", "public"],
    ["biz.openbot.love", "/enterprise/login", "enterprise", "enterprise"],
    ["admin.openbot.love", "/platform/login", "platform", "platform"],
  ] as const)(
    "opens password-reset from the mail link on %s",
    (_host, path, surface, entryVariant) => {
      window.history.replaceState(
        {},
        "",
        `${path}?mode=password-reset&code=RESET-1&surface=${surface}#auth`,
      );
      render(
        renderAuthHome(
          props({
            entryVariant,
            mode: entryVariant === "platform" ? "platform-admin-login" : "login",
          }),
        ),
        container,
      );
      expect(container.textContent).toContain("重置密码");
      expect(container.textContent).not.toContain("已登录企业工作台");
      expect(container.querySelector(".auth-home__mfa")).toBeNull();
    },
  );

  it("keeps forgot-password on the enterprise and platform entries", () => {
    for (const entry of [
      { entryVariant: "enterprise" as const, mode: "forgot-password" as const },
      { entryVariant: "platform" as const, mode: "forgot-password" as const },
    ]) {
      render(renderAuthHome(props(entry)), container);
      expect(container.textContent).toContain("找回密码");
      expect(container.textContent).toContain("发送验证码");
      expect(container.querySelector("input[autocomplete='current-password']")).toBeNull();
    }
  });

  it("controlled login shell forwards recovery mode instead of locking the entry", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../app-render.ts"),
      "utf8",
    );
    expect(source).toContain("authHomeModeForControlledLogin({");
    expect(source).not.toContain(
      'mode: isPlatformLogin ? "platform-admin-login" : "enterprise-activate"',
    );
  });

  it("keeps forgot and reset when the controlled shell forwards that mode", () => {
    for (const isPlatformLogin of [false, true]) {
      for (const platformAuthMode of ["forgot-password", "password-reset"] as const) {
        const mode = authHomeModeForControlledLogin({ isPlatformLogin, platformAuthMode });
        render(
          renderAuthHome(
            props({
              entryVariant: isPlatformLogin ? "platform" : "enterprise",
              mode,
            }),
          ),
          container,
        );
        expect(container.textContent).toContain(
          platformAuthMode === "forgot-password" ? "找回密码" : "重置密码",
        );
        expect(container.querySelector(".auth-home__mfa")).toBeNull();
      }
    }
  });

  it("shows an enterprise picker when login returns more than one tenant", () => {
    render(
      renderAuthHome(
        props({
          entryVariant: "public",
          mode: "login",
          error: "此账号加入了多家企业。请选择要进入的企业后再继续。",
          membershipChoices: [
            {
              membershipId: "mem-a",
              enterpriseId: "ent-a",
              enterpriseName: "甲企业",
              role: "member",
            },
            {
              membershipId: "mem-b",
              enterpriseId: "ent-b",
              enterpriseName: "乙企业",
              role: "member",
            },
          ],
        }),
      ),
      container,
    );
    const select = container.querySelector("select[data-membership-choice]");
    expect(select).toBeTruthy();
    expect(select?.textContent).toContain("甲企业");
    expect(select?.textContent).toContain("乙企业");
    expect(container.textContent).not.toContain("身份不匹配");
    expect(container.querySelector(".auth-home__mfa")).toBeNull();
  });

  it("lets enterprise and platform login open forgot-password", () => {
    for (const entry of [
      { entryVariant: "enterprise" as const, mode: "login" as const },
      { entryVariant: "platform" as const, mode: "platform-admin-login" as const },
    ]) {
      const onModeChange = vi.fn();
      render(renderAuthHome(props({ ...entry, onModeChange })), container);
      const forgot = [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("忘记密码"),
      );
      forgot?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(onModeChange).toHaveBeenCalledWith("forgot-password");
    }
  });
});
