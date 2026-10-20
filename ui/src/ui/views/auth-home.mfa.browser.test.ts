// @vitest-environment jsdom
import { render } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlUiPlatformAuthState } from "../../../../src/gateway/control-ui-contract.js";
import { renderAuthHome } from "./auth-home.ts";

function platformState(): ControlUiPlatformAuthState {
  return {
    enabled: true,
    hasUsers: true,
    hasPlatformAdmins: true,
    requiresPlatformBootstrap: false,
    availableModes: ["platform-super-admin-login", "platform-admin-login"],
  } as ControlUiPlatformAuthState;
}

function baseProps() {
  return {
    currentLocale: "zh-CN" as const,
    state: platformState(),
    mode: "platform-admin-login" as const,
    busy: false,
    error: null,
    notice: null,
    email: "ops@example.com",
    password: "password-123",
    displayName: "",
    tenantName: "",
    expectedUsers: "",
    useCase: "",
    companySize: "",
    needsDemo: "",
    industry: "",
    trialStep: 1 as const,
    inviteCode: "",
    entryVariant: "platform" as const,
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

describe("auth-home MFA section (platform login)", () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("does not render the MFA section when stage is none", () => {
    render(renderAuthHome({ ...baseProps(), mfaStage: "none" }), container);
    expect(container.querySelector(".auth-home__mfa")).toBeNull();
  });

  it("renders the OTP field when stage is code", () => {
    const onMfaCodeChange = vi.fn();
    render(
      renderAuthHome({ ...baseProps(), mfaStage: "code", mfaCode: "", onMfaCodeChange }),
      container,
    );
    const mfa = container.querySelector(".auth-home__mfa");
    expect(mfa).not.toBeNull();
    expect(mfa?.classList.contains("auth-home__mfa--enroll")).toBe(false);
  });

  it("renders the enrollment panel with otpauth uri and recovery codes when stage is enroll", () => {
    render(
      renderAuthHome({
        ...baseProps(),
        mfaStage: "enroll",
        mfaCode: "",
        mfaEnrollment: {
          otpAuthUrl: "otpauth://totp/OpenBot:ops@example.com?secret=ABC234&issuer=OpenBot",
          recoveryCodes: ["ABCD-2345", "EFGH-6789"],
        },
        onMfaCodeChange: vi.fn(),
      }),
      container,
    );
    const enroll = container.querySelector(".auth-home__mfa--enroll");
    expect(enroll).not.toBeNull();
    expect(container.querySelector(".auth-home__mfa-otpauth-uri")?.textContent).toContain(
      "otpauth://totp/",
    );
    const codes = container.querySelectorAll(".auth-home__mfa-recovery-list li");
    expect(codes).toHaveLength(2);
  });

  it("does not render MFA fields for enterprise login", () => {
    render(
      renderAuthHome({
        ...baseProps(),
        mode: "login",
        entryVariant: "enterprise",
        mfaStage: "code",
        mfaCode: "",
        notice: null,
      }),
      container,
    );
    expect(container.querySelector(".auth-home__mfa")).toBeNull();
    expect(container.querySelector("input[autocomplete='one-time-code']")).toBeNull();
    expect(container.textContent).not.toContain("已登录企业工作台");
    expect(container.querySelector(".auth-home__callout--success")).toBeNull();
  });

  it("does not render MFA fields or an enterprise success banner on the public login card", () => {
    render(
      renderAuthHome({
        ...baseProps(),
        mode: "login",
        entryVariant: "public",
        mfaStage: "code",
        mfaCode: "",
        notice: null,
      }),
      container,
    );
    expect(container.querySelector(".auth-home__mfa")).toBeNull();
    expect(container.querySelector("input[autocomplete='one-time-code']")).toBeNull();
    expect(container.textContent).not.toContain("已登录企业工作台");
    expect(container.querySelector(".auth-home__callout--success")).toBeNull();
    const submit = container.querySelector<HTMLButtonElement>(".auth-home__submit");
    expect(submit?.disabled).toBe(false);
  });
});
