// @vitest-environment node
// Feature: shared-agent-identity-access-control-plane

import { describe, expect, it } from "vitest";
import {
  findMembershipByIdForUser,
  findUniqueMembershipByUserId,
  listEligibleMembershipsForUser,
  listMembershipsByUserId,
  resolvePreferredMembershipForUser,
} from "./memberships.js";
import type { PlatformAuthStore } from "./store-types.js";

const NOW = "2026-07-30T00:00:00.000Z";
const LATER = "2026-07-30T02:00:00.000Z";

function storeWithMemberships(): PlatformAuthStore {
  return {
    enterprises: {
      "enterprise-a": {
        id: "enterprise-a",
        name: "A",
        slug: "a",
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
        name: "B",
        slug: "b",
        status: "paid",
        plan: "paid",
        billingStatus: "active",
        createdSource: "self-service",
        createdAt: NOW,
        updatedAt: NOW,
        seatQuota: 5,
        seatUsed: 1,
      },
      "enterprise-c": {
        id: "enterprise-c",
        name: "C",
        slug: "c",
        status: "paid",
        plan: "paid",
        billingStatus: "active",
        createdSource: "self-service",
        createdAt: NOW,
        updatedAt: NOW,
        seatQuota: 5,
        seatUsed: 1,
      },
      "enterprise-suspended": {
        id: "enterprise-suspended",
        name: "Suspended",
        slug: "suspended",
        status: "suspended",
        plan: "paid",
        billingStatus: "active",
        createdSource: "self-service",
        createdAt: NOW,
        updatedAt: NOW,
        seatQuota: 5,
        seatUsed: 0,
      },
    },
    sessions: {},
    memberships: {
      "membership-a": {
        id: "membership-a",
        userId: "user-1",
        enterpriseId: "enterprise-a",
        membershipRole: "member",
        createdAt: NOW,
        updatedAt: NOW,
      },
      "membership-b": {
        id: "membership-b",
        userId: "user-1",
        enterpriseId: "enterprise-b",
        membershipRole: "enterprise-admin",
        createdAt: NOW,
        updatedAt: LATER,
      },
      "membership-c": {
        id: "membership-c",
        userId: "user-2",
        enterpriseId: "enterprise-c",
        membershipRole: "member",
        createdAt: NOW,
        updatedAt: NOW,
      },
      "membership-suspended": {
        id: "membership-suspended",
        userId: "user-1",
        enterpriseId: "enterprise-suspended",
        membershipRole: "member",
        createdAt: NOW,
        updatedAt: LATER,
      },
    },
  } as unknown as PlatformAuthStore;
}

describe("active membership helpers", () => {
  it("lists every membership for the user without selecting one", () => {
    expect(
      listMembershipsByUserId(storeWithMemberships(), "user-1").map((entry) => entry.id),
    ).toEqual(["membership-a", "membership-b", "membership-suspended"]);
  });

  it("resolves an exact membership only for its owning user", () => {
    const store = storeWithMemberships();
    expect(findMembershipByIdForUser(store, "membership-a", "user-1")?.enterpriseId).toBe(
      "enterprise-a",
    );
    expect(findMembershipByIdForUser(store, "membership-a", "user-2")).toBeUndefined();
  });

  it("returns no legacy default when the user has multiple memberships", () => {
    expect(findUniqueMembershipByUserId(storeWithMemberships(), "user-1")).toBeUndefined();
  });

  it("returns the sole membership for an unambiguous legacy user", () => {
    expect(findUniqueMembershipByUserId(storeWithMemberships(), "user-2")?.id).toBe("membership-c");
  });

  it("filters eligible memberships by login channel role", () => {
    const store = storeWithMemberships();
    expect(
      listEligibleMembershipsForUser({ store, userId: "user-1", intent: "employee" }).map(
        (entry) => entry.id,
      ),
    ).toEqual(["membership-a"]);
    expect(
      listEligibleMembershipsForUser({
        store,
        userId: "user-1",
        intent: "enterprise-admin",
      }).map((entry) => entry.id),
    ).toEqual(["membership-b"]);
  });

  it("auto-binds by channel: employee→member, admin→enterprise-admin", () => {
    const store = storeWithMemberships();
    expect(
      resolvePreferredMembershipForUser({
        store,
        userId: "user-1",
        intent: "employee",
      })?.id,
    ).toBe("membership-a");
    expect(
      resolvePreferredMembershipForUser({
        store,
        userId: "user-1",
        intent: "enterprise-admin",
      })?.id,
    ).toBe("membership-b");
  });

  it("prefers the most recent session among channel-matching memberships only", () => {
    const store = storeWithMemberships();
    // Newer admin session must not win employee-channel login.
    store.memberships["membership-a2"] = {
      id: "membership-a2",
      userId: "user-1",
      enterpriseId: "enterprise-c",
      membershipRole: "member",
      createdAt: NOW,
      updatedAt: NOW,
    };
    store.sessions = {
      "session-admin": {
        id: "session-admin",
        userId: "user-1",
        createdAt: LATER,
        updatedAt: LATER,
        sessionIssuedAt: LATER,
        expiresAt: "2026-08-30T00:00:00.000Z",
        membershipId: "membership-b",
        enterpriseId: "enterprise-b",
      },
      "session-member": {
        id: "session-member",
        userId: "user-1",
        createdAt: NOW,
        updatedAt: NOW,
        sessionIssuedAt: NOW,
        expiresAt: "2026-08-30T00:00:00.000Z",
        membershipId: "membership-a",
        enterpriseId: "enterprise-a",
      },
    };
    expect(
      resolvePreferredMembershipForUser({
        store,
        userId: "user-1",
        intent: "employee",
      })?.id,
    ).toBe("membership-a");
  });

  it("honors explicit membershipId over auto preference", () => {
    const store = storeWithMemberships();
    expect(
      resolvePreferredMembershipForUser({
        store,
        userId: "user-1",
        membershipId: "membership-a",
        intent: "employee",
      })?.id,
    ).toBe("membership-a");
  });
});
