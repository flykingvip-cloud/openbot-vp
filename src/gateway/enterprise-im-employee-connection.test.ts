import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ownershipProofFromTenantUser } from "./data-governance/ownership-proof.js";
import { resetSharedDataGovernanceCatalogForTests } from "./data-governance/runtime-catalog.js";
import { renewPersistedFeishuEmployeeConnection } from "./enterprise-im-employee-connection-oauth.js";
import {
  allowFeishuEmployeeCredentialUse,
  beginFeishuEmployeeOAuthSession,
  bindFeishuEmployeeConnection,
  buildFeishuEmployeePromptContext,
  disconnectFeishuEmployeeConnection,
  feishuEmployeeChannelGate,
  feishuEmployeeIdentityId,
  feishuEmployeeRowStatusLabel,
  loadFeishuEmployeeChannelGate,
  projectFeishuEmployeeToolResult,
  readFeishuEmployeeConnection,
  refreshFeishuEmployeeConnection,
  resolveFeishuEnterpriseAccountId,
  type FeishuEmployeeChannelGate,
} from "./enterprise-im-employee-connection.js";
import { saveTenantConfigStore, type TenantConfigStore } from "./tenant-config.js";
import {
  loadUserOperationalIdentityStore,
  saveUserOperationalIdentityStore,
} from "./user-operational-identity-persistence.js";
import { formatUserOperationalIdentityRuntimePrompt } from "./user-operational-identity-runtime.js";
import {
  loadUserOperationalIdentityCredentialSecretStore,
  saveUserOperationalIdentityCredentialSecretStore,
} from "./user-operational-identity-secrets-persistence.js";
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

  it("does not treat another account on the merged config as this tenant's connection", async () => {
    const foreign = {
      channels: {
        feishu: {
          enabled: true,
          accounts: {
            other: {
              platformEnterpriseId: "platform-key",
              appId: "cli_platform",
              appSecret: "platform-secret",
            },
          },
        },
      },
    };
    expect(resolveFeishuEnterpriseAccountId(foreign, "001")).toBeNull();
    const gate = feishuEmployeeChannelGate({ config: foreign, tenantId: "001" });
    expect(gate.loginEnabled).toBe(false);
    expect(gate.childExecutionBlocked).toBe(true);
    expect(gate.statusLabel).toBe("企业尚未开通");

    const dir = mkdtempSync(path.join(tmpdir(), "feishu-tenant-"));
    const tenantPath = path.join(dir, "tenant-config.json");
    const tenantStore: TenantConfigStore = {
      version: 1,
      tenants: {
        "001": { tenantId: "001", override: {}, updatedAt: "2026-11-07T00:00:00.000Z" },
      },
    };
    await saveTenantConfigStore(tenantStore, tenantPath);
    const loaded = await loadFeishuEmployeeChannelGate({ tenantId: "001", storePath: tenantPath });
    expect(loaded.childExecutionBlocked).toBe(true);
    expect(loaded.loginEnabled).toBe(false);
    const store = emptyStore();
    const secrets = emptySecrets();
    const bound = bindEmployee({ store, secrets, ownerId: "emp-a", openId: "ou_a" });
    expect(
      allowFeishuEmployeeCredentialUse({
        store,
        secretStore: secrets,
        ownerId: "emp-a",
        identityId: bound.identityId!,
        gate: loaded,
      }).code,
    ).toBe("ENTERPRISE_CONNECTION_BLOCKED");
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses credential use after refresh failure and after the access token expires", async () => {
    const store = emptyStore();
    const secrets = emptySecrets();
    const gate = openGate();
    const bound = bindEmployee({ store, secrets, ownerId: "emp-a", openId: "ou_a" });
    const failed = await refreshFeishuEmployeeConnection({
      store,
      secretStore: secrets,
      ownerId: "emp-a",
      identityId: bound.identityId!,
      gate,
      nowIso: "2026-11-07T00:03:00.000Z",
      exchange: async () => {
        throw new Error("refresh rejected");
      },
    });
    expect(failed.code).toBe("REFRESH_FAILED");
    expect(store.identities[bound.identityId!]?.status).toBe("reauth_required");
    expect(Object.values(secrets.secrets)[0]?.accessToken).toBe(SECRET);
    expect(
      allowFeishuEmployeeCredentialUse({
        store,
        secretStore: secrets,
        ownerId: "emp-a",
        identityId: bound.identityId!,
        gate,
      }).code,
    ).toBe("REAUTH_REQUIRED");

    const fresh = emptyStore();
    const freshSecrets = emptySecrets();
    const expired = bindEmployee({
      store: fresh,
      secrets: freshSecrets,
      ownerId: "emp-a",
      openId: "ou_a",
    });
    fresh.identities[expired.identityId!].expiresAt = "2026-11-07T00:00:00.000Z";
    freshSecrets.secrets[fresh.identities[expired.identityId!].credentialHandleId].expiresAt =
      "2026-11-07T00:00:00.000Z";
    expect(
      allowFeishuEmployeeCredentialUse({
        store: fresh,
        secretStore: freshSecrets,
        ownerId: "emp-a",
        identityId: expired.identityId!,
        gate,
        nowIso: "2026-11-07T00:05:00.000Z",
      }).code,
    ).toBe("TOKEN_EXPIRED");
  });

  it("persists a real refresh-token request and the rotated token still works after reload", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "feishu-refresh-"));
    const stateDir = path.join(dir, "state");
    const tenantPath = path.join(dir, "tenant-config.json");
    const identityPath = path.join(dir, "identity.json");
    const secretPath = path.join(dir, "secrets.json");
    const capability = {
      checkedAt: "2026-11-07T00:00:00.000Z",
      projectGroupRead: "granted",
      projectDocs: "granted",
      sendAsUser: "granted",
      newMessageTrigger: "granted",
    };
    await saveTenantConfigStore(
      {
        version: 1,
        tenants: {
          "001": {
            tenantId: "001",
            updatedAt: "2026-11-07T00:00:00.000Z",
            override: {
              channels: {
                feishu: {
                  enabled: true,
                  accounts: {
                    t_001_default: {
                      appId: "cli_public",
                      appSecret: "app-secret-value",
                      platformEnterpriseId: "tenant-key-1",
                      capabilityStatus: capability,
                    },
                  },
                },
              },
            },
          },
        },
      },
      tenantPath,
    );
    const store = emptyStore();
    const secrets = emptySecrets();
    const bound = bindEmployee({ store, secrets, ownerId: "emp-a", openId: "ou_a" });
    await saveUserOperationalIdentityStore(store, identityPath, {
      governanceStateDir: stateDir,
      governanceOwnershipProof: ownershipProofFromTenantUser({ tenantId: "001", userId: "emp-a" }),
    });
    await saveUserOperationalIdentityCredentialSecretStore(secrets, secretPath);
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      expect(url).toContain("/open-apis/authen/v2/oauth/token");
      const rawBody = init?.body;
      const body = JSON.parse(typeof rawBody === "string" ? rawBody : "{}") as {
        grant_type?: string;
        refresh_token?: string;
      };
      expect(body.grant_type).toBe("refresh_token");
      expect(body.refresh_token).toBe(REFRESH);
      return {
        json: async () => ({
          code: 0,
          access_token: "rotated-access",
          refresh_token: "rotated-refresh",
          expires_in: 3600,
          tenant_key: "tenant-key-1",
          open_id: "ou_a",
          scope: "offline_access im:message",
        }),
      } as Response;
    });
    const renewed = await renewPersistedFeishuEmployeeConnection({
      ownerId: "emp-a",
      tenantId: "001",
      identityId: bound.identityId!,
      nowIso: "2026-11-07T00:04:00.000Z",
      identityStorePath: identityPath,
      secretStorePath: secretPath,
      tenantConfigPath: tenantPath,
      governanceStateDir: stateDir,
      fetchImpl,
    });
    expect(renewed.ok).toBe(true);
    expect(JSON.stringify(renewed)).not.toContain("rotated-access");
    expect(JSON.stringify(renewed)).not.toContain("rotated-refresh");
    expect(JSON.stringify(renewed)).not.toContain(REFRESH);
    const reloadedStore = await loadUserOperationalIdentityStore(identityPath);
    const reloadedSecrets = await loadUserOperationalIdentityCredentialSecretStore(secretPath);
    const stored = Object.values(reloadedSecrets.secrets)[0];
    expect(stored?.accessToken).toBe("rotated-access");
    expect(stored?.refreshToken).toBe("rotated-refresh");
    expect(JSON.stringify(reloadedSecrets)).not.toContain(REFRESH);
    const gate = await loadFeishuEmployeeChannelGate({ tenantId: "001", storePath: tenantPath });
    const used = allowFeishuEmployeeCredentialUse({
      store: reloadedStore,
      secretStore: reloadedSecrets,
      ownerId: "emp-a",
      identityId: bound.identityId!,
      gate,
      nowIso: "2026-11-07T00:04:00.000Z",
    });
    expect(used.ok).toBe(true);
    expect(JSON.stringify(used)).not.toContain("rotated-access");
    resetSharedDataGovernanceCatalogForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  it("projects bound-row labels with enterprise gate before auth status", () => {
    const link = {
      authorizationLevel: "authorized" as const,
      localCredentialsDeleted: false,
      platformRevokeRecorded: false,
    };
    expect(
      feishuEmployeeRowStatusLabel({
        gate: {
          employeeUiHint: "enterprise_not_open",
          childExecutionBlocked: true,
          statusLabel: "企业尚未开通",
        },
        status: "active",
        enterpriseIm: link,
      }),
    ).toBe("企业尚未开通");
    expect(
      feishuEmployeeRowStatusLabel({
        gate: {
          employeeUiHint: "waiting_admin_scopes",
          childExecutionBlocked: false,
          statusLabel: "等待管理员开通权限",
        },
        status: "active",
        enterpriseIm: link,
      }),
    ).toBe("等待管理员开通权限");
    expect(
      feishuEmployeeRowStatusLabel({
        gate: {
          employeeUiHint: "app_can_attempt",
          childExecutionBlocked: false,
          statusLabel: "可绑定",
        },
        status: "reauth_required",
        enterpriseIm: link,
      }),
    ).toBe("需重新认证");
  });
});
