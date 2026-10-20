import fs from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONTROL_UI_PLATFORM_AUTH_BASE_PATH } from "../control-ui-contract.js";
import { handleControlUiPlatformAuthRequest, type PlatformAuthStore } from "../platform-auth.js";
import { makeMockHttpResponse } from "../test-http-response.js";
import { activateMfaEnrollment, enrollMfa } from "./mfa-store.js";
import { currentTotp } from "./mfa-totp.js";
import { loginUrlForSurface } from "./target-surface.js";

function makeJsonRequest(params: {
  url: string;
  method: "POST" | "GET";
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}): IncomingMessage {
  const body = params.body ? JSON.stringify(params.body) : "";
  const req = Readable.from(body ? [body] : []) as IncomingMessage;
  Object.assign(req, {
    url: params.url,
    method: params.method,
    headers: params.headers ?? {},
  });
  Object.defineProperty(req, "socket", {
    value: { remoteAddress: "127.0.0.1" },
    configurable: true,
  });
  return req;
}

const LOGIN_URL = `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/login`;
const BOOTSTRAP_URL = `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/platform/bootstrap`;

type TrustedProxy = {
  enabled: boolean;
  userHeader: string;
  platformAuth: {
    enabled: boolean;
    store: string;
    requireMfaForPlatformAdmins?: boolean;
  };
};

