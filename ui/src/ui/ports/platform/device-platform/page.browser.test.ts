// @vitest-environment jsdom

import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    contractVersion: "v1-draft",
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

    setDevicePlatformAdminClientForTests({
      ...client,
      list: async () => {
        throw new DevicePlatformAdminRequestError(403, "forbidden");
      },
    });
    resetDevicePlatformConnectionPanelForTests();
    render(renderDevicePlatformConnectionPanel(), container);
    await vi.waitFor(() => {
      expect(container.textContent).toContain("仅平台管理员可以配置设备平台连接");
    });
    expect(container.querySelector("form")).toBeNull();

    setDevicePlatformAdminClientForTests({
      ...client,
      list: async () => {
        throw new DevicePlatformAdminRequestError(500, "boom");
      },
    });
    resetDevicePlatformConnectionPanelForTests();
    render(renderDevicePlatformConnectionPanel(), container);
    await vi.waitFor(() => {
      expect(container.textContent).toContain("读取设备平台连接失败");
    });
  });

  it("keeps the secret off the page and shows a partial probe without marking success", async () => {
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
    setDevicePlatformAdminClientForTests({
      list: async () => [],
      save: vi.fn(async () => saved),
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
      expect(container.querySelector("form")).not.toBeNull();
    });
    typeInto(container, "创建后不可修改", "plat-1");
    typeInto(container, "https://device.example", "https://device.example");
    typeInto(container, "cred://device-platform/...", "cred://device-platform/plat-1");
    typeInto(container, "逗号分隔", "device-platform");
    const secret = container.querySelector(
      "[data-testid='device-platform-secret']",
    ) as HTMLInputElement;
    secret.value = SECRET;
    secret.dispatchEvent(new Event("input", { bubbles: true }));
    container
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      expect(setCredential).toHaveBeenCalledWith("plat-1", SECRET, false);
    });
    expect(container.textContent).not.toContain(SECRET);
    expect(
      (container.querySelector("[data-testid='device-platform-secret']") as HTMLInputElement).value,
    ).toBe("");

    const testButton = container.querySelector(
      "[data-testid='device-platform-test']",
    ) as HTMLButtonElement;
    testButton.click();
    await vi.waitFor(() => {
      expect(container.textContent).toContain("没有标记为健康");
    });
    expect(container.textContent).toContain("停用后立即拒绝新的授权和执行");
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
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
