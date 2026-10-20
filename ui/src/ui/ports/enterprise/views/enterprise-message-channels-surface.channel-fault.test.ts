// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { ChannelsStatusSnapshot } from "../../../types.ts";
import { renderEnterpriseMessageChannelsSurface } from "./enterprise-message-channels-surface.ts";

describe("enterprise message channel card faults", () => {
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
});
