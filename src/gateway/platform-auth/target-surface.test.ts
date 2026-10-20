import { describe, expect, it } from "vitest";
import type { PlatformAuthStore } from "./store-types.js";
import {
  assertTargetMatchesRequest,
  buildPasswordResetLink,
  employeePositionLoginBlock,
  evaluateEmployeePosition,
  loginUrlForSurface,
  passwordResetReturn,
  resolveLoginTarget,
  resolveRequestSessionSurface,
  selectSurfaceMembership,
  selectSurfaceSessionCookie,
  surfaceCookieName,
} from "./target-surface.js";

const NOW = "2026-10-17T00:00:00.000Z";

function storeWith(
  roles: Array<"member" | "enterprise-admin">,
  tenants = ["ent-a"],
): PlatformAuthStore {
  const memberships: PlatformAuthStore["memberships"] = {};
  const enterprises: PlatformAuthStore["enterprises"] = {};
  for (const tenant of tenants) {
    enterprises[tenant] = {
      id: tenant,
      name: tenant,
      slug: tenant,
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
  let index = 0;
  for (const tenant of tenants) {
    for (const role of roles) {
      index += 1;
      const id = `mem-${tenant}-${role}-${index}`;
      memberships[id] = {
        id,
        userId: "user-1",
        enterpriseId: tenant,
        membershipRole: role,
        createdAt: NOW,
        updatedAt: NOW,
      };
    }
  }
  return {
    users: {},
    enterprises,
    memberships,
    sessions: {},
  } as unknown as PlatformAuthStore;
}

describe("login target resolver", () => {
  it.each([
    {
      name: "employee sessionDomain",
      body: { sessionDomain: "employee" },
      surface: "employee" as const,
      explicit: true,
    },
    {
      name: "enterprise expectedSessionKind",
      body: { expectedSessionKind: "enterprise-admin" },
      surface: "enterprise" as const,
      explicit: true,
    },
    {
      name: "platform expectedPlatformRole",
      body: { expectedPlatformRole: "admin" },
      surface: "platform" as const,
      explicit: true,
      role: "admin" as const,
    },
    {
      name: "agreeing employee signals",
      body: { sessionDomain: "employee", loginIntent: "employee", expectedSessionKind: "member" },
      surface: "employee" as const,
      explicit: true,
    },
    {
      name: "admin invite is enterprise",
      body: { adminInviteCode: "invite-1" },
      surface: "enterprise" as const,
      explicit: true,
    },
    {
      name: "omitted target stays employee and is not platform",
      body: {},
      surface: "employee" as const,
      explicit: false,
    },
  ])("$name", (row) => {
    const result = resolveLoginTarget(row.body);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.target.surface).toBe(row.surface);
    expect(result.target.explicit).toBe(row.explicit);
    if ("role" in row) {
      expect(result.target.expectedPlatformRole).toBe(row.role);
    }
  });

  it.each([
    {
      name: "employee domain fights platform role",
      body: { sessionDomain: "employee", expectedPlatformRole: "admin" },
    },
    {
      name: "enterprise kind fights platform domain",
      body: { sessionDomain: "platform", expectedSessionKind: "enterprise-admin" },
    },
    {
      name: "invite fights employee domain",
      body: { sessionDomain: "employee", adminInviteCode: "invite-1" },
    },
  ])("refuses conflicting $name", (row) => {
    const result = resolveLoginTarget(row.body);
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      code: "PLATFORM_AUTH_TARGET_CONFLICT",
    });
  });
});

describe("request surface agreement", () => {
  it.each([
    ["https://openbot.love", "openbot.love", "employee"],
    ["https://www.openbot.love", "www.openbot.love", "employee"],
    ["https://biz.openbot.love", "biz.openbot.love", "enterprise"],
    ["https://admin.openbot.love", "admin.openbot.love", "platform"],
    ["https://gw.openbot.love", "gw.openbot.love", "employee"],
  ] as const)("host %s is %s", (origin, host, surface) => {
    expect(resolveRequestSessionSurface({ origin, host })).toEqual({
      kind: "authoritative",
      surface,
    });
  });

  it("keeps a local API call with no page path ambiguous", () => {
    expect(resolveRequestSessionSurface({ host: "127.0.0.1:18789" })).toEqual({
      kind: "ambiguous",
      localDefault: "employee",
    });
  });

  it("uses the local path as the surface", () => {
    expect(
      resolveRequestSessionSurface({
        host: "localhost:18789",
        pathname: "/enterprise/001/settings",
      }).kind,
    ).toBe("authoritative");
    expect(
      assertTargetMatchesRequest(
        { host: "localhost:18789", referer: "http://127.0.0.1:18789/platform/login" },
        "employee",
      ).ok,
    ).toBe(false);
  });

  it.each([
    ["https://openbot.love", "platform"],
    ["https://www.openbot.love", "platform"],
    ["https://biz.openbot.love", "employee"],
    ["https://biz.openbot.love", "platform"],
    ["https://admin.openbot.love", "enterprise"],
    ["https://gw.openbot.love", "platform"],
  ] as const)("refuses %s target on %s", (origin, surface) => {
    expect(assertTargetMatchesRequest({ origin }, surface)).toMatchObject({
      ok: false,
      code: "PLATFORM_AUTH_SURFACE_MISMATCH",
    });
  });

  it("names the employee portal when biz receives an employee login", () => {
    expect(
      assertTargetMatchesRequest({ origin: "https://biz.openbot.love" }, "employee"),
    ).toMatchObject({
      ok: false,
      status: 403,
      code: "PLATFORM_AUTH_SURFACE_MISMATCH",
      error: "This login entry does not match the requested surface.",
      requestSurface: "enterprise",
      targetSurface: "employee",
    });
    expect(loginUrlForSurface("employee", {})).toBe("https://www.openbot.love/");
    expect(loginUrlForSurface("enterprise", {})).toBe("https://biz.openbot.love/enterprise/login");
    expect(loginUrlForSurface("platform", {})).toBe("https://admin.openbot.love/platform/login");
  });
});

