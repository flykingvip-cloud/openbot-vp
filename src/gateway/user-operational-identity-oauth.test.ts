import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config/config.js";
import type { TenantContext } from "./tenant-context.js";
import { resolveTenantUserOperationalIdentityStorePathForContext } from "./tenant-store-paths.js";
import {
  completeUserOperationalIdentityOAuthCallback,
  simulateCompleteUserOperationalIdentityOAuthSession,
  startUserOperationalIdentityOAuthSession,
} from "./user-operational-identity-oauth.js";
import {
  loadUserOperationalIdentityStore,
  normalizeUserOperationalIdentityStore,
  saveUserOperationalIdentityStore,
  withUserOperationalIdentityStoreWriteLock,
  withUserOperationalIdentityStoreWriteLockForOwner,
} from "./user-operational-identity-persistence.js";
import { loadUserOperationalIdentityCredentialSecretStore } from "./user-operational-identity-secrets-persistence.js";

vi.mock("../config/config.js", () => ({
  loadConfig: vi.fn(() => ({ data: { mode: "local" } })),
}));

const testPaths = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-user-oi-oauth-test-${Date.now()}`,
}));

vi.mock("../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: testPaths.tmpDir,
  };
});

describe("user operational identity oauth", () => {
  const ownerId = "user-1";
  const nowIso = "2026-06-06T12:00:00.000Z";

  it("simulated oauth creates verified credential secret and identity", async () => {
    const started = await withUserOperationalIdentityStoreWriteLock((store) =>
      startUserOperationalIdentityOAuthSession({
        store,
        ownerId,
        provider: "github-personal",
        displayName: "My GitHub",
        callbackOrigin: "http://127.0.0.1:18789",
        nowIso,
      }),
    );
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    expect(started.simulateAllowed).toBe(true);

    const completed = await simulateCompleteUserOperationalIdentityOAuthSession({
      ownerId,
      sessionId: started.session.sessionId,
      externalAccountId: "octocat",
      nowIso,
    });
    expect(completed.ok).toBe(true);
    if (!completed.ok) {
      return;
    }
    expect(completed.credentialHandleId).toBeTruthy();
    expect(completed.identityId).toBeTruthy();

    const secretStore = await loadUserOperationalIdentityCredentialSecretStore();
    expect(secretStore.secrets[completed.credentialHandleId]?.accessToken).toContain("simulated:");
  });

  it("reauthorize oauth rotates credential handle without creating a new identity", async () => {
    const started = await withUserOperationalIdentityStoreWriteLock((store) =>
      startUserOperationalIdentityOAuthSession({
        store,
        ownerId,
        provider: "github-personal",
        nowIso,
      }),
    );
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }

    const bind = await simulateCompleteUserOperationalIdentityOAuthSession({
      ownerId,
      sessionId: started.session.sessionId,
      externalAccountId: "octocat",
      nowIso,
    });
    expect(bind.ok).toBe(true);
    if (!bind.ok || !bind.identityId) {
      return;
    }
    const identityId = bind.identityId;
    const reauthStart = await withUserOperationalIdentityStoreWriteLock((store) =>
      startUserOperationalIdentityOAuthSession({
        store,
        ownerId,
        provider: "github-personal",
        identityId,
        nowIso: "2026-06-06T12:30:00.000Z",
      }),
    );
    expect(reauthStart.ok).toBe(true);
    if (!reauthStart.ok) {
      return;
    }
    expect(reauthStart.session.purpose).toBe("reauthorize");

    const reauthComplete = await simulateCompleteUserOperationalIdentityOAuthSession({
      ownerId,
      sessionId: reauthStart.session.sessionId,
      externalAccountId: "octocat-v2",
      nowIso: "2026-06-06T12:31:00.000Z",
    });
    expect(reauthComplete.ok).toBe(true);
    if (!reauthComplete.ok) {
      return;
    }
    expect(reauthComplete.identityId).toBe(identityId);
    expect(reauthComplete.credentialHandleId).not.toBe(bind.credentialHandleId);
  });

  it("rejects simulate-complete for github authorization_code sessions", async () => {
    const store = normalizeUserOperationalIdentityStore(null);
    const session = {
      sessionId: "sess-1",
      state: "state-1",
      ownerId,
      provider: "github-personal" as const,
      mode: "github_authorization_code" as const,
      status: "pending" as const,
      createdAt: nowIso,
      expiresAt: "2026-06-06T13:00:00.000Z",
    };
    store.oauthSessions[session.sessionId] = session;
    await withUserOperationalIdentityStoreWriteLock(async (locked) => {
      locked.oauthSessions = store.oauthSessions;
      return locked;
    });
    const result = await simulateCompleteUserOperationalIdentityOAuthSession({
      ownerId,
      sessionId: session.sessionId,
      nowIso,
    });
    expect(result.ok).toBe(false);
  });
});

describe("user operational identity oauth (shared multitenant HTTP callback)", () => {
  const ownerId = "user-1";
  const nowIso = "2026-06-06T12:00:00.000Z";

  beforeEach(() => {
    fs.rmSync(testPaths.tmpDir, { recursive: true, force: true });
    fs.mkdirSync(testPaths.tmpDir, { recursive: true });
    process.env.OPENBOT_MULTITENANT = "1";
    process.env.OPENBOT_TENANTS_ROOT = path.join(testPaths.tmpDir, "tenants");
    vi.mocked(loadConfig).mockReturnValue({ data: { mode: "managed" } } as ReturnType<
      typeof loadConfig
    >);
  });

  afterEach(() => {
    delete process.env.OPENBOT_MULTITENANT;
    delete process.env.OPENBOT_TENANTS_ROOT;
    vi.mocked(loadConfig).mockReturnValue({ data: { mode: "local" } } as ReturnType<
      typeof loadConfig
    >);
  });

  it("locates pending session in per-tenant identity store by state", async () => {
    const tenantId = "acme";
    const ctx: TenantContext = { tenantId, userId: ownerId, domain: "employee" };
    const storePath = resolveTenantUserOperationalIdentityStorePathForContext(ctx);
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    const store = normalizeUserOperationalIdentityStore(null);
    const session = {
      sessionId: "sess-scan",
      state: "state-scan-test",
      ownerId,
      tenantId,
      provider: "github-personal" as const,
      mode: "github_authorization_code" as const,
      status: "pending" as const,
      createdAt: nowIso,
      expiresAt: "2026-06-06T13:00:00.000Z",
    };
    store.oauthSessions[session.sessionId] = session;
    await saveUserOperationalIdentityStore(store, storePath);

    const result = await completeUserOperationalIdentityOAuthCallback({
      state: session.state,
      code: "auth-code",
      redirectUri: "http://127.0.0.1:18789/__openbot/user-operational-identity/oauth/callback",
      nowIso,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).not.toBe("USER_IDENTITY_OAUTH_SESSION_NOT_FOUND");
  });

  it("managed-tenant simulate-complete opens tenant store, stamps identity.tenantId, isolates peers", async () => {
    const tenantId = "acme";
    const otherTenantId = "beta";
    const ctx: TenantContext = { tenantId, userId: ownerId, domain: "employee" };
    const storePath = resolveTenantUserOperationalIdentityStorePathForContext(ctx);
    const otherStorePath = resolveTenantUserOperationalIdentityStorePathForContext({
      tenantId: otherTenantId,
      userId: ownerId,
      domain: "employee",
    });
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.mkdirSync(path.dirname(otherStorePath), { recursive: true });
    const governanceStateDir = path.join(testPaths.tmpDir, "governance-state");
    fs.mkdirSync(governanceStateDir, { recursive: true });

    const started = await withUserOperationalIdentityStoreWriteLockForOwner(
      { ownerId, tenantId, storePath, governanceStateDir },
      (store) =>
        startUserOperationalIdentityOAuthSession({
          store,
          ownerId,
          tenantId,
          provider: "github-personal",
          displayName: "Acme GitHub",
          nowIso,
        }),
    );
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    expect(started.session.tenantId).toBe(tenantId);

    const nullTenantWithManagedPath = await simulateCompleteUserOperationalIdentityOAuthSession({
      ownerId,
      sessionId: started.session.sessionId,
      tenantId: null,
      storePath,
      governanceStateDir,
      nowIso,
    });
    expect(nullTenantWithManagedPath.ok).toBe(false);
    if (!nullTenantWithManagedPath.ok) {
      expect(nullTenantWithManagedPath.code).toBe("USER_IDENTITY_OAUTH_SESSION_NOT_FOUND");
    }

    const otherTenantWithManagedPath = await simulateCompleteUserOperationalIdentityOAuthSession({
      ownerId,
      sessionId: started.session.sessionId,
      tenantId: otherTenantId,
      storePath,
      governanceStateDir,
      nowIso,
    });
    expect(otherTenantWithManagedPath.ok).toBe(false);
    if (!otherTenantWithManagedPath.ok) {
      expect(otherTenantWithManagedPath.code).toBe("USER_IDENTITY_OAUTH_SESSION_NOT_FOUND");
    }

    const wrongTenant = await simulateCompleteUserOperationalIdentityOAuthSession({
      ownerId,
      sessionId: started.session.sessionId,
      tenantId: otherTenantId,
      governanceStateDir,
      nowIso,
    });
    expect(wrongTenant.ok).toBe(false);
    if (!wrongTenant.ok) {
      expect(wrongTenant.code).toBe("USER_IDENTITY_OAUTH_SESSION_NOT_FOUND");
    }

    const legacyMiss = await simulateCompleteUserOperationalIdentityOAuthSession({
      ownerId,
      sessionId: started.session.sessionId,
      tenantId: null,
      governanceStateDir,
      nowIso,
    });
    expect(legacyMiss.ok).toBe(false);
    if (!legacyMiss.ok) {
      expect(legacyMiss.code).toBe("USER_IDENTITY_OAUTH_SESSION_NOT_FOUND");
    }

    const completed = await simulateCompleteUserOperationalIdentityOAuthSession({
      ownerId,
      sessionId: started.session.sessionId,
      tenantId,
      // Canonical path only — mismatch overrides are rejected above.
      storePath,
      governanceStateDir,
      externalAccountId: "octocat-acme",
      nowIso,
    });
    expect(completed.ok).toBe(true);
    if (!completed.ok || !completed.identityId) {
      return;
    }

    // Successful completion lands only in the authenticated tenant store.
    const tenantStore = await loadUserOperationalIdentityStore(storePath);
    expect(tenantStore.oauthSessions[started.session.sessionId]?.status).toBe("completed");
    const identity = tenantStore.identities[completed.identityId];
    expect(identity?.tenantId).toBe(tenantId);
    const createdEvent = Object.values(tenantStore.lifecycleEvents).find(
      (event) => event.action === "created" && event.identityId === completed.identityId,
    );
    expect(createdEvent?.tenantId).toBe(tenantId);

    const otherStore = await loadUserOperationalIdentityStore(otherStorePath);
    expect(otherStore.oauthSessions[started.session.sessionId]).toBeUndefined();
    expect(otherStore.identities[completed.identityId]).toBeUndefined();
  });
});

describe("user operational identity oauth (x-twitter adapter)", () => {
  const ownerId = "user-x";
  const nowIso = "2026-10-14T12:00:00.000Z";
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "OPENBOT_USER_OPERATIONAL_IDENTITY_X_TWITTER_CLIENT_ID",
      "OPENBOT_USER_OPERATIONAL_IDENTITY_X_TWITTER_CLIENT_SECRET",
      "OPENBOT_USER_OPERATIONAL_IDENTITY_X_TWITTER_REDIRECT_URI",
      "X_TWITTER_CLIENT_ID",
      "X_TWITTER_CLIENT_SECRET",
      "X_TWITTER_REDIRECT_URI",
    ]) {
      prev[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("falls back to simulated when X OAuth env is missing", async () => {
    const started = await withUserOperationalIdentityStoreWriteLock((store) =>
      startUserOperationalIdentityOAuthSession({
        store,
        ownerId,
        provider: "x-twitter",
        displayName: "My X",
        callbackOrigin: "http://127.0.0.1:18789",
        nowIso,
      }),
    );
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    expect(started.simulateAllowed).toBe(true);
    expect(started.session.mode).toBe("simulated");
    expect(started.authorizeUrl).toBeNull();
  });

  it("starts adapter_authorization_code with PKCE when X env is configured", async () => {
    process.env.OPENBOT_USER_OPERATIONAL_IDENTITY_X_TWITTER_CLIENT_ID = "x-client";
    process.env.OPENBOT_USER_OPERATIONAL_IDENTITY_X_TWITTER_CLIENT_SECRET = "x-secret";
    const started = await withUserOperationalIdentityStoreWriteLock((store) =>
      startUserOperationalIdentityOAuthSession({
        store,
        ownerId,
        provider: "x-twitter",
        displayName: "My X",
        callbackOrigin: "http://127.0.0.1:18789",
        nowIso,
      }),
    );
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    expect(started.simulateAllowed).toBe(false);
    expect(started.session.mode).toBe("adapter_authorization_code");
    expect(started.session.codeVerifier).toBeTruthy();
    expect(started.authorizeUrl).toContain("https://x.com/i/oauth2/authorize");
    expect(started.authorizeUrl).toContain("code_challenge");
    expect(started.authorizeUrl).toContain("tweet.write");
  });

  it("accepts X_TWITTER_* aliases for client config", async () => {
    process.env.X_TWITTER_CLIENT_ID = "alias-client";
    process.env.X_TWITTER_CLIENT_SECRET = "alias-secret";
    const started = await withUserOperationalIdentityStoreWriteLock((store) =>
      startUserOperationalIdentityOAuthSession({
        store,
        ownerId,
        provider: "x-twitter",
        callbackOrigin: "http://127.0.0.1:18789",
        nowIso,
      }),
    );
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    expect(started.session.mode).toBe("adapter_authorization_code");
    expect(started.authorizeUrl).toContain("client_id=alias-client");
  });
});
