/* @vitest-environment jsdom */

import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelsStatusSnapshot } from "../../../types.ts";
import { renderEnterpriseMessageChannelsSurface } from "./enterprise-message-channels-surface.ts";

// Global fake timers without a real-time drain freeze the Vitest browser bridge
// (Playwright waits on the original clock). Limit the fake set and keep time moving.
const browserSafeFakeTimers = {
  shouldAdvanceTime: true,
  toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
} as const;

afterEach(() => {
  vi.useRealTimers();
});

function createSchema() {
  return {
    schema: {
      type: "object",
      properties: {
        channels: {
          type: "object",
          properties: {
            feishu: {
              type: "object",
              properties: { appId: { type: "string" }, appSecret: { type: "string" } },
            },
            dingtalk: {
              type: "object",
              properties: { clientId: { type: "string" }, clientSecret: { type: "string" } },
            },
            wecom: {
              type: "object",
              properties: {
                corpId: { type: "string" },
                agentId: { type: "string" },
                secret: { type: "string" },
                token: { type: "string" },
                encodingAesKey: { type: "string" },
              },
            },
          },
        },
      },
    },
    uiHints: {},
  };
}

async function waitLoaded(container: HTMLElement) {
  await vi.waitFor(() => {
    expect(container.querySelectorAll(".enterprise-channel-gallery__card")).toHaveLength(3);
    expect(container.textContent).not.toContain("加载中…");
    expect(container.textContent).not.toContain("刷新中…");
  });
}

