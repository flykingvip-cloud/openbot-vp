import { describe, it, expect, beforeEach, vi, Mock } from "vitest";
import { loadConfig } from "../config/config.js";
import { resolveAgentTenant } from "./agent-tenant.js";
import {
  loadPlatformAuthStore,
  resolvePlatformAuthConfig,
  findMembershipByUserId,
  type PlatformAuthMembership,
  type PlatformAuthStore,
  type ResolvedPlatformAuthConfig,
} from "./platform-auth.js";
import { resolveTenantForSeatId } from "./seat-tenant-index.js";
import { canonicalizeTenantId } from "./tenant-canonicalization.js";

function authConfig(enabled: boolean): ResolvedPlatformAuthConfig {
  return {
    enabled,
    storePath: "/tmp/openbot-platform-auth.json",
    sessionTtlHours: 24,
    activationTtlHours: 24,
    passwordResetTtlMinutes: 30,
    cookieName: "openbot_platform_session",
    requireMfaForPlatformAdmins: true,
  };
}

function membership(
  userId: string,
  enterpriseId: string,
  overrides: Partial<PlatformAuthMembership> = {},
): PlatformAuthMembership {
  return {
    id: overrides.id ?? `membership-${userId}`,
    userId,
    enterpriseId,
    membershipRole: overrides.membershipRole ?? "member",
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
  };
}

function storeWithMemberships(memberships: PlatformAuthMembership[]): PlatformAuthStore {
  return {
    memberships: Object.fromEntries(memberships.map((entry) => [entry.id, entry] as const)),
  } as unknown as PlatformAuthStore;
}

type ConfigAgentEntry = {
  id?: string | null;
  ownerId?: string;
  ownerType?: string;
  tenantId?: string;
};

type ConfigWithAgents = {
  agents?: {
    list?: ConfigAgentEntry[];
  };
};

// Mock all dependencies
vi.mock("../config/config.js");
vi.mock("./platform-auth.js");
vi.mock("./tenant-canonicalization.js");
vi.mock("./seat-tenant-index.js");

