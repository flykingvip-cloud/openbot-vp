import { describe, expect, it } from "vitest";
import {
  ensureSeatForProvision,
  type EnterpriseSeatAssetsStore,
} from "./enterprise-seat-assets-store.ts";
import { deleteSeatAndMember } from "./enterprise-seat-person-deletion.ts";
import type { PlatformAuthStore, PlatformAuthUser } from "./platform-auth/store-types.ts";

const NOW = "2026-09-22T02:20:00.000Z";

function seatStore(): EnterpriseSeatAssetsStore {
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

function member(id: string, email: string): PlatformAuthUser {
  return {
    id,
    email,
    normalizedEmail: email,
    displayName: email,
    passwordHash: "x",
    passwordUpdatedAt: NOW,
    loginFailedCount: 0,
    status: "active",
    source: "employee-activated",
    role: "operator",
    scopes: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function authStore(user: PlatformAuthUser): PlatformAuthStore {
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
      "001": {
        id: "001",
        name: "企业001",
        slug: "001",
        status: "paid",
        plan: "team",
        createdSource: "platform-created",
        billingStatus: "active",
        createdAt: NOW,
        updatedAt: NOW,
        seatQuota: 10,
        seatUsed: 1,
      },
    },
    users: {
      [user.id]: user,
      "admin-1": member("admin-1", "admin@example.com"),
    },
    sessions: {
      "session-member": {
        id: "session-member",
        userId: user.id,
        createdAt: NOW,
        updatedAt: NOW,
        sessionIssuedAt: NOW,
        expiresAt: "2026-10-01T00:00:00.000Z",
        membershipId: "mem-1",
        enterpriseId: "001",
      },
    },
    memberships: {
      "mem-1": {
        id: "mem-1",
        userId: user.id,
        enterpriseId: "001",
        membershipRole: "member",
        createdAt: NOW,
        updatedAt: NOW,
      },
      "mem-admin": {
        id: "mem-admin",
        userId: "admin-1",
        enterpriseId: "001",
        membershipRole: "enterprise-admin",
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
    adminProvisions: {},
    employeeProvisions: {
      "prov-1": {
        id: "prov-1",
        enterpriseId: "001",
        seatId: "pending",
        employeeName: user.displayName,
        employeeEmail: user.email,
        normalizedEmployeeEmail: user.normalizedEmail,
        status: "activated",
        createdByUserId: "admin-1",
        activatedUserId: user.id,
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
    activationCodes: {},
    trialApplications: {},
    leadNotifications: {},
  };
}

describe("deleteSeatAndMember", () => {
  it("offboards the occupant and deletes the seat without opening a handover", () => {
    const seats = seatStore();
    const seat = ensureSeatForProvision({
      store: seats,
      tenantId: "001",
      seatTitle: "体验官-洪彬",
      teamLabel: "体验组",
      nowIso: NOW,
    });
    seat.status = "occupied";
    seat.currentEmployeeId = "user-1";
    seats.bindings["bind-1"] = {
      bindingId: "bind-1",
      seatId: seat.seatId,
      tenantId: "001",
      employeeId: "user-1",
      bindingStatus: "active",
      effectiveAt: NOW,
    };
    const auth = authStore(member("user-1", "shb5388@163.com"));
    auth.employeeProvisions["prov-1"].seatId = seat.seatId;

    const result = deleteSeatAndMember({
      authStore: auth,
      seatStore: seats,
      tenantId: "001",
      seatId: seat.seatId,
      actorUserId: "admin-1",
      nowIso: NOW,
    });

    expect(result.employeeId).toBe("user-1");
    expect(seats.seats[seat.seatId]).toBeUndefined();
    expect(seats.bindings["bind-1"]?.bindingStatus).toBe("revoked");
    expect(Object.values(seats.handovers)).toHaveLength(0);
    expect(auth.memberships["mem-1"]).toBeUndefined();
    expect(auth.users["user-1"]?.status).toBe("suspended");
    expect(auth.sessions["session-member"]).toBeUndefined();
    expect(auth.employeeProvisions["prov-1"]?.status).toBe("revoked");
    expect(auth.employeeProvisions["prov-1"]?.revokedReason).toBe("member_offboarded");
    expect(auth.enterprises["001"]?.seatUsed).toBe(0);
    expect(auth.users["admin-1"]?.status).toBe("active");
  });

  it("deletes a handover-pending seat and cancels the open handover", () => {
    const seats = seatStore();
    const seat = ensureSeatForProvision({
      store: seats,
      tenantId: "001",
      seatTitle: "体验官-国宏",
      nowIso: NOW,
    });
    seat.status = "handover_pending";
    seat.currentEmployeeId = undefined;
    seats.handovers["case-1"] = {
      handoverCaseId: "case-1",
      tenantId: "001",
      seatId: seat.seatId,
      outgoingEmployeeId: "user-1",
      status: "draft",
      exceptionFlags: [],
      createdAt: NOW,
      updatedAt: NOW,
    };
    const auth = authStore(member("user-1", "2894357278@qq.com"));

    deleteSeatAndMember({
      authStore: auth,
      seatStore: seats,
      tenantId: "001",
      seatId: seat.seatId,
      actorUserId: "admin-1",
      nowIso: NOW,
    });

    expect(seats.seats[seat.seatId]).toBeUndefined();
    expect(seats.handovers["case-1"]?.status).toBe("completed");
    expect(seats.handovers["case-1"]?.reviewSummary).toContain("人岗同删");
    expect(auth.users["user-1"]?.status).toBe("suspended");
  });

  it("refuses when the member still holds another seat", () => {
    const seats = seatStore();
    const seat = ensureSeatForProvision({
      store: seats,
      tenantId: "001",
      seatTitle: "岗位甲",
      nowIso: NOW,
    });
    const other = ensureSeatForProvision({
      store: seats,
      tenantId: "001",
      seatTitle: "岗位乙",
      nowIso: NOW,
    });
    seat.status = "occupied";
    seat.currentEmployeeId = "user-1";
    other.status = "occupied";
    other.currentEmployeeId = "user-1";
    const auth = authStore(member("user-1", "person@example.com"));

    expect(() =>
      deleteSeatAndMember({
        authStore: auth,
        seatStore: seats,
        tenantId: "001",
        seatId: seat.seatId,
        actorUserId: "admin-1",
        nowIso: NOW,
      }),
    ).toThrow(/其他岗位/);
    expect(seats.seats[seat.seatId]).toBeDefined();
    expect(auth.memberships["mem-1"]).toBeDefined();
  });

  it("refuses an enterprise admin occupant and a vacant seat", () => {
    const seats = seatStore();
    const occupied = ensureSeatForProvision({
      store: seats,
      tenantId: "001",
      seatTitle: "管理员岗",
      nowIso: NOW,
    });
    occupied.status = "occupied";
    occupied.currentEmployeeId = "admin-1";
    const vacant = ensureSeatForProvision({
      store: seats,
      tenantId: "001",
      seatTitle: "空岗",
      nowIso: NOW,
    });
    const auth = authStore(member("user-1", "person@example.com"));

    expect(() =>
      deleteSeatAndMember({
        authStore: auth,
        seatStore: seats,
        tenantId: "001",
        seatId: occupied.seatId,
        actorUserId: "user-1",
        nowIso: NOW,
      }),
    ).toThrow(/企业管理员/);
    expect(() =>
      deleteSeatAndMember({
        authStore: auth,
        seatStore: seats,
        tenantId: "001",
        seatId: vacant.seatId,
        actorUserId: "admin-1",
        nowIso: NOW,
      }),
    ).toThrow(/删除岗位/);
  });
});