describe("eligibility matrix", () => {
  it.each([
    {
      name: "employee member",
      roles: ["member"] as Array<"member" | "enterprise-admin">,
      surface: "employee" as const,
      ok: true,
      role: "member",
    },
    {
      name: "employee refuses admin-only CEO",
      roles: ["enterprise-admin"] as Array<"member" | "enterprise-admin">,
      surface: "employee" as const,
      ok: false,
      code: "PLATFORM_AUTH_SURFACE_INELIGIBLE",
    },
    {
      name: "employee dual-role uses member",
      roles: ["enterprise-admin", "member"] as Array<"member" | "enterprise-admin">,
      surface: "employee" as const,
      ok: true,
      role: "member",
    },
    {
      name: "enterprise admin",
      roles: ["enterprise-admin"] as Array<"member" | "enterprise-admin">,
      surface: "enterprise" as const,
      ok: true,
      role: "enterprise-admin",
    },
    {
      name: "enterprise refuses member marked as admin",
      roles: ["member"] as Array<"member" | "enterprise-admin">,
      surface: "enterprise" as const,
      ok: false,
      code: "PLATFORM_AUTH_SURFACE_INELIGIBLE",
    },
    {
      name: "no membership",
      roles: [] as Array<"member" | "enterprise-admin">,
      surface: "employee" as const,
      ok: false,
      code: "PLATFORM_AUTH_NO_ENTERPRISE_MEMBERSHIP",
    },
  ])("$name", (row) => {
    const result = selectSurfaceMembership({
      store: storeWith(row.roles),
      userId: "user-1",
      surface: row.surface,
    });
    expect(result.ok).toBe(row.ok);
    if (result.ok) {
      expect(result.membership.membershipRole).toBe(row.role);
    } else if ("code" in row) {
      expect(result.code).toBe(row.code);
    }
  });

  it("does not silently pick among several employee tenants", () => {
    const result = selectSurfaceMembership({
      store: storeWith(["member"], ["ent-a", "ent-b"]),
      userId: "user-1",
      surface: "employee",
    });
    expect(result).toMatchObject({
      ok: false,
      code: "PLATFORM_AUTH_MEMBERSHIP_SELECTION_REQUIRED",
    });
    if (!result.ok) {
      expect(result.membershipChoices?.map((choice) => choice.enterpriseId).toSorted()).toEqual([
        "ent-a",
        "ent-b",
      ]);
    }
  });

  it("accepts an explicit tenant choice", () => {
    const store = storeWith(["member"], ["ent-a", "ent-b"]);
    const membership = Object.values(store.memberships).find(
      (entry) => entry.enterpriseId === "ent-a",
    );
    const result = selectSurfaceMembership({
      store,
      userId: "user-1",
      surface: "employee",
      membershipId: membership?.id,
      enterpriseId: "ent-a",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.membership.enterpriseId).toBe("ent-a");
    }
  });
});

describe("employee position gate", () => {
  it.each([
    { tenantSeatCount: 0, hasCurrentSeat: false, gate: "ledger-absent" as const },
    { tenantSeatCount: 2, hasCurrentSeat: true, gate: "ok" as const },
    { tenantSeatCount: 2, hasCurrentSeat: false, gate: "missing" as const },
  ])("seats $tenantSeatCount bound $hasCurrentSeat → $gate", (row) => {
    expect(
      evaluateEmployeePosition({
        tenantSeatCount: row.tenantSeatCount,
        hasCurrentSeat: row.hasCurrentSeat,
      }),
    ).toBe(row.gate);
  });

  it("refuses an empty ledger instead of treating it as a free login", () => {
    expect(employeePositionLoginBlock("ok")).toBeNull();
    expect(employeePositionLoginBlock("missing")?.code).toBe("PLATFORM_AUTH_POSITION_REQUIRED");
    expect(employeePositionLoginBlock("ledger-absent")?.code).toBe(
      "PLATFORM_AUTH_POSITION_UNVERIFIED",
    );
  });
});