describe("resolveAgentTenant", () => {
  const mockLoadConfig = loadConfig as Mock;
  const mockResolvePlatformAuthConfig = resolvePlatformAuthConfig as Mock;
  const mockLoadPlatformAuthStore = loadPlatformAuthStore as Mock;
  const mockFindMembershipByUserId = findMembershipByUserId as Mock;
  const mockCanonicalizeTenantId = canonicalizeTenantId as Mock;
  const mockResolveTenantForSeatId = resolveTenantForSeatId as Mock;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  // Regression: production owns most agents through seats (ownerType "position",
  // ownerId = seat id). The membership path can never resolve those, so they came
  // back null and every tenant-scoped operator action on them was refused with
  // "agent has no tenant ownership proof".
  describe("seat ownership (ownerType: position)", () => {
    it("resolves the tenant from the seat record", async () => {
      mockLoadConfig.mockReturnValue({
        agents: {
          list: [{ id: "agt-employee-bot", ownerId: "seat-ceo-main", ownerType: "position" }],
        },
      } satisfies ConfigWithAgents);
      mockResolveTenantForSeatId.mockResolvedValue("001");

      await expect(resolveAgentTenant("agt-employee-bot")).resolves.toBe("001");
      expect(mockResolveTenantForSeatId).toHaveBeenCalledWith("seat-ceo-main");
      // A seat id is never a platform user id; the membership path must not run.
      expect(mockLoadPlatformAuthStore).not.toHaveBeenCalled();
    });

    it("fails closed when the seat is unknown", async () => {
      mockLoadConfig.mockReturnValue({
        agents: { list: [{ id: "agt-orphan", ownerId: "seat-missing", ownerType: "position" }] },
      } satisfies ConfigWithAgents);
      mockResolveTenantForSeatId.mockResolvedValue(null);

      await expect(resolveAgentTenant("agt-orphan")).resolves.toBeNull();
    });

    it("still requires an ownerId", async () => {
      mockLoadConfig.mockReturnValue({
        agents: { list: [{ id: "agt-no-owner", ownerType: "position" }] },
      } satisfies ConfigWithAgents);

      await expect(resolveAgentTenant("agt-no-owner")).resolves.toBeNull();
      expect(mockResolveTenantForSeatId).not.toHaveBeenCalled();
    });

    it("prefers an explicit tenantId over the seat lookup", async () => {
      mockLoadConfig.mockReturnValue({
        agents: {
          list: [
            {
              id: "agt-explicit",
              ownerId: "seat-ceo-main",
              ownerType: "position",
              tenantId: "acme",
            },
          ],
        },
      } satisfies ConfigWithAgents);
      mockCanonicalizeTenantId.mockReturnValue("acme");

      await expect(resolveAgentTenant("agt-explicit")).resolves.toBe("acme");
      expect(mockResolveTenantForSeatId).not.toHaveBeenCalled();
    });

    it("leaves user-owned agents on the membership path", async () => {
      mockLoadConfig.mockReturnValue({
        agents: { list: [{ id: "agt-user-owned", ownerId: "user-1" }] },
      } satisfies ConfigWithAgents);
      mockResolvePlatformAuthConfig.mockReturnValue(authConfig(true));
      mockLoadPlatformAuthStore.mockResolvedValue(
        storeWithMemberships([membership("user-1", "001")]),
      );
      mockFindMembershipByUserId.mockReturnValue(membership("user-1", "001"));
      mockCanonicalizeTenantId.mockReturnValue("001");

      await expect(resolveAgentTenant("agt-user-owned")).resolves.toBe("001");
      expect(mockResolveTenantForSeatId).not.toHaveBeenCalled();
    });
  });

  describe("explicit tenantId on agent entry", () => {
    it("returns explicit tenantId when present on agent entry", async () => {
      mockLoadConfig.mockReturnValue({
        agents: {
          list: [
            {
              id: "agent-1",
              tenantId: "tenant-123",
            },
          ],
        },
      } satisfies ConfigWithAgents);
      mockCanonicalizeTenantId.mockImplementation((id) => id);

      const result = await resolveAgentTenant("agent-1");
      expect(result).toBe("tenant-123");
    });

    it("returns canonicalized tenantId when explicit tenantId is provided", async () => {
      mockLoadConfig.mockReturnValue({
        agents: {
          list: [
            {
              id: "agent-1",
              tenantId: "  TENANT-ABC  ",
            },
          ],
        },
      } satisfies ConfigWithAgents);
      mockCanonicalizeTenantId.mockImplementation((id) => id?.trim().toUpperCase());

      const result = await resolveAgentTenant("agent-1");
      expect(result).toBe("TENANT-ABC");
    });

    it("ignores empty/whitespace tenantId and falls back to ownerId", async () => {
      mockLoadConfig.mockReturnValue({
        agents: {
          list: [
            {
              id: "agent-1",
              ownerId: "user-123",
              tenantId: "   ",
            },
          ],
        },
      } satisfies ConfigWithAgents);
      mockResolvePlatformAuthConfig.mockReturnValue(authConfig(true));
      mockLoadPlatformAuthStore.mockResolvedValue(
        storeWithMemberships([membership("user-123", "enterprise-456")]),
      );
      mockFindMembershipByUserId.mockReturnValue({
        userId: "user-123",
        enterpriseId: "enterprise-456",
      } as PlatformAuthMembership);
      mockCanonicalizeTenantId.mockImplementation((id) => id);

      const result = await resolveAgentTenant("agent-1");
      expect(result).toBe("enterprise-456");
    });
  });

  describe("ownerId → membership → enterpriseId resolution", () => {
    it("returns enterpriseId from membership when ownerId is set", async () => {
      mockLoadConfig.mockReturnValue({
        agents: {
          list: [
            {
              id: "agent-1",
              ownerId: "user-123",
            },
          ],
        },
      } satisfies ConfigWithAgents);
      mockResolvePlatformAuthConfig.mockReturnValue(authConfig(true));
      mockLoadPlatformAuthStore.mockResolvedValue(
        storeWithMemberships([membership("user-123", "enterprise-456")]),
      );
      mockFindMembershipByUserId.mockReturnValue({
        userId: "user-123",
        enterpriseId: "enterprise-456",
      } as PlatformAuthMembership);
      mockCanonicalizeTenantId.mockImplementation((id) => id);

      const result = await resolveAgentTenant("agent-1");
      expect(result).toBe("enterprise-456");
    });

    it("returns canonicalized enterpriseId when found", async () => {
      mockLoadConfig.mockReturnValue({
        agents: {
          list: [
            {
              id: "agent-1",
              ownerId: "user-123",
            },
          ],
        },
      } satisfies ConfigWithAgents);
      mockResolvePlatformAuthConfig.mockReturnValue(authConfig(true));
      mockLoadPlatformAuthStore.mockResolvedValue(
        storeWithMemberships([membership("user-123", "  ENT-789  ")]),
      );
      mockFindMembershipByUserId.mockReturnValue({
        userId: "user-123",
        enterpriseId: "  ENT-789  ",
      } as PlatformAuthMembership);
      mockCanonicalizeTenantId.mockImplementation((id) => id?.trim().toUpperCase());

      const result = await resolveAgentTenant("agent-1");
      expect(result).toBe("ENT-789");
    });

    it("returns null when the owner has several memberships (no store-order guess)", async () => {
      mockLoadConfig.mockReturnValue({
        agents: {
          list: [
            {
              id: "agent-1",
              ownerId: "user-123",
            },
          ],
        },
      } satisfies ConfigWithAgents);
      mockResolvePlatformAuthConfig.mockReturnValue(authConfig(true));
      // `enterprise-b` is stored first, so a first-match lookup would return it.
      mockLoadPlatformAuthStore.mockResolvedValue(
        storeWithMemberships([
          membership("user-123", "enterprise-b", { id: "membership-b" }),
          membership("user-123", "enterprise-a", { id: "membership-a" }),
        ]),
      );
      mockCanonicalizeTenantId.mockImplementation((id) => id);

      // No session exists for a stored entry, so ambiguity must fail closed.
      expect(await resolveAgentTenant("agent-1")).toBeNull();
    });

    it("resolves when several memberships all point at the SAME enterprise (#748)", async () => {
      mockLoadConfig.mockReturnValue({
        agents: {
          list: [
            {
              id: "agent-1",
              ownerId: "user-123",
            },
          ],
        },
      } satisfies ConfigWithAgents);
      mockResolvePlatformAuthConfig.mockReturnValue(authConfig(true));
      // Two memberships, same enterprise: no tenant to leak between, so the
      // enterprise is unambiguous and must resolve rather than fail closed.
      mockLoadPlatformAuthStore.mockResolvedValue(
        storeWithMemberships([
          membership("user-123", "enterprise-001", {
            id: "membership-admin",
            membershipRole: "enterprise-admin",
            createdAt: "2026-01-02T00:00:00.000Z",
          }),
          membership("user-123", "enterprise-001", {
            id: "membership-member",
            membershipRole: "member",
            createdAt: "2026-01-03T00:00:00.000Z",
          }),
        ]),
      );
      mockCanonicalizeTenantId.mockImplementation((id) => id);

      const result = await resolveAgentTenant("agent-1");
      expect(result).toBe("enterprise-001");
    });

    it("resolves same-enterprise memberships to the canonicalized tenant id", async () => {
      mockLoadConfig.mockReturnValue({
        agents: {
          list: [
            {
              id: "agent-1",
              ownerId: "user-123",
            },
          ],
        },
      } satisfies ConfigWithAgents);
      mockResolvePlatformAuthConfig.mockReturnValue(authConfig(true));
      // Different raw casing/whitespace that canonicalizes to one enterprise
      // must still be treated as a single unambiguous enterprise.
      mockLoadPlatformAuthStore.mockResolvedValue(
        storeWithMemberships([
          membership("user-123", "  ENT-001  ", { id: "membership-a" }),
          membership("user-123", "ent-001", { id: "membership-b" }),
        ]),
      );
      mockCanonicalizeTenantId.mockImplementation((id) => id?.trim().toUpperCase());

      const result = await resolveAgentTenant("agent-1");
      expect(result).toBe("ENT-001");
    });

    it("returns null when several memberships span DIFFERENT enterprises", async () => {
      mockLoadConfig.mockReturnValue({
        agents: {
          list: [
            {
              id: "agent-1",
              ownerId: "user-123",
            },
          ],
        },
      } satisfies ConfigWithAgents);
      mockResolvePlatformAuthConfig.mockReturnValue(authConfig(true));
      mockLoadPlatformAuthStore.mockResolvedValue(
        storeWithMemberships([
          membership("user-123", "enterprise-a", { id: "membership-a" }),
          membership("user-123", "enterprise-b", { id: "membership-b" }),
        ]),
      );
      mockCanonicalizeTenantId.mockImplementation((id) => id);

      // Distinct enterprises = a real tenant ambiguity, must fail closed.
      expect(await resolveAgentTenant("agent-1")).toBeNull();
    });

    it("returns null when membership not found for ownerId", async () => {
      mockLoadConfig.mockReturnValue({
        agents: {
          list: [
            {
              id: "agent-1",
              ownerId: "user-unknown",
            },
          ],
        },
      } satisfies ConfigWithAgents);
      mockResolvePlatformAuthConfig.mockReturnValue(authConfig(true));
      mockLoadPlatformAuthStore.mockResolvedValue(
        storeWithMemberships([membership("user-123", "enterprise-456")]),
      );

      const result = await resolveAgentTenant("agent-1");
      expect(result).toBeNull();
    });

    it("returns null when enterpriseId is missing in membership", async () => {
      mockLoadConfig.mockReturnValue({
        agents: {
          list: [
            {
              id: "agent-1",
              ownerId: "user-123",
            },
          ],
        },
      } satisfies ConfigWithAgents);
      mockResolvePlatformAuthConfig.mockReturnValue(authConfig(true));
      mockLoadPlatformAuthStore.mockResolvedValue(
        storeWithMemberships([membership("user-123", "")]),
      );

      const result = await resolveAgentTenant("agent-1");
      expect(result).toBeNull();
    });
  });

  describe("platform-global (no tenant) cases", () => {
    it("returns null when agent not found", async () => {
      mockLoadConfig.mockReturnValue({
        agents: {
          list: [
            {
              id: "agent-1",
            },
          ],
        },
      } satisfies ConfigWithAgents);

      const result = await resolveAgentTenant("agent-nonexistent");
      expect(result).toBeNull();
    });

    it("returns null when ownerId is not set and no tenantId", async () => {
      mockLoadConfig.mockReturnValue({
        agents: {
          list: [
            {
              id: "agent-1",
            },
          ],
        },
      } satisfies ConfigWithAgents);

      const result = await resolveAgentTenant("agent-1");
      expect(result).toBeNull();
    });

    it("returns null when platform-auth is disabled", async () => {
      mockLoadConfig.mockReturnValue({
        agents: {
          list: [
            {
              id: "agent-1",
              ownerId: "user-123",
            },
          ],
        },
      } satisfies ConfigWithAgents);
      mockResolvePlatformAuthConfig.mockReturnValue(authConfig(false));

      const result = await resolveAgentTenant("agent-1");
      expect(result).toBeNull();
    });

    it("returns null when platform-auth resolution throws", async () => {
      mockLoadConfig.mockReturnValue({
        agents: {
          list: [
            {
              id: "agent-1",
              ownerId: "user-123",
            },
          ],
        },
      } satisfies ConfigWithAgents);
      mockResolvePlatformAuthConfig.mockReturnValue(authConfig(true));
      mockLoadPlatformAuthStore.mockRejectedValue(new Error("Auth store error"));

      const result = await resolveAgentTenant("agent-1");
      expect(result).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("handles empty/whitespace agentId", async () => {
      mockLoadConfig.mockReturnValue({
        agents: {
          list: [],
        },
      });

      expect(await resolveAgentTenant("")).toBeNull();
      expect(await resolveAgentTenant("   ")).toBeNull();
      expect(await resolveAgentTenant(undefined as unknown as string)).toBeNull();
    });

    it("handles agentId with whitespace padding", async () => {
      mockLoadConfig.mockReturnValue({
        agents: {
          list: [
            {
              id: "  agent-with-spaces  ",
              ownerId: "user-123",
            },
          ],
        },
      } satisfies ConfigWithAgents);
      mockResolvePlatformAuthConfig.mockReturnValue(authConfig(true));
      mockLoadPlatformAuthStore.mockResolvedValue(
        storeWithMemberships([membership("user-123", "ent-1")]),
      );
      mockFindMembershipByUserId.mockReturnValue({
        userId: "user-123",
        enterpriseId: "ent-1",
      } as PlatformAuthMembership);
      mockCanonicalizeTenantId.mockImplementation((id) => id);

      const result = await resolveAgentTenant("agent-with-spaces");
      expect(result).toBe("ent-1");
    });

    it("handles agent entry with null/undefined fields", async () => {
      mockLoadConfig.mockReturnValue({
        agents: {
          list: [
            {
              id: null as unknown as string,
              ownerId: undefined,
            },
          ],
        },
      } satisfies ConfigWithAgents);

      const result = await resolveAgentTenant("agent-1");
      expect(result).toBeNull();
    });
  });
});
