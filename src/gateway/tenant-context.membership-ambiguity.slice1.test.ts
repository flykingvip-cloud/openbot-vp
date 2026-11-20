import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformAuthStore } from "./platform-auth/store-types.js";
import type { GatewayClient } from "./server-methods/types.js";

/**
 * WP-B slice 1 regression: membership ambiguity on the chat.send helper path.
 * Fail-before (2026-11-20 12:44:42 +0800, baseline a26d79ba): with no session
 * binding, swapping membership insertion order made resolveTenantContextForSessionStore
 * return ent-a then ent-b. This file now asserts the fail-closed pass-after behavior.
 */

let currentStore: PlatformAuthStore;

vi.mock("../config/config.js", () => ({
  loadConfig: () => ({ gateway: { auth: { trustedProxy: { enabled: true } } } }),
}));

vi.mock("./platform-auth/config.js", () => ({
  resolvePlatformAuthConfig: () => ({ enabled: true }),
}));

vi.mock("./platform-auth/store.js", () => ({
  loadStore: async () => currentStore,
}));

vi.mock("./platform-auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./platform-auth.js")>();
  return {
    ...actual,
    resolvePlatformAuthConfig: () => ({ enabled: true }),
    loadPlatformAuthStore: async () => currentStore,
  };
});

const { resolveTenantContextForSessionStore } = await import("./tenant-context.js");
const { ensureGatewayClientEnterpriseTenant } =
  await import("./webchat-client-platform-identity.js");
const { findMembershipByUserId, findUniqueMembershipByUserId } =
  await import("./platform-auth/memberships.js");

const NOW = "2026-01-01T00:00:00.000Z";
const MEM_A = { id: "mem-a", enterpriseId: "ent-a" };
const MEM_B = { id: "mem-b", enterpriseId: "ent-b" };

function storeInOrder(
  first: { id: string; enterpriseId: string },
  second: { id: string; enterpriseId: string },
): PlatformAuthStore {
  const memberships: PlatformAuthStore["memberships"] = {};
  for (const membership of [first, second]) {
    memberships[membership.id] = {
      id: membership.id,
      userId: "user-multi",
      enterpriseId: membership.enterpriseId,
      membershipRole: "member",
      createdAt: NOW,
      updatedAt: NOW,
    };
  }
  return {
    users: {
      "user-multi": {
        id: "user-multi",
        email: "multi@example.com",
        normalizedEmail: "multi@example.com",
        status: "active",
      },
    },
    enterprises: {
      "ent-a": { id: "ent-a", name: "A", status: "paid" },
      "ent-b": { id: "ent-b", name: "B", status: "paid" },
    },
    memberships,
    sessions: {},
  } as unknown as PlatformAuthStore;
}

function unboundClient(): GatewayClient {
  return {
    user: "multi@example.com",
    platformUserId: "user-multi",
  } as GatewayClient;
}

describe("WP-B slice1 membership ambiguity on resolveTenantContextForSessionStore", () => {
  beforeEach(() => {
    currentStore = storeInOrder(MEM_A, MEM_B);
  });

  it("treats two valid enterprise memberships as unique-membership-ambiguous", () => {
    expect(findUniqueMembershipByUserId(currentStore, "user-multi")).toBeUndefined();
  });

  it("does not auto-select an enterprise when membership insertion order is swapped, with no authoritative session binding", async () => {
    currentStore = storeInOrder(MEM_A, MEM_B);
    // The legacy helper still first-matches; this path must not use it.
    expect(findMembershipByUserId(currentStore, "user-multi")?.enterpriseId).toBe("ent-a");
    const firstCtx = await resolveTenantContextForSessionStore(unboundClient());

    currentStore = storeInOrder(MEM_B, MEM_A);
    expect(findMembershipByUserId(currentStore, "user-multi")?.enterpriseId).toBe("ent-b");
    const swappedCtx = await resolveTenantContextForSessionStore(unboundClient());

    expect(firstCtx).toBeNull();
    expect(swappedCtx).toBeNull();
  });

  it("is reached from resolveAndBindChatTurnTenant when the webchat pin leaves the client unbound, and still fails closed", async () => {
    currentStore = storeInOrder(MEM_A, MEM_B);
    const client = unboundClient();
    await ensureGatewayClientEnterpriseTenant(client);

    expect(client.sessionEnterpriseId).toBeUndefined();
    expect(client.sessionMembershipId).toBeUndefined();
    expect(client.sessionTenantId).toBeUndefined();

    const stamped = client.sessionEnterpriseId?.trim() || null;
    expect(stamped).toBeNull();
    const ctx = await resolveTenantContextForSessionStore(client);
    expect(ctx).toBeNull();

    const chatSource = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "server-methods/chat.ts"),
      "utf8",
    );
    expect(chatSource).toContain("async function resolveAndBindChatTurnTenant(");
    expect(chatSource).toMatch(
      /const stamped = client\?\.sessionEnterpriseId\?\.trim\(\) \|\| null;[\s\S]*if \(!tenantId\) \{[\s\S]*resolveTenantContextForSessionStore\(client/,
    );
  });

  it("still honors an exact session membership pair when the user has two enterprises", async () => {
    currentStore = storeInOrder(MEM_A, MEM_B);
    const client = {
      ...unboundClient(),
      sessionMembershipId: "mem-b",
      sessionEnterpriseId: "ent-b",
    } as GatewayClient;
    const ctx = await resolveTenantContextForSessionStore(client);
    expect(ctx?.tenantId).toBe("ent-b");
    expect(ctx?.userId).toBe("user-multi");
  });
});
