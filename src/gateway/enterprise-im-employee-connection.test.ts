import { describe, expect, it, vi } from "vitest";
import {
  beginFeishuEmployeeOAuthSession,
  bindFeishuEmployeeConnection,
  buildFeishuEmployeePromptContext,
  disconnectFeishuEmployeeConnection,
  feishuEmployeeChannelGate,
  feishuEmployeeIdentityId,
  projectFeishuEmployeeToolResult,
  readFeishuEmployeeConnection,
  refreshFeishuEmployeeConnection,
  type FeishuEmployeeChannelGate,
} from "./enterprise-im-employee-connection.js";
import { formatUserOperationalIdentityRuntimePrompt } from "./user-operational-identity-runtime.js";
import type {
  UserOperationalIdentityCredentialSecretStore,
  UserOperationalIdentityStore,
} from "./user-operational-identity-types.js";

const SECRET = "secret-access-token-value";
const REFRESH = "secret-refresh-token-value";
const NEXT_REFRESH = "secret-refresh-token-next";

function emptyStore(): UserOperationalIdentityStore {
  return {
    version: 5,
    identities: {},
    grants: {},
    bindingRequests: {},
    usageEvents: {},
    lifecycleEvents: {},
    continuations: {},
    credentialHandles: {},
    oauthSessions: {},
  };
}

function emptySecrets(): UserOperationalIdentityCredentialSecretStore {
  return { version: 1, secrets: {} };
}

function openGate(): FeishuEmployeeChannelGate {
  return feishuEmployeeChannelGate({
    tenantId: "001",
    config: {
      channels: {
        feishu: {
          enabled: true,
          accounts: {
            t_001_default: {
              platformEnterpriseId: "tenant-key-1",
              appId: "cli_public",
              appSecret: "app-secret-value",
              capabilityStatus: {
                checkedAt: "2026-11-07T00:00:00.000Z",
                projectGroupRead: "granted",
                projectDocs: "granted",
                sendAsUser: "granted",
                newMessageTrigger: "granted",
              },
            },
          },
        },
      },
    },
  });
}

function bindEmployee(params: {
  store: UserOperationalIdentityStore;
  secrets: UserOperationalIdentityCredentialSecretStore;
  ownerId: string;
  openId: string;
  accessToken?: string;
  refreshToken?: string;
  tenantKey?: string | null;
  scopes?: string[];
  gate?: FeishuEmployeeChannelGate;
  posted?: string | null;
}) {
  return bindFeishuEmployeeConnection({
    store: params.store,
    secretStore: params.secrets,
    ownerId: params.ownerId,
    tenantId: "001",
    gate: params.gate ?? openGate(),
    employeePostedEnterpriseId: params.posted,
    nowIso: "2026-11-07T00:00:00.000Z",
    observation: {
      accessToken: params.accessToken ?? SECRET,
      refreshToken: params.refreshToken ?? REFRESH,
      openId: params.openId,
      tenantKey: params.tenantKey === undefined ? "tenant-key-1" : params.tenantKey,
      scopeNames: params.scopes ?? ["offline_access", "im:message", "im:message.send_as_user"],
    },
  });
}

