import fs from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { withEnvAsync } from "../test-utils/env.js";
import { authorizeHttpGatewayConnect } from "./auth.js";
import { submitProposal } from "./capability-governance-store.js";
import {
  CONTROL_UI_BOOTSTRAP_CONFIG_PATH,
  CONTROL_UI_PLATFORM_AUTH_BASE_PATH,
} from "./control-ui-contract.js";
import {
  handleControlUiPlatformAuthRequest,
  loadPlatformAuthStore,
  type PlatformAuthStore,
} from "./platform-auth.js";
import { makeMockHttpResponse } from "./test-http-response.js";
import { withTempConfig } from "./test-temp-config.js";

/** Create a vacant position in the same seat store the invite route reads. */
async function createVacantEnterprisePosition(tenantId: string, title: string): Promise<string> {
  const { ensureSeatForProvision, saveEnterpriseSeatAssetsStore } =
    await import("./enterprise-seat-assets-store.js");
  const { loadSeatAssetsStoreForTenantId, resolveSeatAssetsStorePathForTenantId } =
    await import("./platform-auth/seat-store-loader.js");
  const store = await loadSeatAssetsStoreForTenantId(tenantId);
  const seat = ensureSeatForProvision({
    store,
    tenantId,
    seatTitle: title,
    reuseByTitle: false,
    nowIso: new Date().toISOString(),
  });
  await saveEnterpriseSeatAssetsStore(resolveSeatAssetsStorePathForTenantId(tenantId), store);
  return seat.seatId;
}

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

function getPrimarySetCookie(
  setHeader: ReturnType<typeof makeMockHttpResponse>["setHeader"],
): string | undefined {
  const raw = setHeader.mock.calls.find((call) => call[0] === "Set-Cookie")?.[1];
  if (typeof raw === "string") {
    return raw;
  }
  if (Array.isArray(raw)) {
    return raw.find((value): value is string => typeof value === "string" && value.includes("="));
  }
  return undefined;
}

