import { describe, expect, it, vi } from "vitest";
import {
  loadTenantConfig,
  patchTenantConfigValue,
  saveTenantConfig,
  ensureImAccountWebhookPaths,
  type TenantChannelConfigState,
} from "./tenant-channel-config.ts";

type Call = { method: string; params: Record<string, unknown> };

function fakeClient(handler: (call: Call) => unknown) {
  const calls: Call[] = [];
  const client = {
    request: vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      return handler({ method, params });
    }),
  };
  return { client, calls };
}

function baseState(client: unknown): TenantChannelConfigState {
  return {
    client: client as TenantChannelConfigState["client"],
    connected: true,
    tenantConfigTenantId: null,
    tenantConfigForm: null,
    tenantConfigBaseHash: null,
    tenantConfigLoading: false,
    tenantConfigSaving: false,
    tenantConfigDirty: false,
    tenantConfigError: null,
  };
}

describe("tenant-channel-config controller", () => {
  it("threads tenantId into config.get and stores config + hash", async () => {
    const { client, calls } = fakeClient(() => ({
      config: { channels: { telegram: { accounts: [{ id: "a" }] } } },
      hash: "h1",
      tenantId: "tenant-a",
    }));
    const state = baseState(client);
    await loadTenantConfig(state, "tenant-a");

    expect(calls[0]).toEqual({ method: "config.get", params: { tenantId: "tenant-a" } });
    expect(state.tenantConfigTenantId).toBe("tenant-a");
    expect(state.tenantConfigBaseHash).toBe("h1");
    expect(state.tenantConfigForm).toEqual({
      channels: { telegram: { accounts: [{ id: "a" }] } },
    });
    expect(state.tenantConfigDirty).toBe(false);
  });

  it("patches a value by path and marks dirty without mutating other keys", async () => {
    const state = baseState(null);
    state.tenantConfigForm = { channels: { telegram: { accounts: [{ id: "a" }] } } };
    patchTenantConfigValue(state, ["channels", "telegram", "accounts", 0, "token"], "tok");
    expect(state.tenantConfigDirty).toBe(true);
    expect(state.tenantConfigForm).toEqual({
      channels: { telegram: { accounts: [{ id: "a", token: "tok" }] } },
    });
  });

  it("threads tenantId + baseHash into config.set and reloads", async () => {
    const { client, calls } = fakeClient((call) => {
      if (call.method === "config.set") {
        return { ok: true, tenantId: "tenant-a", config: {}, hash: "h2" };
      }
      return { config: { models: {} }, hash: "h2", tenantId: "tenant-a" };
    });
    const state = baseState(client);
    state.tenantConfigForm = { channels: { telegram: {} } };
    state.tenantConfigBaseHash = "h1";

    await saveTenantConfig(state, "tenant-a");

    const setCall = calls.find((c) => c.method === "config.set");
    expect(setCall?.params.tenantId).toBe("tenant-a");
    expect(setCall?.params.baseHash).toBe("h1");
    expect(typeof setCall?.params.raw).toBe("string");
    // reloaded afterwards
    expect(calls.some((c) => c.method === "config.get")).toBe(true);
    expect(state.tenantConfigDirty).toBe(false);
    expect(state.tenantConfigBaseHash).toBe("h2");
  });

  it("refuses to save without a base hash (optimistic concurrency guard)", async () => {
    const { client, calls } = fakeClient(() => ({}));
    const state = baseState(client);
    state.tenantConfigForm = { channels: {} };
    state.tenantConfigBaseHash = null;

    await saveTenantConfig(state, "tenant-a");
    expect(calls.some((c) => c.method === "config.set")).toBe(false);
    expect(state.tenantConfigError).toBeTruthy();
  });

  it("refuses to save incomplete WeCom credentials when validating that channel", async () => {
    const { client, calls } = fakeClient(() => ({}));
    const state = baseState(client);
    state.tenantConfigBaseHash = "h1";
    state.tenantConfigForm = {
      channels: {
        wecom: {
          accounts: {
            default: { corpId: "ww", secret: "s" },
          },
        },
      },
    };

    const ok = await saveTenantConfig(state, "tenant-a", { validateChannelId: "wecom" });
    expect(ok).toBe(false);
    expect(calls.some((c) => c.method === "config.set")).toBe(false);
    expect(state.tenantConfigError).toMatch(/保存未通过/);
    expect(state.tenantConfigError).toMatch(/agentId|token/);
  });
});

describe("ensureImAccountWebhookPaths", () => {
  it("fills default account-scoped paths for wecom/feishu/dingtalk", () => {
    const next = ensureImAccountWebhookPaths({
      channels: {
        wecom: {
          enabled: true,
          accounts: {
            t_acme_default: { corpId: "ww1", secret: "s" },
          },
        },
        feishu: {
          accounts: {
            t_acme_fs: { appId: "cli_x" },
          },
        },
      },
    });
    const channels = next.channels as Record<
      string,
      Record<string, Record<string, Record<string, string>>>
    >;
    expect(channels.wecom.accounts.t_acme_default.webhookPath).toBe("/wecom/a/t_acme_default");
    expect(channels.feishu.accounts.t_acme_fs.webhookPath).toBe("/feishu/a/t_acme_fs");
  });

  it("does not overwrite explicit webhookPath", () => {
    const next = ensureImAccountWebhookPaths({
      channels: {
        wecom: {
          accounts: {
            t_x: { webhookPath: "/custom" },
          },
        },
      },
    });
    const channels = next.channels as Record<
      string,
      Record<string, Record<string, Record<string, string>>>
    >;
    expect(channels.wecom.accounts.t_x.webhookPath).toBe("/custom");
  });

  it("rewrites legacy shared /wecom paths to account-scoped paths", () => {
    const next = ensureImAccountWebhookPaths({
      channels: {
        wecom: {
          accounts: {
            t_001_default: { webhookPath: "/wecom" },
            default: { webhookPath: "/wecom" },
          },
        },
      },
    });
    const accounts = (
      next.channels as Record<string, Record<string, Record<string, Record<string, string>>>>
    ).wecom.accounts;
    expect(accounts.t_001_default.webhookPath).toBe("/wecom/a/t_001_default");
    expect(accounts.default.webhookPath).toBe("/wecom/a/default");
  });
});