describe("feishu employee connection (slice 1b)", () => {
  it("stores tenant_key from the token and does not create a robot grant", () => {
    const store = emptyStore();
    const secrets = emptySecrets();
    const bound = bindEmployee({ store, secrets, ownerId: "emp-a", openId: "ou_a" });
    expect(bound.ok).toBe(true);
    expect(bound.identityId).toBe(
      feishuEmployeeIdentityId({ tenantId: "001", ownerId: "emp-a", openId: "ou_a" }),
    );
    expect(Object.keys(store.grants)).toHaveLength(0);
    expect(store.identities[bound.identityId!]?.enterpriseIm?.platformEnterpriseId).toBe(
      "tenant-key-1",
    );
    const secret = Object.values(secrets.secrets)[0];
    expect(secret?.refreshToken).toBe(REFRESH);
    expect(JSON.stringify(projectFeishuEmployeeToolResult(bound))).not.toContain(SECRET);
    expect(JSON.stringify(store.usageEvents)).not.toContain(SECRET);
    expect(JSON.stringify(store.usageEvents)).not.toContain(REFRESH);
    expect(buildFeishuEmployeePromptContext(store.identities[bound.identityId!])).not.toContain(
      SECRET,
    );
    expect(
      formatUserOperationalIdentityRuntimePrompt([
        {
          identityId: bound.identityId!,
          provider: "feishu-personal",
          providerLabel: "飞书",
          displayName: "飞书 ou_a",
          status: "active",
          allowedActions: ["read"],
        },
      ] as never),
    ).not.toContain(SECRET);
  });

  it("rejects a token whose platform enterprise does not match, and an employee-posted id alone", () => {
    const store = emptyStore();
    const secrets = emptySecrets();
    const mismatch = bindEmployee({
      store,
      secrets,
      ownerId: "emp-a",
      openId: "ou_a",
      tenantKey: "other-tenant",
    });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.code).toBe("PLATFORM_ENTERPRISE_MISMATCH");
    const postedOnly = bindEmployee({
      store,
      secrets,
      ownerId: "emp-a",
      openId: "ou_a",
      tenantKey: null,
      posted: "tenant-key-1",
    });
    expect(postedOnly.code).toBe("ENTERPRISE_ID_NOT_ON_TOKEN");
    expect(Object.keys(store.identities)).toHaveLength(0);
    expect(Object.keys(secrets.secrets)).toHaveLength(0);
  });

  it("replaces the refresh token once when two refreshes overlap", async () => {
    const store = emptyStore();
    const secrets = emptySecrets();
    const bound = bindEmployee({ store, secrets, ownerId: "emp-a", openId: "ou_a" });
    let calls = 0;
    let release: (() => void) | undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const exchange = vi.fn(async (refreshToken: string) => {
      calls += 1;
      expect(refreshToken).toBe(REFRESH);
      await hold;
      return {
        accessToken: "next-access",
        refreshToken: NEXT_REFRESH,
        openId: "ou_a",
        tenantKey: "tenant-key-1",
        scopeNames: ["offline_access", "im:message"],
      };
    });
    const first = refreshFeishuEmployeeConnection({
      store,
      secretStore: secrets,
      ownerId: "emp-a",
      identityId: bound.identityId!,
      gate: openGate(),
      nowIso: "2026-11-07T00:01:00.000Z",
      exchange,
    });
    const second = refreshFeishuEmployeeConnection({
      store,
      secretStore: secrets,
      ownerId: "emp-a",
      identityId: bound.identityId!,
      gate: openGate(),
      nowIso: "2026-11-07T00:01:00.000Z",
      exchange,
    });
    release?.();
    const [left, right] = await Promise.all([first, second]);
    expect(left.ok).toBe(true);
    expect(right.ok).toBe(true);
    expect(calls).toBe(1);
    expect(Object.values(secrets.secrets)[0]?.refreshToken).toBe(NEXT_REFRESH);
    expect(JSON.stringify(secrets.secrets)).not.toContain(REFRESH);
    expect(JSON.stringify(projectFeishuEmployeeToolResult(left))).not.toContain(NEXT_REFRESH);
  });

  it("disconnects one employee without stopping another, and blocks every child when the enterprise connection is off", () => {
    const store = emptyStore();
    const secrets = emptySecrets();
    const gate = openGate();
    const a = bindEmployee({ store, secrets, ownerId: "emp-a", openId: "ou_a" });
    const b = bindEmployee({
      store,
      secrets,
      ownerId: "emp-b",
      openId: "ou_b",
      accessToken: "b-access",
    });
    const disconnected = disconnectFeishuEmployeeConnection({
      store,
      secretStore: secrets,
      ownerId: "emp-a",
      identityId: a.identityId!,
      nowIso: "2026-11-07T00:02:00.000Z",
    });
    expect(disconnected.message).toBe("本地凭证已删除");
    expect(disconnected.platformRevokeRecorded).toBe(false);
    const readA = readFeishuEmployeeConnection({
      store,
      secretStore: secrets,
      ownerId: "emp-a",
      identityId: a.identityId!,
      gate,
    });
    const readB = readFeishuEmployeeConnection({
      store,
      secretStore: secrets,
      ownerId: "emp-b",
      identityId: b.identityId!,
      gate,
    });
    expect(readA.code).toBe("LOCAL_CREDENTIALS_DELETED");
    expect(readB.ok).toBe(true);
    const closed = feishuEmployeeChannelGate({
      tenantId: "001",
      config: {
        channels: {
          feishu: {
            enabled: false,
            accounts: { t_001_default: { platformEnterpriseId: "tenant-key-1" } },
          },
        },
      },
    });
    expect(
      readFeishuEmployeeConnection({
        store,
        secretStore: secrets,
        ownerId: "emp-b",
        identityId: b.identityId!,
        gate: closed,
      }).code,
    ).toBe("ENTERPRISE_CONNECTION_BLOCKED");
    expect(Object.keys(store.grants)).toHaveLength(0);
  });

  it("keeps the authorize URL free of the app secret and login disabled until the app can attempt the checklist", () => {
    const closed = feishuEmployeeChannelGate({ tenantId: "001", config: {} });
    expect(closed.statusLabel).toBe("企业尚未开通");
    expect(closed.loginEnabled).toBe(false);
    const waiting = feishuEmployeeChannelGate({
      tenantId: "001",
      config: {
        channels: {
          feishu: {
            enabled: true,
            accounts: {
              t_001_default: {
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
      },
    });
    expect(waiting.statusLabel).toBe("等待管理员开通权限");
    expect(waiting.loginEnabled).toBe(false);
    const ready = openGate();
    expect(ready.loginEnabled).toBe(true);
    const identityOnly = bindEmployee({
      store: emptyStore(),
      secrets: emptySecrets(),
      ownerId: "emp-a",
      openId: "ou_id",
      scopes: ["offline_access"],
    });
    expect(identityOnly.authorizationLevel).toBe("identity_only");
    expect(identityOnly.message).toBe("仅身份");
    const started = beginFeishuEmployeeOAuthSession({
      store: emptyStore(),
      ownerId: "emp-a",
      tenantId: "001",
      gate: ready,
      appId: "cli_public",
      redirectUri: "https://example.test/callback",
      nowIso: "2026-11-07T00:00:00.000Z",
    });
    expect(started.ok).toBe(true);
    if (started.ok) {
      expect(started.authorizeUrl).toContain("client_id=cli_public");
      expect(started.authorizeUrl).toContain("offline_access");
      expect(started.authorizeUrl).not.toContain("app-secret-value");
    }
  });
});
