import { describe, expect, it } from "vitest";
import { setPrimaryOwner } from "../agent-registry/ownership.js";
import { createAgentAsset } from "../agent-registry/registry.js";
import { createEmptyAgentRegistryStore } from "../agent-registry/types.js";
import type { TenantContext } from "../tenant-context.js";
import { resolveLegacyAgentAssetId } from "./classify-registry.js";
import {
  classifyWorkspaceAgentAsset,
  classifyWorkspaceGroup,
  classifyWorkspaceLegacyAgent,
} from "./classify.js";
import { UNKNOWN_OWNERSHIP_REASONS, type TrustedWorkspaceClassificationContext } from "./types.js";
import {
  gateWorkspaceWrite,
  requireProvedOwnerScopeForWrite,
  WorkspaceOwnershipRejectedError,
} from "./write-guard.js";

const NOW = "2026-08-12T00:00:00.000Z";

function trustedContext(overrides?: Partial<TenantContext>): TenantContext {
  return {
    tenantId: "tenant-a",
    userId: "user-elle",
    domain: "employee",
    ...overrides,
  };
}

function baseContext(
  overrides?: Partial<TrustedWorkspaceClassificationContext>,
): TrustedWorkspaceClassificationContext {
  return {
    trusted: trustedContext(),
    registry: createEmptyAgentRegistryStore(),
    registryStatus: "available",
    ...overrides,
  };
}

function storeWithSeatOwnedAsset(params: {
  tenantId?: string;
  legacyAgentId?: string;
  seatId?: string;
}) {
  const store = createEmptyAgentRegistryStore();
  const tenantId = params.tenantId ?? "tenant-a";
  const asset = createAgentAsset({
    store,
    enterpriseId: tenantId,
    agentSlug: "bot-a",
    displayName: "Bot A",
    nowIso: NOW,
    legacyAgentId: params.legacyAgentId,
  });
  setPrimaryOwner({
    store,
    ref: { enterpriseId: tenantId, agentAssetId: asset.agentAssetId },
    ownerType: "seat",
    ownerId: params.seatId ?? "seat-1",
    nowIso: NOW,
  });
  return { store, asset };
}

