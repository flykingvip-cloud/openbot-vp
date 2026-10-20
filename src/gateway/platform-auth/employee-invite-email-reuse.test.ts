import { describe, expect, it } from "vitest";
import { hashPassword } from "./auth-helpers.js";
import {
  findUserEmployeeMembershipInEnterprise,
  findUserMembershipInEnterprise,
  resolveEmployeeInviteEmailAvailability,
} from "./employee-invite-email.js";
import type { PlatformAuthStore } from "./store-types.js";

function emptyStore(): PlatformAuthStore {
  return {
    users: {},
    memberships: {},
    enterprises: {},
    sessions: {},
    employeeProvisions: {},
    adminProvisions: {},
    activationCodes: {},
    leadNotifications: {},
    trialApplications: {},
  } as PlatformAuthStore;
}

describe("resolveEmployeeInviteEmailAvailability", () => {
  it("allows an unused email", () => {
    const store = emptyStore();
    expect(
      resolveEmployeeInviteEmailAvailability({
        store,
        email: "new@example.com",
        enterpriseId: "001",
      }),
    ).toEqual({ status: "available" });
  });

  it("allows an email that already belongs to another enterprise", () => {
    const store = emptyStore();
    store.users["u1"] = {
      id: "u1",
      email: "hedon25@126.com",
      normalizedEmail: "hedon25@126.com",
      displayName: "Daniel",
      passwordHash: hashPassword("password-123"),
      passwordUpdatedAt: "2026-07-15T00:00:00.000Z",
      status: "active",
      source: "self-created",
      role: "operator",
      scopes: [],
      loginFailedCount: 0,
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
    };
    store.memberships["m1"] = {
      id: "m1",
      userId: "u1",
      enterpriseId: "workspace-other",
      membershipRole: "enterprise-admin",
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
    };
    const result = resolveEmployeeInviteEmailAvailability({
      store,
      email: "hedon25@126.com",
      enterpriseId: "001",
    });
    expect(result.status).toBe("available");
    expect(result.status === "available" ? result.existingUser?.id : undefined).toBe("u1");
  });

  it("blocks an email that is already a member of this enterprise", () => {
    const store = emptyStore();
    store.users["u1"] = {
      id: "u1",
      email: "member@example.com",
      normalizedEmail: "member@example.com",
      displayName: "Member",
      passwordHash: hashPassword("password-123"),
      passwordUpdatedAt: "2026-07-15T00:00:00.000Z",
      status: "active",
      source: "employee-activated",
      role: "operator",
      scopes: [],
      loginFailedCount: 0,
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
    };
    store.memberships["m1"] = {
      id: "m1",
      userId: "u1",
      enterpriseId: "001",
      membershipRole: "member",
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
    };
    expect(
      resolveEmployeeInviteEmailAvailability({
        store,
        email: "member@example.com",
        enterpriseId: "001",
      }),
    ).toMatchObject({ status: "already-member", user: { id: "u1" } });
  });

  it("allows inviting an enterprise-admin of this tenant onto an employee position", () => {
    const store = emptyStore();
    store.users["u-admin"] = {
      id: "u-admin",
      email: "ceo@example.com",
      normalizedEmail: "ceo@example.com",
      displayName: "CEO",
      passwordHash: hashPassword("password-123"),
      passwordUpdatedAt: "2026-07-15T00:00:00.000Z",
      status: "active",
      source: "self-created",
      role: "operator",
      scopes: [],
      loginFailedCount: 0,
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
    };
    store.memberships["m-admin"] = {
      id: "m-admin",
      userId: "u-admin",
      enterpriseId: "001",
      membershipRole: "enterprise-admin",
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
    };
    expect(
      findUserMembershipInEnterprise({
        store,
        userId: "u-admin",
        enterpriseId: "001",
      })?.membershipRole,
    ).toBe("enterprise-admin");
    expect(
      findUserEmployeeMembershipInEnterprise({
        store,
        userId: "u-admin",
        enterpriseId: "001",
      }),
    ).toBeUndefined();
    const result = resolveEmployeeInviteEmailAvailability({
      store,
      email: "ceo@example.com",
      enterpriseId: "001",
    });
    expect(result.status).toBe("available");
    expect(result.status === "available" ? result.existingUser?.id : undefined).toBe("u-admin");
  });

  it("still blocks an enterprise-admin who already holds an employee seat here", () => {
    const store = emptyStore();
    store.users["u1"] = {
      id: "u1",
      email: "dual@example.com",
      normalizedEmail: "dual@example.com",
      displayName: "Dual",
      passwordHash: hashPassword("password-123"),
      passwordUpdatedAt: "2026-07-15T00:00:00.000Z",
      status: "active",
      source: "self-created",
      role: "operator",
      scopes: [],
      loginFailedCount: 0,
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
    };
    store.memberships["m-admin"] = {
      id: "m-admin",
      userId: "u1",
      enterpriseId: "001",
      membershipRole: "enterprise-admin",
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
    };
    store.memberships["m-member"] = {
      id: "m-member",
      userId: "u1",
      enterpriseId: "001",
      membershipRole: "member",
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
    };
    expect(
      resolveEmployeeInviteEmailAvailability({
        store,
        email: "dual@example.com",
        enterpriseId: "001",
      }),
    ).toMatchObject({ status: "already-member", user: { id: "u1" } });
  });

  it("recycles a suspended orphan so a deleted position can reuse the email", () => {
    const store = emptyStore();
    store.users["u-orphan"] = {
      id: "u-orphan",
      email: "gone@example.com",
      normalizedEmail: "gone@example.com",
      displayName: "Gone",
      passwordHash: hashPassword("password-123"),
      passwordUpdatedAt: "2026-07-15T00:00:00.000Z",
      status: "suspended",
      source: "employee-activated",
      role: "operator",
      scopes: [],
      loginFailedCount: 0,
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
    };
    const result = resolveEmployeeInviteEmailAvailability({
      store,
      email: "gone@example.com",
      enterpriseId: "001",
    });
    expect(result).toEqual({ status: "available" });
    expect(store.users["u-orphan"]).toBeUndefined();
  });
});
