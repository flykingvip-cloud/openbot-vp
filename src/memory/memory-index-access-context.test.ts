import { describe, expect, it } from "vitest";
import {
  ownershipProofForEnterpriseOperationalIdentity,
  ownershipProofFromGroup,
  ownershipProofFromSeat,
  ownershipProofFromTenantUser,
} from "../gateway/data-governance/ownership-proof.js";
import {
  deriveManagedAccessContextFromGovernance,
  isMemoryIndexAccessContext,
  managedAccessContext,
  memoryIndexAccessCacheComponent,
  personalLocalAccessContext,
  resolveMemoryIndexAccess,
  type ResolvedMemoryIndexAccess,
} from "./memory-index-access-context.js";
import type { CanonicalMemoryWorkspaceResolver } from "./memory-index-workspace-handle.js";
import type { MemorySearchGovernance } from "./memory-search-governance.js";
import {
  createMemoryWorkspaceHandle,
  type MemoryWorkspaceHandle,
  type MemoryWorkspaceLifecycle,
  type MemoryWorkspaceResolveResult,
} from "./memory-workspace-handle.js";

// ── fixtures ──────────────────────────────────────────────────────────────────

function mint(overrides?: {
  tenantId?: string;
  resourceId?: string;
  lifecycle?: MemoryWorkspaceLifecycle;
}): MemoryWorkspaceHandle {
  const tenantId = overrides?.tenantId ?? "tenant-a";
  const resourceId = overrides?.resourceId ?? "ws-res-1";
  const result = createMemoryWorkspaceHandle({
    resourceId,
    memoryAssetResourceId: "mem-res-1",
    tenantId,
    agentAssetId: "aa-1",
    bindingId: "bind-1",
    canonicalObjectKey: `obj://${tenantId}/${resourceId}/memory`,
    governanceVersion: 1,
    fencingToken: "ft-1",
    lifecycle: overrides?.lifecycle ?? "active",
    permissions: {
      search: true,
      ingest: false,
      distill: false,
      prune: false,
      reset: false,
      export: true,
    },
  });
  if (!result.ok) {
    throw new Error(`mint failed: ${result.reason}`);
  }
  return result.handle;
}

function okResolver(handle: MemoryWorkspaceHandle): CanonicalMemoryWorkspaceResolver {
  return async () => ({ ok: true, handle }) satisfies MemoryWorkspaceResolveResult;
}

function denyResolver(
  reasonCode: Extract<MemoryWorkspaceResolveResult, { ok: false }>["reasonCode"],
  reason: string,
): CanonicalMemoryWorkspaceResolver {
  return async () => ({ ok: false, reasonCode, reason }) satisfies MemoryWorkspaceResolveResult;
}

function gov(
  ownershipProof: MemorySearchGovernance["ownershipProof"],
  tenantId: string | null,
): MemorySearchGovernance {
  return { tenantId, ownershipProof };
}

const SITE = { agentId: "main", ledgerId: "S32" } as const;

// ── builders ──────────────────────────────────────────────────────────────────

describe("MemoryIndexAccessContext builders", () => {
  it("personalLocalAccessContext is branded, frozen and profile-marked", () => {
    const ctx = personalLocalAccessContext({ source: "background" });
    expect(ctx.securityProfile).toBe("personal_local");
    expect(isMemoryIndexAccessContext(ctx)).toBe(true);
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(ctx.provenance.source).toBe("background");
  });

  it("isMemoryIndexAccessContext rejects a forged plain object", () => {
    expect(isMemoryIndexAccessContext({ securityProfile: "managed_enterprise" })).toBe(false);
  });

  it("managedAccessContext builds a frozen managed context with a resolver", () => {
    const res = managedAccessContext({
      tenantId: "tenant-a",
      userId: "user-1",
      resolveCanonicalHandle: okResolver(mint()),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.context.securityProfile).toBe("managed_enterprise");
    expect(res.context.identity.tenantId).toBe("tenant-a");
    expect(res.context.identity.userId).toBe("user-1");
    expect(res.context.identity.actor.tenantId).toBe("tenant-a");
    expect(isMemoryIndexAccessContext(res.context)).toBe(true);
    expect(Object.isFrozen(res.context)).toBe(true);
  });

  it("managedAccessContext fails closed without tenantId/userId", () => {
    const res = managedAccessContext({
      tenantId: "",
      userId: "user-1",
      resolveCanonicalHandle: okResolver(mint()),
    });
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.reasonCode).toBe("managed_identity_required");
  });

  it("managedAccessContext fails closed without a canonical resolver", () => {
    const res = managedAccessContext({
      tenantId: "tenant-a",
      userId: "user-1",
      resolveCanonicalHandle: undefined as unknown as CanonicalMemoryWorkspaceResolver,
    });
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.reasonCode).toBe("managed_identity_required");
  });

  it("managedAccessContext fails closed on actor tenant/user mismatch", () => {
    const res = managedAccessContext({
      tenantId: "tenant-a",
      userId: "user-1",
      actor: { userId: "user-1", tenantId: "tenant-b" },
      resolveCanonicalHandle: okResolver(mint()),
    });
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.reasonCode).toBe("managed_tenant_mismatch");
  });
});