describe("platform auth", () => {
  it("bootstraps the first platform admin and authenticates trusted-proxy requests via cookie session", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-platform-auth-"));
    try {
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          requireMfaForPlatformAdmins: false,
          store: path.join(tempDir, "platform-auth.json"),
        },
      };
      const registerReq = makeJsonRequest({
        url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/platform/bootstrap`,
        method: "POST",
        headers: {
          host: "127.0.0.1:18789",
        },
        body: {
          email: "alice@example.com",
          password: "password-123",
          displayName: "Alice",
        },
      });
      const { res, setHeader, end } = makeMockHttpResponse();
      const handled = await handleControlUiPlatformAuthRequest(registerReq, res, {
        trustedProxy,
        localDirect: true,
      });
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(201);
      const payload = JSON.parse(String(end.mock.calls[0]?.[0] ?? "")) as {
        ok: boolean;
        session?: { user?: string; role?: string };
        platformAuth?: { sessionKind?: string; canManagePlatform?: boolean };
      };
      expect(payload.ok).toBe(true);
      expect(payload.session).toMatchObject({
        user: "alice@example.com",
        role: "operator",
      });
      expect(payload.platformAuth).toMatchObject({
        sessionKind: "platform-super-admin",
        canManagePlatform: true,
        canManagePlatformAdmins: true,
        platformRole: "super-admin",
      });
      const sessionCookie = getPrimarySetCookie(setHeader);
      expect(typeof sessionCookie).toBe("string");

      const authReq = {
        url: CONTROL_UI_BOOTSTRAP_CONFIG_PATH,
        method: "GET",
        headers: {
          host: "127.0.0.1:18789",
          cookie: String(sessionCookie).split(";")[0],
        },
        socket: { remoteAddress: "127.0.0.1" },
      } as IncomingMessage;
      const authResult = await authorizeHttpGatewayConnect({
        auth: {
          mode: "trusted-proxy",
          allowTailscale: false,
          trustedProxy,
        },
        connectAuth: null,
        req: authReq,
        trustedProxies: ["10.0.0.1"],
      });
      expect(authResult.ok).toBe(true);
      expect(authResult.method).toBe("trusted-proxy");
      expect(authResult.trustedProxy).toMatchObject({
        user: "alice@example.com",
        role: "operator",
      });
      expect(authResult.trustedProxy?.tenantId).toBeUndefined();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("creates an enterprise through self-service and activates the enterprise admin", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-platform-auth-"));
    try {
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          requireMfaForPlatformAdmins: false,
          store: path.join(tempDir, "platform-auth.json"),
        },
      };
      const bootstrapReq = makeJsonRequest({
        url: "/__openbot/platform-auth/platform/bootstrap",
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          email: "ops@example.com",
          password: "password-123",
          displayName: "Ops",
        },
      });
      await handleControlUiPlatformAuthRequest(bootstrapReq, makeMockHttpResponse().res, {
        trustedProxy,
        localDirect: true,
      });

      const createReq = makeJsonRequest({
        url: "/__openbot/platform-auth/enterprise/create",
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          enterpriseName: "Acme",
          adminName: "Owner",
          adminEmail: "owner@example.com",
        },
      });
      const createRes = makeMockHttpResponse();
      const createHandled = await handleControlUiPlatformAuthRequest(createReq, createRes.res, {
        trustedProxy,
        localDirect: true,
      });
      expect(createHandled).toBe(true);
      expect(createRes.res.statusCode).toBe(201);
      const createPayload = JSON.parse(String(createRes.end.mock.calls[0]?.[0] ?? "")) as {
        ok: boolean;
        platformAuth?: {
          pendingActivation?: { code?: string; email?: string; enterpriseName?: string };
        };
      };
      expect(createPayload.ok).toBe(true);
      expect(createPayload.platformAuth?.pendingActivation).toMatchObject({
        email: "owner@example.com",
        enterpriseName: "Acme",
      });
      const activationCode = createPayload.platformAuth?.pendingActivation?.code;
      expect(typeof activationCode).toBe("string");

      const activateReq = makeJsonRequest({
        url: "/__openbot/platform-auth/enterprise/admin/activate",
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          email: "owner@example.com",
          displayName: "Owner",
          password: "password-123",
          code: activationCode,
        },
      });
      const activateRes = makeMockHttpResponse();
      const activateHandled = await handleControlUiPlatformAuthRequest(
        activateReq,
        activateRes.res,
        {
          trustedProxy,
          localDirect: true,
        },
      );
      expect(activateHandled).toBe(true);
      expect(activateRes.res.statusCode).toBe(201);
      const activatePayload = JSON.parse(String(activateRes.end.mock.calls[0]?.[0] ?? "")) as {
        ok: boolean;
        session?: { user?: string; tenantId?: string };
        platformAuth?: {
          membershipRole?: string;
          tenantName?: string;
          enterprise?: { seatUsed?: number; seatQuota?: number; status?: string };
        };
      };
      expect(activatePayload.ok).toBe(true);
      expect(activatePayload.session).toMatchObject({
        user: "owner@example.com",
      });
      expect(activatePayload.platformAuth).toMatchObject({
        membershipRole: "enterprise-admin",
        tenantName: "Acme",
        enterprise: {
          seatUsed: 1,
          seatQuota: 5,
          status: "trial",
        },
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("accepts public platform auth requests when the configured public app base URL matches forwarded host", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-platform-auth-"));
    try {
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          requireMfaForPlatformAdmins: false,
          store: path.join(tempDir, "platform-auth.json"),
        },
      };
      await withEnvAsync(
        {
          OPENBOT_PUBLIC_APP_BASE_URL: "https://www.openbot.love",
          OPENBOT_PUBLIC_APP_BASE_URLS: "https://www.openbot.love,https://admin.openbot.love",
        },
        async () => {
          const bootstrapRes = makeMockHttpResponse();
          await handleControlUiPlatformAuthRequest(
            makeJsonRequest({
              url: "/__openbot/platform-auth/platform/bootstrap",
              method: "POST",
              headers: { host: "127.0.0.1:18789" },
              body: {
                email: "ops@example.com",
                password: "password-123",
                displayName: "Ops",
              },
            }),
            bootstrapRes.res,
            { trustedProxy, localDirect: true },
          );
          const sessionCookie = getPrimarySetCookie(bootstrapRes.setHeader);
          expect(typeof sessionCookie).toBe("string");
          const cookie = String(sessionCookie).split(";")[0];

          const employeeReq = makeJsonRequest({
            url: "/__openbot/platform-auth/session",
            method: "GET",
            headers: {
              host: "www.openbot.love",
              cookie,
              "x-forwarded-host": "www.openbot.love",
              "x-forwarded-proto": "https",
            },
          });
          Object.defineProperty(employeeReq, "socket", {
            value: { remoteAddress: "127.0.0.1" },
            configurable: true,
          });
          const employeeRes = makeMockHttpResponse();
          const employeeHandled = await handleControlUiPlatformAuthRequest(
            employeeReq,
            employeeRes.res,
            { trustedProxy, localDirect: false },
          );
          expect(employeeHandled).toBe(true);
          expect(employeeRes.res.statusCode).toBe(200);
          const employeePayload = JSON.parse(String(employeeRes.end.mock.calls[0]?.[0] ?? "")) as {
            session?: { user?: string };
            enabled?: boolean;
          };
          expect(employeePayload.enabled).toBe(true);
          expect(employeePayload.session?.user).toBeUndefined();

          const sessionReq = makeJsonRequest({
            url: "/__openbot/platform-auth/session",
            method: "GET",
            headers: {
              host: "admin.openbot.love",
              cookie,
              "x-forwarded-host": "admin.openbot.love",
              "x-forwarded-proto": "https",
            },
          });
          Object.defineProperty(sessionReq, "socket", {
            value: { remoteAddress: "127.0.0.1" },
            configurable: true,
          });
          const sessionRes = makeMockHttpResponse();
          const handled = await handleControlUiPlatformAuthRequest(sessionReq, sessionRes.res, {
            trustedProxy,
            localDirect: false,
          });
          expect(handled).toBe(true);
          expect(sessionRes.res.statusCode).toBe(200);
          const payload = JSON.parse(String(sessionRes.end.mock.calls[0]?.[0] ?? "")) as {
            session?: { user?: string };
            enabled?: boolean;
          };
          expect(payload.enabled).toBe(true);
          expect(payload.session?.user).toBe("ops@example.com");
        },
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("blocks platform bootstrap on configured public reverse-proxy entry", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-platform-auth-"));
    try {
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          requireMfaForPlatformAdmins: false,
          store: path.join(tempDir, "platform-auth.json"),
        },
      };
      await withEnvAsync(
        {
          OPENBOT_PUBLIC_APP_BASE_URL: "https://www.openbot.love",
        },
        async () => {
          const bootstrapReq = makeJsonRequest({
            url: "/__openbot/platform-auth/platform/bootstrap",
            method: "POST",
            headers: {
              host: "www.openbot.love",
              "x-forwarded-host": "www.openbot.love",
              "x-forwarded-proto": "https",
            },
            body: {
              email: "ops@example.com",
              password: "password-123",
              displayName: "Ops",
            },
          });
          const bootstrapRes = makeMockHttpResponse();
          const handled = await handleControlUiPlatformAuthRequest(bootstrapReq, bootstrapRes.res, {
            trustedProxy,
            localDirect: false,
          });
          expect(handled).toBe(true);
          expect(bootstrapRes.res.statusCode).toBe(403);
          const payload = JSON.parse(String(bootstrapRes.end.mock.calls[0]?.[0] ?? "")) as {
            code?: string;
          };
          expect(payload.code).toBe("PLATFORM_AUTH_LOCAL_ONLY");
        },
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("allows public direct trial applications when the configured public app base URL matches forwarded host", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-platform-auth-"));
    try {
      const storePath = path.join(tempDir, "platform-auth.json");
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          requireMfaForPlatformAdmins: false,
          store: storePath,
        },
      };
      await withEnvAsync(
        {
          OPENBOT_PUBLIC_APP_BASE_URL: "https://www.openbot.love",
        },
        async () => {
          const bootstrapReq = makeJsonRequest({
            url: "/__openbot/platform-auth/platform/bootstrap",
            method: "POST",
            headers: { host: "127.0.0.1:18789" },
            body: {
              email: "ops@example.com",
              password: "password-123",
              displayName: "Ops",
            },
          });
          await handleControlUiPlatformAuthRequest(bootstrapReq, makeMockHttpResponse().res, {
            trustedProxy,
            localDirect: true,
          });

          const trialReq = makeJsonRequest({
            url: "/__openbot/platform-auth/platform/trial/apply",
            method: "POST",
            headers: {
              host: "www.openbot.love",
              "x-forwarded-host": "www.openbot.love",
              "x-forwarded-proto": "https",
            },
            body: {
              companyName: "Acme",
              contactName: "Alice",
              workEmail: "alice@acme.com",
              expectedUsers: "20",
              useCase: "知识库问答与 AI 助手",
              needsDemo: false,
            },
          });
          Object.defineProperty(trialReq, "socket", {
            value: { remoteAddress: "127.0.0.1" },
            configurable: true,
          });
          const trialRes = makeMockHttpResponse();
          const handled = await handleControlUiPlatformAuthRequest(trialReq, trialRes.res, {
            trustedProxy,
            localDirect: false,
          });
          expect(handled).toBe(true);
          expect([201, 202]).toContain(trialRes.res.statusCode ?? 0);
          const payload = JSON.parse(String(trialRes.end.mock.calls[0]?.[0] ?? "")) as {
            ok: boolean;
            trialApplication?: { mode?: string };
          };
          expect(payload.ok).toBe(true);
          expect(payload.trialApplication?.mode).toBe("auto");
        },
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns an enterprise admin session for enterprise login even when the account also manages the platform", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-platform-auth-"));
    try {
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          requireMfaForPlatformAdmins: false,
          store: path.join(tempDir, "platform-auth.json"),
        },
      };
      const bootstrapReq = makeJsonRequest({
        url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/platform/bootstrap`,
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          email: "owner@example.com",
          password: "password-123",
          displayName: "Owner",
        },
      });
      await handleControlUiPlatformAuthRequest(bootstrapReq, makeMockHttpResponse().res, {
        trustedProxy,
        localDirect: true,
      });

      const store = JSON.parse(
        await fs.readFile(trustedProxy.platformAuth.store, "utf8"),
      ) as PlatformAuthStore;
      const ownerUser = Object.values(store.users).find(
        (user) => user.normalizedEmail === "owner@example.com",
      );
      expect(ownerUser).toBeDefined();
      if (ownerUser) {
        const nowIso = new Date().toISOString();
        store.enterprises["acme"] = {
          id: "acme",
          name: "Acme",
          slug: "acme",
          status: "trial",
          plan: "trial",
          billingStatus: "trialing",
          createdSource: "self-service",
          createdAt: nowIso,
          updatedAt: nowIso,
          seatQuota: 5,
          seatUsed: 1,
        };
        store.memberships["membership-owner-acme"] = {
          id: "membership-owner-acme",
          userId: ownerUser.id,
          enterpriseId: "acme",
          membershipRole: "enterprise-admin",
          createdAt: nowIso,
          updatedAt: nowIso,
        };
      }
      await fs.writeFile(trustedProxy.platformAuth.store, `${JSON.stringify(store, null, 2)}\n`);

      const platformLoginReq = makeJsonRequest({
        url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/login`,
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          email: "owner@example.com",
          password: "password-123",
          expectedPlatformRole: "admin",
        },
      });
      const platformLoginRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(platformLoginReq, platformLoginRes.res, {
        trustedProxy,
        localDirect: true,
      });
      expect(platformLoginRes.res.statusCode).toBe(200);
      const platformPayload = JSON.parse(String(platformLoginRes.end.mock.calls[0]?.[0] ?? "")) as {
        platformAuth?: { sessionKind?: string; platformRole?: string };
      };
      expect(platformPayload.platformAuth).toMatchObject({
        sessionKind: "platform-super-admin",
        platformRole: "super-admin",
      });

      const enterpriseLoginReq = makeJsonRequest({
        url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/login`,
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          email: "owner@example.com",
          password: "password-123",
          expectedSessionKind: "enterprise-admin",
        },
      });
      const enterpriseLoginRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(enterpriseLoginReq, enterpriseLoginRes.res, {
        trustedProxy,
        localDirect: true,
      });
      expect(enterpriseLoginRes.res.statusCode).toBe(200);
      const enterprisePayload = JSON.parse(
        String(enterpriseLoginRes.end.mock.calls[0]?.[0] ?? ""),
      ) as {
        session?: { tenantId?: string };
        platformAuth?: {
          sessionKind?: string;
          platformRole?: string;
          membershipRole?: string;
          tenantName?: string;
        };
      };
      expect(enterprisePayload.session?.tenantId).toBe("acme");
      expect(enterprisePayload.platformAuth).toMatchObject({
        sessionKind: "enterprise-admin",
        platformRole: "super-admin",
        membershipRole: "enterprise-admin",
        tenantName: "Acme",
      });

      const sessionCookie = getPrimarySetCookie(enterpriseLoginRes.setHeader);
      const sessionProbeReq = makeJsonRequest({
        url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/session`,
        method: "GET",
        headers: {
          host: "127.0.0.1:18789",
          cookie: String(sessionCookie).split(";")[0],
        },
      });
      const sessionProbeRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(sessionProbeReq, sessionProbeRes.res, {
        trustedProxy,
        localDirect: true,
      });
      expect(sessionProbeRes.res.statusCode).toBe(200);
      const sessionProbePayload = JSON.parse(
        String(sessionProbeRes.end.mock.calls[0]?.[0] ?? ""),
      ) as {
        sessionKind?: string;
        session?: { user?: string };
      };
      expect(sessionProbePayload).toMatchObject({
        sessionKind: "enterprise-admin",
        session: { user: "owner@example.com" },
      });

      const switchReq = makeJsonRequest({
        url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/session/switch`,
        method: "POST",
        headers: {
          host: "127.0.0.1:18789",
          cookie: String(getPrimarySetCookie(platformLoginRes.setHeader)).split(";")[0],
        },
        body: {
          targetSessionKind: "enterprise-admin",
          tenantId: "acme",
        },
      });
      const switchRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(switchReq, switchRes.res, {
        trustedProxy,
        localDirect: true,
      });
      expect(switchRes.res.statusCode).toBe(200);
      const switchPayload = JSON.parse(String(switchRes.end.mock.calls[0]?.[0] ?? "")) as {
        platformAuth?: { sessionKind?: string; membershipRole?: string };
      };
      expect(switchPayload.platformAuth).toMatchObject({
        sessionKind: "enterprise-admin",
        membershipRole: "enterprise-admin",
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("lets a super admin create a delegated platform administrator and enforces role-specific login", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-platform-auth-"));
    try {
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          requireMfaForPlatformAdmins: false,
          store: path.join(tempDir, "platform-auth.json"),
        },
      };

      const bootstrapReq = makeJsonRequest({
        url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/platform/bootstrap`,
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          email: "root@example.com",
          password: "password-123",
          displayName: "Root",
        },
      });
      const bootstrapRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(bootstrapReq, bootstrapRes.res, {
        trustedProxy,
        localDirect: true,
      });
      const sessionCookie = getPrimarySetCookie(bootstrapRes.setHeader);

      const createAdminReq = makeJsonRequest({
        url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/platform/admin/create`,
        method: "POST",
        headers: {
          host: "127.0.0.1:18789",
          cookie: String(sessionCookie).split(";")[0],
        },
        body: {
          email: "ops@example.com",
          password: "password-456",
          displayName: "Ops",
          scopes: ["operator.read", "operator.write"],
        },
      });
      const createAdminRes = makeMockHttpResponse();
      const createAdminHandled = await handleControlUiPlatformAuthRequest(
        createAdminReq,
        createAdminRes.res,
        {
          trustedProxy,
          localDirect: true,
        },
      );
      expect(createAdminHandled).toBe(true);
      expect(createAdminRes.res.statusCode).toBe(201);
      const createPayload = JSON.parse(String(createAdminRes.end.mock.calls[0]?.[0] ?? "")) as {
        ok: boolean;
        platformAuth?: { platformAdmins?: Array<{ user: string; platformRole: string }> };
      };
      expect(createPayload.ok).toBe(true);
      expect(createPayload.platformAuth?.platformAdmins).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ user: "ops@example.com", platformRole: "admin" }),
        ]),
      );

      const wrongLoginReq = makeJsonRequest({
        url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/login`,
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          email: "ops@example.com",
          password: "password-456",
          expectedPlatformRole: "super-admin",
        },
      });
      const wrongLoginRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(wrongLoginReq, wrongLoginRes.res, {
        trustedProxy,
        localDirect: true,
      });
      expect(wrongLoginRes.res.statusCode).toBe(403);

      const loginReq = makeJsonRequest({
        url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/login`,
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          email: "ops@example.com",
          password: "password-456",
          expectedPlatformRole: "admin",
        },
      });
      const loginRes = makeMockHttpResponse();
      const loginHandled = await handleControlUiPlatformAuthRequest(loginReq, loginRes.res, {
        trustedProxy,
        localDirect: true,
      });
      expect(loginHandled).toBe(true);
      expect(loginRes.res.statusCode).toBe(200);
      const loginPayload = JSON.parse(String(loginRes.end.mock.calls[0]?.[0] ?? "")) as {
        ok: boolean;
        platformAuth?: { sessionKind?: string; platformRole?: string };
      };
      expect(loginPayload.ok).toBe(true);
      expect(loginPayload.platformAuth).toMatchObject({
        sessionKind: "platform-admin",
        platformRole: "admin",
      });

      const superAdminLoginReq = makeJsonRequest({
        url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/login`,
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          email: "root@example.com",
          password: "password-123",
          expectedPlatformRole: "admin",
        },
      });
      const superAdminLoginRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(superAdminLoginReq, superAdminLoginRes.res, {
        trustedProxy,
        localDirect: true,
      });
      expect(superAdminLoginRes.res.statusCode).toBe(200);
      const superAdminLoginPayload = JSON.parse(
        String(superAdminLoginRes.end.mock.calls[0]?.[0] ?? ""),
      ) as {
        ok: boolean;
        platformAuth?: { sessionKind?: string; platformRole?: string };
      };
      expect(superAdminLoginPayload.ok).toBe(true);
      expect(superAdminLoginPayload.platformAuth).toMatchObject({
        sessionKind: "platform-super-admin",
        platformRole: "super-admin",
      });

      const store = JSON.parse(
        await fs.readFile(trustedProxy.platformAuth.store, "utf8"),
      ) as PlatformAuthStore;
      const rootUser = Object.values(store.users).find(
        (user) => user.normalizedEmail === "root@example.com",
      );
      expect(rootUser).toBeDefined();
      if (rootUser) {
        delete rootUser.platformRole;
      }
      await fs.writeFile(trustedProxy.platformAuth.store, `${JSON.stringify(store, null, 2)}\n`);

      const legacySuperAdminLoginReq = makeJsonRequest({
        url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/login`,
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          email: "root@example.com",
          password: "password-123",
          expectedPlatformRole: "admin",
        },
      });
      const legacySuperAdminLoginRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(
        legacySuperAdminLoginReq,
        legacySuperAdminLoginRes.res,
        {
          trustedProxy,
          localDirect: true,
        },
      );
      expect(legacySuperAdminLoginRes.res.statusCode).toBe(200);
      const legacySuperAdminLoginPayload = JSON.parse(
        String(legacySuperAdminLoginRes.end.mock.calls[0]?.[0] ?? ""),
      ) as {
        ok: boolean;
        platformAuth?: { sessionKind?: string; platformRole?: string };
      };
      expect(legacySuperAdminLoginPayload.ok).toBe(true);
      expect(legacySuperAdminLoginPayload.platformAuth).toMatchObject({
        sessionKind: "platform-super-admin",
        platformRole: "super-admin",
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("defaults empty scopes to full platform admin scopes and lets super admin remove delegates", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-platform-auth-"));
    try {
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          requireMfaForPlatformAdmins: false,
          store: path.join(tempDir, "platform-auth.json"),
        },
      };

      const bootstrapReq = makeJsonRequest({
        url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/platform/bootstrap`,
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          email: "root@example.com",
          password: "password-123",
          displayName: "Root",
        },
      });
      const bootstrapRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(bootstrapReq, bootstrapRes.res, {
        trustedProxy,
        localDirect: true,
      });
      const sessionCookie = getPrimarySetCookie(bootstrapRes.setHeader);

      const createAdminReq = makeJsonRequest({
        url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/platform/admin/create`,
        method: "POST",
        headers: {
          host: "127.0.0.1:18789",
          cookie: String(sessionCookie).split(";")[0],
        },
        body: {
          email: "ops@example.com",
          password: "password-456",
          displayName: "Ops",
          scopes: [],
        },
      });
      const createAdminRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(createAdminReq, createAdminRes.res, {
        trustedProxy,
        localDirect: true,
      });
      expect(createAdminRes.res.statusCode).toBe(201);
      const createPayload = JSON.parse(String(createAdminRes.end.mock.calls[0]?.[0] ?? "")) as {
        ok: boolean;
        platformAuth?: {
          platformAdmins?: Array<{ user: string; platformRole: string; scopes?: string[] }>;
        };
      };
      const created = createPayload.platformAuth?.platformAdmins?.find(
        (admin) => admin.user === "ops@example.com",
      );
      expect(created?.platformRole).toBe("admin");
      expect(created?.scopes).toEqual(
        expect.arrayContaining([
          "operator.read",
          "operator.write",
          "operator.admin",
          "operator.approvals",
          "operator.pairing",
        ]),
      );
      expect(created?.scopes).toHaveLength(5);

      const removeReq = makeJsonRequest({
        url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/platform/admin/remove`,
        method: "POST",
        headers: {
          host: "127.0.0.1:18789",
          cookie: String(sessionCookie).split(";")[0],
        },
        body: { user: "ops@example.com" },
      });
      const removeRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(removeReq, removeRes.res, {
        trustedProxy,
        localDirect: true,
      });
      expect(removeRes.res.statusCode).toBe(200);
      const removePayload = JSON.parse(String(removeRes.end.mock.calls[0]?.[0] ?? "")) as {
        ok: boolean;
        platformAuth?: { platformAdmins?: Array<{ user: string }> };
      };
      expect(removePayload.ok).toBe(true);
      expect(removePayload.platformAuth?.platformAdmins ?? []).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ user: "ops@example.com" })]),
      );

      const store = JSON.parse(
        await fs.readFile(trustedProxy.platformAuth.store, "utf8"),
      ) as PlatformAuthStore;
      const ops = Object.values(store.users).find(
        (user) => user.normalizedEmail === "ops@example.com",
      );
      expect(ops?.platformRole).toBeUndefined();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("auto-approves a qualified trial application and queues the activation email", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-platform-auth-"));
    try {
      const storePath = path.join(tempDir, "platform-auth.json");
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          requireMfaForPlatformAdmins: false,
          store: storePath,
        },
      };
      const bootstrapReq = makeJsonRequest({
        url: "/__openbot/platform-auth/platform/bootstrap",
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          email: "ops@example.com",
          password: "password-123",
          displayName: "Ops",
        },
      });
      await handleControlUiPlatformAuthRequest(bootstrapReq, makeMockHttpResponse().res, {
        trustedProxy,
        localDirect: true,
      });

      const trialReq = makeJsonRequest({
        url: "/__openbot/platform-auth/platform/trial/apply",
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          companyName: "Acme",
          contactName: "Alice",
          workEmail: "alice@acme.com",
          expectedUsers: "20",
          useCase: "知识库问答与 AI 助手",
          needsDemo: false,
        },
      });
      const trialRes = makeMockHttpResponse();
      const handled = await handleControlUiPlatformAuthRequest(trialReq, trialRes.res, {
        trustedProxy,
        localDirect: true,
      });
      expect(handled).toBe(true);
      expect(trialRes.res.statusCode).toBe(201);
      const payload = JSON.parse(String(trialRes.end.mock.calls[0]?.[0] ?? "")) as {
        ok: boolean;
        trialApplication?: { mode?: string; message?: string };
        platformAuth?: { pendingActivation?: { enterpriseName?: string; email?: string } };
      };
      expect(payload.ok).toBe(true);
      expect(payload.trialApplication).toMatchObject({
        mode: "auto",
      });
      expect(payload.platformAuth?.pendingActivation).toMatchObject({
        enterpriseName: "Acme",
        email: "alice@acme.com",
      });

      const store = JSON.parse(await fs.readFile(storePath, "utf8")) as {
        trialApplications?: Record<string, { mode?: string }>;
        leadNotifications?: Record<string, { type?: string }>;
      };
      expect(Object.values(store.trialApplications ?? {})).toEqual(
        expect.arrayContaining([expect.objectContaining({ mode: "auto" })]),
      );
      expect(Object.values(store.leadNotifications ?? {})).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: "admin-activation-email" })]),
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("opens the trial and queues sales follow-up for high-intent mid-market leads", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-platform-auth-"));
    try {
      const storePath = path.join(tempDir, "platform-auth.json");
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          requireMfaForPlatformAdmins: false,
          store: storePath,
        },
      };
      const bootstrapReq = makeJsonRequest({
        url: "/__openbot/platform-auth/platform/bootstrap",
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          email: "ops@example.com",
          password: "password-123",
          displayName: "Ops",
        },
      });
      await handleControlUiPlatformAuthRequest(bootstrapReq, makeMockHttpResponse().res, {
        trustedProxy,
        localDirect: true,
      });

      const trialReq = makeJsonRequest({
        url: "/__openbot/platform-auth/platform/trial/apply",
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          companyName: "Contoso",
          contactName: "Chris",
          workEmail: "chris@contoso.com",
          expectedUsers: "50",
          useCase: "跨部门流程自动化",
          needsDemo: true,
        },
      });
      const trialRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(trialReq, trialRes.res, {
        trustedProxy,
        localDirect: true,
      });
      const payload = JSON.parse(String(trialRes.end.mock.calls[0]?.[0] ?? "")) as {
        trialApplication?: { mode?: string };
      };
      expect(payload.trialApplication?.mode).toBe("auto_with_sales");

      const store = JSON.parse(await fs.readFile(storePath, "utf8")) as {
        leadNotifications?: Record<string, { type?: string }>;
      };
      const notificationTypes = Object.values(store.leadNotifications ?? {}).map(
        (entry) => entry.type,
      );
      expect(notificationTypes).toContain("admin-activation-email");
      expect(notificationTypes).toContain("sales-follow-up");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("routes large or personal-email trial applications to manual review without creating an enterprise", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-platform-auth-"));
    try {
      const storePath = path.join(tempDir, "platform-auth.json");
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          requireMfaForPlatformAdmins: false,
          store: storePath,
        },
      };
      const bootstrapReq = makeJsonRequest({
        url: "/__openbot/platform-auth/platform/bootstrap",
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          email: "ops@example.com",
          password: "password-123",
          displayName: "Ops",
        },
      });
      await handleControlUiPlatformAuthRequest(bootstrapReq, makeMockHttpResponse().res, {
        trustedProxy,
        localDirect: true,
      });

      const trialReq = makeJsonRequest({
        url: "/__openbot/platform-auth/platform/trial/apply",
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          companyName: "Acme 集团",
          contactName: "Dana",
          workEmail: "dana@gmail.com",
          expectedUsers: "101",
          useCase: "全国团队协作与数据接入",
        },
      });
      const trialRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(trialReq, trialRes.res, {
        trustedProxy,
        localDirect: true,
      });
      expect(trialRes.res.statusCode).toBe(202);
      const payload = JSON.parse(String(trialRes.end.mock.calls[0]?.[0] ?? "")) as {
        trialApplication?: { mode?: string };
        platformAuth?: { pendingActivation?: unknown };
      };
      expect(payload.trialApplication?.mode).toBe("manual");
      expect(payload.platformAuth?.pendingActivation).toBeUndefined();

      const store = JSON.parse(await fs.readFile(storePath, "utf8")) as {
        enterprises?: Record<string, unknown>;
        trialApplications?: Record<string, { mode?: string }>;
      };
      expect(Object.keys(store.enterprises ?? {})).toHaveLength(0);
      expect(Object.values(store.trialApplications ?? {})).toEqual(
        expect.arrayContaining([expect.objectContaining({ mode: "manual" })]),
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("lets a platform admin create enterprises on behalf of customers", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-platform-auth-"));
    try {
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          requireMfaForPlatformAdmins: false,
          store: path.join(tempDir, "platform-auth.json"),
        },
      };
      const bootstrapReq = makeJsonRequest({
        url: "/__openbot/platform-auth/platform/bootstrap",
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          email: "ops@example.com",
          password: "password-123",
          displayName: "Ops",
        },
      });
      const bootstrapRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(bootstrapReq, bootstrapRes.res, {
        trustedProxy,
        localDirect: true,
      });
      const adminCookie = getPrimarySetCookie(bootstrapRes.setHeader);

      const createReq = makeJsonRequest({
        url: "/__openbot/platform-auth/platform/enterprise/create",
        method: "POST",
        headers: {
          host: "127.0.0.1:18789",
          cookie: String(adminCookie).split(";")[0],
        },
        body: {
          enterpriseName: "Contoso",
          adminName: "Chris",
          adminEmail: "chris@example.com",
          creationMode: "advanced",
          trialDays: 30,
          seatCount: 10,
        },
      });
      const createRes = makeMockHttpResponse();
      const handled = await handleControlUiPlatformAuthRequest(createReq, createRes.res, {
        trustedProxy,
        localDirect: true,
      });
      expect(handled).toBe(true);
      expect(createRes.res.statusCode).toBe(201);
      const payload = JSON.parse(String(createRes.end.mock.calls[0]?.[0] ?? "")) as {
        ok: boolean;
        session?: { user?: string };
        emailDelivery?: { status?: string; reason?: string };
        platformAuth?: {
          pendingActivation?: { enterpriseName?: string; email?: string; code?: string };
          platformEnterprises?: Array<{
            name?: string;
            seatQuota?: number;
            status?: string;
            creationMode?: string;
            lifecycleStage?: string;
            approvalStatus?: string;
            defaultPolicyName?: string;
            contributionSummary?: {
              submittedAssetPackages?: number;
              approvedAssets?: number;
              incubationCandidates?: number;
              platformCandidates?: number;
              crossTenantReuseCount?: number;
              publishedSharedAssets?: number;
            };
          }>;
        };
      };
      expect(payload.ok).toBe(true);
      expect(payload.session?.user).toBe("ops@example.com");
      expect(payload.platformAuth?.pendingActivation).toMatchObject({
        enterpriseName: "Contoso",
        email: "chris@example.com",
      });
      expect(payload.platformAuth?.pendingActivation?.code).toBeTruthy();
      // SMTP typically unset in unit tests → queued with smtp_not_configured
      expect(payload.emailDelivery?.status).toBeTruthy();
      const storeRaw = await fs.readFile(path.join(tempDir, "platform-auth.json"), "utf8");
      const store = JSON.parse(storeRaw) as {
        leadNotifications?: Record<
          string,
          { type?: string; payload?: { activationUrl?: string; code?: string } }
        >;
      };
      const activationMail = Object.values(store.leadNotifications ?? {}).find(
        (entry) => entry.type === "admin-activation-email",
      );
      expect(activationMail).toBeTruthy();
      expect(activationMail?.payload?.activationUrl).toEqual(
        expect.stringContaining("authMode=enterprise-activate"),
      );
      expect(activationMail?.payload?.activationUrl).toEqual(
        expect.stringContaining("enterprise/login"),
      );
      expect(payload.platformAuth?.platformEnterprises).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "Contoso",
            seatQuota: 10,
            status: "suspended",
            creationMode: "advanced",
            lifecycleStage: "governance_review",
            approvalStatus: "pending",
            defaultPolicyName: "Advanced Governance Policy",
            contributionSummary: {
              submittedAssetPackages: 0,
              approvedAssets: 0,
              incubationCandidates: 0,
              platformCandidates: 0,
              crossTenantReuseCount: 0,
              publishedSharedAssets: 0,
            },
          }),
        ]),
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("allows a public direct platform admin session to create enterprises", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-platform-auth-"));
    try {
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          requireMfaForPlatformAdmins: false,
          store: path.join(tempDir, "platform-auth.json"),
        },
      };
      await withEnvAsync(
        {
          OPENBOT_PUBLIC_APP_BASE_URL: "https://admin.openbot.love",
        },
        async () => {
          const bootstrapReq = makeJsonRequest({
            url: "/__openbot/platform-auth/platform/bootstrap",
            method: "POST",
            headers: { host: "127.0.0.1:18789" },
            body: {
              email: "ops@example.com",
              password: "password-123",
              displayName: "Ops",
            },
          });
          const bootstrapRes = makeMockHttpResponse();
          await handleControlUiPlatformAuthRequest(bootstrapReq, bootstrapRes.res, {
            trustedProxy,
            localDirect: true,
          });
          const adminCookie = getPrimarySetCookie(bootstrapRes.setHeader);
          expect(adminCookie).toBeDefined();

          const createReq = makeJsonRequest({
            url: "/__openbot/platform-auth/platform/enterprise/create",
            method: "POST",
            headers: {
              host: "admin.openbot.love",
              "x-forwarded-host": "admin.openbot.love",
              "x-forwarded-proto": "https",
              cookie: String(adminCookie).split(";")[0],
            },
            body: {
              enterpriseName: "Contoso Public",
              adminName: "Chris",
              adminEmail: "chris-public@example.com",
              creationMode: "advanced",
              trialDays: 30,
              seatCount: 10,
            },
          });
          Object.defineProperty(createReq, "socket", {
            value: { remoteAddress: "127.0.0.1" },
            configurable: true,
          });
          const createRes = makeMockHttpResponse();
          const handled = await handleControlUiPlatformAuthRequest(createReq, createRes.res, {
            trustedProxy,
            localDirect: false,
          });
          expect(handled).toBe(true);
          expect(createRes.res.statusCode).toBe(201);
          const payload = JSON.parse(String(createRes.end.mock.calls[0]?.[0] ?? "")) as {
            ok: boolean;
            platformAuth?: {
              pendingActivation?: { enterpriseName?: string; email?: string };
            };
          };
          expect(payload.ok).toBe(true);
          expect(payload.platformAuth?.pendingActivation).toMatchObject({
            enterpriseName: "Contoso Public",
            email: "chris-public@example.com",
          });
        },
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("resends employee activation emails through /employee/activation/send", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-platform-auth-"));
    try {
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          requireMfaForPlatformAdmins: false,
          store: path.join(tempDir, "platform-auth.json"),
        },
      };
      const bootstrapReq = makeJsonRequest({
        url: "/__openbot/platform-auth/platform/bootstrap",
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          email: "ops@example.com",
          password: "password-123",
          displayName: "Ops",
        },
      });
      await handleControlUiPlatformAuthRequest(bootstrapReq, makeMockHttpResponse().res, {
        trustedProxy,
        localDirect: true,
      });
      const createReq = makeJsonRequest({
        url: "/__openbot/platform-auth/enterprise/create",
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          enterpriseName: "Acme",
          adminName: "Owner",
          adminEmail: "owner@example.com",
        },
      });
      const createRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(createReq, createRes.res, {
        trustedProxy,
        localDirect: true,
      });
      const adminActivationCode = (
        JSON.parse(String(createRes.end.mock.calls[0]?.[0] ?? "")) as {
          platformAuth?: { pendingActivation?: { code?: string } };
        }
      ).platformAuth?.pendingActivation?.code;
      const activateReq = makeJsonRequest({
        url: "/__openbot/platform-auth/enterprise/admin/activate",
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          email: "owner@example.com",
          displayName: "Owner",
          password: "password-123",
          code: adminActivationCode,
        },
      });
      const activateRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(activateReq, activateRes.res, {
        trustedProxy,
        localDirect: true,
      });
      const ownerCookie = getPrimarySetCookie(activateRes.setHeader);
      const activatePayload = JSON.parse(String(activateRes.end.mock.calls[0]?.[0] ?? "")) as {
        session?: { tenantId?: string };
      };
      const tenantId = activatePayload.session?.tenantId;
      expect(typeof tenantId).toBe("string");
      const positionId = await createVacantEnterprisePosition(String(tenantId), "客服专员");

      const provisionReq = makeJsonRequest({
        url: "/__openbot/platform-auth/employee/provision",
        method: "POST",
        headers: {
          host: "127.0.0.1:18789",
          cookie: String(ownerCookie).split(";")[0],
        },
        body: {
          employeeName: "客服专员",
          employeeEmail: "elledecke204@gmail.com",
          positionId,
          sendActivationEmail: false,
        },
      });
      await handleControlUiPlatformAuthRequest(provisionReq, makeMockHttpResponse().res, {
        trustedProxy,
        localDirect: true,
      });

      const sendReq = makeJsonRequest({
        url: "/__openbot/platform-auth/employee/activation/send",
        method: "POST",
        headers: {
          host: "127.0.0.1:18789",
          cookie: String(ownerCookie).split(";")[0],
        },
        body: {
          emails: ["elledecke204@gmail.com"],
        },
      });
      const sendRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(sendReq, sendRes.res, {
        trustedProxy,
        localDirect: true,
      });
      const sendPayload = JSON.parse(String(sendRes.end.mock.calls[0]?.[0] ?? "")) as {
        ok?: boolean;
        activationDelivery?: { total?: number; queued?: number; queuedReason?: string };
        platformAuth?: { smtpConfigured?: boolean };
      };
      expect(sendRes.res.statusCode).toBe(200);
      expect(sendPayload.ok).toBe(true);
      expect(sendPayload.activationDelivery).toMatchObject({
        total: 1,
        queued: 1,
        queuedReason: "smtp_not_configured",
      });
      expect(sendPayload.platformAuth?.smtpConfigured).toBe(false);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("provisions an employee seat, activates the employee, and freezes the seat on offboard", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-platform-auth-"));
    try {
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          requireMfaForPlatformAdmins: false,
          store: path.join(tempDir, "platform-auth.json"),
        },
      };
      const bootstrapReq = makeJsonRequest({
        url: "/__openbot/platform-auth/platform/bootstrap",
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          email: "ops@example.com",
          password: "password-123",
          displayName: "Ops",
        },
      });
      await handleControlUiPlatformAuthRequest(bootstrapReq, makeMockHttpResponse().res, {
        trustedProxy,
        localDirect: true,
      });

      const createReq = makeJsonRequest({
        url: "/__openbot/platform-auth/enterprise/create",
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          enterpriseName: "Acme",
          adminName: "Owner",
          adminEmail: "owner@example.com",
        },
      });
      const createRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(createReq, createRes.res, {
        trustedProxy,
        localDirect: true,
      });
      const adminActivationCode = (
        JSON.parse(String(createRes.end.mock.calls[0]?.[0] ?? "")) as {
          platformAuth?: { pendingActivation?: { code?: string } };
        }
      ).platformAuth?.pendingActivation?.code;

      const activateReq = makeJsonRequest({
        url: "/__openbot/platform-auth/enterprise/admin/activate",
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          email: "owner@example.com",
          displayName: "Owner",
          password: "password-123",
          code: adminActivationCode,
        },
      });
      const activateRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(activateReq, activateRes.res, {
        trustedProxy,
        localDirect: true,
      });
      const ownerCookie = getPrimarySetCookie(activateRes.setHeader);
      const activatePayload = JSON.parse(String(activateRes.end.mock.calls[0]?.[0] ?? "")) as {
        session?: { tenantId?: string };
      };
      const tenantId = activatePayload.session?.tenantId;
      expect(typeof tenantId).toBe("string");

      const titleOnlyRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: "/__openbot/platform-auth/employee/provision",
          method: "POST",
          headers: {
            host: "127.0.0.1:18789",
            cookie: String(ownerCookie).split(";")[0],
          },
          body: {
            employeeName: "Member",
            employeeEmail: "title-only@example.com",
            seatTitle: "Sales Lead",
          },
        }),
        titleOnlyRes.res,
        { trustedProxy, localDirect: true },
      );
      expect(titleOnlyRes.res.statusCode).toBe(400);
      expect(JSON.parse(String(titleOnlyRes.end.mock.calls[0]?.[0] ?? ""))).toMatchObject({
        ok: false,
        code: "PLATFORM_AUTH_POSITION_REQUIRED",
      });

      const positionId = await createVacantEnterprisePosition(String(tenantId), "Sales Lead");
      const provisionReq = makeJsonRequest({
        url: "/__openbot/platform-auth/employee/provision",
        method: "POST",
        headers: {
          host: "127.0.0.1:18789",
          cookie: String(ownerCookie).split(";")[0],
        },
        body: {
          employeeName: "Member",
          employeeEmail: "member@example.com",
          positionId,
        },
      });
      const provisionRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(provisionReq, provisionRes.res, {
        trustedProxy,
        localDirect: true,
      });
      const provisionPayload = JSON.parse(String(provisionRes.end.mock.calls[0]?.[0] ?? "")) as {
        emailDelivery?: { status?: string; reason?: string };
        platformAuth?: {
          pendingActivation?: { kind?: string; code?: string };
          organization?: {
            seatCount?: number;
            seats?: Array<{
              title?: string;
              pendingEmployeeUser?: string;
              pendingEmployeeDisplayName?: string;
            }>;
          };
        };
      };
      expect(provisionPayload.emailDelivery).toMatchObject({
        status: "queued",
        reason: "smtp_not_configured",
      });
      expect(provisionPayload.platformAuth?.pendingActivation?.kind).toBe("employee-activation");
      expect(provisionPayload.platformAuth?.organization).toMatchObject({
        seatCount: 1,
        seats: [
          expect.objectContaining({
            title: "Sales Lead",
            pendingEmployeeUser: "member@example.com",
            pendingEmployeeDisplayName: "Member",
          }),
        ],
      });
      const provisionStore = JSON.parse(
        await fs.readFile(trustedProxy.platformAuth.store, "utf8"),
      ) as {
        leadNotifications?: Record<
          string,
          {
            type?: string;
            email?: string;
            status?: string;
            deliveryReason?: string;
            payload?: Record<string, unknown>;
          }
        >;
      };
      expect(Object.values(provisionStore.leadNotifications ?? {})).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "employee-activation-email",
            email: "member@example.com",
            status: "queued",
            deliveryReason: "smtp_not_configured",
            payload: expect.objectContaining({
              seatTitle: "Sales Lead",
              activationUrl: expect.stringContaining("authMode=employee-register"),
            }),
          }),
        ]),
      );
      const employeeCode = provisionPayload.platformAuth?.pendingActivation?.code;

      const registerReq = makeJsonRequest({
        url: "/__openbot/platform-auth/employee/register",
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          email: "member@example.com",
          displayName: "Member",
          password: "password-123",
          code: employeeCode,
        },
      });
      const registerRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(registerReq, registerRes.res, {
        trustedProxy,
        localDirect: true,
      });
      const registerPayload = JSON.parse(String(registerRes.end.mock.calls[0]?.[0] ?? "")) as {
        session?: { user?: string };
        platformAuth?: {
          membershipRole?: string;
          employeeAccess?: {
            currentSeat?: { title?: string };
            defaultAgentId?: string | null;
            memoryScopeIds?: string[];
          };
        };
      };
      expect(registerPayload.session?.user).toBe("member@example.com");
      expect(registerPayload.platformAuth?.membershipRole).toBe("member");
      expect(registerPayload.platformAuth?.employeeAccess).toMatchObject({
        currentSeat: { title: "Sales Lead" },
        defaultAgentId: null,
        memoryScopeIds: expect.any(Array),
      });
      expect(registerPayload.platformAuth?.employeeAccess?.memoryScopeIds).toHaveLength(1);

      const offboardReq = makeJsonRequest({
        url: "/__openbot/platform-auth/member/remove",
        method: "POST",
        headers: {
          host: "127.0.0.1:18789",
          cookie: String(ownerCookie).split(";")[0],
        },
        body: {
          user: "member@example.com",
        },
      });
      const offboardRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(offboardReq, offboardRes.res, {
        trustedProxy,
        localDirect: true,
      });
      const offboardPayload = JSON.parse(String(offboardRes.end.mock.calls[0]?.[0] ?? "")) as {
        platformAuth?: {
          members?: Array<{ user?: string; status?: string }>;
          organization?: {
            handovers?: Array<{ seatTitle?: string; status?: string }>;
            seats?: Array<{ title?: string; status?: string }>;
          };
        };
      };
      expect(offboardPayload.platformAuth?.members ?? []).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ user: "member@example.com" })]),
      );
      expect(offboardPayload.platformAuth?.organization).toMatchObject({
        seats: [expect.objectContaining({ title: "Sales Lead", status: "handover_pending" })],
        handovers: [expect.objectContaining({ seatTitle: "Sales Lead", status: "frozen" })],
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("issues a password reset code and accepts it to establish a new session", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-platform-auth-"));
    try {
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          requireMfaForPlatformAdmins: false,
          store: path.join(tempDir, "platform-auth.json"),
        },
      };
      const bootstrapReq = makeJsonRequest({
        url: "/__openbot/platform-auth/platform/bootstrap",
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          email: "ops@example.com",
          password: "password-123",
          displayName: "Ops",
        },
      });
      await handleControlUiPlatformAuthRequest(bootstrapReq, makeMockHttpResponse().res, {
        trustedProxy,
        localDirect: true,
      });
      const createReq = makeJsonRequest({
        url: "/__openbot/platform-auth/enterprise/create",
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          enterpriseName: "Acme",
          adminName: "Owner",
          adminEmail: "owner@example.com",
        },
      });
      const createRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(createReq, createRes.res, {
        trustedProxy,
        localDirect: true,
      });
      const activationCode = JSON.parse(String(createRes.end.mock.calls[0]?.[0] ?? "")) as {
        platformAuth?: { pendingActivation?: { code?: string } };
      };
      const activateReq = makeJsonRequest({
        url: "/__openbot/platform-auth/enterprise/admin/activate",
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          email: "owner@example.com",
          displayName: "Owner",
          password: "password-123",
          code: activationCode.platformAuth?.pendingActivation?.code,
        },
      });
      await handleControlUiPlatformAuthRequest(activateReq, makeMockHttpResponse().res, {
        trustedProxy,
        localDirect: true,
      });

      const forgotReq = makeJsonRequest({
        url: "/__openbot/platform-auth/password/forgot",
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          email: "owner@example.com",
        },
      });
      const forgotRes = makeMockHttpResponse();
      const forgotHandled = await handleControlUiPlatformAuthRequest(forgotReq, forgotRes.res, {
        trustedProxy,
        localDirect: true,
      });
      expect(forgotHandled).toBe(true);
      const forgotPayload = JSON.parse(String(forgotRes.end.mock.calls[0]?.[0] ?? "")) as {
        ok: boolean;
        platformAuth?: { pendingPasswordReset?: { code?: string } };
      };
      expect(forgotPayload.ok).toBe(true);
      const resetCode = forgotPayload.platformAuth?.pendingPasswordReset?.code;
      expect(typeof resetCode).toBe("string");

      const resetReq = makeJsonRequest({
        url: "/__openbot/platform-auth/password/reset",
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          email: "owner@example.com",
          password: "new-password-123",
          code: resetCode,
        },
      });
      const resetRes = makeMockHttpResponse();
      const resetHandled = await handleControlUiPlatformAuthRequest(resetReq, resetRes.res, {
        trustedProxy,
        localDirect: true,
      });
      expect(resetHandled).toBe(true);
      expect(resetRes.res.statusCode).toBe(200);
      const resetPayload = JSON.parse(String(resetRes.end.mock.calls[0]?.[0] ?? "")) as {
        ok: boolean;
        session?: { user?: string };
        passwordReset?: { sessionIssued?: boolean };
      };
      expect(resetPayload.ok).toBe(true);
      expect(resetPayload.session).toBeUndefined();
      expect(resetPayload.passwordReset).toMatchObject({ sessionIssued: false });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("binds a new-hire assignment to the explicit seatId when same-title seats exist", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-platform-auth-"));
    try {
      const authStorePath = path.join(tempDir, "platform-auth.json");
      const seatStorePath = path.join(tempDir, "seat-assets.json");
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          requireMfaForPlatformAdmins: false,
          store: authStorePath,
        },
      };
      await withTempConfig({
        cfg: {
          gateway: {
            enterpriseSeatAssets: {
              backend: "json",
              store: seatStorePath,
            },
          },
        },
        run: async () => {
          await handleControlUiPlatformAuthRequest(
            makeJsonRequest({
              url: "/__openbot/platform-auth/platform/bootstrap",
              method: "POST",
              headers: { host: "127.0.0.1:18789" },
              body: {
                email: "ops@example.com",
                password: "password-123",
                displayName: "Ops",
              },
            }),
            makeMockHttpResponse().res,
            { trustedProxy, localDirect: true },
          );

          const createRes = makeMockHttpResponse();
          await handleControlUiPlatformAuthRequest(
            makeJsonRequest({
              url: "/__openbot/platform-auth/enterprise/create",
              method: "POST",
              headers: { host: "127.0.0.1:18789" },
              body: {
                enterpriseName: "Acme",
                adminName: "Owner",
                adminEmail: "owner@example.com",
              },
            }),
            createRes.res,
            { trustedProxy, localDirect: true },
          );
          const createPayload = JSON.parse(String(createRes.end.mock.calls[0]?.[0] ?? "")) as {
            platformAuth?: {
              pendingActivation?: { code?: string };
              enterprises?: Array<{ id?: string }>;
            };
          };
          const adminCode = createPayload.platformAuth?.pendingActivation?.code;

          const activateRes = makeMockHttpResponse();
          await handleControlUiPlatformAuthRequest(
            makeJsonRequest({
              url: "/__openbot/platform-auth/enterprise/admin/activate",
              method: "POST",
              headers: { host: "127.0.0.1:18789" },
              body: {
                email: "owner@example.com",
                displayName: "Owner",
                password: "password-123",
                code: adminCode,
              },
            }),
            activateRes.res,
            { trustedProxy, localDirect: true },
          );
          const adminCookie = getPrimarySetCookie(activateRes.setHeader);
          const tenantId = JSON.parse(String(activateRes.end.mock.calls[0]?.[0] ?? "")) as {
            session?: { tenantId?: string };
          };
          const enterpriseId = tenantId.session?.tenantId;
          expect(typeof enterpriseId).toBe("string");

          const { loadEnterpriseSeatAssetsStore, saveEnterpriseSeatAssetsStore } =
            await import("./enterprise-seat-assets-store.js");
          const seatStore = await loadEnterpriseSeatAssetsStore(seatStorePath);
          seatStore.seats["seat-east"] = {
            seatId: "seat-east",
            tenantId: String(enterpriseId),
            title: "销售经理",
            teamLabel: "华东",
            roleCode: "SALES-MGR-001",
            status: "vacant",
            defaultSpaceIds: [],
            defaultAgentAssetIds: [],
            createdAt: "2026-06-04T00:00:00.000Z",
            updatedAt: "2026-06-04T00:00:00.000Z",
          };
          seatStore.seats["seat-south"] = {
            seatId: "seat-south",
            tenantId: String(enterpriseId),
            title: "销售经理",
            teamLabel: "华南",
            roleCode: "SALES-MGR-002",
            status: "handover_pending",
            defaultSpaceIds: [],
            defaultAgentAssetIds: [],
            createdAt: "2026-06-04T00:00:00.000Z",
            updatedAt: "2026-06-04T00:00:00.000Z",
          };
          await saveEnterpriseSeatAssetsStore(seatStorePath, seatStore);

          const provisionRes = makeMockHttpResponse();
          await handleControlUiPlatformAuthRequest(
            makeJsonRequest({
              url: "/__openbot/platform-auth/employee/provision",
              method: "POST",
              headers: {
                host: "127.0.0.1:18789",
                cookie: String(adminCookie).split(";")[0],
              },
              body: {
                employeeName: "Successor",
                employeeEmail: "successor@example.com",
                seatId: "seat-south",
              },
            }),
            provisionRes.res,
            { trustedProxy, localDirect: true },
          );
          const provisionPayload = JSON.parse(
            String(provisionRes.end.mock.calls[0]?.[0] ?? ""),
          ) as {
            emailDelivery?: { status?: string; reason?: string };
            platformAuth?: {
              pendingActivation?: { code?: string; assignmentId?: string };
              organization?: {
                seats?: Array<{
                  seatId?: string;
                  title?: string;
                  teamLabel?: string;
                  pendingEmployeeUser?: string;
                  pendingAssignmentId?: string;
                }>;
              };
            };
          };
          expect(provisionPayload.emailDelivery).toMatchObject({
            status: "queued",
            reason: "smtp_not_configured",
          });
          expect(provisionPayload.platformAuth?.organization?.seats).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                seatId: "seat-south",
                title: "销售经理",
                teamLabel: "华南",
                pendingEmployeeUser: "successor@example.com",
                status: "assigned",
              }),
              expect.objectContaining({
                seatId: "seat-east",
                title: "销售经理",
              }),
            ]),
          );
          expect(
            provisionPayload.platformAuth?.organization?.seats?.find(
              (seat) => seat.seatId === "seat-east",
            )?.pendingEmployeeUser,
          ).toBeUndefined();
          const pendingAssignmentId =
            provisionPayload.platformAuth?.pendingActivation?.assignmentId;
          expect(typeof pendingAssignmentId).toBe("string");
          expect(
            provisionPayload.platformAuth?.organization?.seats?.find(
              (seat) => seat.seatId === "seat-south",
            )?.pendingAssignmentId,
          ).toBe(pendingAssignmentId);

          const provisionStore = JSON.parse(await fs.readFile(authStorePath, "utf8")) as {
            leadNotifications?: Record<
              string,
              { payload?: { assignmentId?: string; seatTitle?: string; teamLabel?: string } }
            >;
          };
          expect(Object.values(provisionStore.leadNotifications ?? {})).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                payload: expect.objectContaining({
                  assignmentId: pendingAssignmentId,
                  seatTitle: "销售经理",
                  teamLabel: "华南",
                }),
              }),
            ]),
          );

          const employeeCode = provisionPayload.platformAuth?.pendingActivation?.code;
          const registerRes = makeMockHttpResponse();
          await handleControlUiPlatformAuthRequest(
            makeJsonRequest({
              url: "/__openbot/platform-auth/employee/register",
              method: "POST",
              headers: { host: "127.0.0.1:18789" },
              body: {
                email: "successor@example.com",
                displayName: "Successor",
                password: "password-123",
                code: employeeCode,
              },
            }),
            registerRes.res,
            { trustedProxy, localDirect: true },
          );
          const registerPayload = JSON.parse(String(registerRes.end.mock.calls[0]?.[0] ?? "")) as {
            platformAuth?: {
              employeeAccess?: { currentSeat?: { seatId?: string; title?: string } };
            };
          };
          expect(registerPayload.platformAuth?.employeeAccess?.currentSeat).toMatchObject({
            seatId: "seat-south",
            title: "销售经理",
          });

          const finalSeatStore = await loadEnterpriseSeatAssetsStore(seatStorePath);
          expect(finalSeatStore.seats["seat-south"]?.currentEmployeeId).toBeDefined();
          expect(finalSeatStore.seats["seat-south"]?.status).toBe("occupied");
          expect(finalSeatStore.seats["seat-east"]?.currentEmployeeId).toBeUndefined();
          expect(finalSeatStore.seats["seat-east"]?.status).toBe("vacant");

          const provisionStoreAfterRegister = JSON.parse(
            await fs.readFile(authStorePath, "utf8"),
          ) as {
            employeeProvisions?: Record<
              string,
              { assignmentId?: string; normalizedEmployeeEmail?: string }
            >;
          };
          expect(
            Object.values(provisionStoreAfterRegister.employeeProvisions ?? {}).find(
              (entry) => entry.normalizedEmployeeEmail === "successor@example.com",
            )?.assignmentId,
          ).toBe(pendingAssignmentId);
        },
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("uses the configured public app base URL for password reset links", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-platform-auth-"));
    try {
      const storePath = path.join(tempDir, "platform-auth.json");
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          store: storePath,
        },
      };
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: "/__openbot/platform-auth/platform/bootstrap",
          method: "POST",
          headers: { host: "127.0.0.1:18789" },
          body: { email: "ops@example.com", password: "password-123", displayName: "Ops" },
        }),
        makeMockHttpResponse().res,
        { trustedProxy, localDirect: true },
      );
      const createRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: "/__openbot/platform-auth/enterprise/create",
          method: "POST",
          headers: { host: "127.0.0.1:18789" },
          body: {
            enterpriseName: "Acme",
            adminName: "Owner",
            adminEmail: "owner@example.com",
          },
        }),
        createRes.res,
        { trustedProxy, localDirect: true },
      );
      const activationCode = JSON.parse(String(createRes.end.mock.calls[0]?.[0] ?? "")) as {
        platformAuth?: { pendingActivation?: { code?: string } };
      };
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: "/__openbot/platform-auth/enterprise/admin/activate",
          method: "POST",
          headers: { host: "127.0.0.1:18789" },
          body: {
            email: "owner@example.com",
            displayName: "Owner",
            password: "password-123",
            code: activationCode.platformAuth?.pendingActivation?.code,
          },
        }),
        makeMockHttpResponse().res,
        { trustedProxy, localDirect: true },
      );
      await withEnvAsync(
        {
          OPENBOT_PUBLIC_APP_BASE_URL: "https://www.openbot.love",
        },
        async () => {
          const forgotRes = makeMockHttpResponse();
          await handleControlUiPlatformAuthRequest(
            makeJsonRequest({
              url: "/__openbot/platform-auth/password/forgot",
              method: "POST",
              headers: { host: "127.0.0.1:18789" },
              body: { email: "owner@example.com" },
            }),
            forgotRes.res,
            { trustedProxy, localDirect: true },
          );
          const store = JSON.parse(await fs.readFile(trustedProxy.platformAuth.store, "utf8")) as {
            leadNotifications?: Record<string, { payload?: Record<string, unknown> }>;
          };
          expect(Object.values(store.leadNotifications ?? {})).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                payload: expect.objectContaining({
                  resetUrl: expect.stringMatching(
                    /^https:\/\/www\.openbot\.love\/\?authMode=password-reset&code=[^&]+&surface=employee#auth$/,
                  ),
                }),
              }),
            ]),
          );
        },
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("canonicalizes legacy enterprise ids in platform auth store on load", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-platform-auth-"));
    try {
      const storePath = path.join(tempDir, "platform-auth.json");
      await fs.mkdir(path.join(tempDir, "enterprise"), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, "enterprise", "tenants.json"),
        JSON.stringify(
          {
            version: 1,
            tenants: [{ tenantId: "001", slug: "upbeyond", displayName: "upbeyond" }],
          },
          null,
          2,
        ),
      );
      await fs.writeFile(
        storePath,
        JSON.stringify(
          {
            version: 4,
            secret: "test-secret",
            policy: {
              defaultTrialDays: 14,
              allowedTrialDays: [14],
              defaultTrialSeatCount: 5,
              trialSeatOptions: [5],
              allowCustomTrialSeatCount: false,
              trialExpiryPolicy: "redirect_to_upgrade",
              updatedAt: "2026-05-01T00:00:00.000Z",
            },
            enterprises: {
              "upbeyond-91aeea3c": {
                id: "upbeyond-91aeea3c",
                name: "UPBEYOND",
                slug: "upbeyond",
                status: "paid",
                plan: "legacy",
                createdSource: "self-service",
                billingStatus: "legacy",
                createdAt: "2026-05-01T00:00:00.000Z",
                updatedAt: "2026-05-01T00:00:00.000Z",
                seatQuota: 5,
                seatUsed: 1,
              },
            },
            users: {},
            sessions: {},
            memberships: {
              "membership-1": {
                id: "membership-1",
                userId: "user-1",
                enterpriseId: "upbeyond-91aeea3c",
                membershipRole: "enterprise-admin",
                createdAt: "2026-05-01T00:00:00.000Z",
                updatedAt: "2026-05-01T00:00:00.000Z",
              },
            },
            adminProvisions: {},
            employeeProvisions: {},
            activationCodes: {},
            trialApplications: {},
            leadNotifications: {},
          },
          null,
          2,
        ),
      );

      const store = await loadPlatformAuthStore({
        enabled: true,
        storePath,
        sessionTtlHours: 24,
        activationTtlHours: 24,
        passwordResetTtlMinutes: 30,
        cookieName: "openbot_platform_auth",
        requireMfaForPlatformAdmins: true,
      });

      expect(store.enterprises["001"]?.id).toBe("001");
      expect(store.memberships["membership-1"]?.enterpriseId).toBe("001");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns the existing pending application when the same email re-applies", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-platform-auth-"));
    try {
      const storePath = path.join(tempDir, "platform-auth.json");
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          requireMfaForPlatformAdmins: false,
          store: storePath,
        },
      };
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: "/__openbot/platform-auth/platform/bootstrap",
          method: "POST",
          headers: { host: "127.0.0.1:18789" },
          body: { email: "ops@example.com", password: "password-123", displayName: "Ops" },
        }),
        makeMockHttpResponse().res,
        { trustedProxy, localDirect: true },
      );
      const submit = async (companyName: string) => {
        const req = makeJsonRequest({
          url: "/__openbot/platform-auth/platform/trial/apply",
          method: "POST",
          headers: { host: "127.0.0.1:18789" },
          body: {
            companyName,
            contactName: "Dana",
            workEmail: "dana@gmail.com",
            expectedUsers: "5",
            useCase: "Customer support",
          },
        });
        const out = makeMockHttpResponse();
        await handleControlUiPlatformAuthRequest(req, out.res, { trustedProxy, localDirect: true });
        return out;
      };
      const first = await submit("Acme A");
      expect(first.res.statusCode).toBe(202);
      const second = await submit("Acme B");
      expect(second.res.statusCode).toBe(200);
      const store = JSON.parse(await fs.readFile(storePath, "utf8")) as {
        trialApplications?: Record<string, { companyName?: string; status?: string }>;
      };
      const pendings = Object.values(store.trialApplications ?? {}).filter(
        (entry) => entry.status === "pending",
      );
      expect(pendings).toHaveLength(1);
      expect(pendings[0]?.companyName).toBe("Acme B");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("approves a pending trial application, builds an enterprise, and queues activation email", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-platform-auth-"));
    try {
      const storePath = path.join(tempDir, "platform-auth.json");
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          requireMfaForPlatformAdmins: false,
          store: storePath,
        },
      };
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: "/__openbot/platform-auth/platform/bootstrap",
          method: "POST",
          headers: { host: "127.0.0.1:18789" },
          body: { email: "ops@example.com", password: "password-123", displayName: "Ops" },
        }),
        makeMockHttpResponse().res,
        { trustedProxy, localDirect: true },
      );
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: "/__openbot/platform-auth/platform/trial/apply",
          method: "POST",
          headers: { host: "127.0.0.1:18789" },
          body: {
            companyName: "Acme",
            contactName: "Dana",
            workEmail: "dana@gmail.com",
            expectedUsers: "5",
            useCase: "Customer support",
          },
        }),
        makeMockHttpResponse().res,
        { trustedProxy, localDirect: true },
      );
      const storeAfterApply = JSON.parse(await fs.readFile(storePath, "utf8")) as {
        trialApplications?: Record<string, { id?: string; status?: string }>;
      };
      const application = Object.values(storeAfterApply.trialApplications ?? {})[0];
      expect(application?.status).toBe("pending");
      const loginRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: "/__openbot/platform-auth/login",
          method: "POST",
          headers: { host: "127.0.0.1:18789" },
          body: {
            email: "ops@example.com",
            password: "password-123",
            sessionDomain: "platform",
          },
        }),
        loginRes.res,
        { trustedProxy, localDirect: true },
      );
      const cookie = getPrimarySetCookie(loginRes.setHeader);
      expect(cookie).toBeDefined();
      const approveRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: "/__openbot/platform-auth/platform/trial/applications/approve",
          method: "POST",
          headers: { host: "127.0.0.1:18789", cookie: cookie ?? "" },
          body: { applicationId: application?.id, reviewNote: "looks good" },
        }),
        approveRes.res,
        { trustedProxy, localDirect: true },
      );
      expect(approveRes.res.statusCode).toBe(200);
      const finalStore = JSON.parse(await fs.readFile(storePath, "utf8")) as {
        enterprises?: Record<string, { name?: string }>;
        trialApplications?: Record<
          string,
          { status?: string; reviewNote?: string; reviewedByPlatformUserId?: string }
        >;
        leadNotifications?: Record<string, { type?: string }>;
        adminProvisions?: Record<string, { status?: string }>;
      };
      const enterprises = Object.values(finalStore.enterprises ?? {});
      expect(enterprises).toHaveLength(1);
      expect(enterprises[0]?.name).toBe("Acme");
      const finalApplication = Object.values(finalStore.trialApplications ?? {})[0];
      expect(finalApplication?.status).toBe("converted");
      expect(finalApplication?.reviewNote).toBe("looks good");
      expect(finalApplication?.reviewedByPlatformUserId).toBeTruthy();
      const notifications = Object.values(finalStore.leadNotifications ?? {});
      expect(notifications).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: "admin-activation-email" })]),
      );
      const adminProvisions = Object.values(finalStore.adminProvisions ?? {});
      expect(adminProvisions).toEqual(
        expect.arrayContaining([expect.objectContaining({ status: "pending_activation" })]),
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects a pending trial application without creating an enterprise", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-platform-auth-"));
    try {
      const storePath = path.join(tempDir, "platform-auth.json");
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          requireMfaForPlatformAdmins: false,
          store: storePath,
        },
      };
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: "/__openbot/platform-auth/platform/bootstrap",
          method: "POST",
          headers: { host: "127.0.0.1:18789" },
          body: { email: "ops@example.com", password: "password-123", displayName: "Ops" },
        }),
        makeMockHttpResponse().res,
        { trustedProxy, localDirect: true },
      );
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: "/__openbot/platform-auth/platform/trial/apply",
          method: "POST",
          headers: { host: "127.0.0.1:18789" },
          body: {
            companyName: "Acme",
            contactName: "Dana",
            workEmail: "dana@gmail.com",
            expectedUsers: "5",
            useCase: "Customer support",
          },
        }),
        makeMockHttpResponse().res,
        { trustedProxy, localDirect: true },
      );
      const storeAfterApply = JSON.parse(await fs.readFile(storePath, "utf8")) as {
        trialApplications?: Record<string, { id?: string }>;
      };
      const application = Object.values(storeAfterApply.trialApplications ?? {})[0];
      const loginRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: "/__openbot/platform-auth/login",
          method: "POST",
          headers: { host: "127.0.0.1:18789" },
          body: {
            email: "ops@example.com",
            password: "password-123",
            sessionDomain: "platform",
          },
        }),
        loginRes.res,
        { trustedProxy, localDirect: true },
      );
      const cookie = getPrimarySetCookie(loginRes.setHeader);
      expect(cookie).toBeDefined();
      const rejectRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: "/__openbot/platform-auth/platform/trial/applications/reject",
          method: "POST",
          headers: { host: "127.0.0.1:18789", cookie: cookie ?? "" },
          body: { applicationId: application?.id, rejectionReason: "duplicate signup" },
        }),
        rejectRes.res,
        { trustedProxy, localDirect: true },
      );
      expect(rejectRes.res.statusCode).toBe(200);
      const finalStore = JSON.parse(await fs.readFile(storePath, "utf8")) as {
        enterprises?: Record<string, unknown>;
        trialApplications?: Record<string, { status?: string; rejectionReason?: string }>;
      };
      expect(Object.keys(finalStore.enterprises ?? {})).toHaveLength(0);
      const finalApplication = Object.values(finalStore.trialApplications ?? {})[0];
      expect(finalApplication?.status).toBe("rejected");
      expect(finalApplication?.rejectionReason).toBe("duplicate signup");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns 403 when reviewing trial applications without a platform-admin session", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-platform-auth-"));
    try {
      const storePath = path.join(tempDir, "platform-auth.json");
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          requireMfaForPlatformAdmins: false,
          store: storePath,
        },
      };
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: "/__openbot/platform-auth/platform/bootstrap",
          method: "POST",
          headers: { host: "127.0.0.1:18789" },
          body: { email: "ops@example.com", password: "password-123", displayName: "Ops" },
        }),
        makeMockHttpResponse().res,
        { trustedProxy, localDirect: true },
      );
      const listRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: "/__openbot/platform-auth/platform/trial/applications",
          method: "GET",
          headers: { host: "127.0.0.1:18789" },
        }),
        listRes.res,
        { trustedProxy, localDirect: true },
      );
      expect(listRes.res.statusCode).toBe(403);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("surfaces enterprise contribution summary in platform enterprise directory", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-platform-auth-"));
    try {
      process.env.OPENCLAW_HOME = tempDir;
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          requireMfaForPlatformAdmins: false,
          store: path.join(tempDir, "platform-auth.json"),
        },
      };
      const bootstrapReq = makeJsonRequest({
        url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/platform/bootstrap`,
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          email: "ops@example.com",
          password: "password-123",
          displayName: "Ops",
        },
      });
      await handleControlUiPlatformAuthRequest(bootstrapReq, makeMockHttpResponse().res, {
        trustedProxy,
        localDirect: true,
      });

      const createReq = makeJsonRequest({
        url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/enterprise/create`,
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          enterpriseName: "Acme",
          adminName: "Owner",
          adminEmail: "owner@example.com",
        },
      });
      await handleControlUiPlatformAuthRequest(createReq, makeMockHttpResponse().res, {
        trustedProxy,
        localDirect: true,
      });

      const store = await loadPlatformAuthStore({
        enabled: true,
        storePath: trustedProxy.platformAuth.store,
        sessionTtlHours: 24,
        activationTtlHours: 72,
        passwordResetTtlMinutes: 30,
        cookieName: "openbot_platform_session",
        requireMfaForPlatformAdmins: true,
      });
      const enterprise = Object.values(store.enterprises)[0];
      expect(enterprise).toBeDefined();

      submitProposal({
        proposalId: "proposal:test-enterprise-capability",
        submittedAt: "2026-06-01T00:00:00.000Z",
        submittedBy: "owner@example.com",
        enterpriseId: enterprise.id,
        status: "approved",
        manifest: {
          id: "urn:openclaw:skill:test-enterprise-capability@1.0.0",
          kind: "skill",
          version: "1.0.0",
          skillKey: "test-enterprise-capability",
          name: "测试企业资产",
          description: "测试企业资产描述",
          source: { kind: "personal", origin: "employee-capability:test", trustTier: "user" },
          risk: {
            level: "low",
            network: false,
            filesystem: false,
            subprocess: false,
            secrets: false,
          },
          enterpriseAssetPackage: {
            packageTitle: "测试企业资产",
            packageSummary: "测试企业资产描述",
            assetPackageType: "single_capability",
            businessScenario: "测试场景",
            inputArtifacts: [],
            outputArtifacts: [],
            dependencies: [],
            executionMode: "assistive",
            riskTags: [],
            targetTeams: [],
            verifiedInProduction: false,
            promotionIntent: "platform_candidate",
            needsEnterpriseSecrets: false,
            notes: "",
          },
        },
        findings: [],
      });

      const listReq = makeJsonRequest({
        url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/login`,
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          email: "ops@example.com",
          password: "password-123",
          expectedPlatformRole: "admin",
        },
      });
      const listRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(listReq, listRes.res, {
        trustedProxy,
        localDirect: true,
      });

      const payload = JSON.parse(String(listRes.end.mock.calls[0]?.[0] ?? "")) as {
        platformAuth?: {
          platformEnterprises?: Array<{
            name?: string;
            contributionSummary?: {
              submittedAssetPackages?: number;
              approvedAssets?: number;
              incubationCandidates?: number;
              platformCandidates?: number;
            };
          }>;
        };
      };

      expect(payload.platformAuth?.platformEnterprises).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "Acme",
            contributionSummary: expect.objectContaining({
              submittedAssetPackages: 1,
              approvedAssets: 1,
              incubationCandidates: 1,
              platformCandidates: 1,
            }),
          }),
        ]),
      );
    } finally {
      delete process.env.OPENCLAW_HOME;
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps enterprise contribution summaries isolated across multiple enterprises", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-platform-auth-"));
    try {
      process.env.OPENCLAW_HOME = tempDir;
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          requireMfaForPlatformAdmins: false,
          store: path.join(tempDir, "platform-auth.json"),
        },
      };
      const bootstrapReq = makeJsonRequest({
        url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/platform/bootstrap`,
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          email: "ops@example.com",
          password: "password-123",
          displayName: "Ops",
        },
      });
      await handleControlUiPlatformAuthRequest(bootstrapReq, makeMockHttpResponse().res, {
        trustedProxy,
        localDirect: true,
      });

      const store = await loadPlatformAuthStore({
        enabled: true,
        storePath: trustedProxy.platformAuth.store,
        sessionTtlHours: 24,
        activationTtlHours: 72,
        passwordResetTtlMinutes: 30,
        cookieName: "openbot_platform_session",
        requireMfaForPlatformAdmins: true,
      });
      const nowIso = new Date().toISOString();
      store.enterprises["ent-a"] = {
        id: "ent-a",
        name: "华东运营中心",
        slug: "east",
        status: "paid",
        plan: "enterprise",
        billingStatus: "active",
        createdSource: "platform-created",
        createdAt: nowIso,
        updatedAt: nowIso,
        seatQuota: 20,
        seatUsed: 5,
      };
      store.enterprises["ent-b"] = {
        id: "ent-b",
        name: "华南客服中心",
        slug: "south",
        status: "trial",
        plan: "trial",
        billingStatus: "trialing",
        createdSource: "self-service",
        createdAt: nowIso,
        updatedAt: nowIso,
        seatQuota: 10,
        seatUsed: 2,
      };
      await fs.writeFile(trustedProxy.platformAuth.store, `${JSON.stringify(store, null, 2)}\n`);

      submitProposal({
        proposalId: "proposal:ent-a",
        submittedAt: "2026-06-01T00:00:00.000Z",
        submittedBy: "a@example.com",
        enterpriseId: "ent-a",
        status: "approved",
        manifest: {
          id: "urn:openclaw:skill:ent-a@1.0.0",
          kind: "skill",
          version: "1.0.0",
          skillKey: "ent-a",
          name: "资产A",
          description: "资产A",
          source: { kind: "personal", origin: "employee-capability:a", trustTier: "user" },
          risk: {
            level: "low",
            network: false,
            filesystem: false,
            subprocess: false,
            secrets: false,
          },
          enterpriseAssetPackage: {
            packageTitle: "资产A",
            packageSummary: "资产A",
            assetPackageType: "single_capability",
            businessScenario: "测试场景",
            inputArtifacts: [],
            outputArtifacts: [],
            dependencies: [],
            executionMode: "assistive",
            riskTags: [],
            targetTeams: [],
            verifiedInProduction: false,
            promotionIntent: "platform_candidate",
            needsEnterpriseSecrets: false,
            notes: "",
          },
        },
        findings: [],
      });

      submitProposal({
        proposalId: "proposal:ent-b",
        submittedAt: "2026-06-02T00:00:00.000Z",
        submittedBy: "b@example.com",
        enterpriseId: "ent-b",
        status: "proposed",
        manifest: {
          id: "urn:openclaw:skill:ent-b@1.0.0",
          kind: "skill",
          version: "1.0.0",
          skillKey: "ent-b",
          name: "资产B",
          description: "资产B",
          source: { kind: "personal", origin: "employee-capability:b", trustTier: "user" },
          risk: {
            level: "low",
            network: false,
            filesystem: false,
            subprocess: false,
            secrets: false,
          },
          enterpriseAssetPackage: {
            packageTitle: "资产B",
            packageSummary: "资产B",
            assetPackageType: "single_capability",
            businessScenario: "测试场景",
            inputArtifacts: [],
            outputArtifacts: [],
            dependencies: [],
            executionMode: "assistive",
            riskTags: [],
            targetTeams: [],
            verifiedInProduction: false,
            promotionIntent: "enterprise_standard",
            needsEnterpriseSecrets: false,
            notes: "",
          },
        },
        findings: [],
      });

      const loginReq = makeJsonRequest({
        url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/login`,
        method: "POST",
        headers: { host: "127.0.0.1:18789" },
        body: {
          email: "ops@example.com",
          password: "password-123",
          expectedPlatformRole: "admin",
        },
      });
      const loginRes = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(loginReq, loginRes.res, {
        trustedProxy,
        localDirect: true,
      });

      const payload = JSON.parse(String(loginRes.end.mock.calls[0]?.[0] ?? "")) as {
        platformAuth?: {
          platformEnterprises?: Array<{
            id?: string;
            contributionSummary?: {
              submittedAssetPackages?: number;
              approvedAssets?: number;
              incubationCandidates?: number;
              platformCandidates?: number;
            };
          }>;
        };
      };

      expect(payload.platformAuth?.platformEnterprises).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "ent-a",
            contributionSummary: expect.objectContaining({
              submittedAssetPackages: 1,
              approvedAssets: 1,
              incubationCandidates: 1,
              platformCandidates: 1,
            }),
          }),
          expect.objectContaining({
            id: "ent-b",
            contributionSummary: expect.objectContaining({
              submittedAssetPackages: 1,
              approvedAssets: 0,
              incubationCandidates: 1,
              platformCandidates: 0,
            }),
          }),
        ]),
      );
    } finally {
      delete process.env.OPENCLAW_HOME;
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