describe("workspace ownership classifier", () => {
  it("empty registry does not become user_owned", () => {
    const scope = classifyWorkspaceLegacyAgent({
      context: baseContext({ registryStatus: "empty" }),
      agentId: "main",
    });
    expect(scope).toEqual({ kind: "unknown", reason: UNKNOWN_OWNERSHIP_REASONS.EMPTY_REGISTRY });
  });

  it("registry unavailable does not become user_owned", () => {
    const scope = classifyWorkspaceAgentAsset({
      context: baseContext({ registryStatus: "unavailable" }),
      agentAssetId: "asset-1",
    });
    expect(scope.kind).toBe("unknown");
    expect(scope).toMatchObject({ reason: UNKNOWN_OWNERSHIP_REASONS.REGISTRY_UNAVAILABLE });
  });

  it("missing seat binding does not become user_owned", () => {
    const store = createEmptyAgentRegistryStore();
    const asset = createAgentAsset({
      store,
      enterpriseId: "tenant-a",
      agentSlug: "orphan",
      displayName: "Orphan",
      nowIso: NOW,
    });
    const scope = classifyWorkspaceAgentAsset({
      context: baseContext({ registry: store }),
      agentAssetId: asset.agentAssetId,
    });
    expect(scope).toMatchObject({
      kind: "unknown",
      reason: UNKNOWN_OWNERSHIP_REASONS.MISSING_PRIMARY_OWNER_BINDING,
    });
  });

  it("classifies position_owned when registry seat binding exists", () => {
    const { store, asset } = storeWithSeatOwnedAsset({ seatId: "seat-42" });
    const scope = classifyWorkspaceAgentAsset({
      context: baseContext({ registry: store }),
      agentAssetId: asset.agentAssetId,
    });
    expect(scope).toEqual({
      kind: "position_owned",
      seatId: "seat-42",
      agentAssetId: asset.agentAssetId,
    });
  });

  it("duplicate legacy agentId mapping is unknown", () => {
    const store = createEmptyAgentRegistryStore();
    createAgentAsset({
      store,
      enterpriseId: "tenant-a",
      agentSlug: "a1",
      displayName: "A1",
      nowIso: NOW,
      legacyAgentId: "main",
    });
    createAgentAsset({
      store,
      enterpriseId: "tenant-a",
      agentSlug: "a2",
      displayName: "A2",
      nowIso: NOW,
      legacyAgentId: "main",
    });
    const mapped = resolveLegacyAgentAssetId({
      store,
      tenantId: "tenant-a",
      agentId: "main",
    });
    expect(mapped).toEqual({
      kind: "unknown",
      reason: UNKNOWN_OWNERSHIP_REASONS.DUPLICATE_LEGACY_AGENT_MAPPING,
    });
  });

  it("rejects cross-tenant agentAssetId mapping", () => {
    const { store, asset } = storeWithSeatOwnedAsset({ tenantId: "tenant-b" });
    const scope = classifyWorkspaceAgentAsset({
      context: baseContext({ registry: store, trusted: trustedContext({ tenantId: "tenant-a" }) }),
      agentAssetId: asset.agentAssetId,
    });
    expect(scope).toMatchObject({
      kind: "unknown",
      reason: UNKNOWN_OWNERSHIP_REASONS.ASSET_NOT_IN_TENANT,
    });
  });

  it("caller-supplied tenant cannot override trusted tenant", () => {
    const { store, asset } = storeWithSeatOwnedAsset({});
    const scope = classifyWorkspaceAgentAsset({
      context: baseContext({
        registry: store,
        claimedTenantId: "tenant-b",
      }),
      agentAssetId: asset.agentAssetId,
    });
    expect(scope).toMatchObject({
      kind: "unknown",
      reason: UNKNOWN_OWNERSHIP_REASONS.CALLER_TENANT_MISMATCH,
    });
  });

  it("same agentAssetId across tenants remain isolated", () => {
    const store = createEmptyAgentRegistryStore();
    const sharedAssetId = "shared-asset-id";
    store.assets[sharedAssetId] = {
      agentAssetId: sharedAssetId,
      enterpriseId: "tenant-a",
      agentSlug: "shared",
      displayName: "Shared",
      status: "active",
      createdAt: NOW,
      updatedAt: NOW,
    };
    setPrimaryOwner({
      store,
      ref: { enterpriseId: "tenant-a", agentAssetId: sharedAssetId },
      ownerType: "seat",
      ownerId: "seat-a",
      nowIso: NOW,
    });

    const tenantBScope = classifyWorkspaceAgentAsset({
      context: baseContext({
        registry: store,
        trusted: trustedContext({ tenantId: "tenant-b", userId: "user-b" }),
      }),
      agentAssetId: sharedAssetId,
    });
    expect(tenantBScope).toMatchObject({
      kind: "unknown",
      reason: UNKNOWN_OWNERSHIP_REASONS.ASSET_NOT_IN_TENANT,
    });
  });

  it("classifies user_owned from explicit binding", () => {
    const { asset } = storeWithSeatOwnedAsset({});
    const scope = classifyWorkspaceAgentAsset({
      context: baseContext({
        explicitBindings: [
          {
            tenantId: "tenant-a",
            userId: "user-elle",
            agentAssetId: asset.agentAssetId,
          },
        ],
      }),
      agentAssetId: asset.agentAssetId,
    });
    expect(scope.kind).toBe("user_owned");
    if (scope.kind === "user_owned") {
      expect(scope.proof.source).toBe("explicit_binding");
      expect(scope.userId).toBe("user-elle");
    }
  });

  it("classifies group_owned when group ACL evidence is present", () => {
    const scope = classifyWorkspaceGroup({
      context: baseContext({
        groupAcl: {
          tenantId: "tenant-a",
          groupId: "group-1",
          memberUserIds: ["user-elle", "user-bob"],
          available: true,
        },
      }),
      groupId: "group-1",
    });
    expect(scope).toEqual({ kind: "group_owned", groupId: "group-1" });
  });

  it("write guard rejects unknown before filesystem work", () => {
    expect(() =>
      requireProvedOwnerScopeForWrite({
        kind: "unknown",
        reason: UNKNOWN_OWNERSHIP_REASONS.EMPTY_REGISTRY,
      }),
    ).toThrow(WorkspaceOwnershipRejectedError);

    expect(() =>
      gateWorkspaceWrite({ kind: "unknown", reason: "test" }, () => {
        throw new Error("filesystem touched");
      }),
    ).toThrow(WorkspaceOwnershipRejectedError);

    const result = gateWorkspaceWrite({ kind: "group_owned", groupId: "g1" }, () => "ok");
    expect(result).toBe("ok");
  });
});

/**
 * Classification truth table (P0-b exit evidence):
 *
 * | Evidence | Result |
 * | --- | --- |
 * | Registry unavailable | unknown |
 * | Empty registry | unknown |
 * | Legacy agent unmapped | unknown |
 * | Duplicate legacy agentId | unknown |
 * | Legacy agent quarantined | unknown |
 * | Asset missing in tenant | unknown |
 * | Missing primary owner binding | unknown |
 * | Ambiguous primary owner binding | unknown |
 * | Seat owner binding (active asset) | position_owned |
 * | Explicit user binding (trusted user) | user_owned |
 * | Valid group ACL | group_owned |
 * | Claimed tenant != trusted tenant | unknown |
 * | Claimed user != trusted user | unknown |
 */
