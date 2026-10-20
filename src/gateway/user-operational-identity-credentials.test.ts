import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindUserOperationalIdentityManualCredentials,
  isValidWechatOfficialAppId,
  probeWechatOfficialCredentials,
  verifyUserOperationalIdentityWechatOfficialCredentials,
} from "./user-operational-identity-credentials.js";
import { startUserOperationalIdentityOAuthSession } from "./user-operational-identity-oauth.js";
import { normalizeUserOperationalIdentityStore } from "./user-operational-identity-persistence.js";
import { listUserOperationalIdentityProviderCatalog } from "./user-operational-identity-providers.js";
import { withUserOperationalIdentityCredentialSecretStoreWriteLock } from "./user-operational-identity-secrets-persistence.js";
import { getUserOperationalIdentityCredentialSecret } from "./user-operational-identity-secrets.js";

const memorySecretStore = {
  version: 1,
  secrets: {} as Record<
    string,
    import("./user-operational-identity-types.js").UserOperationalIdentityCredentialSecret
  >,
};

vi.mock("./user-operational-identity-secrets-persistence.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./user-operational-identity-secrets-persistence.js")>();
  return {
    ...actual,
    withUserOperationalIdentityCredentialSecretStoreWriteLock: vi.fn(
      async (fn: (store: typeof memorySecretStore) => unknown) => fn(memorySecretStore),
    ),
    loadUserOperationalIdentityCredentialSecretStore: vi.fn(async () => memorySecretStore),
  };
});

