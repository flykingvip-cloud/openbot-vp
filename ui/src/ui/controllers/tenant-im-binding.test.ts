import { describe, expect, it, vi } from "vitest";
import {
  defaultImWebhookPath,
  describeTenantImCredentialGaps,
  hasTenantImChannelCredentials,
  localizeTenantImProbeError,
  probeTenantImChannel,
  resolveTenantImCallbackEntries,
  resolveTenantImPendingHint,
  summarizeTenantImProbeFromSnapshot,
  type TenantImBindingProbeState,
} from "./tenant-im-binding.ts";

describe("tenant-im-binding helpers", () => {
  it("builds default account-scoped webhook paths", () => {
    expect(defaultImWebhookPath("wecom", "t_acme")).toBe("/wecom/a/t_acme");
    expect(defaultImWebhookPath("feishu", "bot-1")).toBe("/feishu/a/bot-1");
    expect(defaultImWebhookPath("dingtalk", "a b")).toBe("/dingtalk/a/a%20b");
  });

  it("derives callback URLs from webhookPath + public base", () => {
    const entries = resolveTenantImCallbackEntries({
      form: {
        channels: {
          feishu: {
            accounts: {
              default: { appId: "cli_x", appSecret: "s", webhookPath: "/feishu/a/default" },
            },
          },
        },
      },
      channelId: "feishu",
      publicBaseUrl: "https://biz.openbot.love",
    });
    expect(entries).toEqual([
      {
        accountId: "default",
        path: "/feishu/a/default",
        url: "https://biz.openbot.love/feishu/a/default",
        copyText: "https://biz.openbot.love/feishu/a/default",
      },
    ]);
  });

  it("prefers explicit account webhookUrl when present", () => {
    const entries = resolveTenantImCallbackEntries({
      form: {
        channels: {
          wecom: {
            accounts: {
              main: {
                corpId: "ww",
                secret: "s",
                webhookPath: "/wecom/a/main",
                webhookUrl: "https://hooks.example.com/custom",
              },
            },
          },
        },
      },
      channelId: "wecom",
      publicBaseUrl: "https://biz.openbot.love",
    });
    expect(entries[0]?.url).toBe("https://hooks.example.com/custom");
    expect(entries[0]?.copyText).toBe("https://hooks.example.com/custom");
  });

  it("dedupes identical callback URLs and prefers focused account", () => {
    const form = {
      channels: {
        wecom: {
          accounts: {
            t_001_default: {
              corpId: "ww",
              webhookUrl: "https://biz.openbot.love/wecom",
            },
            default: {
              corpId: "ww",
              webhookUrl: "https://biz.openbot.love/wecom",
            },
          },
        },
      },
    };
    expect(
      resolveTenantImCallbackEntries({
        form,
        channelId: "wecom",
        publicBaseUrl: "https://biz.openbot.love",
      }),
    ).toHaveLength(1);
    expect(
      resolveTenantImCallbackEntries({
        form,
        channelId: "wecom",
        accountId: "t_001_default",
        publicBaseUrl: "https://biz.openbot.love",
      }),
    ).toEqual([
      {
        accountId: "t_001_default",
        path: "/wecom/a/t_001_default",
        url: "https://biz.openbot.love/wecom",
        copyText: "https://biz.openbot.love/wecom",
      },
    ]);
  });

  it("fills missing webhookPath with the default account path", () => {
    const entries = resolveTenantImCallbackEntries({
      form: {
        channels: {
          dingtalk: {
            accounts: {
              corp: { clientId: "c", clientSecret: "s" },
            },
          },
        },
      },
      channelId: "dingtalk",
      publicBaseUrl: "https://gw.openbot.love/",
    });
    expect(entries[0]?.path).toBe("/dingtalk/a/corp");
    expect(entries[0]?.url).toBe("https://gw.openbot.love/dingtalk/a/corp");
  });

  it("returns empty callbacks for non-IM channels", () => {
    expect(
      resolveTenantImCallbackEntries({
        form: { channels: { telegram: { accounts: { a: {} } } } },
        channelId: "telegram",
        publicBaseUrl: "https://biz.openbot.love",
      }),
    ).toEqual([]);
  });

  it("detects configured IM credentials per channel", () => {
    expect(
      hasTenantImChannelCredentials(
        {
          channels: {
            feishu: { accounts: { a: { appId: "cli", appSecret: "sec" } } },
          },
        },
        "feishu",
      ),
    ).toBe(true);
    expect(
      hasTenantImChannelCredentials(
        {
          channels: {
            feishu: { accounts: { a: { appId: "cli" } } },
          },
        },
        "feishu",
      ),
    ).toBe(false);
    expect(
      hasTenantImChannelCredentials(
        {
          channels: {
            wecom: { accounts: { a: { corpId: "ww", secret: "s" } } },
          },
        },
        "wecom",
      ),
    ).toBe(false);
    expect(
      hasTenantImChannelCredentials(
        {
          channels: {
            wecom: {
              accounts: {
                a: {
                  corpId: "ww",
                  agentId: 1000002,
                  secret: "s",
                  token: "tok",
                  encodingAesKey: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
                },
              },
            },
          },
        },
        "wecom",
      ),
    ).toBe(true);
  });

  it("localizes WeCom unconfigured probe errors", () => {
    expect(
      localizeTenantImProbeError(
        "wecom",
        "WeCom requires corpId, agentId, secret, token, and a reachable webhook path.",
      ),
    ).toMatch(/corpId/);
    expect(
      localizeTenantImProbeError(
        "wecom",
        "WeCom missing required fields: agentId, token. Also set encodingAesKey, webhookPath.",
      ),
    ).toMatch(/缺少：agentId, token/);
    expect(
      localizeTenantImProbeError("wecom", "WeCom AIBot long connection requires botId and secret."),
    ).toMatch(/Bot ID/);
    expect(
      localizeTenantImProbeError("wecom", "WeCom AIBot subscribe failed: 40014 invalid secret"),
    ).toMatch(/长连接鉴权失败/);
  });

  it("treats AIBot probe.ok as long-connection success even when runtime is idle", () => {
    const ok = summarizeTenantImProbeFromSnapshot("wecom", {
      ts: Date.now(),
      channelOrder: ["wecom"],
      channelLabels: {},
      channels: {},
      channelAccounts: {
        wecom: [
          {
            accountId: "t_demo_default",
            name: null,
            enabled: true,
            configured: true,
            running: false,
            connected: false,
            lastError: null,
            probe: { ok: true, elapsedMs: 120 },
          },
        ],
      },
      channelDefaultAccountId: {},
    });
    expect(ok.tone).toBe("ok");
    expect(ok.summary).toMatch(/长连接鉴权通过/);
    expect(ok.accounts[0]?.running).toBe(true);

    const fail = summarizeTenantImProbeFromSnapshot("wecom", {
      ts: Date.now(),
      channelOrder: ["wecom"],
      channelLabels: {},
      channels: {},
      channelAccounts: {
        wecom: [
          {
            accountId: "t_demo_default",
            name: null,
            enabled: true,
            configured: true,
            running: false,
            connected: false,
            lastError: null,
            probe: { ok: false, elapsedMs: 80, error: "WeCom AIBot subscribe failed: 40014 bad" },
          },
        ],
      },
      channelDefaultAccountId: {},
    });
    expect(fail.tone).toBe("fail");
    expect(fail.summary).toMatch(/长连接鉴权失败/);
  });

  it("describes credential gaps per account for save/test gating", () => {
    expect(
      describeTenantImCredentialGaps(
        {
          channels: {
            wecom: {
              accounts: {
                default: { corpId: "ww", secret: "s" },
              },
            },
          },
        },
        "wecom",
      ),
    ).toMatch(/agentId/);
    expect(
      describeTenantImCredentialGaps(
        {
          channels: {
            wecom: {
              accounts: {
                default: {
                  corpId: "ww",
                  agentId: 1,
                  secret: "s",
                  token: "t",
                },
              },
            },
          },
        },
        "wecom",
      ),
    ).toMatch(/encodingAesKey/);
    expect(
      describeTenantImCredentialGaps(
        {
          channels: {
            wecom: {
              accounts: {
                default: {
                  corpId: "ww",
                  agentId: 1,
                  secret: "s",
                  token: "t",
                  encodingAesKey: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
                },
              },
            },
          },
        },
        "wecom",
      ),
    ).toBeNull();
    expect(
      describeTenantImCredentialGaps(
        {
          channels: {
            feishu: {
              accounts: {
                default: {
                  appId: "cli_x",
                  appSecret: "sec",
                  connectionMode: "webhook",
                },
              },
            },
          },
        },
        "feishu",
      ),
    ).toMatch(/verificationToken/);
    expect(
      describeTenantImCredentialGaps(
        {
          channels: {
            feishu: {
              accounts: {
                default: {
                  appId: "cli_x",
                  appSecret: "sec",
                  connectionMode: "websocket",
                },
              },
            },
          },
        },
        "feishu",
      ),
    ).toBeNull();
    expect(
      describeTenantImCredentialGaps(
        {
          channels: {
            wecom: {
              accounts: {
                default: {
                  connectionMode: "websocket",
                  botId: "aib1",
                  secret: "sec",
                },
              },
            },
          },
        },
        "wecom",
      ),
    ).toBeNull();
    expect(
      describeTenantImCredentialGaps(
        {
          channels: {
            wecom: {
              accounts: {
                t_001_default: { corpId: "ww", secret: "s" },
                default: { corpId: "ww", agentId: 1, secret: "s", token: "t" },
              },
            },
          },
        },
        "wecom",
        { accountId: "t_001_default" },
      ),
    ).toMatch(/agentId/);
  });

  it("fails probe before gateway when credentials are incomplete or dirty", async () => {
    const request = vi.fn();
    const state: TenantImBindingProbeState = {
      client: { request } as never,
      connected: true,
      tenantImProbeBusy: false,
      tenantImProbeResult: null,
      tenantImProbeError: null,
      tenantConfigDirty: true,
      tenantConfigForm: {
        channels: {
          wecom: {
            accounts: {
              default: { corpId: "ww", agentId: 1, secret: "s", token: "t" },
            },
          },
        },
      },
    };
    const dirtyResult = await probeTenantImChannel(state, {
      tenantId: "t1",
      channelId: "wecom",
    });
    expect(dirtyResult?.tone).toBe("fail");
    expect(dirtyResult?.summary).toMatch(/未保存/);
    expect(request).not.toHaveBeenCalled();

    state.tenantConfigDirty = false;
    state.tenantConfigForm = {
      channels: { wecom: { accounts: { default: { corpId: "ww" } } } },
    };
    const gapResult = await probeTenantImChannel(state, {
      tenantId: "t1",
      channelId: "wecom",
    });
    expect(gapResult?.tone).toBe("fail");
    expect(gapResult?.summary).toMatch(/测试未通过/);
    expect(request).not.toHaveBeenCalled();
  });

  it("exposes pending activation hints per IM", () => {
    expect(resolveTenantImPendingHint("feishu")).toMatch(/@/);
    expect(resolveTenantImPendingHint("wecom")).toMatch(/可见范围/);
    expect(resolveTenantImPendingHint("dingtalk")).toMatch(/Stream|@/);
  });
});
