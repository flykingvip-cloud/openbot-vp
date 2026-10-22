// @vitest-environment jsdom

import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import type { PlatformSurfaceProps } from "../shared/surface.ts";
import { renderPlatformSystemSettingsSurface } from "../system-settings/page.ts";
import {
  DevicePlatformAdminRequestError,
  resetDevicePlatformConnectionPanelForTests,
  setDevicePlatformAdminClientForTests,
  type DevicePlatformAdminClient,
  type DevicePlatformConnectionView,
} from "./page.ts";

const SECRET = "service-secret-16+";

function connection(
  partial: Partial<DevicePlatformConnectionView> = {},
): DevicePlatformConnectionView {
  return {
    platformId: "plat-1",
    displayName: "生产设备平台",
    environment: "production",
    serviceBaseUrl: "https://device.example",
    contractVersion: "v1",
    credentialRef: "cred://device-platform/plat-1",
    clientIdentity: "device-platform",
    registrationNotes: "capability registration",
    callbackAllowlist: [],
    serviceClientIds: ["device-platform"],
    enabled: true,
    disabledDisposition: "block_new_keep_existing",
    credentialPresent: true,
    health: "unknown",
    ...partial,
  };
}

beforeEach(async () => {
  await i18n.setLocale("zh-CN");
});

afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
  setDevicePlatformAdminClientForTests(null);
  resetDevicePlatformConnectionPanelForTests();
  vi.restoreAllMocks();
});

