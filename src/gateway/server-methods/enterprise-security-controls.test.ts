import { describe, expect, it, afterEach } from "vitest";
import {
  ENTERPRISE_SECURITY_MFA_ENROLL_METHOD,
  ENTERPRISE_SECURITY_SESSIONS_LIST_METHOD,
  ENTERPRISE_SECURITY_SESSIONS_REVOKE_METHOD,
  MFA_ENROLLMENT_TTL_MS,
} from "../enterprise-security/controls.js";
import { createMemoryIdempotencyStore } from "../enterprise-security/idempotency.js";
import { authorizeOperatorScopesForMethod } from "../method-scopes.js";
import type { ResolvedPlatformAuthConfig } from "../platform-auth/config.js";
import type { MfaSecretRecord } from "../platform-auth/mfa-store.js";
import type {
  PlatformAuthSessionRecord,
  PlatformAuthStore,
  PlatformAuthUser,
} from "../platform-auth/store-types.js";
import { listGatewayMethods } from "../server-methods-list.js";
import {
  enterpriseSecurityControlHandlers,
  setEnterpriseSecurityControlDepsForTests,
} from "./enterprise-security-controls.js";
import type { GatewayClient } from "./types.js";

const NOW = Date.parse("2026-10-12T00:00:00.000Z");

