import { describe, expect, it } from "vitest";
import {
  findEditableUserOperationalIdentityForProvider,
  openUserOperationalIdentityEditor,
  setUserOperationalIdentityNav,
  type UserOperationalIdentityHost,
  type UserOperationalIdentitySnapshot,
} from "./user-operational-identity.ts";

function createHost(
  snapshot: UserOperationalIdentitySnapshot | null = null,
): UserOperationalIdentityHost {
  return {
    client: null,
    connected: true,
    userOperationalIdentities: snapshot,
    userOperationalIdentityBusy: false,
    userOperationalIdentityError: null,
    userOperationalIdentityNotice: null,
    userOperationalIdentityNav: "bound",
    userOperationalIdentityEditorOpen: false,
    userOperationalIdentityEditorProvider: "",
    userOperationalIdentityEditorDisplayName: "",
    userOperationalIdentityEditorCredentialHandleId: "",
    userOperationalIdentityEditorAppId: "",
    userOperationalIdentityEditorAppSecret: "",
    userOperationalIdentityEditorSmtpHost: "",
    userOperationalIdentityEditorSmtpPort: "587",
    userOperationalIdentityEditorSmtpUser: "",
    userOperationalIdentityEditorImapHost: "",
    userOperationalIdentityEditorImapPort: "993",
    userOperationalIdentityEditorImapUser: "",
    userOperationalIdentityEditorUsePlatformSmtp: false,
    userOperationalIdentityEditorPersonalEmailPresetNote: null,
    userOperationalIdentityEditorIdentityId: null,
    wechatPersonalQrWorkerOnline: null,
    wechatPersonalQrStatus: "idle",
    wechatPersonalQrDataUrl: null,
    wechatPersonalQrMessage: null,
    wechatPersonalQrWxid: null,
    userOperationalIdentityOAuthSessionId: null,
    userOperationalIdentityReturnSessionKey: null,
    userOperationalIdentityReturnModule: null,
    userOperationalIdentityContinuationToken: null,
    userOperationalIdentityContinuationNotice: null,
  };
}

const catalog = [
  {
    provider: "github-personal",
    label: "GitHub（个人）",
    category: "developer" as const,
    rolloutTier: "pilot" as const,
    registrationReady: true,
    authMode: "oauth" as const,
    operationalActions: [],
    reauthHint: "",
    degradedHint: null,
  },
  {
    provider: "wechat-official",
    label: "微信公众号",
    category: "official" as const,
    rolloutTier: "pilot" as const,
    registrationReady: true,
    authMode: "manual" as const,
    manualKind: "wechat_oa" as const,
    operationalActions: [],
    reauthHint: "",
    degradedHint: null,
  },
  {
    provider: "xiaohongshu",
    label: "小红书",
    category: "social" as const,
    rolloutTier: "pilot" as const,
    registrationReady: true,
    authMode: "manual" as const,
    manualKind: "social_account" as const,
    operationalActions: [],
    reauthHint: "",
    degradedHint: null,
  },
];

