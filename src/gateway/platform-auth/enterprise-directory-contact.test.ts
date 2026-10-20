import { describe, expect, it } from "vitest";
import { resolveEnterpriseDirectoryContact } from "./enterprise-customer-attributes.js";
import type { PlatformAuthStore } from "./store-types.js";
import { createDefaultPolicy } from "./trial-policy.js";

function emptyStore(): PlatformAuthStore {
  const nowIso = "2026-08-01T00:00:00.000Z";
  return {
    version: 5,
    secret: "test-secret",
    policy: createDefaultPolicy(nowIso),
    enterprises: {
      "acme-1": {
        id: "acme-1",
        name: "Acme",
        slug: "acme",
        status: "trial",
        plan: "trial",
        createdSource: "self-service",
        billingStatus: "trialing",
        createdAt: nowIso,
        updatedAt: nowIso,
        seatQuota: 5,
        seatUsed: 0,
      },
    },
    users: {},
    sessions: {},
    memberships: {},
    adminProvisions: {},
    employeeProvisions: {},
    activationCodes: {},
    trialApplications: {},
    leadNotifications: {},
  };
}

describe("resolveEnterpriseDirectoryContact", () => {
  it("returns pending admin provision contact", () => {
    const store = emptyStore();
    store.adminProvisions["p1"] = {
      id: "p1",
      enterpriseId: "acme-1",
      adminName: "王经理",
      adminEmail: "admin@acme.test",
      normalizedAdminEmail: "admin@acme.test",
      status: "pending_activation",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
    };
    expect(resolveEnterpriseDirectoryContact(store, "acme-1")).toEqual({
      contactName: "王经理",
      contactEmail: "admin@acme.test",
      source: "admin-provision",
      status: "pending_activation",
      updatedAt: "2026-08-02T00:00:00.000Z",
    });
  });

  it("prefers activated enterprise-admin membership over pending provision", () => {
    const store = emptyStore();
    store.users["u1"] = {
      id: "u1",
      email: "boss@acme.test",
      normalizedEmail: "boss@acme.test",
      displayName: "Boss",
      passwordHash: "x",
      passwordUpdatedAt: "2026-08-01T00:00:00.000Z",
      loginFailedCount: 0,
      status: "active",
      source: "self-created",
      role: "operator",
      scopes: [],
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-03T00:00:00.000Z",
    };
    store.memberships["m1"] = {
      id: "m1",
      userId: "u1",
      enterpriseId: "acme-1",
      membershipRole: "enterprise-admin",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    };
    store.adminProvisions["p1"] = {
      id: "p1",
      enterpriseId: "acme-1",
      adminName: "Old",
      adminEmail: "old@acme.test",
      normalizedAdminEmail: "old@acme.test",
      status: "pending_activation",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    };
    expect(resolveEnterpriseDirectoryContact(store, "acme-1")).toMatchObject({
      contactName: "Boss",
      contactEmail: "boss@acme.test",
      status: "activated",
    });
  });

  it("falls back to linked trial application contact", () => {
    const store = emptyStore();
    store.trialApplications["t1"] = {
      id: "t1",
      companyName: "Acme",
      contactName: "申请联系人",
      workEmail: "lead@acme.test",
      normalizedWorkEmail: "lead@acme.test",
      expectedUsers: 10,
      useCase: "ops",
      needsDemo: false,
      status: "converted",
      mode: "auto",
      highIntentLead: false,
      reviewReasons: [],
      enterpriseId: "acme-1",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T12:00:00.000Z",
    };
    expect(resolveEnterpriseDirectoryContact(store, "acme-1")).toEqual({
      contactName: "申请联系人",
      contactEmail: "lead@acme.test",
      source: "trial-application",
      status: "pending_activation",
      updatedAt: "2026-08-01T12:00:00.000Z",
    });
  });
});
