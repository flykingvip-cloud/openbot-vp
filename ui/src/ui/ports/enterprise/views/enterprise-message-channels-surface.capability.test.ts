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
    expect(container.querySelector(".enterprise-im-workspace__columns")).not.toBeNull();
    const groupRead = container.querySelector("[data-capability='projectGroupRead']");
    expect(groupRead?.getAttribute("data-status")).toBe("granted");
    expect(groupRead?.textContent).toContain("群消息读取");
    expect(groupRead?.textContent).toContain("已开通");
    const docs = container.querySelector("[data-capability='projectDocs']");
    expect(docs?.getAttribute("data-status")).toBe("missing");
    expect(docs?.textContent).toContain("未开通");
    expect(container.querySelector("[data-feishu-enterprise-id]")?.textContent).toContain(
      "平台企业 ID",
    );
    const sync = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("同步为运营身份"),
    );
    expect(sync?.classList.contains("btn--primary")).toBe(false);
    expect(container.textContent).not.toContain("未探测");
    expect(container.textContent).not.toContain("凭证与基础信息");
    expect(container.textContent).not.toContain("长连接无需公网回调");
    expect(container.textContent).not.toContain("当前为长连接模式（推荐）");
    const help = container.querySelector("[data-testid='enterprise-im-setup-guide']");
    expect(help?.tagName).toBe("DETAILS");
    expect((help as HTMLDetailsElement).open).toBe(false);
    const troubleshoot = container.querySelector("[data-testid='enterprise-im-troubleshoot']");
    expect(troubleshoot?.tagName).toBe("DETAILS");
    expect((troubleshoot as HTMLDetailsElement).open).toBe(false);
    expect(troubleshoot?.textContent).toContain("建议顺序");
    expect(container.querySelectorAll(".enterprise-im-status__cap")).toHaveLength(4);
    expect(
      container.querySelector(".enterprise-im-workspace__side .enterprise-channel-workspace__hint"),
    ).toBeNull();
    expect(container.querySelector("a[href*='feishu-install']")).toBeNull();
  });
});
