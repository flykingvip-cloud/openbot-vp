// @vitest-environment node
// Feature: shared-agent-identity-access-control-plane

import fs from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONTROL_UI_PLATFORM_AUTH_BASE_PATH } from "../control-ui-contract.js";
import type { EnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { handleControlUiPlatformAuthRequest } from "../platform-auth.js";
import { makeMockHttpResponse } from "../test-http-response.js";
import type { ResolvedPlatformAuthConfig } from "./config.js";
import { createEnterpriseWithPendingAdminActivation } from "./enterprise-provisioning.js";
import {
  resolveMembershipSelectionForUser,
  resolveSessionMembershipBinding,
} from "./memberships.js";
import { createEmployeeProvisionWithSeat } from "./routes-employee.js";
import { resolveStoredPlatformAuthSessionContext } from "./session-context.js";
import type { PlatformAuthStore } from "./store-types.js";

const seatAssetsState = vi.hoisted(() => ({
  current: null as unknown as EnterpriseSeatAssetsStore,
}));

vi.mock("../enterprise-seat-assets-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../enterprise-seat-assets-store.js")>();
  return {
    ...actual,
    loadEnterpriseSeatAssetsStore: vi.fn(async () => seatAssetsState.current),
    saveEnterpriseSeatAssetsStore: vi.fn(
      async (_storePath: string | undefined, store: EnterpriseSeatAssetsStore) => {
        seatAssetsState.current = store;
      },
    ),
  };
});

// Mock the tenant-aware I/O seam itself: the facade's importOriginal cycle can
// capture the real loader before its partial mock is installed.
vi.mock("./seat-store-loader.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./seat-store-loader.js")>();
  return {
    ...actual,
    loadSeatAssetsStoreForTenantId: vi.fn(async () => seatAssetsState.current),
    loadSeatAssetsStoreForContext: vi.fn(async () => seatAssetsState.current),
  };
});

const NOW = "2026-07-30T00:00:00.000Z";

function makeSeatAssetsStore(): EnterpriseSeatAssetsStore {
  return {
    version: 4,
    seats: {},
    bindings: {},
    accessPolicies: {},
    assetBindings: {},
    credentialBindings: {},
    handovers: {},
    offers: {},
    auditEvents: {},
    enterpriseIdentities: {},
    identityUsagePolicies: {},
    dataSourceIdentityBindings: {},
    employeeIdentityEnrollments: {},
    organizationDepartments: {},
    organizationChildOrders: {},
  };
}