describe("enterprise message channels surface (card gallery)", () => {
  it("renders three gallery cards without dropdown add controls", async () => {
    const snapshot = {
      channelOrder: ["telegram", "feishu", "dingtalk", "wecom", "slack"],
      channelAccounts: {
        telegram: [{ accountId: "telegram-default", enabled: true }],
        feishu: [{ accountId: "feishu-default", enabled: true }],
        dingtalk: [{ accountId: "dingtalk-default", enabled: true }],
        wecom: [{ accountId: "wecom-default", enabled: true }],
        slack: [{ accountId: "slack-default", enabled: true }],
      },
    } as unknown as ChannelsStatusSnapshot;
    const config = {
      channels: {
        wecom: {
          enabled: true,
          corpId: "ww",
          agentId: "100",
          secret: "s",
          token: "t",
          encodingAesKey: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
        },
        feishu: { enabled: true, appId: "cli_a", appSecret: "sec" },
      },
    };
    const request = vi.fn(async (method: string) => {
      if (method === "channels.status") {
        return snapshot;
      }
      if (method === "config.get") {
        return { raw: `${JSON.stringify(config, null, 2)}\n`, hash: "hash-1" };
      }
      if (method === "config.schema") {
        return createSchema();
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const client = { request };
    const host = {};
    const container = document.createElement("div");
    const renderSurface = () => {
      render(
        renderEnterpriseMessageChannelsSurface({
          host,
          props: { client: client as never, tenantId: "tenant-a" },
          requestUpdate: renderSurface,
        }),
        container,
      );
    };

    renderSurface();
    await waitLoaded(container);

    expect(container.querySelector(".enterprise-settings-section__title")).toBeNull();
    expect(container.querySelector(".enterprise-settings-section__subtitle")).toBeNull();
    expect(container.textContent).toContain("企业微信");
    expect(container.textContent).toContain("飞书");
    expect(container.textContent).toContain("钉钉");
    expect(container.textContent).not.toContain("telegram");
    expect(container.textContent).not.toContain("slack");
    expect(container.querySelector("select")).toBeNull();
    expect(
      Array.from(container.querySelectorAll("button")).some((button) =>
        button.textContent?.includes("添加通道"),
      ),
    ).toBe(false);
    expect(container.textContent).toContain("选择一个通道开始配置");
    expect(container.textContent).toContain("未添加");
    expect(container.textContent).toContain("已保存");
  });

  it("opens workspace from card click without persisting an empty entry", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "channels.status") {
        return {
          channelOrder: ["feishu", "dingtalk", "wecom"],
          channelAccounts: {},
        } as unknown as ChannelsStatusSnapshot;
      }
      if (method === "config.get") {
        return { config: { channels: {} }, hash: "hash-1" };
      }
      if (method === "config.schema") {
        return createSchema();
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const client = { request };
    const host = {};
    const container = document.createElement("div");
    const renderSurface = () => {
      render(
        renderEnterpriseMessageChannelsSurface({
          host,
          props: { client: client as never, tenantId: "tenant-a" },
          requestUpdate: renderSurface,
        }),
        container,
      );
    };

    renderSurface();
    await waitLoaded(container);

    const dingtalkCard = Array.from(
      container.querySelectorAll(".enterprise-channel-gallery__card"),
    ).find((card) => card.textContent?.includes("钉钉"));
    expect(dingtalkCard).toBeDefined();
    (dingtalkCard as HTMLButtonElement).click();

    await vi.waitFor(() => expect(container.textContent).toContain("配置 · 钉钉"));
    expect(request.mock.calls.some(([method]) => method === "config.set")).toBe(false);
    expect(container.textContent).toContain("待完善");
    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="enterprise-im-curated-form"]')).not.toBeNull(),
    );
    expect(container.textContent).toContain("接入配置");
    expect(container.textContent).toContain("Stream 长连接");
    expect(container.textContent).toContain("长连接模式");
    expect(container.textContent).toContain("钉钉配置指南");
    expect(container.textContent).not.toContain("开放平台检查");
    expect(container.textContent).not.toContain("本页配置");
    expect(container.textContent).not.toContain("Callback URL（回填到开放平台）");
    expect(container.textContent).not.toContain("企业账户");
    expect(container.textContent).not.toContain("Webhook 路径");
    expect(container.querySelector('[data-testid="enterprise-im-connection-mode"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="enterprise-im-setup-guide"]')).not.toBeNull();
    const helpLink = container.querySelector<HTMLAnchorElement>(
      '[data-testid="enterprise-im-help-link"]',
    );
    expect(helpLink?.getAttribute("href")).toBe("/help/dingtalk");
  });

  it("shows Callback URL only after switching feishu to webhook mode", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "channels.status") {
        return {
          channelOrder: ["feishu", "dingtalk", "wecom"],
          channelAccounts: {},
        } as unknown as ChannelsStatusSnapshot;
      }
      if (method === "config.get") {
        return { config: { channels: {} }, hash: "hash-1" };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const client = { request };
    const host = {};
    const container = document.createElement("div");
    const renderSurface = () => {
      render(
        renderEnterpriseMessageChannelsSurface({
          host,
          props: { client: client as never, tenantId: "tenant-a" },
          requestUpdate: renderSurface,
        }),
        container,
      );
    };

    renderSurface();
    await waitLoaded(container);
    const feishuCard = Array.from(
      container.querySelectorAll(".enterprise-channel-gallery__card"),
    ).find((card) => card.textContent?.includes("飞书"));
    (feishuCard as HTMLButtonElement).click();

    await vi.waitFor(() =>
      expect(
        container.querySelector('[data-testid="enterprise-im-connection-mode"]'),
      ).not.toBeNull(),
    );
    expect(container.textContent).toContain("WebSocket 长连接");
    expect(container.textContent).not.toContain("Callback URL（回填到开放平台）");
    expect(container.textContent).not.toContain("Verification Token");

    const modeSelect = container.querySelector(
      '[data-testid="enterprise-im-connection-mode"]',
    ) as HTMLSelectElement;
    modeSelect.value = "webhook";
    modeSelect.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Callback URL（回填到开放平台）");
      expect(container.textContent).toContain("Verification Token");
      expect(container.textContent).toContain("Encrypt Key");
    });
  });

  it("gates incomplete save and persists when credentials are complete", async () => {
    const request = vi.fn(async (method: string, params: unknown) => {
      if (method === "channels.status") {
        return {
          channelOrder: ["feishu", "dingtalk", "wecom"],
          channelAccounts: {},
        } as unknown as ChannelsStatusSnapshot;
      }
      if (method === "config.get") {
        return { config: { channels: {} }, hash: "hash-1" };
      }
      if (method === "config.schema") {
        return createSchema();
      }
      if (method === "config.set") {
        return { hash: "hash-2", params };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const client = { request };
    const host = {};
    const container = document.createElement("div");
    const renderSurface = () => {
      render(
        renderEnterpriseMessageChannelsSurface({
          host,
          props: { client: client as never, tenantId: "tenant-a" },
          requestUpdate: renderSurface,
        }),
        container,
      );
    };

    renderSurface();
    await waitLoaded(container);
    const feishuCard = Array.from(
      container.querySelectorAll(".enterprise-channel-gallery__card"),
    ).find((card) => card.textContent?.includes("飞书"));
    (feishuCard as HTMLButtonElement).click();

    await vi.waitFor(() => expect(container.querySelector("input")).not.toBeNull());

    // Force incomplete save via direct busy path: open workspace then save with only skeleton.
    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "保存",
    );
    expect(saveButton?.disabled).toBe(true);

    const inputs = Array.from(container.querySelectorAll("input"));
    for (const input of inputs) {
      const label = input.getAttribute("name") ?? input.id ?? "";
      if (/secret/i.test(label) || input.type === "password") {
        input.value = "secret_value";
      } else {
        input.value = "cli_test_app_id";
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    await vi.waitFor(() => {
      const btn = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === "保存",
      );
      expect(btn?.disabled).toBe(false);
    });

    // Clear one field to force gate
    const appIdInput = inputs[0];
    if (appIdInput) {
      appIdInput.value = "";
      appIdInput.dispatchEvent(new Event("input", { bubbles: true }));
      appIdInput.dispatchEvent(new Event("change", { bubbles: true }));
    }

    const saveIncomplete = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "保存",
    );
    // If form still dirty with empty required, attempt save
    if (saveIncomplete && !saveIncomplete.disabled) {
      saveIncomplete.click();
      await vi.waitFor(() => expect(container.textContent).toContain("保存未通过"));
      expect(request.mock.calls.some(([method]) => method === "config.set")).toBe(false);
    }

    for (const input of Array.from(container.querySelectorAll("input"))) {
      const label = input.getAttribute("name") ?? input.id ?? "";
      if (/secret/i.test(label) || input.type === "password") {
        input.value = "secret_value";
      } else {
        input.value = "cli_test_app_id";
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    const saveAgain = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "保存",
    );
    expect(saveAgain?.disabled).toBe(false);
    saveAgain?.click();

    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        "config.set",
        expect.objectContaining({ tenantId: "tenant-a", baseHash: "hash-1" }),
      );
      expect(container.textContent).toContain("操作成功");
    });
  });

  it("shows test_failed badge only after explicit probe", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "channels.status") {
        return {
          channelOrder: ["wecom"],
          channelAccounts: {
            wecom: [
              {
                accountId: "default",
                enabled: true,
                configured: false,
                lastError: "WeCom missing required fields: corpId.",
              },
            ],
          },
        } as unknown as ChannelsStatusSnapshot;
      }
      if (method === "config.get") {
        return {
          config: {
            channels: {
              wecom: {
                enabled: true,
                corpId: "ww",
                agentId: "1",
                secret: "s",
                token: "t",
                encodingAesKey: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
              },
            },
          },
          hash: "hash-1",
        };
      }
      if (method === "config.schema") {
        return createSchema();
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const client = { request };
    const host = {};
    const container = document.createElement("div");
    const renderSurface = () => {
      render(
        renderEnterpriseMessageChannelsSurface({
          host,
          props: { client: client as never, tenantId: "tenant-a" },
          requestUpdate: renderSurface,
        }),
        container,
      );
    };

    renderSurface();
    await waitLoaded(container);
    expect(container.textContent).not.toContain("测试未通过");

    const wecomCard = Array.from(
      container.querySelectorAll(".enterprise-channel-gallery__card"),
    ).find((card) => card.textContent?.includes("企业微信"));
    (wecomCard as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.textContent).toContain("配置 · 企业微信"));
    // Legacy corp-app config without connectionMode stays on URL callback.
    expect(container.textContent).toContain("URL 回调");
    expect(container.textContent).toContain("企业 Corp ID");

    const probeButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="enterprise-channel-probe"]',
    );
    expect(probeButton).not.toBeNull();
    expect(probeButton?.disabled).toBe(false);
    const statusCallsBefore = request.mock.calls.filter(
      ([method]) => method === "channels.status",
    ).length;
    probeButton?.click();

    await vi.waitFor(() => {
      const statusCalls = request.mock.calls.filter(([method]) => method === "channels.status");
      expect(statusCalls.length).toBeGreaterThan(statusCallsBefore);
      expect(container.textContent).toContain("测试未通过");
    });
  });

  it("shows a stopped channel on that card only", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "channels.status") {
        return {
          channelOrder: ["wecom", "feishu"],
          channels: {
            wecom: { configured: true, running: false, lastError: "wecom channel stopped" },
            feishu: { configured: true, running: true, connected: true },
          },
          channelAccounts: {
            wecom: [
              {
                accountId: "default",
                enabled: true,
                configured: true,
                running: false,
                lastError: "wecom channel stopped",
              },
            ],
            feishu: [
              {
                accountId: "default",
                enabled: true,
                configured: true,
                running: true,
                connected: true,
              },
            ],
          },
        } as unknown as ChannelsStatusSnapshot;
      }
      if (method === "config.get") {
        return {
          config: {
            channels: {
              wecom: {
                enabled: true,
                corpId: "ww",
                agentId: "1",
                secret: "s",
                token: "t",
                encodingAesKey: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
              },
              feishu: { enabled: true, appId: "cli", appSecret: "sec" },
            },
          },
          hash: "hash-1",
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const host = {};
    const client = { request };
    const container = document.createElement("div");
    const renderSurface = () => {
      render(
        renderEnterpriseMessageChannelsSurface({
          host,
          props: { client: client as never, tenantId: "tenant-a" },
          requestUpdate: renderSurface,
        }),
        container,
      );
    };

    renderSurface();
    await vi.waitFor(() => expect(container.textContent).toContain("wecom channel stopped"));

    const cards = Array.from(container.querySelectorAll(".enterprise-channel-gallery__card"));
    const wecomCard = cards.find((card) => card.textContent?.includes("企业微信"));
    const feishuCard = cards.find((card) => card.textContent?.includes("飞书"));
    expect(wecomCard?.querySelector("[data-channel-fault]")?.textContent).toBe(
      "wecom channel stopped",
    );
    expect(feishuCard?.querySelector("[data-channel-fault]")).toBeNull();
    expect(container.querySelector(".enterprise-channel-workspace__result--danger")).toBeNull();
    expect(container.textContent).not.toContain("测试未通过");
    expect(container.textContent).not.toContain("已断开与网关的连接");
    expect(container.textContent).not.toContain("网关无法连接");
    expect(container.textContent).not.toContain("Gateway unreachable");
  });

  it("releases the loading state when the gateway does not respond", async () => {
    vi.useFakeTimers({
      shouldAdvanceTime: browserSafeFakeTimers.shouldAdvanceTime,
      toFake: [...browserSafeFakeTimers.toFake],
    });
    try {
      const client = { request: vi.fn(() => new Promise(() => undefined)) };
      const host = {};
      const container = document.createElement("div");
      const renderSurface = () => {
        render(
          renderEnterpriseMessageChannelsSurface({
            host,
            props: { client: client as never, tenantId: "tenant-a" },
            requestUpdate: renderSurface,
          }),
          container,
        );
      };

      renderSurface();
      expect(
        container.querySelectorAll(".enterprise-channel-gallery__card.is-skeleton"),
      ).toHaveLength(3);
      await vi.advanceTimersByTimeAsync(10_500);
      await Promise.resolve();
      await Promise.resolve();

      expect(container.textContent).toContain("channels.status 请求超时");
      const refreshButton = Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("刷新"),
      );
      expect(refreshButton?.disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("labels refresh as a reload and asks before disabling a channel", async () => {
    const config = {
      channels: {
        wecom: {
          enabled: true,
          corpId: "ww",
          agentId: "100",
          secret: "s",
          token: "t",
          encodingAesKey: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
        },
      },
    };
    const request = vi.fn(async (method: string) => {
      if (method === "channels.status") {
        return {
          channelOrder: ["wecom"],
          channelAccounts: { wecom: [{ accountId: "default", enabled: true, configured: true }] },
        } as unknown as ChannelsStatusSnapshot;
      }
      if (method === "config.get") {
        return { raw: `${JSON.stringify(config, null, 2)}\n`, hash: "hash-1" };
      }
      if (method === "config.schema") {
        return createSchema();
      }
      if (method === "config.set") {
        return { hash: "hash-2" };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const client = { request };
    const host = {};
    const container = document.createElement("div");
    const renderSurface = () => {
      render(
        renderEnterpriseMessageChannelsSurface({
          host,
          props: { client: client as never, tenantId: "tenant-a" },
          requestUpdate: renderSurface,
        }),
        container,
      );
    };

    renderSurface();
    await waitLoaded(container);
    const wecomBefore = Array.from(
      container.querySelectorAll(".enterprise-channel-gallery__card"),
    ).find((card) => card.textContent?.includes("企业微信"));
    expect(wecomBefore?.textContent ?? "").toContain("已保存");
    expect(wecomBefore?.querySelector(".enterprise-im-switcher__dot")).not.toBeNull();
    expect(wecomBefore?.querySelector(".enterprise-im-switcher__mark--wecom")).not.toBeNull();

    const refreshButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("刷新"),
    );
    refreshButton?.click();
    await vi.waitFor(() => expect(container.textContent).toContain("已刷新"));
    expect(container.textContent).not.toContain("操作成功");

    const wecomCard = Array.from(
      container.querySelectorAll(".enterprise-channel-gallery__card"),
    ).find((card) => card.textContent?.includes("企业微信"));
    (wecomCard as HTMLButtonElement | undefined)?.click();
    await vi.waitFor(() => expect(container.textContent).toContain("停用"));

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const disableButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "停用",
    );
    disableButton?.click();
    expect(confirmSpy).toHaveBeenCalled();
    expect(request.mock.calls.some(([method]) => method === "config.set")).toBe(false);
    confirmSpy.mockRestore();
  });

  it("clears saved tenant credentials through channels.logout and refuses a non-tenant result", async () => {
    let logoutResult: Record<string, unknown> = {
      cleared: true,
      scope: "tenant",
      runtimeStopped: false,
    };
    const request = vi.fn(async (method: string) => {
      if (method === "channels.status") {
        return {
          channelOrder: ["feishu"],
          channelAccounts: {},
        } as unknown as ChannelsStatusSnapshot;
      }
      if (method === "config.get") {
        return {
          config: {
            channels: {
              feishu: {
                enabled: true,
                accounts: { default: { appId: "cli_test", appSecret: "secret" } },
              },
            },
          },
          hash: "hash-1",
        };
      }
      if (method === "config.schema") {
        return createSchema();
      }
      if (method === "channels.logout") {
        return logoutResult;
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const client = { request };
    const host = {};
    const container = document.createElement("div");
    const renderSurface = () => {
      render(
        renderEnterpriseMessageChannelsSurface({
          host,
          props: { client: client as never, tenantId: "tenant-a" },
          requestUpdate: renderSurface,
        }),
        container,
      );
    };

    renderSurface();
    await waitLoaded(container);
    const feishuCard = Array.from(
      container.querySelectorAll(".enterprise-channel-gallery__card"),
    ).find((card) => card.textContent?.includes("飞书"));
    (feishuCard as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(container.querySelector("[data-testid='enterprise-channel-logout']")).not.toBeNull(),
    );

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const logoutButton = () =>
      container.querySelector<HTMLButtonElement>("[data-testid='enterprise-channel-logout']");
    logoutButton()?.click();
    expect(confirmSpy).toHaveBeenCalled();
    expect(request.mock.calls.some(([method]) => method === "channels.logout")).toBe(false);

    confirmSpy.mockReturnValue(true);
    logoutButton()?.click();
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        "channels.logout",
        expect.objectContaining({
          channel: "feishu",
          tenantId: "tenant-a",
          accountId: "default",
        }),
      );
      expect(container.textContent).toContain("全局通道运行时未停止");
    });
    expect(container.textContent).not.toContain("已断开");
    expect(container.textContent).not.toContain("操作成功");

    logoutResult = { cleared: true, scope: "global", runtimeStopped: true };
    logoutButton()?.click();
    await vi.waitFor(() => {
      expect(container.textContent).toContain("清除结果不是企业凭证范围");
    });
    expect(container.textContent).not.toContain("全局通道运行时未停止");
    confirmSpy.mockRestore();
  });

  it("clears the loading skeleton when channel status fails", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "channels.status") {
        throw new Error("status down");
      }
      if (method === "config.get") {
        return { raw: "{}\n", hash: "hash-1" };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const host = {};
    const client = { request };
    const container = document.createElement("div");
    const renderSurface = () => {
      render(
        renderEnterpriseMessageChannelsSurface({
          host,
          props: { client: client as never, tenantId: "tenant-a" },
          requestUpdate: renderSurface,
        }),
        container,
      );
    };
    renderSurface();
    await vi.waitFor(() => {
      expect(container.textContent).not.toContain("加载中…");
      expect(container.textContent).toContain("status down");
    });
    expect(
      container.querySelectorAll(".enterprise-channel-gallery__card.is-skeleton"),
    ).toHaveLength(0);
  });

  it("shows Feishu app capability status without a new install route", async () => {
    const snapshot = {
      channelOrder: ["feishu"],
      channelAccounts: {
        feishu: [
          {
            accountId: "t_tenant_a_default",
            enabled: true,
            platformEnterpriseId: "tenant-key-1",
            enterpriseImEmployeeUiHint: "waiting_admin_scopes",
            enterpriseImCapability: {
              checkedAt: "2026-11-07T00:00:00.000Z",
              projectGroupRead: "granted",
              projectDocs: "missing",
              sendAsUser: "missing",
              newMessageTrigger: "missing",
            },
          },
        ],
      },
    } as unknown as ChannelsStatusSnapshot;
    const config = {
      channels: {
        feishu: {
          enabled: true,
          accounts: {
            t_tenant_a_default: {
              appId: "cli_a",
              appSecret: "sec",
              platformEnterpriseId: "tenant-key-1",
              capabilityStatus: {
                checkedAt: "2026-11-07T00:00:00.000Z",
                projectGroupRead: "granted",
                projectDocs: "missing",
                sendAsUser: "missing",
                newMessageTrigger: "missing",
              },
            },
          },
        },
      },
    };
    const request = vi.fn(async (method: string) => {
      if (method === "channels.status") {
        return snapshot;
      }
      if (method === "config.get") {
        return { raw: `${JSON.stringify(config, null, 2)}\n`, hash: "hash-1" };
      }
      if (method === "config.schema") {
        return createSchema();
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const host = {};
    const client = { request };
    const container = document.createElement("div");
    const renderSurface = () => {
      render(
        renderEnterpriseMessageChannelsSurface({
          host,
          props: { client: client as never, tenantId: "tenant-a" },
          requestUpdate: renderSurface,
        }),
        container,
      );
    };
    renderSurface();
    await waitLoaded(container);
    expect(container.textContent).not.toContain("应用权限可尝试");
    const feishuCard = Array.from(
      container.querySelectorAll(".enterprise-channel-gallery__card"),
    ).find((card) => card.textContent?.includes("飞书"));
    expect(feishuCard?.querySelector(".enterprise-channel-gallery__cta")).toBeNull();
    (feishuCard as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(container.querySelector("[data-feishu-enterprise-contract]")?.textContent).toContain(
        "tenant-key-1",
      );
    });
    expect(container.textContent).toContain("等待管理员开通权限");
    expect(container.textContent).toContain("不是员工授权");
    expect(container.querySelector("[data-capability='projectGroupRead']")?.textContent).toContain(
      "已开通",
    );
    expect(container.querySelector("a[href*='feishu-install']")).toBeNull();
    expect(container.querySelector("a[href*='workplace']")).toBeNull();
  });
});