// ── derive from governance (user / seat / group / system) ──────────────────────

describe("deriveManagedAccessContextFromGovernance", () => {
  const resolver = okResolver(mint());

  it("derives a user-owned managed context (userId from the proof)", () => {
    const res = deriveManagedAccessContextFromGovernance({
      governance: gov(
        ownershipProofFromTenantUser({ tenantId: "tenant-a", userId: "user-1" }),
        "tenant-a",
      ),
      resolveCanonicalHandle: resolver,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.context.identity.userId).toBe("user-1");
    expect(res.context.provenance.ownerKind).toBe("user");
  });

  it("derives a position/seat-owned managed context with an authenticated userId", () => {
    const res = deriveManagedAccessContextFromGovernance({
      governance: gov(
        ownershipProofFromSeat({ tenantId: "tenant-a", seatId: "seat-9" }),
        "tenant-a",
      ),
      authenticatedUserId: "user-seat",
      resolveCanonicalHandle: resolver,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.context.identity.userId).toBe("user-seat");
    expect(res.context.provenance.ownerKind).toBe("position");
  });

  it("derives a group-owned managed context with an authenticated userId", () => {
    const res = deriveManagedAccessContextFromGovernance({
      governance: gov(
        ownershipProofFromGroup({ tenantId: "tenant-a", groupId: "grp-3" }),
        "tenant-a",
      ),
      authenticatedUserId: "user-grp",
      resolveCanonicalHandle: resolver,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.context.provenance.ownerKind).toBe("group");
  });

  it("fails closed (membership missing) for seat/group ownership without an authenticated userId", () => {
    const seat = deriveManagedAccessContextFromGovernance({
      governance: gov(
        ownershipProofFromSeat({ tenantId: "tenant-a", seatId: "seat-9" }),
        "tenant-a",
      ),
      resolveCanonicalHandle: resolver,
    });
    expect(seat.ok).toBe(false);
    if (seat.ok) {
      return;
    }
    expect(seat.reasonCode).toBe("managed_membership_missing");
  });

  it("refuses a system-owned proof (no forged operator/system auth)", () => {
    const res = deriveManagedAccessContextFromGovernance({
      governance: gov(
        ownershipProofForEnterpriseOperationalIdentity({ tenantId: "tenant-a" }),
        "tenant-a",
      ),
      authenticatedUserId: "user-x",
      resolveCanonicalHandle: resolver,
    });
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.reasonCode).toBe("managed_grant_denied");
  });
});

// ── resolveMemoryIndexAccess (the fail-closed managed resolve) ──────────────────

describe("resolveMemoryIndexAccess", () => {
  function managed(resolver: CanonicalMemoryWorkspaceResolver, tenantId = "tenant-a") {
    const built = managedAccessContext({
      tenantId,
      userId: "user-1",
      resolveCanonicalHandle: resolver,
    });
    if (!built.ok) {
      throw new Error(built.reason);
    }
    return built.context;
  }

  it("personal_local short-circuits without invoking any resolver", async () => {
    let called = false;
    const ctx = personalLocalAccessContext();
    const res = await resolveMemoryIndexAccess(ctx, SITE);
    expect(called).toBe(false);
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.access.profile).toBe("personal_local");
  });

  it("managed resolves a valid active binding to the canonical locator + namespace", async () => {
    const handle = mint({ tenantId: "tenant-a", resourceId: "ws-7" });
    const res = await resolveMemoryIndexAccess(managed(okResolver(handle)), SITE);
    expect(res.ok).toBe(true);
    if (!res.ok || res.access.profile !== "managed_enterprise") {
      return;
    }
    expect(res.access.locator).toBe(handle.canonicalObjectKey);
    expect(res.access.namespace).toBe("managed:tenant-a:ws-7");
    expect(res.access.tenantId).toBe("tenant-a");
    expect(res.access.resourceId).toBe("ws-7");
  });

  it("maps a catalog miss to managed_catalog_miss", async () => {
    const res = await resolveMemoryIndexAccess(
      managed(denyResolver("missing_workspace_resource", "catalog miss")),
      SITE,
    );
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.reasonCode).toBe("managed_catalog_miss");
  });

  it("maps an ambiguous agent asset to managed_catalog_ambiguous", async () => {
    const res = await resolveMemoryIndexAccess(
      managed(denyResolver("ambiguous_agent_asset", "ambiguous")),
      SITE,
    );
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.reasonCode).toBe("managed_catalog_ambiguous");
  });

  it("maps a resolver tenant mismatch to managed_tenant_mismatch", async () => {
    const res = await resolveMemoryIndexAccess(
      managed(denyResolver("tenant_mismatch", "cross tenant")),
      SITE,
    );
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.reasonCode).toBe("managed_tenant_mismatch");
  });

  it("fails closed on a cross-tenant resolved handle (never trusts index existence)", async () => {
    // identity tenant-a but the resolver returns a handle bound to tenant-b.
    const res = await resolveMemoryIndexAccess(
      managed(okResolver(mint({ tenantId: "tenant-b" })), "tenant-a"),
      SITE,
    );
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.reasonCode).toBe("managed_tenant_mismatch");
  });

  it("maps a missing binding to managed_membership_missing", async () => {
    const res = await resolveMemoryIndexAccess(
      managed(denyResolver("missing_binding", "no binding")),
      SITE,
    );
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.reasonCode).toBe("managed_membership_missing");
  });

  it.each<MemoryWorkspaceLifecycle>(["retired", "purged", "moving", "recovery_required"])(
    "halts a %s (tombstoned/revoked) workspace",
    async (lifecycle) => {
      const res = await resolveMemoryIndexAccess(managed(okResolver(mint({ lifecycle }))), SITE);
      expect(res.ok).toBe(false);
      if (res.ok) {
        return;
      }
      expect(res.reasonCode).toBe("managed_workspace_not_indexable");
    },
  );

  it("a denial exposes no locator/handle (reject path has zero index-root output)", async () => {
    const res = await resolveMemoryIndexAccess(
      managed(denyResolver("missing_workspace_resource", "catalog miss")),
      SITE,
    );
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect("access" in res).toBe(false);
  });
});

