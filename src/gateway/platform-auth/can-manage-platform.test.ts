import { describe, expect, it } from "vitest";
import type { EnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { canManagePlatform } from "./auth-helpers.js";
import { buildPlatformAuthState } from "./session-context.js";
import type {
  PlatformAuthSessionContext,
  PlatformAuthStore,
  PlatformAuthUser,
} from "./store-types.js";

const NOW = "2026-08-06T00:00:00.000Z";

function user(overrides: Partial<PlatformAuthUser> = {}): PlatformAuthUser {
  return {
    id: "user-admin",
    email: "ops@example.com",
    normalizedEmail: "ops@example.com",
    displayName: "Ops Admin",
    passwordHash: "unused",
    passwordUpdatedAt: NOW,
    loginFailedCount: 0,
    status: "active",
    source: "platform-created",
    role: "operator",
    scopes: ["operator.admin", "operator.approvals", "operator.pairing"],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("canManagePlatform", () => {
  it("grants platformRole=admin even when scopes omit operator.admin", () => {
    expect(canManagePlatform(user({ platformRole: "admin", scopes: [] }))).toBe(true);
  });

  it("grants platformRole=super-admin", () => {
    expect(canManagePlatform(user({ platformRole: "super-admin", scopes: [] }))).toBe(true);
  });

  it("grants legacy operator.admin scope without platformRole", () => {
    expect(canManagePlatform(user({ scopes: ["operator.admin"] }))).toBe(true);
  });

  it("does not grant on the bare string admin scope", () => {
    expect(canManagePlatform(user({ scopes: ["admin"] }))).toBe(false);
  });
});

describe("buildPlatformAuthState canManagePlatform", () => {
  const config = {
    enabled: true,
    storePath: "/tmp/openbot-platform-auth-test.json",
    sessionTtlHours: 24,
    activationTtlHours: 72,
    passwordResetTtlMinutes: 30,
    cookieName: "openbot_platform_session",
    requireMfaForPlatformAdmins: false,
  };
  const seatStore = { version: 1, seats: {} } as unknown as EnterpriseSeatAssetsStore;

  async function stateFor(platformUser: PlatformAuthUser) {
    const store = {
      version: 1,
      users: { [platformUser.id]: platformUser },
      enterprises: {},
      memberships: {},
      sessions: {},
      activationCodes: {},
      passwordResets: {},
      invites: {},
      adminProvisions: {},
      policy: {
        defaultTrialDays: 14,
        allowedTrialDays: [7, 14, 30],
        defaultTrialSeatCount: 5,
        trialSeatOptions: [5, 10, 20],
        allowCustomTrialSeatCount: true,
        trialExpiryPolicy: "read-only",
      },
      trialApplications: {},
      auditLog: [],
    } as unknown as PlatformAuthStore;
    const context = {
      user: platformUser,
      session: {
        provider: "trusted-proxy",
        user: platformUser.email,
        role: "operator",
        scopes: [...platformUser.scopes],
      },
      sessionKind:
        platformUser.platformRole === "super-admin" ? "platform-super-admin" : "platform-admin",
      domain: "platform",
    } as unknown as PlatformAuthSessionContext;
    return buildPlatformAuthState({
      config,
      store,
      seatStore,
      context,
      skipSubscriptionContracts: true,
    });
  }

  it("sets canManagePlatform for platformRole=admin with operator.admin scopes", async () => {
    const state = await stateFor(user({ platformRole: "admin" }));
    expect(state.canManagePlatform).toBe(true);
    expect(state.sessionKind).toBe("platform-admin");
  });

  it("sets canManagePlatform for platformRole=admin with empty scopes", async () => {
    // Regression: session-context previously required scopes.includes("admin"),
    // which never matched real scopes and left platform-admin UI fully read-only.
    const state = await stateFor(user({ platformRole: "admin", scopes: [] }));
    expect(state.canManagePlatform).toBe(true);
  });

  it("sets canManagePlatform for super-admin", async () => {
    const state = await stateFor(user({ platformRole: "super-admin", scopes: [] }));
    expect(state.canManagePlatform).toBe(true);
    expect(state.canManagePlatformAdmins).toBe(true);
  });
});
