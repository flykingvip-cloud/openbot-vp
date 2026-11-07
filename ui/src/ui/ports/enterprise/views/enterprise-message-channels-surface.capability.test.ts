// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { ChannelsStatusSnapshot } from "../../../types.ts";
import { renderEnterpriseMessageChannelsSurface } from "./enterprise-message-channels-surface.ts";

describe("enterprise Feishu channel capability (slice 1a)", () => {
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

  it("shows Feishu app capability on the existing channel cards", async () => {
    const snapshot = {
      channelOrder: ["feishu"],
      channelAccounts: {
        feishu: [
          {
            accountId: "t_tenant_a_default",
            enabled: true,
            platformEnterpriseId: "tenant-key-1",
            enterpriseImEmployeeUiHint: "waiting_admin_scopes",
            enterpriseImChildExecutionBlocked: false,
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
        return { schema: { type: "object" }, uiHints: {} };
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
      expect(container.textContent).toContain("等待管理员开通权限");
    });
    const feishuCard = Array.from(
      container.querySelectorAll(".enterprise-channel-gallery__card"),
    ).find((card) => card.textContent?.includes("飞书"));
    (feishuCard as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(container.querySelector("[data-feishu-enterprise-contract]")?.textContent).toContain(
        "tenant-key-1",
      );
    });
    expect(container.textContent).toContain("不是员工授权");
    expect(container.textContent).toContain("群消息读取 granted");
    expect(container.querySelector("a[href*='feishu-install']")).toBeNull();
  });
});
