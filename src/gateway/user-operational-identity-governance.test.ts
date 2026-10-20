// @vitest-environment node
// P2 Task 2.1/2.6: scoped governance aggregator (platform/tenant/self visibility + owner→tenant backfill).

import { describe, expect, it } from "vitest";
import type { PlatformAuthStore } from "./platform-auth/store-types.js";
import { listUserOperationalIdentityActivityForScope } from "./user-operational-identity-governance.js";
import type {
  UserOperationalIdentity,
  UserOperationalIdentityGrant,
  UserOperationalIdentityStore,
  UserOperationalIdentityUsageEvent,
} from "./user-operational-identity-types.js";

function identity(
  partial: Pick<UserOperationalIdentity, "identityId" | "ownerId"> &
    Partial<UserOperationalIdentity>,
): UserOperationalIdentity {
  return {
    ownerType: "user",
    provider: "github-personal",
    displayName: "id",
    credentialHandleId: "h",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

function usage(
  partial: Pick<UserOperationalIdentityUsageEvent, "eventId" | "ownerId"> &
    Partial<UserOperationalIdentityUsageEvent>,
): UserOperationalIdentityUsageEvent {
  return {
    agentId: "agent-1",
    identityId: "i-1",
    provider: "github-personal",
    action: "read",
    result: "allowed",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

function buildStore(
  overrides: Partial<UserOperationalIdentityStore> = {},
): UserOperationalIdentityStore {
  return {
    version: 4,
    identities: {},
    grants: {},
    bindingRequests: {},
    usageEvents: {},
    lifecycleEvents: {},
    continuations: {},
    credentialHandles: {},
    oauthSessions: {},
    ...overrides,
  };
}

// Two owners: alice→tenant A (via membership), bob→tenant B (explicit on records).
function platformStore(): PlatformAuthStore {
  return {
    memberships: {
      "m-alice": { userId: "alice", enterpriseId: "tenant-a" },
      "m-bob": { userId: "bob", enterpriseId: "tenant-b" },
    },
  } as unknown as PlatformAuthStore;
}

const store = buildStore({
  identities: {
    "i-a": identity({ identityId: "i-a", ownerId: "alice", status: "active" }),
    "i-b": identity({ identityId: "i-b", ownerId: "bob", status: "reauth_required" }),
  },
  grants: {
    "g-a": {
      grantId: "g-a",
      identityId: "i-a",
      ownerId: "alice",
      agentId: "agent-1",
      agentScope: "owned",
      allowedActions: ["read"],
      grantMode: "auto",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } satisfies UserOperationalIdentityGrant,
  },
  usageEvents: {
    "e-a": usage({ eventId: "e-a", ownerId: "alice", result: "allowed" }),
    "e-b": usage({ eventId: "e-b", ownerId: "bob", result: "denied", denialCode: "X" }),
  },
  lifecycleEvents: {
    "l-a": {
      eventId: "l-a",
      ownerId: "alice",
      identityId: "i-a",
      provider: "github-personal",
      action: "created",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    "l-b": {
      eventId: "l-b",
      ownerId: "bob",
      identityId: "i-b",
      provider: "github-personal",
      action: "revoked",
      createdAt: "2026-01-02T00:00:00.000Z",
    },
  },
});

describe("listUserOperationalIdentityActivityForScope", () => {
  it("platform scope sees all identities and a per-tenant breakdown", () => {
    const overview = listUserOperationalIdentityActivityForScope({
      store,
      scope: { kind: "platform" },
      platformStore: platformStore(),
    });
    expect(overview.totals.identities).toBe(2);
    expect(overview.totals.active).toBe(1);
    expect(overview.totals.reauthRequired).toBe(1);
    expect(overview.recentDenials).toHaveLength(1);
    const tenants = (overview.tenantBreakdown ?? []).map((entry) => entry.tenantId).toSorted();
    expect(tenants).toEqual(["tenant-a", "tenant-b"]);
  });

  it("tenant scope only sees its own tenant (owner→membership backfill)", () => {
    const overview = listUserOperationalIdentityActivityForScope({
      store,
      scope: { kind: "tenant", tenantId: "tenant-a" },
      platformStore: platformStore(),
    });
    expect(overview.totals.identities).toBe(1);
    expect(overview.activeGrants).toBe(1);
    expect(overview.recentDenials).toHaveLength(0);
    // platform-only breakdown is omitted for tenant scope
    expect(overview.tenantBreakdown).toBeUndefined();
  });

  it("self scope only sees the owner's own records", () => {
    const overview = listUserOperationalIdentityActivityForScope({
      store,
      scope: { kind: "self", ownerId: "bob" },
      platformStore: platformStore(),
    });
    expect(overview.totals.identities).toBe(1);
    expect(overview.totals.reauthRequired).toBe(1);
    expect(overview.recentDenials).toHaveLength(1);
    expect(overview.recentDenials[0]?.ownerId).toBe("bob");
    // lifecycle stream is scope-filtered too
    expect(overview.recentLifecycle).toHaveLength(1);
    expect(overview.recentLifecycle[0]?.action).toBe("revoked");
    expect(overview.recentLifecycle[0]?.ownerId).toBe("bob");
  });

  it("platform scope surfaces lifecycle events across owners (newest first)", () => {
    const overview = listUserOperationalIdentityActivityForScope({
      store,
      scope: { kind: "platform" },
      platformStore: platformStore(),
    });
    expect(overview.recentLifecycle.map((event) => event.eventId)).toEqual(["l-b", "l-a"]);
  });

  it("desensitized views expose only metadata (no secret fields)", () => {
    const overview = listUserOperationalIdentityActivityForScope({
      store,
      scope: { kind: "platform" },
      platformStore: platformStore(),
    });
    const event = overview.recentUsage[0];
    expect(event).toBeDefined();
    expect(Object.keys(event ?? {}).toSorted()).toEqual(
      [
        "action",
        "agentId",
        "createdAt",
        "denialCode",
        "eventId",
        "identityId",
        "ownerId",
        "provider",
        "result",
        "tenantId",
      ].toSorted(),
    );
  });
});