describe("user operational identity wechat-official credentials", () => {
  const nowIso = "2026-07-26T04:00:00.000Z";
  const ownerId = "user-oa-1";
  const appId = "wx1234567890abcdef";
  const appSecret = "secret-value-abcdefghijklmnopqrstuvwxyz";

  beforeEach(() => {
    vi.clearAllMocks();
    memorySecretStore.secrets = {};
    process.env.OPENBOT_USER_OPERATIONAL_IDENTITY_WECHAT_OA_SKIP_PROBE = "1";
  });

  afterEach(() => {
    delete process.env.OPENBOT_USER_OPERATIONAL_IDENTITY_WECHAT_OA_SKIP_PROBE;
  });

  it("lists wechat-official as ready manual provider labeled 微信公众号", () => {
    const entry = listUserOperationalIdentityProviderCatalog().find(
      (item) => item.provider === "wechat-official",
    );
    expect(entry).toMatchObject({
      label: "微信公众号",
      registrationReady: true,
      authMode: "manual",
    });
  });

  it("validates AppID shape", () => {
    expect(isValidWechatOfficialAppId(appId)).toBe(true);
    expect(isValidWechatOfficialAppId("wxshort")).toBe(false);
    expect(isValidWechatOfficialAppId("not-wx")).toBe(false);
  });

  it("binds wechat-official with AppID/AppSecret and stores wechat_oa secret", async () => {
    const store = normalizeUserOperationalIdentityStore(null);
    const result = await bindUserOperationalIdentityManualCredentials({
      store,
      ownerId,
      provider: "wechat-official",
      displayName: "我的订阅号",
      appId,
      appSecret,
      nowIso,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.identity.provider).toBe("wechat-official");
    expect(result.identity.externalAccountId).toBe(appId);
    expect(result.identity.displayName).toBe("我的订阅号");

    const secret = getUserOperationalIdentityCredentialSecret({
      handleId: result.credentialHandleId,
      ownerId,
      secretStore: memorySecretStore,
    });
    expect(secret?.kind).toBe("wechat_oa");
    expect(secret?.accessToken).toBe(appSecret);
    expect(secret?.metadata?.appId).toBe(appId);
    expect(withUserOperationalIdentityCredentialSecretStoreWriteLock).toHaveBeenCalled();
  });

  it("rejects invalid AppID before probing", async () => {
    const store = normalizeUserOperationalIdentityStore(null);
    const result = await bindUserOperationalIdentityManualCredentials({
      store,
      ownerId,
      provider: "wechat-official",
      displayName: "坏 AppID",
      appId: "invalid",
      appSecret,
      nowIso,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("USER_IDENTITY_WECHAT_OA_APPID_INVALID");
  });

  it.each(["github-personal", "x-twitter"] as const)(
    "rejects oauth provider %s on manual bind path",
    async (provider) => {
      const store = normalizeUserOperationalIdentityStore(null);
      const result = await bindUserOperationalIdentityManualCredentials({
        store,
        ownerId,
        provider,
        displayName: provider,
        appId,
        appSecret,
        nowIso,
      });
      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.code).toBe("USER_IDENTITY_OAUTH_REQUIRED");
    },
  );

  it.each(["weibo", "zhihu", "douyin", "xiaohongshu", "kuaishou"] as const)(
    "binds social provider %s with account handle + access token",
    async (provider) => {
      const store = normalizeUserOperationalIdentityStore(null);
      const result = await bindUserOperationalIdentityManualCredentials({
        store,
        ownerId,
        provider,
        displayName: `我的${provider}`,
        accountHandle: `@handle-${provider}`,
        accessToken: `token-${provider}`,
        nowIso,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.identity.provider).toBe(provider);
      expect(result.identity.externalAccountId).toBe(`@handle-${provider}`);
      const secret = getUserOperationalIdentityCredentialSecret({
        handleId: result.credentialHandleId,
        ownerId,
        secretStore: memorySecretStore,
      });
      expect(secret?.kind).toBe("social_account");
      expect(secret?.accessToken).toBe(`token-${provider}`);
      expect(secret?.metadata?.accountHandle).toBe(`@handle-${provider}`);
    },
  );

  it("rejects social bind without access token", async () => {
    const store = normalizeUserOperationalIdentityStore(null);
    const result = await bindUserOperationalIdentityManualCredentials({
      store,
      ownerId,
      provider: "xiaohongshu",
      displayName: "小红书号",
      accountHandle: "@xhs",
      nowIso,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("USER_IDENTITY_SOCIAL_TOKEN_REQUIRED");
  });

  it("rejects oauth.start for wechat-official", () => {
    const store = normalizeUserOperationalIdentityStore(null);
    const result = startUserOperationalIdentityOAuthSession({
      store,
      ownerId,
      provider: "wechat-official",
      displayName: "公众号",
      nowIso,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("USER_IDENTITY_MANUAL_CREDENTIALS_REQUIRED");
  });

  it("maps IP whitelist probe errors", async () => {
    delete process.env.OPENBOT_USER_OPERATIONAL_IDENTITY_WECHAT_OA_SKIP_PROBE;
    const fetchImpl = vi.fn(async () =>
      Response.json({ errcode: 40164, errmsg: "invalid ip" }),
    ) as unknown as typeof fetch;
    const result = await probeWechatOfficialCredentials({
      appId,
      appSecret,
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("USER_IDENTITY_WECHAT_OA_IP_WHITELIST");
    expect(result.error).toContain("IP 白名单");
    expect(result.error).toMatch(/IP 白名单未放行/);
  });

  it("prefers official stable_token over legacy gettoken", async () => {
    delete process.env.OPENBOT_USER_OPERATIONAL_IDENTITY_WECHAT_OA_SKIP_PROBE;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/cgi-bin/stable_token")) {
        return Response.json({ access_token: "stable-token-1", expires_in: 7200 });
      }
      throw new Error(`unexpected token url: ${url}`);
    }) as unknown as typeof fetch;
    const result = await probeWechatOfficialCredentials({
      appId,
      appSecret,
      fetchImpl,
    });
    expect(result).toEqual({ ok: true, accessToken: "stable-token-1" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not fall through to legacy gettoken when stable_token returns errcode", async () => {
    delete process.env.OPENBOT_USER_OPERATIONAL_IDENTITY_WECHAT_OA_SKIP_PROBE;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/cgi-bin/stable_token")) {
        return Response.json({
          errcode: 40164,
          errmsg: "invalid ip 8.8.8.8, not in whitelist",
        });
      }
      throw new Error(`unexpected token url: ${url}`);
    }) as unknown as typeof fetch;
    const result = await probeWechatOfficialCredentials({
      appId,
      appSecret,
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("USER_IDENTITY_WECHAT_OA_IP_WHITELIST");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("verifies bound wechat-official credentials via token probe", async () => {
    const store = normalizeUserOperationalIdentityStore(null);
    const bound = await bindUserOperationalIdentityManualCredentials({
      store,
      ownerId,
      provider: "wechat-official",
      displayName: "我的订阅号",
      appId,
      appSecret,
      nowIso,
    });
    expect(bound.ok).toBe(true);
    if (!bound.ok) {
      return;
    }
    const verified = await verifyUserOperationalIdentityWechatOfficialCredentials({
      store,
      ownerId,
      identityId: bound.identity.identityId,
      nowIso: "2026-07-26T05:10:00.000Z",
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) {
      return;
    }
    expect(verified.appId).toBe(appId);
    expect(verified.identity.lastVerifiedAt).toBe("2026-07-26T05:10:00.000Z");
  });
});

describe("user operational identity personal-email SMTP credentials", () => {
  const nowIso = "2026-07-26T06:00:00.000Z";
  const ownerId = "user-email-1";

  beforeEach(() => {
    vi.clearAllMocks();
    memorySecretStore.secrets = {};
    process.env.OPENBOT_USER_OPERATIONAL_IDENTITY_SMTP_SKIP_PROBE = "1";
    delete process.env.OPENBOT_SMTP_HOST;
    delete process.env.OPENBOT_SMTP_FROM;
    delete process.env.OPENBOT_SMTP_USER;
    delete process.env.OPENBOT_SMTP_PASS;
  });

  afterEach(() => {
    delete process.env.OPENBOT_USER_OPERATIONAL_IDENTITY_SMTP_SKIP_PROBE;
    delete process.env.OPENBOT_SMTP_HOST;
    delete process.env.OPENBOT_SMTP_FROM;
    delete process.env.OPENBOT_SMTP_USER;
    delete process.env.OPENBOT_SMTP_PASS;
  });

  it("lists personal-email as ready manual SMTP provider", () => {
    const entry = listUserOperationalIdentityProviderCatalog().find(
      (item) => item.provider === "personal-email",
    );
    expect(entry).toMatchObject({
      label: "个人邮箱",
      registrationReady: true,
      authMode: "manual",
      manualKind: "smtp",
    });
  });

  it("binds personal-email with custom SMTP config", async () => {
    const store = normalizeUserOperationalIdentityStore(null);
    const result = await bindUserOperationalIdentityManualCredentials({
      store,
      ownerId,
      provider: "personal-email",
      displayName: "工作邮箱",
      smtp: {
        from: "me@example.com",
        host: "smtp.example.com",
        port: "587",
        user: "me@example.com",
        pass: "app-password",
      },
      nowIso,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.identity.provider).toBe("personal-email");
    expect(result.identity.externalAccountId).toBe("me@example.com");
    const secret = getUserOperationalIdentityCredentialSecret({
      handleId: result.credentialHandleId,
      ownerId,
      secretStore: memorySecretStore,
    });
    expect(secret?.kind).toBe("smtp");
    expect(secret?.accessToken).toBe("app-password");
    expect(secret?.metadata?.smtpHost).toBe("smtp.example.com");
    expect(secret?.metadata?.source).toBe("custom");
  });

  it("binds personal-email via platform SMTP when configured", async () => {
    process.env.OPENBOT_SMTP_HOST = "smtp.platform.local";
    process.env.OPENBOT_SMTP_FROM = "noreply@openbot.love";
    process.env.OPENBOT_SMTP_USER = "noreply@openbot.love";
    process.env.OPENBOT_SMTP_PASS = "platform-pass";
    const store = normalizeUserOperationalIdentityStore(null);
    const result = await bindUserOperationalIdentityManualCredentials({
      store,
      ownerId,
      provider: "personal-email",
      displayName: "平台邮箱身份",
      smtp: {
        from: "alias@example.com",
        usePlatformSmtp: true,
      },
      nowIso,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.identity.externalAccountId).toBe("alias@example.com");
    const secret = getUserOperationalIdentityCredentialSecret({
      handleId: result.credentialHandleId,
      ownerId,
      secretStore: memorySecretStore,
    });
    expect(secret?.metadata?.source).toBe("platform_env");
    // Envelope FROM stays on platform domain; personal mailbox is Reply-To.
    expect(secret?.metadata?.smtpFrom).toBe("noreply@openbot.love");
    expect(secret?.metadata?.smtpReplyTo).toBe("alias@example.com");
    expect(secret?.metadata?.personalEmail).toBe("alias@example.com");

    const { resolveUserOperationalIdentitySmtpConfig } =
      await import("./user-operational-identity-smtp.js");
    const resolved = resolveUserOperationalIdentitySmtpConfig(secret!);
    expect(resolved?.from).toBe("noreply@openbot.love");
    expect(resolved?.replyTo).toBe("alias@example.com");
  });

  it("resolves legacy platform_env secrets that stored personal Gmail as smtpFrom", async () => {
    process.env.OPENBOT_SMTP_HOST = "smtpdm.aliyun.com";
    process.env.OPENBOT_SMTP_FROM = "OpenBot <csc@mail.openbot.love>";
    process.env.OPENBOT_SMTP_USER = "csc@mail.openbot.love";
    process.env.OPENBOT_SMTP_PASS = "platform-pass";
    const { resolveUserOperationalIdentitySmtpConfig } =
      await import("./user-operational-identity-smtp.js");
    const resolved = resolveUserOperationalIdentitySmtpConfig({
      handleId: "cred-legacy",
      ownerId,
      provider: "personal-email",
      kind: "smtp",
      accessToken: "env:platform",
      accountLabel: "gmail",
      metadata: {
        source: "platform_env",
        smtpFrom: "daniel.hhd@gmail.com",
      },
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    expect(resolved?.from).toBe("OpenBot <csc@mail.openbot.love>");
    expect(resolved?.replyTo).toBe("daniel.hhd@gmail.com");
  });

  it("rejects personal-email bind without SMTP host", async () => {
    const store = normalizeUserOperationalIdentityStore(null);
    const result = await bindUserOperationalIdentityManualCredentials({
      store,
      ownerId,
      provider: "personal-email",
      displayName: "工作邮箱",
      smtp: {
        from: "me@example.com",
        pass: "app-password",
      },
      nowIso,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("USER_IDENTITY_SMTP_HOST_REQUIRED");
  });

  it("rejects oauth start for personal-email after SMTP manual mode", () => {
    const store = normalizeUserOperationalIdentityStore(null);
    const started = startUserOperationalIdentityOAuthSession({
      store,
      ownerId,
      provider: "personal-email",
      displayName: "邮箱",
      nowIso,
    });
    expect(started.ok).toBe(false);
    if (started.ok) {
      return;
    }
    expect(started.code).toBe("USER_IDENTITY_MANUAL_CREDENTIALS_REQUIRED");
  });
});
