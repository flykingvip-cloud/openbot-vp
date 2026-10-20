// @vitest-environment jsdom
import { render } from "lit";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import type { AppViewState } from "../app-view-state.ts";
import type { SecureFormOfferedUi } from "../gateway-subscriptions/secure-form.ts";
import {
  renderSecureFormCard,
  renderSecureFormCardFromState,
  renderSecureFormThreadCards,
} from "./secure-form-card.ts";

beforeAll(async () => {
  await i18n.setLocale("zh-CN");
});

function offered(overrides: Partial<SecureFormOfferedUi> = {}): SecureFormOfferedUi {
  return {
    formId: "f1",
    sessionKey: "session:main",
    agentLabel: "Agent",
    reason: "auth",
    domain: { host: "login.example.com" },
    fields: [
      { fieldId: "username", kind: "username", label: "用户名" },
      { fieldId: "password", kind: "password", label: "密码" },
    ],
    createdAt: Date.now(),
    ...overrides,
  };
}

function mountFromState(state: Partial<AppViewState>) {
  const container = document.createElement("div");
  const full = {
    sessionKey: "session:main",
    secureFormOffered: null,
    secureFormValues: {},
    secureFormBusy: false,
    secureFormError: null,
    secureFormReceipt: null,
    secureFormHandoff: null,
    handleSecureFormFieldInput: vi.fn(),
    handleSecureFormSubmit: vi.fn(),
    handleSecureFormClose: vi.fn(),
    handleSecureFormUseComputer: vi.fn(),
    handleSecureFormHandoffDismiss: vi.fn(),
    handleSecureFormHandoffReturn: vi.fn(),
    ...state,
  } as unknown as AppViewState;
  render(renderSecureFormCardFromState(full), container);
  return { container, state: full };
}

describe("secure form card", () => {
  it("legacy overlay renderer is a no-op (cards live in the thread)", () => {
    const container = document.createElement("div");
    render(
      renderSecureFormCard({
        sessionKey: "session:main",
        secureFormHandoff: {
          sessionKey: "session:main",
          instruction: "x",
          reason: "sso",
        },
      } as unknown as AppViewState),
      container,
    );
    expect(container.textContent?.trim()).toBe("");
    expect(container.querySelector(".exec-approval-overlay")).toBeNull();
  });

  it("renders nothing when idle", () => {
    const { container } = mountFromState({});
    expect(container.textContent?.trim()).toBe("");
  });

  it("renders title, domain, fields, and actions in conversation placement", () => {
    const { container } = mountFromState({ secureFormOffered: offered() });
    expect(container.textContent).toContain("登录授权");
    expect(container.textContent).toContain("目标站点：login.example.com");
    expect(container.textContent).toContain("用户名");
    expect(container.textContent).toContain("密码");
    expect(container.textContent).toContain("填入电脑");
    expect(container.textContent).toContain("改用电脑完成");
    expect(container.textContent).toContain("关闭");
    const root = container.querySelector('[data-surface="secure-form"]');
    expect(root?.getAttribute("data-placement")).toBe("conversation");
    expect(container.querySelector(".exec-approval-overlay")).toBeNull();
    const password = container.querySelector('input[type="password"]');
    expect(password).toBeTruthy();
  });

  it("wires submit / use-computer / close", () => {
    const { container, state } = mountFromState({ secureFormOffered: offered() });
    const buttons = [...container.querySelectorAll("button")];
    const byLabel = (label: string) => buttons.find((b) => (b.textContent ?? "").includes(label));
    byLabel("填入电脑")?.click();
    byLabel("改用电脑完成")?.click();
    byLabel("关闭")?.click();
    expect(state.handleSecureFormSubmit).toHaveBeenCalled();
    expect(state.handleSecureFormUseComputer).toHaveBeenCalled();
    expect(state.handleSecureFormClose).toHaveBeenCalled();
  });

  it("shows filled receipt banner inline", () => {
    const { container } = mountFromState({
      secureFormReceipt: { formId: "f1", status: "filled", completedAt: Date.now() },
    });
    expect(container.textContent).toContain("已填入");
    expect(container.querySelector(".exec-approval-overlay")).toBeNull();
  });

  it("skips conversation handoff reminder card for auto-resume QR/SMS gate", () => {
    const { container } = mountFromState({
      secureFormHandoff: {
        sessionKey: "session:main",
        instruction: "请在云电脑窗口扫码或输入短信验证码；完成后系统会自动继续。",
        reason: "qr",
      },
    });
    expect(container.textContent?.trim()).toBe("");
    expect(container.querySelector('[data-surface="secure-form-handoff"]')).toBeNull();
    expect(container.textContent).not.toContain("请在专用浏览器完成登录");
    expect(container.textContent).not.toContain("收起卡片");
    expect(container.textContent).not.toContain("不用点「交给AI」");
    expect(container.textContent).not.toContain("无需点「交给AI」");
    expect(container.querySelector(".exec-approval-overlay")).toBeNull();
    expect(container.querySelector("[data-secure-form-handback]")).toBeNull();
  });

  it("still skips handoff card when instruction is empty (i18n unused in UI)", () => {
    const container = document.createElement("div");
    render(
      renderSecureFormThreadCards({
        sessionKey: "session:main",
        handoff: { sessionKey: "session:main", instruction: "", reason: "sms" },
        onHandBack: vi.fn(),
        onHandoffDismiss: vi.fn(),
      }),
      container,
    );
    expect(container.textContent?.trim()).toBe("");
    expect(container.querySelector('[data-surface="secure-form-handoff"]')).toBeNull();
  });

  it("password Secure Form card still renders while handoff path stays card-free", () => {
    const { container } = mountFromState({ secureFormOffered: offered() });
    expect(container.querySelector('[data-surface="secure-form"]')).toBeTruthy();
    expect(container.textContent).toContain("登录授权");
    expect(container.querySelector('[data-surface="secure-form-handoff"]')).toBeNull();
  });
});
