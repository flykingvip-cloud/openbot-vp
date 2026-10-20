import { describe, expect, it } from "vitest";
import {
  defaultEnterpriseImAccountId,
  defaultEnterpriseImConnectionMode,
  ensureEnterpriseImAccountForm,
  enterpriseImNeedsCallbackUrl,
  readEnterpriseImAccountValues,
  resolveEnterpriseImConnectionMode,
  resolveEnterpriseImCredentialFields,
  resolveEnterpriseImHelpHref,
  resolveEnterpriseImHelpLabel,
  resolveEnterpriseImPrimaryAccountId,
  resolveEnterpriseImSetupGuide,
  setEnterpriseImAccountFieldValue,
} from "./enterprise-im-channel-form.ts";

describe("enterprise-im-channel-form helpers", () => {
  it("builds a tenant-scoped default account id", () => {
    expect(defaultEnterpriseImAccountId("001")).toBe("t_001_default");
    expect(defaultEnterpriseImAccountId("Acme Corp")).toBe("t_acme_corp_default");
  });

  it("prefers existing default / first account before creating a new id", () => {
    expect(resolveEnterpriseImPrimaryAccountId({ default: {} }, "001")).toBe("default");
    expect(resolveEnterpriseImPrimaryAccountId({ sales: {} }, "001")).toBe("sales");
    expect(resolveEnterpriseImPrimaryAccountId({}, "001")).toBe("t_001_default");
  });

  it("defaults wecom/feishu/dingtalk to long-connection modes", () => {
    expect(defaultEnterpriseImConnectionMode("feishu")).toBe("websocket");
    expect(defaultEnterpriseImConnectionMode("dingtalk")).toBe("stream");
    expect(defaultEnterpriseImConnectionMode("wecom")).toBe("websocket");
  });

  it("hides callback URL for long-connection modes", () => {
    expect(enterpriseImNeedsCallbackUrl("feishu", "websocket")).toBe(false);
    expect(enterpriseImNeedsCallbackUrl("dingtalk", "stream")).toBe(false);
    expect(enterpriseImNeedsCallbackUrl("wecom", "websocket")).toBe(false);
    expect(enterpriseImNeedsCallbackUrl("feishu", "webhook")).toBe(true);
    expect(enterpriseImNeedsCallbackUrl("dingtalk", "webhook")).toBe(true);
    expect(enterpriseImNeedsCallbackUrl("wecom", "callback")).toBe(true);
  });

  it("exposes curated wecom fields by mode without accounts/webhookPath editors", () => {
    expect(resolveEnterpriseImCredentialFields("wecom", "websocket").map((f) => f.key)).toEqual([
      "botId",
      "secret",
    ]);
    expect(resolveEnterpriseImCredentialFields("wecom", "callback").map((f) => f.key)).toEqual([
      "corpId",
      "agentId",
      "secret",
      "token",
      "encodingAesKey",
    ]);
  });

  it("shows feishu webhook secrets only in webhook mode", () => {
    expect(resolveEnterpriseImCredentialFields("feishu", "websocket").map((f) => f.key)).toEqual([
      "appId",
      "appSecret",
    ]);
    expect(resolveEnterpriseImCredentialFields("feishu", "webhook").map((f) => f.key)).toEqual([
      "appId",
      "appSecret",
      "verificationToken",
      "encryptKey",
    ]);
  });

  it("maps channels to same-origin help guides", () => {
    expect(resolveEnterpriseImHelpHref("dingtalk")).toBe("/help/dingtalk");
    expect(resolveEnterpriseImHelpHref("feishu")).toBe("/help/feishu");
    expect(resolveEnterpriseImHelpLabel("dingtalk")).toBe("钉钉配置指南");
    expect(resolveEnterpriseImHelpLabel("wecom")).toBe("企业微信配置指南");
  });

  it("splits setup guide into platform checklist + openbot config", () => {
    const feishu = resolveEnterpriseImSetupGuide("feishu", "websocket");
    expect(feishu.map((section) => section.id)).toEqual(["platform", "openbot"]);
    expect(feishu[0]?.title).toBe("开放平台检查");
    expect(feishu[1]?.title).toBe("本页配置");
    expect(feishu[0]?.items.some((item) => item.includes("发布"))).toBe(true);
    expect(feishu[1]?.items.some((item) => item.includes("App ID"))).toBe(true);

    const dingtalk = resolveEnterpriseImSetupGuide("dingtalk", "stream");
    expect(dingtalk[0]?.items.some((item) => item.includes("qyapi_robot_sendmsg"))).toBe(true);
    expect(dingtalk[1]?.items.some((item) => item.includes("无需回填"))).toBe(true);

    const wecomWs = resolveEnterpriseImSetupGuide("wecom", "websocket");
    expect(wecomWs[0]?.items.some((item) => item.includes("智能机器人"))).toBe(true);
    expect(wecomWs[1]?.items.some((item) => item.includes("Bot ID"))).toBe(true);
    const wecomCb = resolveEnterpriseImSetupGuide("wecom", "callback");
    expect(wecomCb[1]?.items.some((item) => item.includes("Callback URL"))).toBe(true);
  });

  it("materializes an account shell with default connectionMode for feishu", () => {
    const { form, accountId } = ensureEnterpriseImAccountForm({
      form: { channels: {} },
      channelId: "feishu",
      tenantId: "001",
    });
    expect(accountId).toBe("t_001_default");
    const account = (
      form.channels as { feishu: { accounts: Record<string, Record<string, string>> } }
    ).feishu.accounts.t_001_default;
    expect(account.connectionMode).toBe("websocket");
    expect(account.webhookPath).toBe("/feishu/a/t_001_default");
  });

  it("materializes dingtalk accounts with stream mode by default", () => {
    const { form } = ensureEnterpriseImAccountForm({
      form: { channels: {} },
      channelId: "dingtalk",
      tenantId: "001",
    });
    const account = (
      form.channels as { dingtalk: { accounts: Record<string, Record<string, string>> } }
    ).dingtalk.accounts.t_001_default;
    expect(account.connectionMode).toBe("stream");
  });

  it("migrates root-level credentials into the account shell", () => {
    const { form, accountId } = ensureEnterpriseImAccountForm({
      form: {
        channels: {
          wecom: {
            enabled: true,
            corpId: "ww1",
            agentId: "100",
            secret: "s",
            token: "t",
            encodingAesKey: "k".repeat(43),
          },
        },
      },
      channelId: "wecom",
      tenantId: "001",
    });
    expect(accountId).toBe("t_001_default");
    const accounts = (
      form.channels as { wecom: { accounts: Record<string, Record<string, string>> } }
    ).wecom.accounts;
    expect(accounts.t_001_default.corpId).toBe("ww1");
    expect(accounts.t_001_default.connectionMode).toBe("callback");
    expect(accounts.t_001_default.webhookPath).toBe("/wecom/a/t_001_default");
  });

  it("defaults empty wecom accounts to websocket AIBot mode", () => {
    const { form } = ensureEnterpriseImAccountForm({
      form: { channels: {} },
      channelId: "wecom",
      tenantId: "001",
    });
    const account = (
      form.channels as { wecom: { accounts: Record<string, Record<string, string>> } }
    ).wecom.accounts.t_001_default;
    expect(account.connectionMode).toBe("websocket");
  });

  it("reads account values with root fallback for legacy configs", () => {
    const values = readEnterpriseImAccountValues({
      form: {
        channels: {
          wecom: {
            corpId: "ww-root",
            accounts: {
              default: { token: "tok-account" },
            },
          },
        },
      },
      channelId: "wecom",
      accountId: "default",
    });
    expect(values.corpId).toBe("ww-root");
    expect(values.token).toBe("tok-account");
  });

  it("resolves connection mode from stored values", () => {
    expect(
      resolveEnterpriseImConnectionMode({
        channelId: "feishu",
        values: { connectionMode: "webhook" },
      }),
    ).toBe("webhook");
    expect(
      resolveEnterpriseImConnectionMode({
        channelId: "dingtalk",
        values: {},
      }),
    ).toBe("stream");
  });

  it("patches credential fields onto the primary account path", () => {
    const next = setEnterpriseImAccountFieldValue({
      form: { channels: {} },
      channelId: "feishu",
      tenantId: "001",
      field: "appId",
      value: "cli_x",
    });
    const accounts = (
      next.channels as { feishu: { accounts: Record<string, Record<string, string>> } }
    ).feishu.accounts;
    expect(accounts.t_001_default.appId).toBe("cli_x");
    expect(accounts.t_001_default.connectionMode).toBe("websocket");
    expect(accounts.t_001_default.webhookPath).toBe("/feishu/a/t_001_default");
  });
});