function makeStore(): PlatformAuthStore {
  return {
    version: 5,
    secret: "test-secret",
    policy: {
      defaultTrialDays: 14,
      allowedTrialDays: [14],
      defaultTrialSeatCount: 5,
      trialSeatOptions: [5],
      allowCustomTrialSeatCount: false,
      trialExpiryPolicy: "choose",
      trialExpiryHandling: "auto_stop",
      trialGraceDays: 0,
      updatedAt: NOW,
    },
    enterprises: {
      "enterprise-a": {
        id: "enterprise-a",
        name: "Enterprise A",
        slug: "enterprise-a",
        status: "paid",
        plan: "paid",
        billingStatus: "active",
        createdSource: "self-service",
        createdAt: NOW,
        updatedAt: NOW,
        seatQuota: 5,
        seatUsed: 1,
      },
      "enterprise-b": {
        id: "enterprise-b",
        name: "Enterprise B",
        slug: "enterprise-b",
        status: "paid",
        plan: "paid",
        billingStatus: "active",
        createdSource: "self-service",
        createdAt: NOW,
        updatedAt: NOW,
        seatQuota: 5,
        seatUsed: 1,
      },
    },
    users: {
      "user-a": {
        id: "user-a",
        email: "user-a@example.com",
        normalizedEmail: "user-a@example.com",
        displayName: "User A",
        passwordHash: "unused",
        passwordUpdatedAt: NOW,
        loginFailedCount: 0,
        status: "active",
        source: "self-created",
        role: "operator",
        scopes: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
      "user-b": {
        id: "user-b",
        email: "user-b@example.com",
        normalizedEmail: "user-b@example.com",
        displayName: "User B",
        passwordHash: "unused",
        passwordUpdatedAt: NOW,
        loginFailedCount: 0,
        status: "active",
        source: "platform-operator",
        platformRole: "super-admin",
        role: "operator",
        scopes: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
    sessions: {
      "session-a": {
        id: "session-a",
        userId: "user-a",
        createdAt: NOW,
        updatedAt: NOW,
        sessionIssuedAt: NOW,
        expiresAt: "2099-01-01T00:00:00.000Z",
        domain: "employee",
        sessionKind: "member",
        membershipId: "membership-a",
        enterpriseId: "enterprise-a",
      },
      "platform-session": {
        id: "platform-session",
        userId: "user-b",
        createdAt: NOW,
        updatedAt: NOW,
        sessionIssuedAt: NOW,
        expiresAt: "2099-01-01T00:00:00.000Z",
        domain: "platform",
        sessionKind: "platform-super-admin",
      },
    },
    memberships: {
      "membership-a": {
        id: "membership-a",
        userId: "user-a",
        enterpriseId: "enterprise-a",
        membershipRole: "member",
        createdAt: NOW,
        updatedAt: NOW,
      },
      "membership-b": {
        id: "membership-b",
        userId: "user-b",
        enterpriseId: "enterprise-b",
        membershipRole: "enterprise-admin",
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
    adminProvisions: {},
    employeeProvisions: {},
    activationCodes: {},
    trialApplications: {},
    leadNotifications: {},
  };
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
  return Array.isArray(raw)
    ? raw.find((value): value is string => typeof value === "string" && value.includes("="))
    : undefined;
}

function cookieHeader(cookie: string): string {
  return cookie.split(";", 1)[0] ?? "";
}

function sessionIdFromCookie(cookie: string): string {
  const value = cookieHeader(cookie).split("=", 2)[1] ?? "";
  return decodeURIComponent(value).split(".", 1)[0] ?? "";
}

function makeConfig(storePath: string): ResolvedPlatformAuthConfig {
  return {
    enabled: true,
    storePath,
    sessionTtlHours: 24 * 7,
    activationTtlHours: 24 * 3,
    passwordResetTtlMinutes: 30,
    cookieName: "openbot_platform_session",
    requireMfaForPlatformAdmins: false,
  };
}

async function readStore(storePath: string): Promise<PlatformAuthStore> {
  return JSON.parse(await fs.readFile(storePath, "utf8")) as PlatformAuthStore;
}

async function writeStore(storePath: string, store: PlatformAuthStore): Promise<void> {
  await fs.writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`);
}

beforeEach(() => {
  seatAssetsState.current = makeSeatAssetsStore();
});

describe("active membership session binding", () => {
  it("reconstructs only the exact persisted membership and exposes authoritative fields", () => {
    const store = makeStore();
    const context = resolveStoredPlatformAuthSessionContext({
      store,
      session: store.sessions["session-a"],
    });

    expect(context).toMatchObject({
      membership: { id: "membership-a", enterpriseId: "enterprise-a" },
      enterprise: { id: "enterprise-a" },
      session: {
        membershipId: "membership-a",
        enterpriseId: "enterprise-a",
        tenantId: "enterprise-a",
      },
      sessionKind: "member",
    });
  });

  it("fails closed for invalid persisted bindings and unavailable scoped identities", () => {
    const cases = [
      {
        name: "membership owned by another user",
        mutate: (store: PlatformAuthStore) => {
          store.memberships["membership-a"].userId = "user-b";
        },
      },
      {
        name: "enterprise mismatch",
        mutate: (store: PlatformAuthStore) => {
          store.sessions["session-a"].enterpriseId = "enterprise-b";
        },
      },
      {
        name: "partial binding",
        mutate: (store: PlatformAuthStore) => {
          delete store.sessions["session-a"].enterpriseId;
        },
      },
      {
        name: "deleted membership",
        mutate: (store: PlatformAuthStore) => {
          delete store.memberships["membership-a"];
        },
      },
      {
        name: "suspended enterprise",
        mutate: (store: PlatformAuthStore) => {
          store.enterprises["enterprise-a"].status = "suspended";
        },
      },
    ] as const;

    for (const testCase of cases) {
      const store = makeStore();
      testCase.mutate(store);
      expect(
        resolveStoredPlatformAuthSessionContext({
          store,
          session: store.sessions["session-a"],
        }),
        testCase.name,
      ).toBeNull();
    }
  });

  it("allows only unique legacy membership fallback and keeps platform sessions unbound", () => {
    const uniqueStore = makeStore();
    delete uniqueStore.sessions["session-a"].membershipId;
    delete uniqueStore.sessions["session-a"].enterpriseId;
    expect(
      resolveStoredPlatformAuthSessionContext({
        store: uniqueStore,
        session: uniqueStore.sessions["session-a"],
      })?.membership?.id,
    ).toBe("membership-a");

    const ambiguousStore = makeStore();
    ambiguousStore.memberships["membership-c"] = {
      id: "membership-c",
      userId: "user-a",
      enterpriseId: "enterprise-b",
      membershipRole: "member",
      createdAt: NOW,
      updatedAt: NOW,
    };
    delete ambiguousStore.sessions["session-a"].membershipId;
    delete ambiguousStore.sessions["session-a"].enterpriseId;
    expect(
      resolveStoredPlatformAuthSessionContext({
        store: ambiguousStore,
        session: ambiguousStore.sessions["session-a"],
      }),
    ).toBeNull();

    const platformStore = makeStore();
    const platformContext = resolveStoredPlatformAuthSessionContext({
      store: platformStore,
      session: platformStore.sessions["platform-session"],
    });
    expect(platformContext).toMatchObject({
      membership: null,
      enterprise: null,
      sessionKind: "platform-super-admin",
    });
    expect(platformContext?.session.membershipId).toBeUndefined();
    expect(platformContext?.session.enterpriseId).toBeUndefined();
  });

  it("treats tenant as a constraint and auto-binds when membership is ambiguous", () => {
    const store = makeStore();
    store.memberships["membership-c"] = {
      id: "membership-c",
      userId: "user-a",
      enterpriseId: "enterprise-b",
      membershipRole: "member",
      createdAt: NOW,
      updatedAt: NOW,
    };

    // Two memberships + prior session on membership-a → prefer last session.
    expect(
      resolveMembershipSelectionForUser({
        store,
        userId: "user-a",
        intent: "employee",
      })?.id,
    ).toBe("membership-a");
    expect(
      resolveMembershipSelectionForUser({
        store,
        userId: "user-a",
        enterpriseId: "enterprise-a",
      })?.id,
    ).toBe("membership-a");
    expect(
      resolveMembershipSelectionForUser({
        store,
        userId: "user-a",
        membershipId: "membership-c",
        enterpriseId: "enterprise-a",
      }),
    ).toBeUndefined();
    expect(
      resolveSessionMembershipBinding({
        store,
        userId: "user-a",
        membershipId: "membership-a",
      }),
    ).toBeUndefined();
  });

  it("persists selected bindings, rejects forged switches, and rotates the session", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-active-membership-"));
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
      const bootstrapResponse = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/platform/bootstrap`,
          method: "POST",
          headers: { host: "127.0.0.1:18789" },
          body: {
            email: "owner@example.com",
            password: "password-123",
            displayName: "Owner",
          },
        }),
        bootstrapResponse.res,
        { trustedProxy, localDirect: true },
      );
      const platformCookie = getPrimarySetCookie(bootstrapResponse.setHeader);
      expect(platformCookie).toBeDefined();

      const store = await readStore(storePath);
      const owner = Object.values(store.users).find(
        (user) => user.normalizedEmail === "owner@example.com",
      );
      if (!owner) {
        throw new Error("bootstrap did not create the platform owner");
      }
      for (const [enterpriseId, membershipId, updatedAt] of [
        ["enterprise-a", "membership-a", NOW],
        ["enterprise-b", "membership-b", "2026-07-30T01:00:00.000Z"],
      ] as const) {
        store.enterprises[enterpriseId] = {
          id: enterpriseId,
          name: enterpriseId,
          slug: enterpriseId,
          status: "paid",
          plan: "paid",
          billingStatus: "active",
          createdSource: "self-service",
          createdAt: NOW,
          updatedAt: NOW,
          seatQuota: 5,
          seatUsed: 1,
        };
        store.memberships[membershipId] = {
          id: membershipId,
          userId: owner.id,
          enterpriseId,
          membershipRole: "enterprise-admin",
          createdAt: NOW,
          updatedAt,
        };
      }
      await writeStore(storePath, store);

      const ambiguousLoginResponse = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/login`,
          method: "POST",
          headers: { host: "127.0.0.1:18789" },
          body: {
            email: "owner@example.com",
            password: "password-123",
            expectedSessionKind: "enterprise-admin",
          },
        }),
        ambiguousLoginResponse.res,
        { trustedProxy, localDirect: true },
      );
      // Several eligible tenants require an explicit choice.
      expect(ambiguousLoginResponse.res.statusCode).toBe(409);
      expect(JSON.parse(String(ambiguousLoginResponse.end.mock.calls[0]?.[0] ?? ""))).toMatchObject(
        { code: "PLATFORM_AUTH_MEMBERSHIP_SELECTION_REQUIRED" },
      );

      const selectedLoginResponse = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/login`,
          method: "POST",
          headers: { host: "127.0.0.1:18789" },
          body: {
            email: "owner@example.com",
            password: "password-123",
            expectedSessionKind: "enterprise-admin",
            membershipId: "membership-a",
            tenantId: "enterprise-a",
          },
        }),
        selectedLoginResponse.res,
        { trustedProxy, localDirect: true },
      );
      expect(selectedLoginResponse.res.statusCode).toBe(200);
      const selectedCookie = getPrimarySetCookie(selectedLoginResponse.setHeader);
      expect(selectedCookie).toBeDefined();
      const afterLogin = await readStore(storePath);
      expect(afterLogin.sessions[sessionIdFromCookie(String(selectedCookie))]).toMatchObject({
        membershipId: "membership-a",
        enterpriseId: "enterprise-a",
      });

      const platformSessionId = sessionIdFromCookie(String(platformCookie));
      const cookieName = cookieHeader(String(platformCookie)).split("=", 1)[0] ?? "";
      const forgedSwitchResponse = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/session/switch`,
          method: "POST",
          headers: {
            host: "127.0.0.1:18789",
            cookie: `${cookieName}=${encodeURIComponent(`${platformSessionId}.forged`)}`,
          },
          body: {
            targetSessionKind: "enterprise-admin",
            membershipId: "membership-b",
            tenantId: "enterprise-b",
          },
        }),
        forgedSwitchResponse.res,
        { trustedProxy, localDirect: true },
      );
      expect(forgedSwitchResponse.res.statusCode).toBe(401);
      expect((await readStore(storePath)).sessions[platformSessionId]).toBeDefined();

      const switchResponse = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/session/switch`,
          method: "POST",
          headers: {
            host: "127.0.0.1:18789",
            cookie: cookieHeader(String(platformCookie)),
          },
          body: {
            targetSessionKind: "enterprise-admin",
            membershipId: "membership-b",
            tenantId: "enterprise-b",
          },
        }),
        switchResponse.res,
        { trustedProxy, localDirect: true },
      );
      expect(switchResponse.res.statusCode).toBe(200);
      const switchedCookie = getPrimarySetCookie(switchResponse.setHeader);
      const switchedSessionId = sessionIdFromCookie(String(switchedCookie));
      expect(switchedSessionId).not.toBe(platformSessionId);
      const afterSwitch = await readStore(storePath);
      expect(afterSwitch.sessions[platformSessionId]).toMatchObject({ domain: "platform" });
      expect(afterSwitch.sessions[switchedSessionId]).toMatchObject({
        membershipId: "membership-b",
        enterpriseId: "enterprise-b",
        domain: "enterprise",
      });

      const passwordChangeResponse = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/password/change`,
          method: "POST",
          headers: {
            host: "127.0.0.1:18789",
            cookie: cookieHeader(String(switchedCookie)),
          },
          body: {
            currentPassword: "password-123",
            newPassword: "password-456",
          },
        }),
        passwordChangeResponse.res,
        { trustedProxy, localDirect: true },
      );
      expect(passwordChangeResponse.res.statusCode).toBe(200);
      const passwordChangeCookie = getPrimarySetCookie(passwordChangeResponse.setHeader);
      const afterPasswordChange = await readStore(storePath);
      expect(
        afterPasswordChange.sessions[sessionIdFromCookie(String(passwordChangeCookie))],
      ).toMatchObject({
        membershipId: "membership-b",
        enterpriseId: "enterprise-b",
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("pins enterprise-admin and employee activation sessions to their issued memberships", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-activation-membership-"));
    try {
      const storePath = path.join(tempDir, "platform-auth.json");
      const config = makeConfig(storePath);
      const trustedProxy = {
        userHeader: "x-forwarded-user",
        platformAuth: {
          enabled: true,
          requireMfaForPlatformAdmins: false,
          store: storePath,
        },
      };
      const store = makeStore();
      const { enterprise: adminEnterprise, plainCode: adminCode } =
        createEnterpriseWithPendingAdminActivation({
          config,
          store,
          enterpriseName: "Activation Enterprise",
          adminName: "Activation Admin",
          adminEmail: "activation-admin@example.com",
          createdSource: "self-service",
        });
      await writeStore(storePath, store);

      const adminActivationResponse = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/enterprise/admin/activate`,
          method: "POST",
          headers: { host: "127.0.0.1:18789" },
          body: {
            email: "activation-admin@example.com",
            password: "password-123",
            displayName: "Activation Admin",
            code: adminCode,
          },
        }),
        adminActivationResponse.res,
        { trustedProxy, localDirect: true },
      );
      expect(adminActivationResponse.res.statusCode).toBe(201);
      const adminCookie = getPrimarySetCookie(adminActivationResponse.setHeader);
      expect(adminCookie).toBeDefined();

      const afterAdminActivation = await readStore(storePath);
      const admin = Object.values(afterAdminActivation.users).find(
        (user) => user.normalizedEmail === "activation-admin@example.com",
      );
      if (!admin) {
        throw new Error("enterprise-admin activation did not create the admin user");
      }
      const adminMembership = Object.values(afterAdminActivation.memberships).find(
        (membership) =>
          membership.userId === admin.id && membership.enterpriseId === adminEnterprise.id,
      );
      if (!adminMembership) {
        throw new Error("enterprise-admin activation did not create the admin membership");
      }
      const adminSessionId = sessionIdFromCookie(String(adminCookie));
      expect(afterAdminActivation.sessions[adminSessionId]).toMatchObject({
        domain: "enterprise",
        sessionKind: "enterprise-admin",
        membershipId: adminMembership.id,
        enterpriseId: adminEnterprise.id,
      });
      afterAdminActivation.memberships["activation-admin-secondary-membership"] = {
        id: "activation-admin-secondary-membership",
        userId: admin.id,
        enterpriseId: "enterprise-a",
        membershipRole: "member",
        createdAt: NOW,
        updatedAt: NOW,
      };
      await writeStore(storePath, afterAdminActivation);
      const afterAdminSecondMembership = await readStore(storePath);
      expect(
        resolveStoredPlatformAuthSessionContext({
          store: afterAdminSecondMembership,
          session: afterAdminSecondMembership.sessions[adminSessionId],
        }),
      ).toMatchObject({
        membership: { id: adminMembership.id },
        enterprise: { id: adminEnterprise.id },
      });

      const employeeProvisionStore = await readStore(storePath);
      seatAssetsState.current.seats["seat-activation"] = {
        seatId: "seat-activation",
        tenantId: "enterprise-a",
        title: "Activation Specialist",
        status: "vacant",
        defaultSpaceIds: [],
        defaultAgentAssetIds: [],
        createdAt: NOW,
        updatedAt: NOW,
      };
      const { plainCode: employeeCode } = await createEmployeeProvisionWithSeat({
        config,
        store: employeeProvisionStore,
        enterpriseId: "enterprise-a",
        employeeName: "Activation Employee",
        employeeEmail: "activation-employee@example.com",
        createdByUserId: "user-a",
        seatId: "seat-activation",
      });
      await writeStore(storePath, employeeProvisionStore);

      const employeeActivationResponse = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/employee/register`,
          method: "POST",
          headers: { host: "127.0.0.1:18789" },
          body: {
            email: "activation-employee@example.com",
            password: "password-123",
            displayName: "Activation Employee",
            code: employeeCode,
          },
        }),
        employeeActivationResponse.res,
        { trustedProxy, localDirect: true },
      );
      expect(employeeActivationResponse.res.statusCode).toBe(201);
      const employeeCookie = getPrimarySetCookie(employeeActivationResponse.setHeader);
      expect(employeeCookie).toBeDefined();

      const afterEmployeeActivation = await readStore(storePath);
      const employee = Object.values(afterEmployeeActivation.users).find(
        (user) => user.normalizedEmail === "activation-employee@example.com",
      );
      if (!employee) {
        throw new Error("employee activation did not create the employee user");
      }
      const employeeMembership = Object.values(afterEmployeeActivation.memberships).find(
        (membership) =>
          membership.userId === employee.id && membership.enterpriseId === "enterprise-a",
      );
      if (!employeeMembership) {
        throw new Error("employee activation did not create the employee membership");
      }
      const employeeSessionId = sessionIdFromCookie(String(employeeCookie));
      expect(afterEmployeeActivation.sessions[employeeSessionId]).toMatchObject({
        domain: "employee",
        sessionKind: "member",
        membershipId: employeeMembership.id,
        enterpriseId: "enterprise-a",
      });
      afterEmployeeActivation.memberships["activation-employee-secondary-membership"] = {
        id: "activation-employee-secondary-membership",
        userId: employee.id,
        enterpriseId: "enterprise-b",
        membershipRole: "member",
        createdAt: NOW,
        updatedAt: NOW,
      };
      await writeStore(storePath, afterEmployeeActivation);
      const afterEmployeeSecondMembership = await readStore(storePath);
      expect(
        resolveStoredPlatformAuthSessionContext({
          store: afterEmployeeSecondMembership,
          session: afterEmployeeSecondMembership.sessions[employeeSessionId],
        }),
      ).toMatchObject({
        membership: { id: employeeMembership.id },
        enterprise: { id: "enterprise-a" },
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("removes active membership, preserves other scopes, and offboards a final non-platform member", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-member-removal-"));
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
      const bootstrapResponse = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/platform/bootstrap`,
          method: "POST",
          headers: { host: "127.0.0.1:18789" },
          body: {
            email: "removal-admin@example.com",
            password: "password-123",
            displayName: "Removal Admin",
          },
        }),
        bootstrapResponse.res,
        { trustedProxy, localDirect: true },
      );
      const platformCookie = getPrimarySetCookie(bootstrapResponse.setHeader);
      expect(platformCookie).toBeDefined();

      const store = await readStore(storePath);
      const actor = Object.values(store.users).find(
        (user) => user.normalizedEmail === "removal-admin@example.com",
      );
      if (!actor) {
        throw new Error("bootstrap did not create the member-removal actor");
      }
      for (const enterpriseId of ["enterprise-a", "enterprise-b"] as const) {
        store.enterprises[enterpriseId] = {
          id: enterpriseId,
          name: enterpriseId,
          slug: enterpriseId,
          status: "paid",
          plan: "paid",
          billingStatus: "active",
          createdSource: "self-service",
          createdAt: NOW,
          updatedAt: NOW,
          seatQuota: 5,
          seatUsed: 1,
        };
      }
      store.memberships["removal-actor-membership"] = {
        id: "removal-actor-membership",
        userId: actor.id,
        enterpriseId: "enterprise-a",
        membershipRole: "enterprise-admin",
        createdAt: NOW,
        updatedAt: NOW,
      };
      store.users["removal-target"] = {
        id: "removal-target",
        email: "removal-target@example.com",
        normalizedEmail: "removal-target@example.com",
        displayName: "Removal Target",
        passwordHash: "unused",
        passwordUpdatedAt: NOW,
        loginFailedCount: 0,
        status: "active",
        source: "employee-activated",
        platformRole: "admin",
        role: "operator",
        scopes: [],
        createdAt: NOW,
        updatedAt: NOW,
      };
      // Insert enterprise B first: a first-match implementation would reject the
      // target even though the actor is removing their enterprise A membership.
      store.memberships["removal-target-membership-b"] = {
        id: "removal-target-membership-b",
        userId: "removal-target",
        enterpriseId: "enterprise-b",
        membershipRole: "member",
        createdAt: NOW,
        updatedAt: NOW,
      };
      store.memberships["removal-target-membership-a"] = {
        id: "removal-target-membership-a",
        userId: "removal-target",
        enterpriseId: "enterprise-a",
        membershipRole: "member",
        createdAt: NOW,
        updatedAt: NOW,
      };
      for (const [sessionId, membershipId, enterpriseId] of [
        ["removal-target-session-a", "removal-target-membership-a", "enterprise-a"],
        ["removal-target-session-b", "removal-target-membership-b", "enterprise-b"],
      ] as const) {
        store.sessions[sessionId] = {
          id: sessionId,
          userId: "removal-target",
          createdAt: NOW,
          updatedAt: NOW,
          sessionIssuedAt: NOW,
          expiresAt: "2099-01-01T00:00:00.000Z",
          domain: "employee",
          sessionKind: "member",
          membershipId,
          enterpriseId,
        };
      }
      // Only a session that the authoritative resolver classifies as platform
      // can survive binding-free; employee and partial records must not fall
      // back to enterprise B after enterprise A is revoked.
      store.sessions["removal-target-platform-session"] = {
        id: "removal-target-platform-session",
        userId: "removal-target",
        createdAt: NOW,
        updatedAt: NOW,
        sessionIssuedAt: NOW,
        expiresAt: "2099-01-01T00:00:00.000Z",
      };
      store.sessions["removal-target-legacy-employee-session"] = {
        id: "removal-target-legacy-employee-session",
        userId: "removal-target",
        createdAt: NOW,
        updatedAt: NOW,
        sessionIssuedAt: NOW,
        expiresAt: "2099-01-01T00:00:00.000Z",
        domain: "employee",
        sessionKind: "member",
      };
      store.sessions["removal-target-membership-only-session"] = {
        id: "removal-target-membership-only-session",
        userId: "removal-target",
        createdAt: NOW,
        updatedAt: NOW,
        sessionIssuedAt: NOW,
        expiresAt: "2099-01-01T00:00:00.000Z",
        domain: "employee",
        sessionKind: "member",
        membershipId: "removal-target-membership-b",
      };
      store.sessions["removal-target-enterprise-only-session"] = {
        id: "removal-target-enterprise-only-session",
        userId: "removal-target",
        createdAt: NOW,
        updatedAt: NOW,
        sessionIssuedAt: NOW,
        expiresAt: "2099-01-01T00:00:00.000Z",
        domain: "employee",
        sessionKind: "member",
        enterpriseId: "enterprise-b",
      };
      store.employeeProvisions["removal-target-provision-a"] = {
        id: "removal-target-provision-a",
        enterpriseId: "enterprise-a",
        seatId: "removal-target-seat-a",
        employeeName: "Removal Target",
        employeeEmail: "removal-target@example.com",
        normalizedEmployeeEmail: "removal-target@example.com",
        status: "activated",
        createdByUserId: actor.id,
        activatedUserId: "removal-target",
        activatedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      };
      await writeStore(storePath, store);

      const switchResponse = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/session/switch`,
          method: "POST",
          headers: {
            host: "127.0.0.1:18789",
            cookie: cookieHeader(String(platformCookie)),
          },
          body: {
            targetSessionKind: "enterprise-admin",
            membershipId: "removal-actor-membership",
            tenantId: "enterprise-a",
          },
        }),
        switchResponse.res,
        { trustedProxy, localDirect: true },
      );
      expect(switchResponse.res.statusCode).toBe(200);
      const actorCookie = getPrimarySetCookie(switchResponse.setHeader);
      expect(actorCookie).toBeDefined();

      const removeResponse = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/member/remove`,
          method: "POST",
          headers: {
            host: "127.0.0.1:18789",
            cookie: cookieHeader(String(actorCookie)),
          },
          body: { user: "removal-target@example.com" },
        }),
        removeResponse.res,
        { trustedProxy, localDirect: true },
      );

      expect(removeResponse.res.statusCode).toBe(200);
      const removalPayload = JSON.parse(String(removeResponse.end.mock.calls[0]?.[0])) as Record<
        string,
        unknown
      >;
      expect(removalPayload.session).toMatchObject({
        membershipId: "removal-actor-membership",
        enterpriseId: "enterprise-a",
      });
      const afterRemoval = await readStore(storePath);
      expect(afterRemoval.memberships["removal-target-membership-a"]).toBeUndefined();
      expect(afterRemoval.memberships["removal-target-membership-b"]).toBeDefined();
      expect(afterRemoval.users["removal-target"]?.status).toBe("active");
      expect(afterRemoval.sessions["removal-target-session-a"]).toBeUndefined();
      expect(afterRemoval.sessions["removal-target-session-b"]).toBeDefined();
      expect(afterRemoval.sessions["removal-target-legacy-employee-session"]).toBeUndefined();
      expect(afterRemoval.sessions["removal-target-membership-only-session"]).toBeUndefined();
      expect(afterRemoval.sessions["removal-target-enterprise-only-session"]).toBeUndefined();
      expect(afterRemoval.sessions["removal-target-platform-session"]).toBeDefined();
      expect(
        resolveStoredPlatformAuthSessionContext({
          store: afterRemoval,
          session: afterRemoval.sessions["removal-target-session-b"],
        }),
      ).toMatchObject({
        membership: { id: "removal-target-membership-b" },
        enterprise: { id: "enterprise-b" },
      });
      expect(
        resolveStoredPlatformAuthSessionContext({
          store: afterRemoval,
          session: afterRemoval.sessions["removal-target-platform-session"],
        }),
      ).toMatchObject({
        membership: null,
        enterprise: null,
        sessionKind: "platform-admin",
      });
      expect(afterRemoval.employeeProvisions["removal-target-provision-a"]?.status).toBe("revoked");
      expect(afterRemoval.enterprises["enterprise-a"]?.seatUsed).toBe(0);
      expect(afterRemoval.enterprises["enterprise-b"]?.seatUsed).toBe(1);

      // A non-platform user losing their final membership keeps the established
      // suspension/global-invalidation behavior without affecting the first target.
      afterRemoval.memberships["removal-actor-membership-b"] = {
        id: "removal-actor-membership-b",
        userId: actor.id,
        enterpriseId: "enterprise-b",
        membershipRole: "enterprise-admin",
        createdAt: NOW,
        updatedAt: NOW,
      };
      afterRemoval.users["removal-final-target"] = {
        id: "removal-final-target",
        email: "removal-final-target@example.com",
        normalizedEmail: "removal-final-target@example.com",
        displayName: "Removal Final Target",
        passwordHash: "unused",
        passwordUpdatedAt: NOW,
        loginFailedCount: 0,
        status: "active",
        source: "employee-activated",
        role: "operator",
        scopes: [],
        createdAt: NOW,
        updatedAt: NOW,
      };
      afterRemoval.memberships["removal-final-target-membership-b"] = {
        id: "removal-final-target-membership-b",
        userId: "removal-final-target",
        enterpriseId: "enterprise-b",
        membershipRole: "member",
        createdAt: NOW,
        updatedAt: NOW,
      };
      afterRemoval.sessions["removal-final-target-session-b"] = {
        id: "removal-final-target-session-b",
        userId: "removal-final-target",
        createdAt: NOW,
        updatedAt: NOW,
        sessionIssuedAt: NOW,
        expiresAt: "2099-01-01T00:00:00.000Z",
        domain: "employee",
        sessionKind: "member",
        membershipId: "removal-final-target-membership-b",
        enterpriseId: "enterprise-b",
      };
      afterRemoval.sessions["removal-final-target-legacy-session"] = {
        id: "removal-final-target-legacy-session",
        userId: "removal-final-target",
        createdAt: NOW,
        updatedAt: NOW,
        sessionIssuedAt: NOW,
        expiresAt: "2099-01-01T00:00:00.000Z",
      };
      const enterpriseB = afterRemoval.enterprises["enterprise-b"];
      if (!enterpriseB) {
        throw new Error("enterprise B was not created");
      }
      enterpriseB.seatUsed += 1;
      await writeStore(storePath, afterRemoval);

      const switchEnterpriseBResponse = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/session/switch`,
          method: "POST",
          headers: {
            host: "127.0.0.1:18789",
            cookie: cookieHeader(String(actorCookie)),
          },
          body: {
            targetSessionKind: "enterprise-admin",
            membershipId: "removal-actor-membership-b",
            tenantId: "enterprise-b",
          },
        }),
        switchEnterpriseBResponse.res,
        { trustedProxy, localDirect: true },
      );
      expect(switchEnterpriseBResponse.res.statusCode).toBe(200);
      const actorEnterpriseBCookie = getPrimarySetCookie(switchEnterpriseBResponse.setHeader);
      expect(actorEnterpriseBCookie).toBeDefined();

      const removeFinalResponse = makeMockHttpResponse();
      await handleControlUiPlatformAuthRequest(
        makeJsonRequest({
          url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}/member/remove`,
          method: "POST",
          headers: {
            host: "127.0.0.1:18789",
            cookie: cookieHeader(String(actorEnterpriseBCookie)),
          },
          body: { user: "removal-final-target@example.com" },
        }),
        removeFinalResponse.res,
        { trustedProxy, localDirect: true },
      );
      expect(removeFinalResponse.res.statusCode).toBe(200);

      const afterFinalRemoval = await readStore(storePath);
      expect(afterFinalRemoval.memberships["removal-final-target-membership-b"]).toBeUndefined();
      expect(afterFinalRemoval.users["removal-final-target"]?.status).toBe("suspended");
      expect(afterFinalRemoval.sessions["removal-final-target-session-b"]).toBeUndefined();
      expect(afterFinalRemoval.sessions["removal-final-target-legacy-session"]).toBeUndefined();
      expect(afterFinalRemoval.enterprises["enterprise-b"]?.seatUsed).toBe(1);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
