// @vitest-environment jsdom
import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderProviderIdentityEditorForm } from "./workbench-operational-identity-forms.ts";
import type { SettingsContract } from "./workbench-stage-contracts.ts";

afterEach(() => {
  document.body.innerHTML = "";
});

function wechatSettings(partial: Partial<SettingsContract>): SettingsContract {
  return {
    userOperationalIdentityEditorProvider: "wechat-personal",
    userOperationalIdentityEditorDisplayName: "我的微信",
    userOperationalIdentitySnapshot: {
      identities: [],
      grants: [],
      usageHistory: [],
      providerCatalog: [
        {
          provider: "wechat-personal",
          label: "微信个人号",
          category: "social",
          rolloutTier: "pilot",
          registrationReady: true,
          authMode: "qr_channel",
          operationalActions: [],
          reauthHint: "",
          degradedHint: "不等于公众号",
        },
      ],
      pendingBindingRequests: [],
    },
    ...partial,
  } as SettingsContract;
}

function renderForm(settings: SettingsContract): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  render(renderProviderIdentityEditorForm(settings), container);
  return container;
}

describe("wechat-personal native bind form", () => {
  it("renders wxid/nickname when the sidecar is logged in and has no QR image", () => {
    const onSubmit = vi.fn();
    const onStartQr = vi.fn();
    const container = renderForm(
      wechatSettings({
        wechatPersonalQrWorkerOnline: true,
        wechatPersonalQrStatus: "logged_in",
        wechatPersonalQrWxid: "wxid_native",
        wechatPersonalQrMessage: "已检测到本机微信：本机微信 / wxid_native",
        wechatPersonalQrDataUrl: "data:image/png;base64,abc",
        onSubmitUserOperationalIdentityEditor: onSubmit,
        onStartWechatPersonalQr: onStartQr,
      }),
    );

    const status = container.querySelector("[data-wechat-personal-worker-status]");
    expect(status?.getAttribute("data-wechat-personal-worker-status")).toBe("logged_in");
    expect(status?.textContent).toContain("已检测到本机微信：本机微信 / wxid_native");
    expect(container.querySelector("[data-wechat-personal-qr]")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("绑定当前已登录微信");
    expect(container.textContent).not.toContain("生成二维码");
    expect(container.textContent).not.toContain("重新扫码");

    const primary = container.querySelector(".btn--primary") as HTMLButtonElement;
    primary.click();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onStartQr).not.toHaveBeenCalled();
  });

  it("renders the logged-out setup prompt without a bind button", () => {
    const onRecheck = vi.fn();
    const container = renderForm(
      wechatSettings({
        wechatPersonalQrWorkerOnline: true,
        wechatPersonalQrStatus: "idle",
        wechatPersonalQrWxid: null,
        wechatPersonalQrMessage:
          "本机通道已接通，但还没有可用的微信登录态。请先打开并登录本机微信，再点重新检测。",
        onRecheckWechatPersonalChannel: onRecheck,
      }),
    );

    const status = container.querySelector("[data-wechat-personal-worker-status]");
    expect(status?.getAttribute("data-wechat-personal-worker-status")).toBe("logged_out");
    expect(status?.textContent).toContain("还没有可用的微信登录态");
    expect(container.textContent).toContain("本机通道");
    expect(container.textContent).toContain("已接通");
    expect(container.textContent).toContain("微信登录态");
    expect(container.textContent).toContain("未就绪");
    expect(container.textContent).toContain("重新检测");
    expect(container.textContent).toContain("打开并登录本机微信");
    expect(container.querySelector(".btn--primary")).toBeNull();
    expect(container.querySelector("[data-wechat-personal-qr]")).toBeNull();
    const recheck = container.querySelector("[data-wechat-personal-recheck]") as HTMLButtonElement;
    recheck.click();
    expect(onRecheck).toHaveBeenCalledTimes(1);
  });

  it("renders the worker offline prompt", () => {
    const container = renderForm(
      wechatSettings({
        wechatPersonalQrWorkerOnline: false,
        wechatPersonalQrStatus: "offline",
        wechatPersonalQrMessage: "本机微信通道未连接。请先打开本机 OpenBot 桌面端，再点重新检测。",
      }),
    );

    const status = container.querySelector("[data-wechat-personal-worker-status]");
    expect(status?.getAttribute("data-wechat-personal-worker-status")).toBe("offline");
    expect(status?.textContent).toContain("本机微信通道未连接");
    expect(container.textContent).toContain("打开本机 OpenBot 桌面端");
    expect(container.textContent).toContain("重新检测");
    expect(container.querySelector(".btn--primary")).toBeNull();
  });

  it("requires an owned agent before bind is enabled", () => {
    const onSubmit = vi.fn();
    const container = renderForm(
      wechatSettings({
        wechatPersonalQrWorkerOnline: true,
        wechatPersonalQrStatus: "logged_in",
        wechatPersonalQrWxid: "wxid_native",
        wechatPersonalQrMessage: "已检测到本机微信：wxid_native",
        ownedAgents: [{ id: "bot-1", name: "客服" }],
        userOperationalIdentityEditorGrantAgentId: "",
        onSubmitUserOperationalIdentityEditor: onSubmit,
      }),
    );

    const primary = container.querySelector(".btn--primary") as HTMLButtonElement;
    expect(primary.disabled).toBe(true);
    expect(container.textContent).toContain("先选择数字人再绑定");
    primary.click();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
