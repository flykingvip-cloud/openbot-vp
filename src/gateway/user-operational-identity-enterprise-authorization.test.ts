// @vitest-environment node
// P3 Task 3.4: enterprise authorization gate (resolver + integration into resolveUserOperationalIdentity).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config/config.js";
import type { EnterpriseSeatAssetsStore } from "./enterprise-seat-assets-store.js";
import type { PlatformAuthStore } from "./platform-auth/store-types.js";
import { resolveUserOperationalIdentity } from "./user-operational-identity-access.js";
import {
  ENTERPRISE_SEAT_REVOKED_DENIAL_CODE,
  resolveEmployeeOperationalAuthorization,
} from "./user-operational-identity-enterprise-authorization.js";
import { normalizeUserOperationalIdentityStore } from "./user-operational-identity-persistence.js";
import { registerUserOperationalIdentity } from "./user-operational-identity-store.js";

vi.mock("../config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

vi.mock("./collaboration-learning/shared.js", () => ({
  readConfiguredAgentOwnership: vi.fn(() => null),
}));

vi.mock("./session-utils.js", () => ({
  listAgentsForGateway: vi.fn(() => ({
    agents: [{ id: "agent-owned-1", scope: "self" }],
  })),
}));

function platformStore(memberships: Record<string, { userId: string; enterpriseId: string }>) {
  return { memberships } as unknown as PlatformAuthStore;
}

function seatStore(
  bindings: Array<{
    bindingId: string;
    seatId: string;
    tenantId: string;
    employeeId: string;
    bindingStatus: string;
    effectiveAt: string;
  }>,
) {
  const map: Record<string, unknown> = {};
  for (const binding of bindings) {
    map[binding.bindingId] = binding;
  }
  return { bindings: map } as unknown as EnterpriseSeatAssetsStore;
}

describe("resolveEmployeeOperationalAuthorization (Task 3.1)", () => {
  it("is ungoverned (allow) when platform auth is disabled", () => {
    const result = resolveEmployeeOperationalAuthorization({
      ownerId: "u1",
      platformStore: null,
      seatStore: null,
    });
    expect(result).toEqual({ governed: false, decision: "allow" });
  });

  it("is ungoverned (allow) when the owner has no membership", () => {
    const result = resolveEmployeeOperationalAuthorization({
      ownerId: "u1",
      platformStore: platformStore({}),
      seatStore: null,
    });
    expect(result.governed).toBe(false);
    expect(result.decision).toBe("allow");
  });

  it("allows an enterprise employee with no seat binding (no false deny)", () => {
    const result = resolveEmployeeOperationalAuthorization({
      ownerId: "u1",
      platformStore: platformStore({ m1: { userId: "u1", enterpriseId: "tenant-a" } }),
      seatStore: seatStore([]),
    });
    expect(result).toMatchObject({ governed: true, decision: "allow", tenantId: "tenant-a" });
    expect(result.seatId).toBeUndefined();
  });

  it("allows and surfaces the active seat when a binding is active", () => {
    const result = resolveEmployeeOperationalAuthorization({
      ownerId: "u1",
      platformStore: platformStore({ m1: { userId: "u1", enterpriseId: "tenant-a" } }),
      seatStore: seatStore([
        {
          bindingId: "b1",
          seatId: "seat-1",
          tenantId: "tenant-a",
          employeeId: "u1",
          bindingStatus: "active",
          effectiveAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
    });
    expect(result).toMatchObject({
      governed: true,
      decision: "allow",
      tenantId: "tenant-a",
      seatId: "seat-1",
    });
  });

  it("denies when the employee has only non-active seat bindings (withdrawn)", () => {
    const result = resolveEmployeeOperationalAuthorization({
      ownerId: "u1",
      platformStore: platformStore({ m1: { userId: "u1", enterpriseId: "tenant-a" } }),
      seatStore: seatStore([
        {
          bindingId: "b1",
          seatId: "seat-1",
          tenantId: "tenant-a",
          employeeId: "u1",
          bindingStatus: "revoked",
          effectiveAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
    });
    expect(result.decision).toBe("deny");
    expect(result.denialCode).toBe(ENTERPRISE_SEAT_REVOKED_DENIAL_CODE);
    expect(result.tenantId).toBe("tenant-a");
  });
});

describe("resolveUserOperationalIdentity enterprise gate (Task 3.2/3.3)", () => {
  const nowIso = "2026-06-06T12:00:00.000Z";
  const ownerId = "user-1";

  beforeEach(() => {
    vi.mocked(loadConfig).mockReturnValue({});
  });

  function seedIdentity(store: ReturnType<typeof normalizeUserOperationalIdentityStore>) {
    const created = registerUserOperationalIdentity({
      store,
      ownerId,
      displayName: "My GitHub",
      provider: "github-personal",
      credentialHandleId: "cred-github-1",
      nowIso,
      credentialVerified: true,
    });
    if (!created.ok) {
      throw new Error("seed failed");
    }
  }

  it("hard-denies before owner/grant evaluation and records a standardized deny audit", () => {
    const store = normalizeUserOperationalIdentityStore(null);
    seedIdentity(store);
    const result = resolveUserOperationalIdentity({
      store,
      provider: "github-personal",
      action: "create_issue",
      currentUserId: ownerId,
      currentAgentId: "agent-owned-1",
      nowIso,
      enterpriseAuthorization: {
        governed: true,
        decision: "deny",
        tenantId: "tenant-a",
        denialCode: ENTERPRISE_SEAT_REVOKED_DENIAL_CODE,
        reason: "withdrawn",
      },
    });
    expect(result.allowed).toBe(false);
    if (result.allowed) {
      return;
    }
    expect(result.code).toBe(ENTERPRISE_SEAT_REVOKED_DENIAL_CODE);
    const denyEvent = Object.values(store.usageEvents).find(
      (event) => event.denialCode === ENTERPRISE_SEAT_REVOKED_DENIAL_CODE,
    );
    expect(denyEvent).toBeDefined();
    expect(denyEvent?.tenantId).toBe("tenant-a");
  });

  it("uses authoritative tenant/seat for audit on allow (ignores untrusted params)", () => {
    const store = normalizeUserOperationalIdentityStore(null);
    seedIdentity(store);
    const result = resolveUserOperationalIdentity({
      store,
      provider: "github-personal",
      action: "create_issue",
      currentUserId: ownerId,
      currentAgentId: "agent-owned-1",
      // Untrusted request-supplied values that must NOT win over authoritative ones.
      tenantId: "tenant-forged",
      currentSeatId: "seat-forged",
      nowIso,
      enterpriseAuthorization: {
        governed: true,
        decision: "allow",
        tenantId: "tenant-a",
        seatId: "seat-1",
      },
    });
    expect(result.allowed).toBe(true);
    const allowEvent = Object.values(store.usageEvents).find((event) => event.result === "allowed");
    expect(allowEvent?.tenantId).toBe("tenant-a");
    expect(allowEvent?.seatId).toBe("seat-1");
  });

  it("does not false-deny when no enterprise authorization is provided (regression)", () => {
    const store = normalizeUserOperationalIdentityStore(null);
    seedIdentity(store);
    const result = resolveUserOperationalIdentity({
      store,
      provider: "github-personal",
      action: "create_issue",
      currentUserId: ownerId,
      currentAgentId: "agent-owned-1",
      nowIso,
    });
    expect(result.allowed).toBe(true);
  });
});