function user(id = "user-1"): PlatformAuthUser {
  return {
    id,
    email: "admin@example.com",
    normalizedEmail: "admin@example.com",
    displayName: "Admin",
    passwordHash: "hash",
    passwordUpdatedAt: "2026-10-01T00:00:00.000Z",
    loginFailedCount: 0,
    status: "active",
    source: "self-created",
    role: "operator",
    scopes: ["operator.admin"],
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

function session(
  id: string,
  over: Partial<PlatformAuthSessionRecord> = {},
): PlatformAuthSessionRecord {
  return {
    id,
    userId: "user-1",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
    sessionIssuedAt: "2026-10-01T00:00:00.000Z",
    expiresAt: "2026-12-01T00:00:00.000Z",
    domain: "enterprise",
    sessionKind: "enterprise-admin",
    enterpriseId: "tenant-a",
    membershipId: "mem-1",
    ...over,
  };
}

function storeWith(sessions: PlatformAuthSessionRecord[]): PlatformAuthStore {
  return {
    version: 5,
    secret: "test-secret",
    policy: { updatedAt: "2026-10-01T00:00:00.000Z" },
    enterprises: {},
    users: { "user-1": user() },
    sessions: Object.fromEntries(sessions.map((entry) => [entry.id, entry])),
    memberships: {},
    adminProvisions: {},
    employeeProvisions: {},
    activationCodes: {},
    trialApplications: {},
    leadNotifications: {},
  } as unknown as PlatformAuthStore;
}

function client(over: Partial<GatewayClient> = {}): GatewayClient {
  return {
    connect: {
      minProtocol: 1,
      maxProtocol: 3,
      client: {
        id: "openbot-control-ui",
        displayName: "test",
        version: "0",
        platform: "web",
        mode: "webchat",
      },
      scopes: ["operator.admin"],
    },
    user: "admin@example.com",
    platformUserId: "user-1",
    sessionDomain: "enterprise",
    sessionKind: "enterprise-admin",
    sessionEnterpriseId: "tenant-a",
    ...over,
  };
}

type InvokeResult = {
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { code?: string; message?: string };
};

function invoke(
  method: string,
  params: Record<string, unknown>,
  caller: GatewayClient | null = client(),
) {
  const handler = enterpriseSecurityControlHandlers[method];
  return new Promise<InvokeResult>((resolve) => {
    void handler({
      req: { id: "1", method, type: "req" },
      params,
      client: caller,
      isWebchatConnect: () => false,
      respond: (ok, payload, error) => {
        resolve({
          ok,
          payload: payload as Record<string, unknown> | undefined,
          error: error as InvokeResult["error"],
        });
      },
      context: {} as never,
    });
  });
}

function install(params: {
  store: PlatformAuthStore;
  callerSessionId?: string | null;
  now?: number;
}) {
  let record: MfaSecretRecord | null = null;
  const idempotency = createMemoryIdempotencyStore();
  setEnterpriseSecurityControlDepsForTests({
    now: () => params.now ?? NOW,
    idempotency,
    async withAuth(action) {
      const outcome = await action({
        config: { cookieName: "openbot_platform_session" } as ResolvedPlatformAuthConfig,
        store: params.store,
      });
      return outcome.value;
    },
    callerSessionId: () =>
      params.callerSessionId === undefined ? "sess-current" : params.callerSessionId,
    mfa: {
      async enroll(userId, email) {
        record = {
          userId,
          secret: `secret-for-${email}`,
          algorithm: "SHA1",
          digits: 6,
          periodSeconds: 30,
          pending: true,
          recoveryCodes: ["recovery-1"],
          createdAt: new Date(params.now ?? NOW).toISOString(),
        };
        return {
          secret: record.secret,
          otpAuthUrl: `otpauth://totp/OpenBot:${email}?secret=SECRET`,
          recoveryCodes: ["recovery-1"],
        };
      },
      async activate(_userId, code) {
        if (!record || record.revokedAt || code !== "123456") {
          return false;
        }
        record.pending = false;
        record.verifiedAt = new Date(params.now ?? NOW).toISOString();
        return true;
      },
      async secret() {
        return record;
      },
      async revoke() {
        if (record) {
          record.revokedAt = new Date(params.now ?? NOW).toISOString();
          record.pending = false;
        }
      },
    },
  });
  return {
    secret: () => record,
    setSecret(next: MfaSecretRecord | null) {
      record = next;
    },
  };
}

describe("enterprise security controls", () => {
  afterEach(() => {
    setEnterpriseSecurityControlDepsForTests(null);
  });

  it("registers mfa enroll and login session methods under their scopes", () => {
    expect(listGatewayMethods()).toContain(ENTERPRISE_SECURITY_MFA_ENROLL_METHOD);
    expect(listGatewayMethods()).toContain(ENTERPRISE_SECURITY_SESSIONS_LIST_METHOD);
    expect(listGatewayMethods()).toContain(ENTERPRISE_SECURITY_SESSIONS_REVOKE_METHOD);
    expect(listGatewayMethods()).toContain("enterprise.security.session-policy.set");
    expect(listGatewayMethods()).toContain("enterprise.security.ip-allowlist.set");
    expect(listGatewayMethods()).toContain("enterprise.security.audit.export");
    expect(listGatewayMethods()).toContain("enterprise.access.roles.create");
    expect(listGatewayMethods()).toContain("enterprise.mesh.asset.pause");
    expect(listGatewayMethods()).toContain("enterprise.mesh.asset-budget.set");
    expect(listGatewayMethods()).toContain("enterprise.access.permissions.commit");
    expect(
      authorizeOperatorScopesForMethod(ENTERPRISE_SECURITY_MFA_ENROLL_METHOD, ["operator.admin"])
        .allowed,
    ).toBe(true);
    expect(
      authorizeOperatorScopesForMethod(ENTERPRISE_SECURITY_SESSIONS_LIST_METHOD, ["operator.read"])
        .allowed,
    ).toBe(true);
    expect(
      authorizeOperatorScopesForMethod(ENTERPRISE_SECURITY_SESSIONS_REVOKE_METHOD, [
        "operator.read",
      ]).allowed,
    ).toBe(false);
  });

  it("rejects platform and employee sessions", async () => {
    install({ store: storeWith([]) });
    const platform = await invoke(
      ENTERPRISE_SECURITY_MFA_ENROLL_METHOD,
      { action: "start", idempotencyKey: "k1" },
      client({ sessionDomain: "platform", sessionKind: "platform-admin" }),
    );
    expect(platform.ok).toBe(false);
    expect(platform.error?.message).toContain("platform session");

    const employee = await invoke(
      ENTERPRISE_SECURITY_SESSIONS_LIST_METHOD,
      {},
      client({ sessionDomain: "employee", sessionKind: "member" }),
    );
    expect(employee.ok).toBe(false);
    expect(employee.error?.message).toContain("employee session");
  });

  it("starts MFA once, replays the same provisioning material, and confirms it", async () => {
    const mfa = install({ store: storeWith([]) });
    const started = await invoke(ENTERPRISE_SECURITY_MFA_ENROLL_METHOD, {
      action: "start",
      idempotencyKey: "enroll-1",
    });
    expect(started.ok).toBe(true);
    expect(started.payload).toMatchObject({
      ok: true,
      enabled: false,
      otpAuthUrl: "otpauth://totp/OpenBot:admin@example.com?secret=SECRET",
      recoveryCodes: ["recovery-1"],
    });

    const replay = await invoke(ENTERPRISE_SECURITY_MFA_ENROLL_METHOD, {
      action: "start",
      idempotencyKey: "enroll-1",
    });
    expect(replay.payload).toEqual(started.payload);
    expect(mfa.secret()?.secret).toBe("secret-for-admin@example.com");

    const conflict = await invoke(ENTERPRISE_SECURITY_MFA_ENROLL_METHOD, {
      action: "confirm",
      code: "123456",
      idempotencyKey: "enroll-1",
    });
    expect(conflict.payload).toMatchObject({ ok: false, reason: "idempotency_conflict" });
    expect(conflict.payload?.otpAuthUrl).toBeUndefined();
    expect(mfa.secret()?.pending).toBe(true);

    const confirmed = await invoke(ENTERPRISE_SECURITY_MFA_ENROLL_METHOD, {
      action: "confirm",
      code: "123456",
      idempotencyKey: "enroll-2",
    });
    expect(confirmed.payload).toEqual({ ok: true, enabled: true });
    expect(confirmed.payload?.otpAuthUrl).toBeUndefined();
    expect(confirmed.payload?.recoveryCodes).toBeUndefined();

    const again = await invoke(ENTERPRISE_SECURITY_MFA_ENROLL_METHOD, {
      action: "start",
      idempotencyKey: "enroll-3",
    });
    expect(again.payload).toMatchObject({ ok: false, enabled: true, reason: "already_enabled" });
    expect(again.payload?.otpAuthUrl).toBeUndefined();
  });

  it("refuses an expired pending enrollment without activating it", async () => {
    const mfa = install({ store: storeWith([]), now: NOW });
    mfa.setSecret({
      userId: "user-1",
      secret: "old",
      algorithm: "SHA1",
      digits: 6,
      periodSeconds: 30,
      pending: true,
      recoveryCodes: ["recovery-1"],
      createdAt: new Date(NOW - MFA_ENROLLMENT_TTL_MS - 1000).toISOString(),
    });
    const expired = await invoke(ENTERPRISE_SECURITY_MFA_ENROLL_METHOD, {
      action: "confirm",
      code: "123456",
      idempotencyKey: "expired-1",
    });
    expect(expired.payload).toMatchObject({ ok: false, reason: "enrollment_expired" });
    expect(mfa.secret()?.revokedAt).toBeTruthy();
    expect(mfa.secret()?.pending).toBe(false);
  });

  it("lists only this tenant's login sessions and revokes the others", async () => {
    const auth = storeWith([
      session("sess-current", { createdAt: "2026-10-03T00:00:00.000Z" }),
      session("sess-other", {
        userId: "user-2",
        createdAt: "2026-10-04T00:00:00.000Z",
        updatedAt: "2026-10-05T00:00:00.000Z",
        sessionKind: "member",
        domain: "employee",
      }),
      session("sess-foreign", { enterpriseId: "tenant-b" }),
      session("sess-platform", {
        domain: "platform",
        sessionKind: "platform-admin",
        enterpriseId: undefined,
        membershipId: undefined,
      }),
    ]);
    install({ store: auth, callerSessionId: "sess-current" });

    const listed = await invoke(ENTERPRISE_SECURITY_SESSIONS_LIST_METHOD, { limit: 50 });
    expect(listed.payload?.sessions).toEqual([
      {
        sessionId: "sess-other",
        userId: "user-2",
        createdAt: "2026-10-04T00:00:00.000Z",
        lastSeenAt: "2026-10-05T00:00:00.000Z",
        current: false,
      },
      {
        sessionId: "sess-current",
        userId: "user-1",
        createdAt: "2026-10-03T00:00:00.000Z",
        lastSeenAt: "2026-10-02T00:00:00.000Z",
        current: true,
      },
    ]);

    const protectedCall = await invoke(ENTERPRISE_SECURITY_SESSIONS_REVOKE_METHOD, {
      sessionIds: ["sess-current"],
      idempotencyKey: "revoke-current",
    });
    expect(protectedCall.payload).toMatchObject({
      ok: false,
      revoked: [],
      reason: "current_session_protected",
    });
    expect(auth.sessions["sess-current"]).toBeDefined();

    const missing = await invoke(ENTERPRISE_SECURITY_SESSIONS_REVOKE_METHOD, {
      sessionIds: ["sess-foreign"],
      idempotencyKey: "revoke-foreign",
    });
    expect(missing.payload).toMatchObject({ ok: false, reason: "session_not_found" });
    expect(auth.sessions["sess-other"]).toBeDefined();

    const revoked = await invoke(ENTERPRISE_SECURITY_SESSIONS_REVOKE_METHOD, {
      allExceptCurrent: true,
      idempotencyKey: "revoke-rest",
    });
    expect(revoked.payload).toEqual({ ok: true, revoked: ["sess-other"] });
    expect(auth.sessions["sess-other"]).toBeUndefined();
    expect(auth.sessions["sess-current"]).toBeDefined();
    expect(auth.sessions["sess-foreign"]).toBeDefined();

    auth.sessions["sess-other"] = session("sess-other");
    const replay = await invoke(ENTERPRISE_SECURITY_SESSIONS_REVOKE_METHOD, {
      allExceptCurrent: true,
      idempotencyKey: "revoke-rest",
    });
    expect(replay.payload).toEqual({ ok: true, revoked: ["sess-other"] });
    expect(auth.sessions["sess-other"]).toBeDefined();
  });

  it("does not revoke when the caller session cannot be resolved", async () => {
    const auth = storeWith([session("sess-other", { id: "sess-other" })]);
    install({ store: auth, callerSessionId: null });
    const result = await invoke(ENTERPRISE_SECURITY_SESSIONS_REVOKE_METHOD, {
      allExceptCurrent: true,
      idempotencyKey: "revoke-unknown-caller",
    });
    expect(result.payload).toMatchObject({ ok: false, reason: "current_session_protected" });
    expect(auth.sessions["sess-other"]).toBeDefined();
  });
});