describe("openUserOperationalIdentityEditor hydration", () => {
  it("opens provider hub without editor when identity is already bound", () => {
    const host = createHost({
      identities: [
        {
          identityId: "id-gh-1",
          provider: "github-personal",
          providerLabel: "GitHub（个人）",
          displayName: "我的 GitHub",
          externalAccountId: "octocat",
          status: "active",
          grantCount: 0,
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T01:00:00.000Z",
        },
      ],
      grants: [],
      usageHistory: [],
      providerCatalog: catalog,
      pendingBindingRequests: [],
    });

    setUserOperationalIdentityNav(host, "add:github-personal");

    expect(host.userOperationalIdentityEditorOpen).toBe(false);
    expect(host.userOperationalIdentityNav).toBe("add:github-personal");
  });

  it("prefills GitHub editor from an already-bound identity when editor is opened explicitly", () => {
    const host = createHost({
      identities: [
        {
          identityId: "id-gh-1",
          provider: "github-personal",
          providerLabel: "GitHub（个人）",
          displayName: "我的 GitHub",
          externalAccountId: "octocat",
          status: "active",
          grantCount: 0,
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T01:00:00.000Z",
        },
      ],
      grants: [],
      usageHistory: [],
      providerCatalog: catalog,
      pendingBindingRequests: [],
    });

    openUserOperationalIdentityEditor(host, { provider: "github-personal" });

    expect(host.userOperationalIdentityEditorOpen).toBe(true);
    expect(host.userOperationalIdentityEditorIdentityId).toBe("id-gh-1");
    expect(host.userOperationalIdentityEditorDisplayName).toBe("我的 GitHub");
    expect(host.userOperationalIdentityEditorCredentialHandleId).toBe("octocat");
    expect(host.userOperationalIdentityEditorAppSecret).toBe("");
  });

  it("prefills WeChat AppID (not secret) when identity already exists", () => {
    const host = createHost({
      identities: [
        {
          identityId: "id-wx-1",
          provider: "wechat-official",
          providerLabel: "微信公众号",
          displayName: "订阅号",
          externalAccountId: "wx1234567890abcdef",
          status: "active",
          grantCount: 1,
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T01:00:00.000Z",
        },
      ],
      grants: [],
      usageHistory: [],
      providerCatalog: catalog,
      pendingBindingRequests: [],
    });

    openUserOperationalIdentityEditor(host, { provider: "wechat-official" });

    expect(host.userOperationalIdentityEditorIdentityId).toBe("id-wx-1");
    expect(host.userOperationalIdentityEditorAppId).toBe("wx1234567890abcdef");
    expect(host.userOperationalIdentityEditorAppSecret).toBe("");
    expect(host.userOperationalIdentityEditorDisplayName).toBe("订阅号");
  });

  it("keeps a blank form for providers with no bound identity", () => {
    const host = createHost({
      identities: [],
      grants: [],
      usageHistory: [],
      providerCatalog: catalog,
      pendingBindingRequests: [],
    });

    openUserOperationalIdentityEditor(host, { provider: "xiaohongshu" });

    expect(host.userOperationalIdentityEditorIdentityId).toBeNull();
    expect(host.userOperationalIdentityEditorDisplayName).toBe("小红书");
    expect(host.userOperationalIdentityEditorCredentialHandleId).toBe("");
  });

  it("prefers the newest active identity when multiple exist", () => {
    const host = createHost({
      identities: [
        {
          identityId: "old",
          provider: "xiaohongshu",
          providerLabel: "小红书",
          displayName: "旧号",
          externalAccountId: "@old",
          status: "active",
          grantCount: 0,
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z",
        },
        {
          identityId: "new",
          provider: "xiaohongshu",
          providerLabel: "小红书",
          displayName: "新号",
          externalAccountId: "@new",
          status: "active",
          grantCount: 0,
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T12:00:00.000Z",
        },
      ],
      grants: [],
      usageHistory: [],
      providerCatalog: catalog,
      pendingBindingRequests: [],
    });

    const found = findEditableUserOperationalIdentityForProvider(host, "xiaohongshu");
    expect(found?.identityId).toBe("new");
  });

  it("auto-fills Gmail SMTP/IMAP presets and leaves the auth code blank", () => {
    const host = createHost({
      identities: [
        {
          identityId: "id-mail-1",
          provider: "personal-email",
          providerLabel: "个人邮箱",
          displayName: "个人邮箱",
          externalAccountId: "daniel.hhd@gmail.com",
          status: "active",
          grantCount: 1,
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T01:00:00.000Z",
        },
      ],
      grants: [],
      usageHistory: [],
      platformSmtpConfigured: true,
      providerCatalog: [
        ...catalog,
        {
          provider: "personal-email",
          label: "个人邮箱",
          category: "communication",
          rolloutTier: "pilot",
          registrationReady: true,
          authMode: "manual",
          manualKind: "smtp",
          operationalActions: [],
          reauthHint: "",
          degradedHint: null,
        },
      ],
      pendingBindingRequests: [],
    });

    openUserOperationalIdentityEditor(host, { provider: "personal-email" });

    expect(host.userOperationalIdentityEditorCredentialHandleId).toBe("daniel.hhd@gmail.com");
    expect(host.userOperationalIdentityEditorUsePlatformSmtp).toBe(false);
    expect(host.userOperationalIdentityEditorSmtpHost).toBe("smtp.gmail.com");
    expect(host.userOperationalIdentityEditorSmtpPort).toBe("465");
    expect(host.userOperationalIdentityEditorSmtpUser).toBe("daniel.hhd@gmail.com");
    expect(host.userOperationalIdentityEditorImapHost).toBe("imap.gmail.com");
    expect(host.userOperationalIdentityEditorImapPort).toBe("993");
    expect(host.userOperationalIdentityEditorImapUser).toBe("daniel.hhd@gmail.com");
    expect(host.userOperationalIdentityEditorAppSecret).toBe("");
  });
});