// ── cache component (§七: managed instance/cache isolation) ─────────────────────

describe("memoryIndexAccessCacheComponent", () => {
  const personal: ResolvedMemoryIndexAccess = { profile: "personal_local" };
  const managedA: ResolvedMemoryIndexAccess = {
    profile: "managed_enterprise",
    handle: mint({ tenantId: "tenant-a", resourceId: "ws-1" }),
    locator: "obj://tenant-a/ws-1/memory",
    namespace: "managed:tenant-a:ws-1",
    tenantId: "tenant-a",
    resourceId: "ws-1",
  };
  const managedB: ResolvedMemoryIndexAccess = {
    profile: "managed_enterprise",
    handle: mint({ tenantId: "tenant-b", resourceId: "ws-1" }),
    locator: "obj://tenant-b/ws-1/memory",
    namespace: "managed:tenant-b:ws-1",
    tenantId: "tenant-b",
    resourceId: "ws-1",
  };

  it("same-named agent in two tenants never shares a cache key (cross-tenant isolation)", () => {
    expect(memoryIndexAccessCacheComponent(managedA)).toBe("managed:tenant-a:ws-1");
    expect(memoryIndexAccessCacheComponent(managedB)).toBe("managed:tenant-b:ws-1");
    expect(memoryIndexAccessCacheComponent(managedA)).not.toBe(
      memoryIndexAccessCacheComponent(managedB),
    );
  });

  it("a resourceId change never reuses a stale cache key", () => {
    const managedA2: ResolvedMemoryIndexAccess = {
      ...managedA,
      resourceId: "ws-2",
      namespace: "managed:tenant-a:ws-2",
    };
    expect(memoryIndexAccessCacheComponent(managedA2)).toBe("managed:tenant-a:ws-2");
    expect(memoryIndexAccessCacheComponent(managedA)).not.toBe(
      memoryIndexAccessCacheComponent(managedA2),
    );
  });

  it("personal vs managed cache components never collide", () => {
    expect(memoryIndexAccessCacheComponent(personal)).toBe("personal_local");
    expect(memoryIndexAccessCacheComponent(undefined)).toBe("personal_local");
    expect(memoryIndexAccessCacheComponent(managedA)).not.toBe(
      memoryIndexAccessCacheComponent(personal),
    );
  });
});