describe("设备平台连接", () => {
  it("shows loading, empty, unauthorized, and failure states", async () => {
    let resolveList: (value: DevicePlatformConnectionView[]) => void = () => undefined;
    const client: DevicePlatformAdminClient = {
      list: () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
      save: vi.fn(),
      setCredential: vi.fn(),
      test: vi.fn(),
    };
    setDevicePlatformAdminClientForTests(client);
    resetDevicePlatformConnectionPanelForTests();
    const { renderDevicePlatformConnectionPanel } = await import("./page.ts");
    const container = document.createElement("div");
    document.body.append(container);
    const appHost = document.createElement("openbot-app") as HTMLElement & {
      requestUpdate: () => void;
    };
    appHost.requestUpdate = () => render(renderDevicePlatformConnectionPanel(), container);
    document.body.append(appHost);
    render(renderDevicePlatformConnectionPanel(), container);
    expect(container.textContent).toContain("正在读取设备平台连接");
    resolveList([]);
    await vi.waitFor(() => {
      expect(container.textContent).toContain("还没有设备平台连接");
    });
    expect(container.textContent).not.toContain("管理接入伙伴的连接与可达性，不管理单台设备");
    expect(container.textContent).not.toContain("设备列表与授权在企业侧「已连接设备」");
    expect(container.querySelector("[data-testid='device-platform-footnote']")).toBeNull();
    expect(container.textContent).not.toContain("未确认·JOINT_PENDING");
    expect(container.textContent).not.toContain("设备已应用");

    setDevicePlatformAdminClientForTests({
      ...client,
      list: async () => {
        throw new DevicePlatformAdminRequestError(403, "forbidden");
      },
    });
    resetDevicePlatformConnectionPanelForTests();
    await i18n.setLocale("zh-CN");
    render(renderDevicePlatformConnectionPanel(), container);
    await vi.waitFor(() => {
      expect(container.textContent).toMatch(
        /仅平台管理员可以配置设备平台连接|Only platform administrators/,
      );
    });
    expect(container.querySelector("form")).toBeNull();

    setDevicePlatformAdminClientForTests({
      ...client,
      list: async () => {
        throw new DevicePlatformAdminRequestError(500, "boom");
      },
    });
    resetDevicePlatformConnectionPanelForTests();
    await i18n.setLocale("zh-CN");
    render(renderDevicePlatformConnectionPanel(), container);
    await vi.waitFor(() => {
      expect(container.textContent).toMatch(
        /读取设备平台连接失败|Failed to load device platform connections/,
      );
    });
  });

  it("lists connections with filters and keeps the secret off the edit page", async () => {
    const saved = connection();
    const setCredential = vi.fn(async () => connection({ credentialPresent: true }));
    const test = vi.fn(async () => ({
      connection: connection({
        health: "down",
        healthError: "capabilities check failed",
        healthCheckedAt: "2026-10-20T00:00:00.000Z",
      }),
      checks: { health: "ok" as const, capabilities: "failed" as const },
      partial: true,
    }));
    const save = vi.fn(async () => saved);
    setDevicePlatformAdminClientForTests({
      list: async () => [connection({ health: "ok", healthCheckedAt: new Date().toISOString() })],
      save,
      setCredential,
      test,
    });
    resetDevicePlatformConnectionPanelForTests();
    const { renderDevicePlatformConnectionPanel } = await import("./page.ts");
    const container = document.createElement("div");
    document.body.append(container);
    const appHost = document.createElement("openbot-app") as HTMLElement & {
      requestUpdate: () => void;
    };
    appHost.requestUpdate = () => render(renderDevicePlatformConnectionPanel(), container);
    document.body.append(appHost);
    render(renderDevicePlatformConnectionPanel(), container);
    await vi.waitFor(() => {
      expect(container.querySelector("[data-testid='device-platform-list']")).not.toBeNull();
    });
    expect(container.textContent).toContain("生产设备平台");
    expect(container.textContent).toContain("plat-1");
    expect(container.textContent).toContain("v1-frozen");
    expect(container.textContent).toContain("全部");
    expect(container.textContent).toContain("已启用");
    expect(container.textContent).toContain("异常");

    (
      container.querySelector("[data-testid='device-platform-edit-plat-1']") as HTMLButtonElement
    ).click();
    await vi.waitFor(() => {
      expect(container.querySelector("form")).not.toBeNull();
    });
    expect(container.querySelector("[data-testid='device-platform-status-bar']")).not.toBeNull();
    expect(container.textContent).not.toContain("与冻结契约对齐");
    expect(container.textContent).not.toContain("高级：覆盖服务客户端 ID");
    expect(
      container.querySelector("[data-testid='device-platform-credential-ref']"),
    ).not.toBeNull();
    expect(
      (
        container.querySelector(
          "[data-testid='device-platform-credential-ref']",
        ) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    expect(
      container.querySelector("[data-testid='device-platform-credential-ref-hint']")?.textContent,
    ).toMatch(/自动生成|Auto-derived/);
    // Edit form also drops the breadcrumb/title block under tabs.
    expect(container.querySelector(".device-platform-admin__eyebrow")).toBeNull();

    (container.querySelector("[data-testid='device-platform-rotate']") as HTMLInputElement).click();
    await vi.waitFor(() => {
      expect(container.querySelector("[data-testid='device-platform-secret']")).not.toBeNull();
    });
    const secret = container.querySelector(
      "[data-testid='device-platform-secret']",
    ) as HTMLInputElement;
    secret.value = SECRET;
    secret.dispatchEvent(new Event("input", { bubbles: true }));
    container
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      expect(setCredential).toHaveBeenCalledWith("plat-1", SECRET, true);
    });
    expect(container.textContent).not.toContain(SECRET);
    expect(container.querySelector("[data-testid='device-platform-secret']")?.value ?? "").toBe("");

    const testButton = container.querySelector(
      "[data-testid='device-platform-test']",
    ) as HTMLButtonElement;
    testButton.click();
    await vi.waitFor(() => {
      expect(container.textContent).toContain("没有标记为健康");
    });
    expect(container.textContent).not.toContain(SECRET);
  });

  it("creates a connection from the add flow with required secret", async () => {
    const save = vi.fn(async (platformId: string, body: Record<string, unknown>) =>
      connection({
        platformId,
        displayName: typeof body.displayName === "string" ? body.displayName : "",
        serviceBaseUrl: typeof body.serviceBaseUrl === "string" ? body.serviceBaseUrl : "",
        credentialRef: typeof body.credentialRef === "string" ? body.credentialRef : "",
        credentialPresent: false,
      }),
    );
    const setCredential = vi.fn(async () =>
      connection({ platformId: "plat-local", credentialPresent: true }),
    );
    setDevicePlatformAdminClientForTests({
      list: async () => [],
      save,
      setCredential,
      test: vi.fn(),
    });
    resetDevicePlatformConnectionPanelForTests();
    const { renderDevicePlatformConnectionPanel } = await import("./page.ts");
    const container = document.createElement("div");
    document.body.append(container);
    const appHost = document.createElement("openbot-app") as HTMLElement & {
      requestUpdate: () => void;
    };
    appHost.requestUpdate = () => render(renderDevicePlatformConnectionPanel(), container);
    document.body.append(appHost);
    render(renderDevicePlatformConnectionPanel(), container);
    await vi.waitFor(() => {
      expect(container.querySelector("[data-testid='device-platform-add']")).not.toBeNull();
    });
    (container.querySelector("[data-testid='device-platform-add']") as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(container.querySelector("form")).not.toBeNull();
    });
    // Add form: no live status strip, contract helper, or service-client override.
    expect(container.querySelector("[data-testid='device-platform-status-bar']")).toBeNull();
    expect(container.textContent).not.toContain("与冻结契约对齐");
    expect(container.textContent).not.toContain("高级：覆盖服务客户端 ID");
    expect(container.textContent).not.toContain("health unknown");
    expect(container.textContent).not.toContain("上次探测");
    // Form header (breadcrumb + 「添加连接」 title) removed under tabs.
    expect(container.querySelector(".device-platform-admin__eyebrow")).toBeNull();
    expect(container.querySelector(".device-platform-admin__title")).toBeNull();
    // Credential ref is derived from stable ID, not user-editable.
    const credRef = container.querySelector(
      "[data-testid='device-platform-credential-ref']",
    ) as HTMLInputElement;
    expect(credRef.disabled).toBe(true);
    expect(
      container.querySelector("[data-testid='device-platform-credential-ref-hint']")?.textContent,
    ).toMatch(/自动生成|Auto-derived/);
    typeInto(container, "例如 本地 joint mock", "本地 joint mock");
    typeInto(container, "例如 plat-local", "plat-local");
    typeInto(container, "http://127.0.0.1:8791", "http://127.0.0.1:8791");
    const secret = container.querySelector(
      "[data-testid='device-platform-secret']",
    ) as HTMLInputElement;
    secret.value = SECRET;
    secret.dispatchEvent(new Event("input", { bubbles: true }));
    container
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      expect(save).toHaveBeenCalled();
    });
    expect(save.mock.calls[0]?.[0]).toBe("plat-local");
    expect(save.mock.calls[0]?.[1]).toMatchObject({
      displayName: "本地 joint mock",
      serviceBaseUrl: "http://127.0.0.1:8791",
      credentialRef: "cred://device-platform/plat-local",
      clientIdentity: "device-platform",
      serviceClientIds: ["device-platform"],
      contractVersion: "v1",
    });
    expect(setCredential).toHaveBeenCalledWith("plat-local", SECRET, false);
    expect(container.textContent).not.toContain(SECRET);
  });

  it("opens from platform system settings", async () => {
    setDevicePlatformAdminClientForTests({
      list: async () => [],
      save: vi.fn(),
      setCredential: vi.fn(),
      test: vi.fn(),
    });
    resetDevicePlatformConnectionPanelForTests();
    window.history.replaceState(
      {},
      "",
      "/platform/system-settings#platform-system-settings:device-platform",
    );
    const container = document.createElement("div");
    document.body.append(container);
    const appHost = document.createElement("openbot-app") as HTMLElement & {
      requestUpdate: () => void;
    };
    const props = {
      tab: "platformSystemSettings",
      basePath: "",
      readModel: { platformModelsMode: "native", shellSnapshotReady: false },
      channelsProps: { configFormDirty: false },
      actions: {},
    } as PlatformSurfaceProps;
    appHost.requestUpdate = () => render(renderPlatformSystemSettingsSurface(props), container);
    document.body.append(appHost);
    render(renderPlatformSystemSettingsSurface(props), container);
    expect(container.textContent).toContain("设备平台连接");
    await vi.waitFor(() => {
      expect(container.textContent).toContain("还没有设备平台连接");
    });
  });
});

function typeInto(container: HTMLElement, placeholder: string, value: string): void {
  const input = container.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement;
  expect(input).not.toBeNull();
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
