import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelPlugin } from "../../channels/plugins/types.js";
import type { OpenBotConfig } from "../../config/config.js";
import { createEmptyPluginRegistry } from "../../plugins/registry.js";
import { setActivePluginRegistry } from "../../plugins/runtime.js";
import {
  createChannelTestPluginBase,
  createTestRegistry,
} from "../../test-utils/channel-plugins.js";
import { normalizeTenantConfigStore, setTenantConfigOverride } from "../tenant-config.js";

// Platform default has a platform-owned telegram account; tenant-a overrides
// the telegram accounts with its own. The handler must surface ONLY the tenant's
// accounts when scoped to tenant-a (no platform-account leak).
const platformDefault = {
  channels: { telegram: { accounts: { "platform-acct": { botToken: "platform-token" } } } },
} as unknown as OpenBotConfig;

const tenantStore = setTenantConfigOverride(normalizeTenantConfigStore(null), "tenant-a", {
  channels: {
    telegram: {
      accounts: {
        // RFC 7396 null removes the platform default account from the tenant view.
        "platform-acct": null,
        "tenant-a-acct": { botToken: "tenant-a-token" },
      },
    },
  },
});

const writeTenantConfigViewMock = vi.fn(
  async (
    _params: unknown = undefined,
  ): Promise<{ ok: true; config: Record<string, never>; hash: string }> => ({
    ok: true as const,
    config: {},
    hash: "h1",
  }),
);

vi.mock("../../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => platformDefault,
    readConfigFileSnapshot: async () => ({ valid: true, config: platformDefault }),
  };
});

vi.mock("../enterprise-data/enterprise-data-seat-context.js", () => ({
  requireResolvedEnterpriseTenantId: vi.fn(async () => "tenant-a"),
}));

vi.mock("../tenant-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tenant-config.js")>();
  return {
    ...actual,
    loadTenantConfigStore: vi.fn(async () => tenantStore),
  };
});

vi.mock("../tenant-config-service.js", () => ({
  writeTenantConfigView: (params: unknown) => writeTenantConfigViewMock(params),
}));

function telegramAccountPlugin(): ChannelPlugin {
  const base = createChannelTestPluginBase({
    id: "telegram",
    label: "Telegram",
    config: {
      listAccountIds: (cfg: OpenBotConfig) => Object.keys(cfg.channels?.telegram?.accounts ?? {}),
      resolveAccount: (cfg: OpenBotConfig, accountId?: string | null) =>
        (accountId ? cfg.channels?.telegram?.accounts?.[accountId] : undefined) ?? {},
      isConfigured: async () => true,
    },
  });
  return {
    ...base,
    status: {
      buildChannelSummary: async () => ({ configured: true }),
    },
  } as ChannelPlugin;
}

function minimalContext() {
  return {
    getRuntimeSnapshot: () => ({ channels: {}, channelAccounts: {} }),
    stopChannel: vi.fn(),
    markChannelLoggedOut: vi.fn(),
  } as never;
}

describe("channels.status tenant scoping", () => {
  beforeEach(() => {
    writeTenantConfigViewMock.mockClear();
    writeTenantConfigViewMock.mockResolvedValue({
      ok: true as const,
      config: {},
      hash: "h1",
    });
  });

  afterEach(() => {
    setActivePluginRegistry(createEmptyPluginRegistry());
  });

  it("returns only the tenant's channel accounts (no platform-account leak)", async () => {
    setActivePluginRegistry(
      createTestRegistry([
        { pluginId: "telegram", source: "test", plugin: telegramAccountPlugin() },
      ]),
    );
    const { channelsHandlers } = await import("./channels.js");

    let payload: Record<string, unknown> | undefined;
    await channelsHandlers["channels.status"]({
      params: { tenantId: "tenant-a", probe: false },
      respond: (ok: boolean, body?: unknown) => {
        if (ok) {
          payload = body as Record<string, unknown>;
        }
      },
      context: minimalContext(),
      client: { connect: {} } as never,
    } as never);

    const accounts = (payload?.channelAccounts as Record<string, Array<{ accountId: string }>>)
      ?.telegram;
    const ids = (accounts ?? []).map((a) => a.accountId);
    expect(ids).toEqual(["tenant-a-acct"]);
    expect(ids).not.toContain("platform-acct");
  });

  it("clears tenant channel credentials without stopping global runtime", async () => {
    const { clearTenantChannelCredentials, channelsHandlers } = await import("./channels.js");

    const cleared = clearTenantChannelCredentials({
      cfg: {
        channels: {
          telegram: { accounts: { "tenant-a-acct": { botToken: "tenant-a-token" } } },
        },
      } as never,
      channelId: "telegram",
      accountId: "tenant-a-acct",
    });
    expect(cleared.cleared).toBe(true);
    expect(
      (cleared.next.channels?.telegram as { accounts?: Record<string, { botToken?: string }> })
        ?.accounts?.["tenant-a-acct"]?.botToken,
    ).toBeUndefined();

    const stopChannel = vi.fn();
    let payload: Record<string, unknown> | undefined;
    let ok = false;
    await channelsHandlers["channels.logout"]({
      params: { channel: "telegram", accountId: "tenant-a-acct", tenantId: "tenant-a" },
      respond: (success: boolean, body?: unknown) => {
        ok = success;
        payload = body as Record<string, unknown>;
      },
      context: {
        getRuntimeSnapshot: () => ({ channels: {}, channelAccounts: {} }),
        stopChannel,
        markChannelLoggedOut: vi.fn(),
      },
      client: { connect: {} } as never,
    } as never);

    expect(ok).toBe(true);
    expect(payload).toMatchObject({
      channel: "telegram",
      accountId: "tenant-a-acct",
      scope: "tenant",
      runtimeStopped: false,
      cleared: true,
    });
    expect(writeTenantConfigViewMock).toHaveBeenCalled();
    expect(stopChannel).not.toHaveBeenCalled();
  });
});
