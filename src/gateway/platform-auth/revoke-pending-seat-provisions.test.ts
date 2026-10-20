import { describe, expect, it } from "vitest";
import { revokePendingEmployeeProvisionsForSeat } from "./auth-helpers.js";
import type { PlatformAuthStore } from "./store-types.js";

function createStore(): PlatformAuthStore {
  return {
    users: {},
    memberships: {},
    enterprises: {},
    employeeProvisions: {
      "prov-pending": {
        id: "prov-pending",
        enterpriseId: "acme",
        seatId: "seat-pending",
        employeeName: "Hire",
        employeeEmail: "hire@example.com",
        normalizedEmployeeEmail: "hire@example.com",
        status: "pending_activation",
        createdByUserId: "admin-1",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
      "prov-other-seat": {
        id: "prov-other-seat",
        enterpriseId: "acme",
        seatId: "seat-other",
        employeeName: "Other",
        employeeEmail: "other@example.com",
        normalizedEmployeeEmail: "other@example.com",
        status: "pending_activation",
        createdByUserId: "admin-1",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
      "prov-activated": {
        id: "prov-activated",
        enterpriseId: "acme",
        seatId: "seat-pending",
        employeeName: "Old",
        employeeEmail: "old@example.com",
        normalizedEmployeeEmail: "old@example.com",
        status: "activated",
        createdByUserId: "admin-1",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
    },
    activationCodes: {
      "code-pending": {
        id: "code-pending",
        enterpriseId: "acme",
        provisionId: "prov-pending",
        email: "hire@example.com",
        normalizedEmail: "hire@example.com",
        codeHash: "hash",
        displayCode: "ABCD",
        codeType: "employeeActivation",
        status: "active",
        attemptCount: 0,
        maxAttempts: 5,
        deliveryChannel: "email",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        expiresAt: "2026-06-08T00:00:00.000Z",
      },
    },
  } as unknown as PlatformAuthStore;
}

describe("revokePendingEmployeeProvisionsForSeat", () => {
  it("revokes pending_activation provisions and active activation codes for the seat", () => {
    const store = createStore();
    const revoked = revokePendingEmployeeProvisionsForSeat({
      store,
      enterpriseId: "acme",
      seatId: "seat-pending",
      nowIso: "2026-06-12T08:20:00.000Z",
      reason: "seat_deleted",
    });
    expect(revoked).toBe(1);
    expect(store.employeeProvisions["prov-pending"]?.status).toBe("revoked");
    expect(store.employeeProvisions["prov-pending"]?.revokedReason).toBe("seat_deleted");
    expect(store.activationCodes["code-pending"]?.status).toBe("revoked");
    expect(store.employeeProvisions["prov-other-seat"]?.status).toBe("pending_activation");
    expect(store.employeeProvisions["prov-activated"]?.status).toBe("activated");
  });

  it("returns 0 when no pending provisions match", () => {
    const store = createStore();
    const revoked = revokePendingEmployeeProvisionsForSeat({
      store,
      enterpriseId: "acme",
      seatId: "seat-missing",
      nowIso: "2026-06-12T08:20:00.000Z",
    });
    expect(revoked).toBe(0);
    expect(store.employeeProvisions["prov-pending"]?.status).toBe("pending_activation");
  });
});
