// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { renderChannels } from "./channels.ts";
import type { ChannelsProps } from "./channels.types.ts";

function createProps(): ChannelsProps {
  return {
    connected: true,
    loading: false,
    snapshot: {
      ts: Date.now(),
      channelOrder: ["wecom"],
      channelLabels: { wecom: "WeCom" },
      channelAccounts: {
        wecom: [
          {
            accountId: "default",
            name: "Default enterprise",
            configured: false,
            running: false,
            connected: false,
          },
        ],
      },
      channelDefaultAccountId: { wecom: "default" },
      channels: {
        wecom: {
          configured: false,
          running: false,
          connected: false,
        },
      },
      channelMeta: [
        {
          id: "wecom",
          label: "WeCom",
          detailLabel: "WeCom app",
        },
      ],
    },
    lastError: null,
    lastSuccessAt: Date.now(),
    whatsappMessage: null,
    whatsappQrDataUrl: null,
    whatsappConnected: null,
    whatsappBusy: false,
    configSchema: {
      type: "object",
      properties: {
        channels: {
          type: "object",
          properties: {
            wecom: {
              type: "object",
              properties: {
                corpId: { type: "string" },
              },
            },
          },
        },
      },
    },
    configSchemaLoading: false,
    configForm: { channels: { wecom: {} } },
    configUiHints: {
      "channels.wecom.corpId": { label: "Corp ID" },
    },
    configSaving: false,
    configFormDirty: false,
    nostrProfileFormState: null,
    nostrProfileAccountId: null,
    onRefresh: vi.fn(),
    onWhatsAppStart: vi.fn(),
    onWhatsAppWait: vi.fn(),
    onWhatsAppLogout: vi.fn(),
    onConfigPatch: vi.fn(),
    onConfigSave: vi.fn(),
    onConfigReload: vi.fn(),
    onNostrProfileEdit: vi.fn(),
    onNostrProfileCancel: vi.fn(),
    onNostrProfileFieldChange: vi.fn(),
    onNostrProfileSave: vi.fn(),
    onNostrProfileImport: vi.fn(),
    onNostrProfileToggleAdvanced: vi.fn(),
  };
}

describe("renderChannels", () => {
  it("uses a full-width stack layout and localized WeCom content", async () => {
    const container = document.createElement("div");
    await i18n.setLocale("zh-CN");

    render(renderChannels(createProps()), container);

    const section = container.querySelector("section");
    expect(section?.className).toContain("stack");
    expect(section?.className).not.toContain("grid-cols-2");
    expect(container.textContent).toContain("企业微信接入");
    expect(container.textContent).toContain("Corp ID");

    await i18n.setLocale("en");
  });

  it("shows one channel fault on that card and a channels load error off the gateway banner", async () => {
    const container = document.createElement("div");
    const props = createProps();
    props.snapshot = {
      ...props.snapshot!,
      channelAccounts: {
        wecom: [
          {
            accountId: "default",
            name: "Default enterprise",
            configured: true,
            running: false,
            connected: false,
            lastError: "wecom channel stopped",
          },
        ],
      },
      channels: {
        wecom: {
          configured: true,
          running: false,
          connected: false,
          lastError: "wecom channel stopped",
        },
      },
    };
    props.lastError = "channels.status failed";

    render(renderChannels(props), container);

    const card = container.querySelector(".card");
    expect(card?.textContent).toContain("wecom channel stopped");
    expect(container.querySelector("[data-channel-load-error]")?.textContent).toBe(
      "channels.status failed",
    );
    expect(container.textContent).not.toContain("Disconnected from gateway");
    expect(container.textContent).not.toContain("Gateway unreachable");
    expect(container.textContent).not.toContain("已断开与网关的连接");
    expect(container.textContent).not.toContain("网关无法连接");
  });
});
