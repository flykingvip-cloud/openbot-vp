import { describe, expect, it } from "vitest";
import { createEmptyAgentRegistryStore, type AgentRegistryStore } from "../agent-registry/types.js";
import { classifyWorkspaceOwnership, isWritableWorkspaceScope } from "./ownership-classifier.js";

function storeWith(params: {
  tenantId: string;
  agentAssetId: string;
  legacyAgentId?: string;
  ownerType: "membership" | "seat";
  ownerId: string;
  secondAssetSameLegacy?: boolean;
}): AgentRegistryStore {
  const store = createEmptyAgentRegistryStore();
  const now = "2026-08-10T00:00:00.000Z";
  store.assets[params.agentAssetId] = {
    agentAssetId: params.agentAssetId,
    enterpriseId: params.tenantId,
    agentSlug: "bot",
    displayName: "Bot",
    status: "active",
    legacyAgentId: params.legacyAgentId,
    createdAt: now,
    updatedAt: now,
  };
  if (params.secondAssetSameLegacy && params.legacyAgentId) {
    store.assets["asset-dup"] = {
      agentAssetId: "asset-dup",
      enterpriseId: params.tenantId,
      agentSlug: "bot-dup",
      displayName: "Bot Dup",
      status: "active",
      legacyAgentId: params.legacyAgentId,
      createdAt: now,
      updatedAt: now,
    };
  }
  store.ownerBindings["b1"] = {
    bindingId: "b1",
    enterpriseId: params.tenantId,
    agentAssetId: params.agentAssetId,
    ownerType: params.ownerType,
    ownerId: params.ownerId,
    isPrimary: true,
    effectiveAt: now,
  };
  return store;
}

describe("classifyWorkspaceOwnership", () => {
  it("empty registry does not become user_owned", () => {
    const scope = classifyWorkspaceOwnership({
      actor: { tenantId: "t1", userId: "u1" },
      registry: createEmptyAgentRegistryStore(),
      agentId: "sales",
    });
    expect(scope.kind).toBe("unknown");
    expect(isWritableWorkspaceScope(scope)).toBe(false);
  });

  it("registry load error does not become user_owned", () => {
    const scope = classifyWorkspaceOwnership({
      actor: { tenantId: "t1", userId: "u1" },
      registry: null,
      registryUnavailable: true,
      agentAssetId: "asset-1",
    });
    expect(scope).toEqual({ kind: "unknown", reason: "registry_unavailable" });
  });

  it("missing seat binding does not become user_owned", () => {
    const store = createEmptyAgentRegistryStore();
    const now = "2026-08-10T00:00:00.000Z";
    store.assets["asset-1"] = {
      agentAssetId: "asset-1",
      enterpriseId: "t1",
      agentSlug: "bot",
      displayName: "Bot",
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    const scope = classifyWorkspaceOwnership({
      actor: { tenantId: "t1", userId: "u1" },
      registry: store,
      agentAssetId: "asset-1",
    });
    expect(scope).toEqual({ kind: "unknown", reason: "missing_primary_owner" });
  });

  it("duplicate agentId mapping is unknown", () => {
    const store = storeWith({
      tenantId: "t1",
      agentAssetId: "asset-1",
      legacyAgentId: "sales",
      ownerType: "seat",
      ownerId: "seat-1",
      secondAssetSameLegacy: true,
    });
    const scope = classifyWorkspaceOwnership({
      actor: { tenantId: "t1" },
      registry: store,
      agentId: "sales",
    });
    expect(scope).toEqual({ kind: "unknown", reason: "duplicate_agent_id_mapping" });
  });

  it("cross-tenant agentAssetId mapping is rejected", () => {
    const store = storeWith({
      tenantId: "t-other",
      agentAssetId: "asset-1",
      ownerType: "seat",
      ownerId: "seat-1",
    });
    const scope = classifyWorkspaceOwnership({
      actor: { tenantId: "t1" },
      registry: store,
      agentAssetId: "asset-1",
    });
    expect(scope).toEqual({ kind: "unknown", reason: "cross_tenant_agent_asset" });
  });

  it("caller-supplied owner or tenant cannot change classification", () => {
    const store = storeWith({
      tenantId: "t1",
      agentAssetId: "asset-1",
      ownerType: "seat",
      ownerId: "seat-1",
    });
    expect(
      classifyWorkspaceOwnership({
        actor: { tenantId: "t1" },
        registry: store,
        agentAssetId: "asset-1",
        clientOwnerHint: "attacker",
      }).kind,
    ).toBe("unknown");
    expect(
      classifyWorkspaceOwnership({
        actor: { tenantId: "t1" },
        registry: store,
        agentAssetId: "asset-1",
        clientTenantHint: "t-evil",
      }).kind,
    ).toBe("unknown");
  });

  it("classifies position_owned and user_owned from registry proof", () => {
    const seat = storeWith({
      tenantId: "t1",
      agentAssetId: "asset-seat",
      ownerType: "seat",
      ownerId: "seat-9",
    });
    expect(
      classifyWorkspaceOwnership({
        actor: { tenantId: "t1" },
        registry: seat,
        agentAssetId: "asset-seat",
      }),
    ).toEqual({
      kind: "position_owned",
      seatId: "seat-9",
      agentAssetId: "asset-seat",
    });

    const membership = storeWith({
      tenantId: "t1",
      agentAssetId: "asset-user",
      ownerType: "membership",
      ownerId: "mem-1",
    });
    const userScope = classifyWorkspaceOwnership({
      actor: { tenantId: "t1", userId: "u1", membershipId: "mem-1" },
      registry: membership,
      agentAssetId: "asset-user",
    });
    expect(userScope.kind).toBe("user_owned");
    if (userScope.kind === "user_owned") {
      expect(userScope.agentAssetId).toBe("asset-user");
      expect(userScope.proof.source).toBe("registry");
    }
  });

  it("same ids across tenants remain isolated via trusted actor tenant", () => {
    const storeA = storeWith({
      tenantId: "t-a",
      agentAssetId: "shared-looking-asset",
      legacyAgentId: "sales",
      ownerType: "seat",
      ownerId: "seat-1",
    });
    const storeB = storeWith({
      tenantId: "t-b",
      agentAssetId: "shared-looking-asset",
      legacyAgentId: "sales",
      ownerType: "seat",
      ownerId: "seat-1",
    });
    expect(
      classifyWorkspaceOwnership({
        actor: { tenantId: "t-a" },
        registry: storeA,
        agentId: "sales",
      }).kind,
    ).toBe("position_owned");
    expect(
      classifyWorkspaceOwnership({
        actor: { tenantId: "t-a" },
        registry: storeB,
        agentId: "sales",
      }).kind,
    ).toBe("unknown");
  });

  it("group_owned requires verified ACL", () => {
    expect(
      classifyWorkspaceOwnership({
        actor: { tenantId: "t1", userId: "u1" },
        registry: createEmptyAgentRegistryStore(),
        groupId: "g1",
        groupAclVerified: false,
      }),
    ).toEqual({ kind: "unknown", reason: "group_acl_unverified" });
    expect(
      classifyWorkspaceOwnership({
        actor: { tenantId: "t1", userId: "u1" },
        registry: createEmptyAgentRegistryStore(),
        groupId: "g1",
        groupAclVerified: true,
      }),
    ).toEqual({ kind: "group_owned", groupId: "g1" });
  });
});