describe("surface cookies do not clobber each other", () => {
  it("selects the cookie whose stored domain matches the host", () => {
    const baseName = "openbot_platform_session";
    const selected = selectSurfaceSessionCookie({
      baseName,
      resolution: { kind: "authoritative", surface: "employee" },
      candidates: [
        { cookieName: surfaceCookieName(baseName, "platform"), domain: "platform", id: "p" },
        { cookieName: surfaceCookieName(baseName, "enterprise"), domain: "enterprise", id: "b" },
        { cookieName: surfaceCookieName(baseName, "employee"), domain: "employee", id: "e" },
      ],
    });
    expect(selected).toMatchObject({ id: "e" });
  });

  it("ignores a legacy platform cookie on the employee host", () => {
    const selected = selectSurfaceSessionCookie({
      baseName: "openbot_platform_session",
      resolution: { kind: "authoritative", surface: "employee" },
      candidates: [{ cookieName: "openbot_platform_session", domain: "platform", id: "legacy" }],
    });
    expect(selected).toBeNull();
  });

  it("keeps one local cookie when the page path is absent", () => {
    const selected = selectSurfaceSessionCookie({
      baseName: "openbot_platform_session",
      resolution: { kind: "ambiguous", localDefault: "employee" },
      candidates: [
        {
          cookieName: surfaceCookieName("openbot_platform_session", "enterprise"),
          domain: "enterprise",
          id: "only",
        },
      ],
    });
    expect(selected).toMatchObject({ id: "only" });
  });

  it("uses the employee cookie when a local request carries every surface", () => {
    const baseName = "openbot_platform_session";
    const selected = selectSurfaceSessionCookie({
      baseName,
      resolution: { kind: "ambiguous", localDefault: "employee" },
      candidates: [
        { cookieName: surfaceCookieName(baseName, "platform"), domain: "platform", id: "p" },
        { cookieName: surfaceCookieName(baseName, "employee"), domain: "employee", id: "e" },
      ],
    });
    expect(selected).toMatchObject({ id: "e" });
  });
});

describe("password reset return", () => {
  it("does not follow a gw or platform public base away from www", () => {
    const fromWww = buildPasswordResetLink({
      hint: { origin: "https://www.openbot.love", host: "www.openbot.love" },
      code: "RESET-1",
      env: { OPENBOT_PUBLIC_APP_BASE_URL: "https://gw.openbot.love" },
    });
    expect(fromWww.href.startsWith("https://www.openbot.love/?authMode=password-reset")).toBe(true);
    expect(fromWww.href).toContain("surface=employee");
    expect(fromWww.href).not.toContain("/auth?");
    expect(fromWww.href).not.toContain("gw.openbot.love");
    expect(fromWww.loginPath).toBe("/");

    const fromGw = buildPasswordResetLink({
      hint: { origin: "https://gw.openbot.love", host: "gw.openbot.love" },
      code: "RESET-2",
      env: { OPENBOT_PUBLIC_APP_BASE_URL: "https://admin.openbot.love" },
    });
    expect(fromGw.href.startsWith("https://www.openbot.love/?authMode=password-reset")).toBe(true);
    expect(fromGw.surface).toBe("employee");
    expect(fromGw.loginPath).toBe("/");
  });

  it("keeps a local reset on the local origin and names the return path", () => {
    const link = buildPasswordResetLink({
      hint: { host: "127.0.0.1:18789" },
      code: "RESET-3",
      env: {},
      proto: "http:",
    });
    expect(link.href.startsWith("http://127.0.0.1:18789/?authMode=password-reset")).toBe(true);
    expect(link.href).not.toContain("http://evil.example");
    expect(passwordResetReturn({ hint: { origin: "https://biz.openbot.love" } })).toEqual({
      returnSurface: "enterprise",
      loginPath: "/enterprise/login",
    });
  });

  it("still honors a configured public base for an ambiguous local caller", () => {
    const link = buildPasswordResetLink({
      hint: { host: "127.0.0.1:18789" },
      code: "RESET-4",
      env: { OPENBOT_PUBLIC_APP_BASE_URL: "https://www.openbot.love" },
    });
    expect(link.href).toContain("https://www.openbot.love/?authMode=password-reset");
    expect(link.href).not.toContain("/auth?");
  });

  it("lands enterprise and platform reset mail on that surface login", () => {
    const enterprise = buildPasswordResetLink({
      hint: { origin: "https://biz.openbot.love", host: "biz.openbot.love" },
      code: "RESET-BIZ",
      env: {},
    });
    expect(enterprise.href).toContain(
      "https://biz.openbot.love/enterprise/login?authMode=password-reset",
    );
    expect(enterprise.href).toContain("code=RESET-BIZ");
    expect(enterprise.href).toContain("surface=enterprise");
    expect(enterprise.loginPath).toBe("/enterprise/login");

    const platform = buildPasswordResetLink({
      hint: { origin: "https://admin.openbot.love", host: "admin.openbot.love" },
      code: "RESET-ADMIN",
      env: {},
    });
    expect(platform.href).toContain(
      "https://admin.openbot.love/platform/login?authMode=password-reset",
    );
    expect(platform.href).toContain("surface=platform");
    expect(platform.loginPath).toBe("/platform/login");
  });
});