describe("platform login MFA gate", () => {
  let tempDir = "";
  let storePath = "";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-login-mfa-"));
    storePath = path.join(tempDir, "platform-auth.json");
    // Audit + MFA stores live under CONFIG_DIR; point HOME-derived CONFIG_DIR at tempDir
    // is not trivial here, so we rely on the store path + the real CONFIG_DIR for mfa file.
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function proxy(requireMfa: boolean): TrustedProxy {
    return {
      enabled: true,
      userHeader: "x-forwarded-user",
      platformAuth: {
        enabled: true,
        store: storePath,
        requireMfaForPlatformAdmins: requireMfa,
      },
    };
  }

  /**
   * Gives the bootstrap account one enterprise membership so the employee entry
   * can resolve a bound member session instead of a platform session.
   */
  async function seedMembershipForRoot(): Promise<void> {
    const store = JSON.parse(await fs.readFile(storePath, "utf8")) as PlatformAuthStore;
    const user = Object.values(store.users).find(
      (entry) => entry.normalizedEmail === "root@example.com",
    );
    if (!user) {
      throw new Error("bootstrap user not found");
    }
    const nowIso = "2026-07-31T00:00:00.000Z";
    store.enterprises["ent-seed"] = {
      id: "ent-seed",
      name: "Seed",
      slug: "seed",
      status: "paid",
      plan: "trial",
      createdSource: "platform-created",
      billingStatus: "active",
      createdAt: nowIso,
      updatedAt: nowIso,
      seatQuota: 10,
      seatUsed: 0,
    };
    store.memberships["mem-seed"] = {
      id: "mem-seed",
      userId: user.id,
      enterpriseId: "ent-seed",
      membershipRole: "member",
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await fs.writeFile(storePath, JSON.stringify(store, null, 2));
    await bindMemberSeat("ent-seed", user.id);
  }

  async function bindMemberSeat(tenantId: string, employeeId: string): Promise<void> {
    const { assignSeatToEmployee, ensureSeatForProvision } =
      await import("../enterprise-seat-assets-store.js");
    const { loadSeatAssetsStoreForTenantId, saveSeatAssetsStoreForTenantId } =
      await import("./seat-store-loader.js");
    const nowIso = "2026-10-17T00:00:00.000Z";
    const seatStore = await loadSeatAssetsStoreForTenantId(tenantId);
    const seat = ensureSeatForProvision({
      store: seatStore,
      tenantId,
      seatTitle: "Member",
      reuseByTitle: true,
      nowIso,
    });
    assignSeatToEmployee({
      store: seatStore,
      tenantId,
      seatId: seat.seatId,
      employeeId,
      nowIso,
    });
    await saveSeatAssetsStoreForTenantId(tenantId, seatStore);
  }

  async function bootstrap(requireMfa: boolean): Promise<string | undefined> {
    const req = makeJsonRequest({
      url: BOOTSTRAP_URL,
      method: "POST",
      headers: { host: "127.0.0.1:18789" },
      body: {
        email: "root@example.com",
        password: "password-123",
        displayName: "Root",
      },
    });
    const mock = makeMockHttpResponse();
    await handleControlUiPlatformAuthRequest(req, mock.res, {
      trustedProxy: proxy(requireMfa),
      localDirect: true,
    });
    const raw = mock.setHeader.mock.calls.find((call) => call[0] === "Set-Cookie")?.[1];
    const cookie = Array.isArray(raw)
      ? raw.find((v): v is string => typeof v === "string" && v.includes("="))
      : typeof raw === "string"
        ? raw
        : undefined;
    return cookie ? cookie.split(";")[0] : undefined;
  }

  async function login(
    body: Record<string, unknown>,
    requireMfa: boolean,
    headers?: Record<string, string>,
  ): Promise<{ status: number; payload: Record<string, unknown>; requestId?: string }> {
    const req = makeJsonRequest({
      url: LOGIN_URL,
      method: "POST",
      headers: { host: "127.0.0.1:18789", "user-agent": "vitest", ...headers },
      body,
    });
    const mock = makeMockHttpResponse();
    await handleControlUiPlatformAuthRequest(req, mock.res, {
      trustedProxy: proxy(requireMfa),
      localDirect: true,
    });
    const payload = JSON.parse(String(mock.end.mock.calls[0]?.[0] ?? "{}")) as Record<
      string,
      unknown
    >;
    const requestIdHeader = mock.setHeader.mock.calls.find((c) => c[0] === "X-Request-Id")?.[1];
    return {
      status: mock.res.statusCode ?? 0,
      payload,
      requestId: typeof requestIdHeader === "string" ? requestIdHeader : undefined,
    };
  }

  it("MFA off: platform super-admin logs in with email + password only", async () => {
    await bootstrap(false);
    const result = await login(
      { email: "root@example.com", password: "password-123", expectedPlatformRole: "super-admin" },
      false,
    );
    expect(result.status).toBe(200);
    expect(result.payload.ok).toBe(true);
    expect(result.requestId).toBeDefined();
  });

  it("MFA on: first login requires enrollment, then succeeds with the enrolled code", async () => {
    await bootstrap(true);

    // 1) No code → enrollment required (HTTP 412 with otpAuthUrl).
    const enrollPrompt = await login(
      { email: "root@example.com", password: "password-123", expectedPlatformRole: "super-admin" },
      true,
    );
    expect(enrollPrompt.status).toBe(412);
    expect(enrollPrompt.payload.code).toBe("PLATFORM_AUTH_MFA_REQUIRED_ENROLL_FIRST");
    const enrollment = enrollPrompt.payload.mfaEnrollment as {
      otpAuthUrl: string;
      recoveryCodes: string[];
    };
    expect(enrollment.otpAuthUrl).toContain("otpauth://");

    // Extract the secret from the otpauth URL to compute a valid code.
    const secret = new URL(enrollment.otpAuthUrl).searchParams.get("secret")!;
    expect(secret).toBeTruthy();

    // 2) Supply the first code → activates enrollment AND completes login.
    const code = currentTotp(secret);
    const success = await login(
      {
        email: "root@example.com",
        password: "password-123",
        expectedPlatformRole: "super-admin",
        mfaCode: code,
      },
      true,
    );
    expect(success.status).toBe(200);
    expect(success.payload.ok).toBe(true);
  });

  it("a membership-less platform super-admin is refused on the employee entry", async () => {
    await bootstrap(true);
    // No target signal is the employee entry. A platform-only account must not
    // receive a platform session, and must not skip ahead into MFA enrollment.
    const result = await login({ email: "root@example.com", password: "password-123" }, true);
    expect(result.status).toBe(403);
    expect(result.payload.ok).toBe(false);
    expect(result.payload.code).toBe("PLATFORM_AUTH_SURFACE_INELIGIBLE");
  });

  it("employee entry is not MFA-gated once the account has an enterprise membership", async () => {
    await bootstrap(true);
    // With a membership present the account resolves to a bound member session,
    // so the employee surface never reaches the platform MFA gate and never
    // reports platform capabilities.
    await seedMembershipForRoot();
    const result = await login({ email: "root@example.com", password: "password-123" }, true);
    expect(result.status).toBe(200);
    expect(result.payload.ok).toBe(true);
    const platformAuth = result.payload.platformAuth as Record<string, unknown>;
    expect(platformAuth.canManagePlatform).toBeUndefined();
    expect(platformAuth.canManagePlatformAdmins).toBeUndefined();
    expect(platformAuth.platformRole).toBeUndefined();
    expect(platformAuth.sessionKind).toBe("member");
  });

  it("MFA on: enrolled account with no code is prompted (401 mfa_required)", async () => {
    await bootstrap(true);
    // Trigger enrollment + activate.
    const prompt = await login(
      { email: "root@example.com", password: "password-123", expectedPlatformRole: "super-admin" },
      true,
    );
    const secret = new URL(
      (prompt.payload.mfaEnrollment as { otpAuthUrl: string }).otpAuthUrl,
    ).searchParams.get("secret")!;
    await login(
      {
        email: "root@example.com",
        password: "password-123",
        expectedPlatformRole: "super-admin",
        mfaCode: currentTotp(secret),
      },
      true,
    );

    // Now enrolled: a code-less login should prompt with mfa_required (not enroll).
    const reprompt = await login(
      { email: "root@example.com", password: "password-123", expectedPlatformRole: "super-admin" },
      true,
    );
    expect(reprompt.status).toBe(401);
    expect(reprompt.payload.code).toBe("PLATFORM_AUTH_MFA_REQUIRED");
  });

  it("MFA on: wrong code is rejected with mfa_invalid", async () => {
    await bootstrap(true);
    const prompt = await login(
      { email: "root@example.com", password: "password-123", expectedPlatformRole: "super-admin" },
      true,
    );
    const secret = new URL(
      (prompt.payload.mfaEnrollment as { otpAuthUrl: string }).otpAuthUrl,
    ).searchParams.get("secret")!;
    await login(
      {
        email: "root@example.com",
        password: "password-123",
        expectedPlatformRole: "super-admin",
        mfaCode: currentTotp(secret),
      },
      true,
    );

    const bad = await login(
      {
        email: "root@example.com",
        password: "password-123",
        expectedPlatformRole: "super-admin",
        mfaCode: "000000",
      },
      true,
    );
    expect(bad.status).toBe(401);
    expect(bad.payload.code).toBe("PLATFORM_AUTH_MFA_INVALID");
    expect(bad.payload.error).toBe("验证码不正确或已过期。");
  });

  it("MFA on: a recovery code completes login after enrollment", async () => {
    await bootstrap(true);
    const prompt = await login(
      { email: "root@example.com", password: "password-123", expectedPlatformRole: "super-admin" },
      true,
    );
    const enrollment = prompt.payload.mfaEnrollment as {
      otpAuthUrl: string;
      recoveryCodes: string[];
    };
    const secret = new URL(enrollment.otpAuthUrl).searchParams.get("secret")!;
    await login(
      {
        email: "root@example.com",
        password: "password-123",
        expectedPlatformRole: "super-admin",
        mfaCode: currentTotp(secret),
      },
      true,
    );

    const recovered = await login(
      {
        email: "root@example.com",
        password: "password-123",
        expectedPlatformRole: "super-admin",
        mfaCode: enrollment.recoveryCodes[0].replace("-", "").toLowerCase(),
      },
      true,
    );
    expect(recovered.status).toBe(200);
    expect(recovered.payload.ok).toBe(true);
  });

  it("bootstrap itself does not require MFA (recovery path)", async () => {
    // Bootstrapping with MFA on must still succeed (no MFA on bootstrap).
    await bootstrap(true);
    const store = JSON.parse(await fs.readFile(storePath, "utf8")) as PlatformAuthStore;
    const root = Object.values(store.users).find((u) => u.normalizedEmail === "root@example.com");
    expect(root).toBeDefined();
  });

  it("sets X-Request-Id and emits no secret material in the response", async () => {
    await bootstrap(false);
    const result = await login(
      { email: "root@example.com", password: "password-123", expectedPlatformRole: "super-admin" },
      false,
    );
    expect(result.requestId).toBeDefined();
    expect(JSON.stringify(result.payload)).not.toContain("password-123");
  });

  async function setMfaPolicy(
    requireMfa: boolean,
    requireMfaConfig: boolean,
    cookie: string | undefined,
  ): Promise<{ status: number; payload: Record<string, unknown> }> {
    const req = makeJsonRequest({
      url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/platform/security/mfa-policy`,
      method: "POST",
      headers: { host: "127.0.0.1:18789", ...(cookie ? { cookie } : {}) },
      body: { requireMfaForPlatformAdmins: requireMfa },
    });
    const mock = makeMockHttpResponse();
    await handleControlUiPlatformAuthRequest(req, mock.res, {
      trustedProxy: proxy(requireMfaConfig),
      localDirect: true,
    });
    const payload = JSON.parse(String(mock.end.mock.calls[0]?.[0] ?? "{}")) as Record<
      string,
      unknown
    >;
    return { status: mock.res.statusCode ?? 0, payload };
  }

  it("super-admin can toggle the MFA policy at runtime without restart", async () => {
    // bootstrap with config default MFA on; the bootstrapped session is super-admin.
    const cookie = await bootstrap(true);
    expect(cookie).toBeDefined();
    // turn the policy OFF via the store override
    const off = await setMfaPolicy(false, true, cookie);
    expect(off.status).toBe(200);
    expect(off.payload.requireMfaForPlatformAdmins).toBe(false);
    expect((off.payload.platformAuth as Record<string, unknown>).requireMfaForPlatformAdmins).toBe(
      false,
    );

    // now login without MFA succeeds because the override beats the config default
    const result = await login(
      { email: "root@example.com", password: "password-123", expectedPlatformRole: "super-admin" },
      true,
    );
    expect(result.status).toBe(200);
    expect(result.payload.ok).toBe(true);
  });

  it("does not require a code on enterprise or employee login after enrollment", async () => {
    await bootstrap(false);
    const store = JSON.parse(await fs.readFile(storePath, "utf8")) as PlatformAuthStore;
    const account = Object.values(store.users).find(
      (entry) => entry.normalizedEmail === "root@example.com",
    );
    if (!account) {
      throw new Error("bootstrap user not found");
    }
    const nowIso = "2026-10-12T00:00:00.000Z";
    store.enterprises["ent-seed"] = {
      id: "ent-seed",
      name: "Seed",
      slug: "seed",
      status: "paid",
      plan: "trial",
      createdSource: "platform-created",
      billingStatus: "active",
      createdAt: nowIso,
      updatedAt: nowIso,
      seatQuota: 10,
      seatUsed: 0,
    };
    store.memberships["mem-admin"] = {
      id: "mem-admin",
      userId: account.id,
      enterpriseId: "ent-seed",
      membershipRole: "enterprise-admin",
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    store.memberships["mem-member"] = {
      id: "mem-member",
      userId: account.id,
      enterpriseId: "ent-seed",
      membershipRole: "member",
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await fs.writeFile(storePath, JSON.stringify(store));
    await bindMemberSeat("ent-seed", account.id);
    const enrolled = await enrollMfa(account.id, account.email);
    const secret = new URL(enrolled.otpAuthUrl).searchParams.get("secret");
    expect(secret).toBeTruthy();
    expect(await activateMfaEnrollment(account.id, currentTotp(secret!))).toBe(true);

    const enterprise = await login(
      {
        email: "root@example.com",
        password: "password-123",
        sessionDomain: "enterprise",
        expectedSessionKind: "enterprise-admin",
      },
      false,
    );
    expect(enterprise.status).toBe(200);
    expect(enterprise.payload.ok).toBe(true);
    expect(enterprise.payload.code).toBeUndefined();

    const employee = await login(
      {
        email: "root@example.com",
        password: "password-123",
        sessionDomain: "employee",
      },
      false,
    );
    expect(employee.status).toBe(200);
    expect(employee.payload.ok).toBe(true);
    expect((employee.payload.platformAuth as { sessionKind?: string }).sessionKind).toBe("member");

    const platform = await login(
      {
        email: "root@example.com",
        password: "password-123",
        sessionDomain: "platform",
        expectedPlatformRole: "super-admin",
      },
      false,
    );
    expect(platform.status).toBe(401);
    expect(platform.payload.code).toBe("PLATFORM_AUTH_MFA_REQUIRED");

    const platformOnAdmin = await login(
      {
        email: "root@example.com",
        password: "password-123",
        sessionDomain: "platform",
        expectedPlatformRole: "super-admin",
      },
      false,
      { host: "admin.openbot.love", origin: "https://admin.openbot.love" },
    );
    expect(platformOnAdmin.status).toBe(401);
    expect(platformOnAdmin.payload.code).toBe("PLATFORM_AUTH_MFA_REQUIRED");

    for (const host of ["www.openbot.love", "openbot.love"]) {
      const employeeOnPublicHome = await login(
        {
          email: "root@example.com",
          password: "password-123",
          sessionDomain: "employee",
        },
        false,
        { host, origin: `https://${host}` },
      );
      expect(employeeOnPublicHome.status).toBe(200);
      expect(employeeOnPublicHome.payload.code).toBeUndefined();

      const platformOnPublicHome = await login(
        {
          email: "root@example.com",
          password: "password-123",
          sessionDomain: "platform",
          expectedPlatformRole: "super-admin",
        },
        false,
        { host, origin: `https://${host}` },
      );
      expect(platformOnPublicHome.status).toBe(403);
      expect(platformOnPublicHome.payload.code).toBe("PLATFORM_AUTH_SURFACE_MISMATCH");
    }

    const enterpriseOnBiz = await login(
      {
        email: "root@example.com",
        password: "password-123",
        sessionDomain: "enterprise",
        expectedSessionKind: "enterprise-admin",
      },
      false,
      { host: "biz.openbot.love", origin: "https://biz.openbot.love" },
    );
    expect(enterpriseOnBiz.status).toBe(200);
    expect(enterpriseOnBiz.payload.code).toBeUndefined();

    const platformOnBiz = await login(
      {
        email: "root@example.com",
        password: "password-123",
        sessionDomain: "platform",
        expectedPlatformRole: "super-admin",
      },
      false,
      { host: "biz.openbot.love", origin: "https://biz.openbot.love" },
    );
    expect(platformOnBiz.status).toBe(403);
    expect(platformOnBiz.payload.code).toBe("PLATFORM_AUTH_SURFACE_MISMATCH");

    const employeeOnBiz = await login(
      {
        email: "root@example.com",
        password: "password-123",
        sessionDomain: "employee",
      },
      false,
      { host: "biz.openbot.love", origin: "https://biz.openbot.love" },
    );
    expect(employeeOnBiz.status).toBe(403);
    expect(employeeOnBiz.payload.ok).toBe(false);
    expect(employeeOnBiz.payload.code).toBe("PLATFORM_AUTH_SURFACE_MISMATCH");
    expect(employeeOnBiz.payload.error).toBe(
      "This login entry does not match the requested surface.",
    );
    expect(employeeOnBiz.payload.requestSurface).toBe("enterprise");
    expect(employeeOnBiz.payload.targetSurface).toBe("employee");
    expect(employeeOnBiz.payload.loginPath).toBe("/");
    expect(employeeOnBiz.payload.loginUrl).toBe(loginUrlForSurface("employee"));
    expect(String(employeeOnBiz.payload.loginUrl)).not.toContain("biz.openbot.love");
    expect(String(employeeOnBiz.payload.loginUrl)).not.toContain("admin.openbot.love");
  });

  it("rejects MFA policy change without a super-admin session", async () => {
    await bootstrap(true);
    const denied = await setMfaPolicy(false, true, undefined);
    expect(denied.status).toBe(403);
  });
});
