import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/types.js";
import { SCHEMA_V2_ENABLED } from "../../memory/schema-v2.js";
import type { EnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import type { PlatformAuthStore } from "../platform-auth/store-types.js";
import {
  buildGroupWorkspaceCatalogEntry,
  buildUserOwnedWorkspaceCatalogEntry,
} from "./builders.js";
import {
  createEmptyWorkspaceCatalog,
  InMemoryWorkspaceResourceCatalog,
  type WorkspaceResourceCatalog,
} from "./catalog.js";
import {
  denyLegacyLocatorCaller,
  ITEM7_LOCATOR_DELETE_CALL_SITES,
  ITEM7_LOCATOR_DEPLOY_AUTHORIZED,
  ITEM7_LOCATOR_EXECUTION_BLOCKED,
  ITEM7_LOCATOR_ITEM7,
  ITEM7_LOCATOR_LIVE,
  ITEM7_LOCATOR_LIVE_WRITE_WATCH_INDEX,
  ITEM7_LOCATOR_PHASE1B_UNLOCK,
  ITEM7_LOCATOR_PRODUCTION_CATALOG_WRITE,
  ITEM7_LOCATOR_RETIRED_THIS_CHANGE,
  ITEM7_LOCATOR_SCHEMA_V2_WRITE,
  ITEM7_LOCATOR_WIRED_TO_PRODUCTION,
  LEGACY_LOCATOR_CALLER_MATRIX,
  resolveWorkspaceLocator,
  type WorkspaceLocatorQueryAttempt,
} from "./strict-locator.js";
import type { WorkspaceBindingRecord, WorkspaceResourceRecord } from "./types.js";

const managedCfg = { data: { mode: "managed" as const } } satisfies OpenBotConfig;

const TENANT_A = {
  tenantId: "tenant-a",
  userId: "user-elle",
  domain: "enterprise" as const,
};

function userOwnedCatalog(params?: {
  tenantId?: string;
  userId?: string;
  agentAssetId?: string;
  locator?: string;
  extra?: { resource: WorkspaceResourceRecord; binding: WorkspaceBindingRecord };
}): InMemoryWorkspaceResourceCatalog {
  const tenantId = params?.tenantId ?? "tenant-a";
  const userId = params?.userId ?? "user-elle";
  const agentAssetId = params?.agentAssetId ?? "asset-alpha";
  const entry = buildUserOwnedWorkspaceCatalogEntry({
    tenantId,
    userId,
    agentAssetId,
    workspaceRoot: params?.locator ?? "/var/workspaces/tenant-a/asset-alpha",
  });
  const snap = createEmptyWorkspaceCatalog().snapshot();
  return new InMemoryWorkspaceResourceCatalog({
    ...snap,
    resources: {
      [entry.resource.resourceId]: entry.resource,
      ...(params?.extra ? { [params.extra.resource.resourceId]: params.extra.resource } : {}),
    },
    bindings: {
      [entry.binding.bindingId]: entry.binding,
      ...(params?.extra ? { [params.extra.binding.bindingId]: params.extra.binding } : {}),
    },
  });
}

function completeQuery(
  catalog: WorkspaceResourceCatalog,
  overrides?: Partial<WorkspaceLocatorQueryAttempt>,
): WorkspaceLocatorQueryAttempt {
  return {
    tenantContext: TENANT_A,
    tenantId: "tenant-a",
    actor: {
      userId: "user-elle",
      grant: { kind: "user", subjectId: "user-elle", purpose: "locator-contract-test" },
    },
    resourceId: "ws:tenant-a:user:user-elle:asset:asset-alpha",
    agentAssetId: "asset-alpha",
    catalog,
    cfg: managedCfg,
    ...overrides,
  };
}

function platformAuthStore(userId: string): PlatformAuthStore {
  return {
    users: {
      [userId]: {
        id: userId,
        email: `${userId}@example.com`,
        displayName: userId,
        status: "active",
        scopes: [],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    },
    memberships: {},
    enterprises: {},
    employeeProvisions: {},
  } as unknown as PlatformAuthStore;
}

function seatStore(params: {
  seatId: string;
  tenantId: string;
  currentEmployeeId: string;
}): EnterpriseSeatAssetsStore {
  return {
    version: 1,
    seats: {
      [params.seatId]: {
        seatId: params.seatId,
        tenantId: params.tenantId,
        title: "Sales",
        status: "occupied",
        currentEmployeeId: params.currentEmployeeId,
        defaultSpaceIds: [],
        defaultAgentAssetIds: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
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
  };
}

describe("strict workspace locator contract", () => {
  it("keeps Item 7 locks and does not wire production callers", () => {
    expect(ITEM7_LOCATOR_ITEM7).toBe("not-met");
    expect(ITEM7_LOCATOR_PHASE1B_UNLOCK).toBe("not-issued");
    expect(ITEM7_LOCATOR_EXECUTION_BLOCKED).toBe(true);
    expect(ITEM7_LOCATOR_DEPLOY_AUTHORIZED).toBe(false);
    expect(ITEM7_LOCATOR_PRODUCTION_CATALOG_WRITE).toBe("none");
    expect(ITEM7_LOCATOR_SCHEMA_V2_WRITE).toBe("disabled");
    expect(SCHEMA_V2_ENABLED).toBe(false);
    expect(ITEM7_LOCATOR_LIVE).toBe("forbidden");
    expect(ITEM7_LOCATOR_DELETE_CALL_SITES).toBe(false);
    expect(ITEM7_LOCATOR_WIRED_TO_PRODUCTION).toBe(false);
    expect(ITEM7_LOCATOR_LIVE_WRITE_WATCH_INDEX).toBe(36);
    expect(ITEM7_LOCATOR_RETIRED_THIS_CHANGE).toBe(1);
  });

  it("returns structured handle when TenantContext, tenant, actor/grant, resourceId, and unique canonical match", () => {
    const catalog = userOwnedCatalog();
    const result = resolveWorkspaceLocator(completeQuery(catalog));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.handle.resourceId).toBe("ws:tenant-a:user:user-elle:asset:asset-alpha");
    expect(result.handle.agentAssetId).toBe("asset-alpha");
    expect(result.handle.locator).toBe("/var/workspaces/tenant-a/asset-alpha");
    expect(result.locator.bindingId).toContain("canonical");
    expect(result.handle.locator).not.toBe("");
  });

  it("isolates tenants with the same agent slug", () => {
    const tenantA = buildUserOwnedWorkspaceCatalogEntry({
      tenantId: "tenant-a",
      userId: "user-elle",
      agentAssetId: "shared-slug",
      workspaceRoot: "/var/workspaces/tenant-a/shared-slug",
    });
    const tenantB = buildUserOwnedWorkspaceCatalogEntry({
      tenantId: "tenant-b",
      userId: "user-bob",
      agentAssetId: "shared-slug",
      workspaceRoot: "/var/workspaces/tenant-b/shared-slug",
    });
    const catalog = new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 1,
      status: "available",
      resources: {
        [tenantA.resource.resourceId]: tenantA.resource,
        [tenantB.resource.resourceId]: tenantB.resource,
      },
      bindings: {
        [tenantA.binding.bindingId]: tenantA.binding,
        [tenantB.binding.bindingId]: tenantB.binding,
      },
    });

    const allowed = resolveWorkspaceLocator(
      completeQuery(catalog, {
        resourceId: tenantA.resource.resourceId,
        agentAssetId: "shared-slug",
      }),
    );
    expect(allowed.ok).toBe(true);
    if (allowed.ok) {
      expect(allowed.handle.locator).toBe("/var/workspaces/tenant-a/shared-slug");
    }

    const stolen = resolveWorkspaceLocator(
      completeQuery(catalog, {
        resourceId: tenantB.resource.resourceId,
        agentAssetId: "shared-slug",
      }),
    );
    expect(stolen).toMatchObject({ ok: false, reasonCode: "tenant_mismatch", failClosed: true });
  });

  it("denies missing TenantContext", () => {
    const result = resolveWorkspaceLocator(
      completeQuery(userOwnedCatalog(), { tenantContext: null }),
    );
    expect(result).toMatchObject({
      ok: false,
      reasonCode: "missing_tenant_context",
      failClosed: true,
    });
  });

  it("denies optional tenantId or actor", () => {
    expect(
      resolveWorkspaceLocator(completeQuery(userOwnedCatalog(), { tenantId: null })),
    ).toMatchObject({ ok: false, reasonCode: "tenant_id_optional_forbidden" });
    expect(
      resolveWorkspaceLocator(completeQuery(userOwnedCatalog(), { actor: null })),
    ).toMatchObject({ ok: false, reasonCode: "actor_optional_forbidden" });
    expect(
      resolveWorkspaceLocator(
        completeQuery(userOwnedCatalog(), {
          actor: { userId: "user-elle", grant: null },
        }),
      ),
    ).toMatchObject({ ok: false, reasonCode: "missing_grant" });
  });

  it("emits catalog_projection_miss when grant is present but catalog is null", () => {
    expect(
      resolveWorkspaceLocator(
        completeQuery(userOwnedCatalog(), {
          catalog: null,
        }),
      ),
    ).toMatchObject({ ok: false, reasonCode: "catalog_projection_miss", failClosed: true });
  });

  it("emits missing_agent_asset when grant+catalog present but asset and resourceId absent", () => {
    const catalog = userOwnedCatalog();
    expect(
      resolveWorkspaceLocator({
        tenantContext: {
          tenantId: "tenant-a",
          userId: "user-elle",
          domain: "enterprise" as const,
        },
        tenantId: "tenant-a",
        actor: {
          userId: "user-elle",
          grant: { kind: "user" as const, subjectId: "user-elle", purpose: "read" },
        },
        catalog,
        resourceId: null,
        agentAssetId: null,
        cfg: { data: { mode: "managed" as const } },
      }),
    ).toMatchObject({ ok: false, reasonCode: "missing_agent_asset", failClosed: true });
  });

  it("denies agentId/slug-only queries", () => {
    expect(resolveWorkspaceLocator({ agentId: "main" })).toMatchObject({
      ok: false,
      reasonCode: "agent_id_slug_query_forbidden",
    });
    expect(resolveWorkspaceLocator({ slug: "shared-slug" })).toMatchObject({
      ok: false,
      reasonCode: "agent_id_slug_query_forbidden",
    });
  });

  it("denies resourceId includes/endsWith matching", () => {
    expect(
      resolveWorkspaceLocator(completeQuery(userOwnedCatalog(), { resourceIdMatch: "includes" })),
    ).toMatchObject({ ok: false, reasonCode: "resource_id_substring_match_forbidden" });
    expect(
      resolveWorkspaceLocator(completeQuery(userOwnedCatalog(), { resourceIdMatch: "endsWith" })),
    ).toMatchObject({ ok: false, reasonCode: "resource_id_substring_match_forbidden" });
  });

  it("does not resolve a suffix as if it were an exact resourceId", () => {
    const catalog = userOwnedCatalog();
    const result = resolveWorkspaceLocator(completeQuery(catalog, { resourceId: "asset-alpha" }));
    expect(result).toMatchObject({ ok: false, reasonCode: "catalog_miss", failClosed: true });
  });

  it("denies Catalog global snapshot fallback, catch-continue, and first-canonical selection", () => {
    const catalog = userOwnedCatalog();
    expect(
      resolveWorkspaceLocator(completeQuery(catalog, { fallbackToGlobalSnapshot: true })),
    ).toMatchObject({ ok: false, reasonCode: "catalog_global_snapshot_fallback_forbidden" });
    expect(resolveWorkspaceLocator(completeQuery(catalog, { catchContinue: true }))).toMatchObject({
      ok: false,
      reasonCode: "catch_continue_forbidden",
    });
    expect(
      resolveWorkspaceLocator(completeQuery(catalog, { selectFirstCanonical: true })),
    ).toMatchObject({ ok: false, reasonCode: "first_canonical_selection_forbidden" });
  });

  it("managed catalog miss/unavailable/auth failure fail closed and never return workspaceDir empty", () => {
    expect(resolveWorkspaceLocator(completeQuery(createEmptyWorkspaceCatalog()))).toMatchObject({
      ok: false,
      reasonCode: "catalog_miss",
      failClosed: true,
    });
    expect(
      resolveWorkspaceLocator(
        completeQuery(createEmptyWorkspaceCatalog(), { emptyWorkspaceDirOnMiss: true }),
      ),
    ).toMatchObject({
      ok: false,
      reasonCode: "empty_workspace_dir_forbidden",
    });

    const unavailable = new InMemoryWorkspaceResourceCatalog({
      ...userOwnedCatalog().snapshot(),
      status: "unavailable",
    });
    expect(resolveWorkspaceLocator(completeQuery(unavailable))).toMatchObject({
      ok: false,
      reasonCode: "catalog_unavailable",
      failClosed: true,
    });

    expect(
      resolveWorkspaceLocator(
        completeQuery(userOwnedCatalog(), {
          actor: {
            userId: "user-elle",
            grant: { kind: "user", subjectId: "user-intruder", purpose: "read" },
          },
        }),
      ),
    ).toMatchObject({ ok: false, reasonCode: "auth_failure", failClosed: true });
  });

  it("denies empty canonical locator instead of returning workspaceDir empty string", () => {
    const catalog = userOwnedCatalog({ locator: "   " });
    expect(resolveWorkspaceLocator(completeQuery(catalog))).toMatchObject({
      ok: false,
      reasonCode: "empty_workspace_dir_forbidden",
      failClosed: true,
    });
  });

  it("denies ambiguous assets and multiple active canonical bindings", () => {
    const first = buildUserOwnedWorkspaceCatalogEntry({
      tenantId: "tenant-a",
      userId: "user-elle",
      agentAssetId: "asset-alpha",
      workspaceRoot: "/var/workspaces/a/one",
    });
    const second = buildUserOwnedWorkspaceCatalogEntry({
      tenantId: "tenant-a",
      userId: "user-elle",
      agentAssetId: "asset-alpha",
      workspaceRoot: "/var/workspaces/a/two",
    });
    second.resource = { ...second.resource, resourceId: `${first.resource.resourceId}:dup` };
    second.binding = {
      ...second.binding,
      resourceId: second.resource.resourceId,
      bindingId: `${second.resource.resourceId}:canonical`,
    };
    const ambiguous = new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 1,
      status: "available",
      resources: {
        [first.resource.resourceId]: first.resource,
        [second.resource.resourceId]: second.resource,
      },
      bindings: {
        [first.binding.bindingId]: first.binding,
        [second.binding.bindingId]: second.binding,
      },
    });
    expect(resolveWorkspaceLocator(completeQuery(ambiguous))).toMatchObject({
      ok: false,
      reasonCode: "catalog_ambiguous",
    });

    const multi = new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 1,
      status: "available",
      resources: { [first.resource.resourceId]: first.resource },
      bindings: {
        [first.binding.bindingId]: first.binding,
        [`${first.binding.bindingId}:2`]: {
          ...first.binding,
          bindingId: `${first.binding.bindingId}:2`,
          locator: "/var/workspaces/a/other",
        },
      },
    });
    expect(resolveWorkspaceLocator(completeQuery(multi))).toMatchObject({
      ok: false,
      reasonCode: "multi_binding",
    });
  });

  it("fail-closes when catalog throws instead of catching and continuing", () => {
    const throwing: WorkspaceResourceCatalog = {
      snapshot() {
        throw new Error("catalog exploded");
      },
      getResource() {
        throw new Error("catalog exploded");
      },
      getBinding() {
        throw new Error("catalog exploded");
      },
      listBindingsForResource() {
        throw new Error("catalog exploded");
      },
    };
    expect(resolveWorkspaceLocator(completeQuery(throwing))).toMatchObject({
      ok: false,
      reasonCode: "catalog_unavailable",
      failClosed: true,
    });
  });

  it("denies LIVE, Item 7 met, call-site deletion, and watch-index rewrite", () => {
    const catalog = userOwnedCatalog();
    expect(resolveWorkspaceLocator(completeQuery(catalog, { liveCutover: true }))).toMatchObject({
      ok: false,
      reasonCode: "live_cutover_forbidden",
    });
    expect(resolveWorkspaceLocator(completeQuery(catalog, { item7Met: true }))).toMatchObject({
      ok: false,
      reasonCode: "item7_met_forbidden",
    });
    expect(
      resolveWorkspaceLocator(completeQuery(catalog, { deleteCallSites: true })),
    ).toMatchObject({
      ok: false,
      reasonCode: "delete_call_sites_forbidden",
    });
    expect(
      resolveWorkspaceLocator(completeQuery(catalog, { liveWriteWatchIndex: 0 })),
    ).toMatchObject({ ok: false, reasonCode: "rewrite_watch_index_forbidden" });
  });

  it("accepts a user grant for user_owned without treating subjectId as a seat or group", () => {
    const catalog = userOwnedCatalog();
    const result = resolveWorkspaceLocator(completeQuery(catalog));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.handle.locator).toBe("/var/workspaces/tenant-a/asset-alpha");
    }
  });

  it("accepts a seat member whose seatId is not the employee userId", () => {
    const resourceId = "ws:tenant-a:seat:seat-sales:asset:asset-seat";
    const catalog = new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 1,
      status: "available",
      resources: {
        [resourceId]: {
          resourceId,
          resourceType: "workspace",
          tenantId: "tenant-a",
          ownerScope: {
            kind: "position_owned",
            seatId: "seat-sales",
            agentAssetId: "asset-seat",
          },
          lifecycleState: "active",
          classification: "agent.workspace",
          governanceVersion: 1,
        },
      },
      bindings: {
        [`${resourceId}:canonical`]: {
          bindingId: `${resourceId}:canonical`,
          resourceId,
          role: "canonical",
          locator: "/var/workspaces/tenant-a/seat-sales",
          state: "active",
          contentVersion: "v1",
        },
      },
    });
    const result = resolveWorkspaceLocator(
      completeQuery(catalog, {
        actor: {
          userId: "user-elle",
          grant: { kind: "seat", subjectId: "seat-sales", purpose: "locator-seat" },
        },
        resourceId,
        agentAssetId: "asset-seat",
        membership: {
          source: "platform-auth",
          platformAuthStore: platformAuthStore("user-elle"),
          seatStore: seatStore({
            seatId: "seat-sales",
            tenantId: "tenant-a",
            currentEmployeeId: "user-elle",
          }),
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.handle.locator).toBe("/var/workspaces/tenant-a/seat-sales");
    }
  });

  it("accepts a seat member recorded by email rather than platform user id", () => {
    const resourceId = "ws:tenant-a:seat:seat-sales:asset:asset-seat";
    const catalog = new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 1,
      status: "available",
      resources: {
        [resourceId]: {
          resourceId,
          resourceType: "workspace",
          tenantId: "tenant-a",
          ownerScope: {
            kind: "position_owned",
            seatId: "seat-sales",
            agentAssetId: "asset-seat",
          },
          lifecycleState: "active",
          classification: "agent.workspace",
          governanceVersion: 1,
        },
      },
      bindings: {
        [`${resourceId}:canonical`]: {
          bindingId: `${resourceId}:canonical`,
          resourceId,
          role: "canonical",
          locator: "/var/workspaces/tenant-a/seat-sales",
          state: "active",
          contentVersion: "v1",
        },
      },
    });
    const result = resolveWorkspaceLocator(
      completeQuery(catalog, {
        actor: {
          userId: "user-elle",
          grant: { kind: "seat", subjectId: "seat-sales", purpose: "locator-seat" },
        },
        resourceId,
        agentAssetId: "asset-seat",
        membership: {
          source: "platform-auth",
          platformAuthStore: platformAuthStore("user-elle"),
          seatStore: seatStore({
            seatId: "seat-sales",
            tenantId: "tenant-a",
            currentEmployeeId: "Elle@Example.com",
          }),
          actorIdentities: ["user-elle", "elle@example.com"],
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.handle.locator).toBe("/var/workspaces/tenant-a/seat-sales");
    }
  });

  it("accepts agents.delete for the ownership-store manager after the seat occupant changes", () => {
    const resourceId = "ws:tenant-a:seat:seat-sales:asset:asset-seat";
    const catalog = new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 1,
      status: "available",
      resources: {
        [resourceId]: {
          resourceId,
          resourceType: "workspace",
          tenantId: "tenant-a",
          ownerScope: {
            kind: "position_owned",
            seatId: "seat-sales",
            agentAssetId: "asset-seat",
          },
          lifecycleState: "active",
          classification: "agent.workspace",
          governanceVersion: 1,
        },
      },
      bindings: {
        [`${resourceId}:canonical`]: {
          bindingId: `${resourceId}:canonical`,
          resourceId,
          role: "canonical",
          locator: "/var/workspaces/tenant-a/seat-sales",
          state: "active",
          contentVersion: "v1",
        },
      },
    });
    const allowed = resolveWorkspaceLocator(
      completeQuery(catalog, {
        actor: {
          userId: "user-elle",
          grant: { kind: "seat", subjectId: "seat-sales", purpose: "agents.delete" },
        },
        resourceId,
        agentAssetId: "asset-seat",
        membership: {
          source: "platform-auth",
          platformAuthStore: platformAuthStore("user-elle"),
          seatStore: seatStore({
            seatId: "seat-sales",
            tenantId: "tenant-a",
            currentEmployeeId: "user-other",
          }),
          durableAgentManager: {
            purpose: "agents.delete",
            actorUserId: "user-elle",
            seatId: "seat-sales",
          },
        },
      }),
    );
    expect(allowed.ok).toBe(true);
    if (allowed.ok) {
      expect(allowed.handle.locator).toBe("/var/workspaces/tenant-a/seat-sales");
    }

    const wrongActor = resolveWorkspaceLocator(
      completeQuery(catalog, {
        actor: {
          userId: "user-elle",
          grant: { kind: "seat", subjectId: "seat-sales", purpose: "agents.delete" },
        },
        resourceId,
        agentAssetId: "asset-seat",
        membership: {
          source: "platform-auth",
          platformAuthStore: platformAuthStore("user-elle"),
          seatStore: seatStore({
            seatId: "seat-sales",
            tenantId: "tenant-a",
            currentEmployeeId: "user-other",
          }),
          durableAgentManager: {
            purpose: "agents.delete",
            actorUserId: "user-other",
            seatId: "seat-sales",
          },
        },
      }),
    );
    expect(wrongActor).toMatchObject({ ok: false, reasonCode: "auth_failure", failClosed: true });

    const wrongSeat = resolveWorkspaceLocator(
      completeQuery(catalog, {
        actor: {
          userId: "user-elle",
          grant: { kind: "seat", subjectId: "seat-sales", purpose: "agents.delete" },
        },
        resourceId,
        agentAssetId: "asset-seat",
        membership: {
          source: "platform-auth",
          platformAuthStore: platformAuthStore("user-elle"),
          seatStore: seatStore({
            seatId: "seat-sales",
            tenantId: "tenant-a",
            currentEmployeeId: "user-other",
          }),
          durableAgentManager: {
            purpose: "agents.delete",
            actorUserId: "user-elle",
            seatId: "seat-other",
          },
        },
      }),
    );
    expect(wrongSeat).toMatchObject({ ok: false, reasonCode: "auth_failure", failClosed: true });
  });

  it("rejects durable manager proof when the grant purpose is not agents.delete", () => {
    const resourceId = "ws:tenant-a:seat:seat-sales:asset:asset-seat";
    const catalog = new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 1,
      status: "available",
      resources: {
        [resourceId]: {
          resourceId,
          resourceType: "workspace",
          tenantId: "tenant-a",
          ownerScope: {
            kind: "position_owned",
            seatId: "seat-sales",
            agentAssetId: "asset-seat",
          },
          lifecycleState: "active",
          classification: "agent.workspace",
          governanceVersion: 1,
        },
      },
      bindings: {
        [`${resourceId}:canonical`]: {
          bindingId: `${resourceId}:canonical`,
          resourceId,
          role: "canonical",
          locator: "/var/workspaces/tenant-a/seat-sales",
          state: "active",
          contentVersion: "v1",
        },
      },
    });
    const filesGet = resolveWorkspaceLocator(
      completeQuery(catalog, {
        actor: {
          userId: "user-elle",
          grant: { kind: "seat", subjectId: "seat-sales", purpose: "agents.files.get" },
        },
        resourceId,
        agentAssetId: "asset-seat",
        membership: {
          source: "platform-auth",
          platformAuthStore: platformAuthStore("user-elle"),
          seatStore: seatStore({
            seatId: "seat-sales",
            tenantId: "tenant-a",
            currentEmployeeId: "user-other",
          }),
          durableAgentManager: {
            purpose: "agents.delete",
            actorUserId: "user-elle",
            seatId: "seat-sales",
          },
        },
      }),
    );
    expect(filesGet).toMatchObject({ ok: false, reasonCode: "auth_failure", failClosed: true });
  });

  it("denies a seat grant when the employee is not the current seat member", () => {
    const resourceId = "ws:tenant-a:seat:seat-sales:asset:asset-seat";
    const catalog = new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 1,
      status: "available",
      resources: {
        [resourceId]: {
          resourceId,
          resourceType: "workspace",
          tenantId: "tenant-a",
          ownerScope: {
            kind: "position_owned",
            seatId: "seat-sales",
            agentAssetId: "asset-seat",
          },
          lifecycleState: "active",
          classification: "agent.workspace",
          governanceVersion: 1,
        },
      },
      bindings: {
        [`${resourceId}:canonical`]: {
          bindingId: `${resourceId}:canonical`,
          resourceId,
          role: "canonical",
          locator: "/var/workspaces/tenant-a/seat-sales",
          state: "active",
          contentVersion: "v1",
        },
      },
    });
    expect(
      resolveWorkspaceLocator(
        completeQuery(catalog, {
          actor: {
            userId: "user-elle",
            grant: { kind: "seat", subjectId: "seat-sales", purpose: "locator-seat" },
          },
          resourceId,
          agentAssetId: "asset-seat",
          membership: {
            source: "platform-auth",
            platformAuthStore: platformAuthStore("user-elle"),
            seatStore: seatStore({
              seatId: "seat-sales",
              tenantId: "tenant-a",
              currentEmployeeId: "user-other",
            }),
          },
        }),
      ),
    ).toMatchObject({ ok: false, reasonCode: "auth_failure", failClosed: true });
  });

  it("accepts a group member whose groupId is not the employee userId", () => {
    const entry = buildGroupWorkspaceCatalogEntry({
      tenantId: "tenant-a",
      groupId: "group-ops",
      workspaceRoot: "/var/workspaces/tenant-a/group-ops",
    });
    const catalog = new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 1,
      status: "available",
      resources: { [entry.resource.resourceId]: entry.resource },
      bindings: { [entry.binding.bindingId]: entry.binding },
    });
    const result = resolveWorkspaceLocator(
      completeQuery(catalog, {
        actor: {
          userId: "user-elle",
          grant: { kind: "group", subjectId: "group-ops", purpose: "locator-group" },
        },
        resourceId: entry.resource.resourceId,
        agentAssetId: undefined,
        membership: {
          source: "platform-auth",
          groupAcl: {
            tenantId: "tenant-a",
            groupId: "group-ops",
            memberUserIds: ["user-elle", "user-sam"],
            available: true,
          },
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.handle.locator).toBe("/var/workspaces/tenant-a/group-ops");
    }
  });

  it("denies a group grant when the employee is not an ACL member", () => {
    const entry = buildGroupWorkspaceCatalogEntry({
      tenantId: "tenant-a",
      groupId: "group-ops",
      workspaceRoot: "/var/workspaces/tenant-a/group-ops",
    });
    const catalog = new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 1,
      status: "available",
      resources: { [entry.resource.resourceId]: entry.resource },
      bindings: { [entry.binding.bindingId]: entry.binding },
    });
    expect(
      resolveWorkspaceLocator(
        completeQuery(catalog, {
          actor: {
            userId: "user-elle",
            grant: { kind: "group", subjectId: "group-ops", purpose: "locator-group" },
          },
          resourceId: entry.resource.resourceId,
          membership: {
            source: "platform-auth",
            groupAcl: {
              tenantId: "tenant-a",
              groupId: "group-ops",
              memberUserIds: ["user-sam"],
              available: true,
            },
          },
        }),
      ),
    ).toMatchObject({ ok: false, reasonCode: "auth_failure", failClosed: true });
  });

  it("denies cross-tenant resource access even when the grant subject matches", () => {
    const foreign = buildUserOwnedWorkspaceCatalogEntry({
      tenantId: "tenant-b",
      userId: "user-elle",
      agentAssetId: "asset-alpha",
      workspaceRoot: "/var/workspaces/tenant-b/asset-alpha",
    });
    const catalog = new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 1,
      status: "available",
      resources: { [foreign.resource.resourceId]: foreign.resource },
      bindings: { [foreign.binding.bindingId]: foreign.binding },
    });
    expect(
      resolveWorkspaceLocator(
        completeQuery(catalog, {
          resourceId: foreign.resource.resourceId,
        }),
      ),
    ).toMatchObject({ ok: false, reasonCode: "tenant_mismatch", failClosed: true });
  });

  it("isolates same-tenant same agent slug owned by different users", () => {
    const elle = buildUserOwnedWorkspaceCatalogEntry({
      tenantId: "tenant-a",
      userId: "user-elle",
      agentAssetId: "shared-slug",
      workspaceRoot: "/var/workspaces/tenant-a/elle/shared-slug",
    });
    const bob = buildUserOwnedWorkspaceCatalogEntry({
      tenantId: "tenant-a",
      userId: "user-bob",
      agentAssetId: "shared-slug",
      workspaceRoot: "/var/workspaces/tenant-a/bob/shared-slug",
    });
    const catalog = new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 1,
      status: "available",
      resources: {
        [elle.resource.resourceId]: elle.resource,
        [bob.resource.resourceId]: bob.resource,
      },
      bindings: {
        [elle.binding.bindingId]: elle.binding,
        [bob.binding.bindingId]: bob.binding,
      },
    });
    const allowed = resolveWorkspaceLocator(
      completeQuery(catalog, {
        resourceId: elle.resource.resourceId,
        agentAssetId: "shared-slug",
      }),
    );
    expect(allowed.ok).toBe(true);
    if (allowed.ok) {
      expect(allowed.handle.locator).toBe("/var/workspaces/tenant-a/elle/shared-slug");
    }
    expect(
      resolveWorkspaceLocator(
        completeQuery(catalog, {
          resourceId: bob.resource.resourceId,
          agentAssetId: "shared-slug",
        }),
      ),
    ).toMatchObject({ ok: false, reasonCode: "auth_failure", failClosed: true });
    const bobAllowed = resolveWorkspaceLocator(
      completeQuery(catalog, {
        tenantContext: { tenantId: "tenant-a", userId: "user-bob", domain: "enterprise" as const },
        actor: {
          userId: "user-bob",
          grant: { kind: "user", subjectId: "user-bob", purpose: "locator-contract-test" },
        },
        resourceId: bob.resource.resourceId,
        agentAssetId: "shared-slug",
      }),
    );
    expect(bobAllowed.ok).toBe(true);
    if (bobAllowed.ok) {
      expect(bobAllowed.handle.locator).toBe("/var/workspaces/tenant-a/bob/shared-slug");
    }
  });

  it("denies duplicate active canonical bindings", () => {
    const first = buildUserOwnedWorkspaceCatalogEntry({
      tenantId: "tenant-a",
      userId: "user-elle",
      agentAssetId: "asset-alpha",
      workspaceRoot: "/var/workspaces/a/one",
    });
    const multi = new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 1,
      status: "available",
      resources: { [first.resource.resourceId]: first.resource },
      bindings: {
        [first.binding.bindingId]: first.binding,
        [`${first.binding.bindingId}:dup`]: {
          ...first.binding,
          bindingId: `${first.binding.bindingId}:dup`,
          locator: "/var/workspaces/a/other",
        },
      },
    });
    expect(resolveWorkspaceLocator(completeQuery(multi))).toMatchObject({
      ok: false,
      reasonCode: "multi_binding",
      failClosed: true,
    });
  });

  it("denies seat and group grants when the platform-auth membership SoT is missing", () => {
    const seatResourceId = "ws:tenant-a:seat:seat-sales:asset:asset-seat";
    const seatCatalog = new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 1,
      status: "available",
      resources: {
        [seatResourceId]: {
          resourceId: seatResourceId,
          resourceType: "workspace",
          tenantId: "tenant-a",
          ownerScope: {
            kind: "position_owned",
            seatId: "seat-sales",
            agentAssetId: "asset-seat",
          },
          lifecycleState: "active",
          classification: "agent.workspace",
          governanceVersion: 1,
        },
      },
      bindings: {
        [`${seatResourceId}:canonical`]: {
          bindingId: `${seatResourceId}:canonical`,
          resourceId: seatResourceId,
          role: "canonical",
          locator: "/var/workspaces/tenant-a/seat-sales",
          state: "active",
          contentVersion: "v1",
        },
      },
    });
    expect(
      resolveWorkspaceLocator(
        completeQuery(seatCatalog, {
          actor: {
            userId: "user-elle",
            grant: { kind: "seat", subjectId: "seat-sales", purpose: "locator-seat" },
          },
          resourceId: seatResourceId,
          agentAssetId: "asset-seat",
        }),
      ),
    ).toMatchObject({ ok: false, reasonCode: "missing_membership_sot", failClosed: true });

    const group = buildGroupWorkspaceCatalogEntry({
      tenantId: "tenant-a",
      groupId: "group-ops",
      workspaceRoot: "/var/workspaces/tenant-a/group-ops",
    });
    const groupCatalog = new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 1,
      status: "available",
      resources: { [group.resource.resourceId]: group.resource },
      bindings: { [group.binding.bindingId]: group.binding },
    });
    expect(
      resolveWorkspaceLocator(
        completeQuery(groupCatalog, {
          actor: {
            userId: "user-elle",
            grant: { kind: "group", subjectId: "group-ops", purpose: "locator-group" },
          },
          resourceId: group.resource.resourceId,
        }),
      ),
    ).toMatchObject({ ok: false, reasonCode: "missing_membership_sot", failClosed: true });
  });

  it("keeps unknown ownerScope blocked and allows employee_private as user_owned classification", () => {
    const unknownId = "ws:tenant-a:unknown:empty_registry";
    const unknownCatalog = new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 1,
      status: "available",
      resources: {
        [unknownId]: {
          resourceId: unknownId,
          resourceType: "workspace",
          tenantId: "tenant-a",
          ownerScope: { kind: "unknown", reason: "empty_registry" },
          lifecycleState: "active",
          classification: "agent.workspace",
          governanceVersion: 1,
        },
      },
      bindings: {
        [`${unknownId}:canonical`]: {
          bindingId: `${unknownId}:canonical`,
          resourceId: unknownId,
          role: "canonical",
          locator: "/var/workspaces/unknown",
          state: "active",
          contentVersion: "v1",
        },
      },
    });
    expect(
      resolveWorkspaceLocator(
        completeQuery(unknownCatalog, {
          resourceId: unknownId,
          agentAssetId: "asset-alpha",
        }),
      ),
    ).toMatchObject({ ok: false, reasonCode: "workspace_kind_blocked", failClosed: true });

    const privateEntry = buildUserOwnedWorkspaceCatalogEntry({
      tenantId: "tenant-a",
      userId: "user-elle",
      agentAssetId: "steward:builtin",
      workspaceRoot: "/var/workspaces/tenant-a/employee-private",
      classification: "employee_private",
    });
    const privateCatalog = new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 1,
      status: "available",
      resources: { [privateEntry.resource.resourceId]: privateEntry.resource },
      bindings: { [privateEntry.binding.bindingId]: privateEntry.binding },
    });
    const allowed = resolveWorkspaceLocator(
      completeQuery(privateCatalog, {
        resourceId: privateEntry.resource.resourceId,
        agentAssetId: "steward:builtin",
      }),
    );
    expect(allowed.ok).toBe(true);
    if (allowed.ok) {
      expect(allowed.handle.locator).toBe("/var/workspaces/tenant-a/employee-private");
    }
  });

  it("legacy caller compatibility matrix stays denied until batched replacement PRs", () => {
    expect(LEGACY_LOCATOR_CALLER_MATRIX.length).toBeGreaterThan(0);
    for (const row of LEGACY_LOCATOR_CALLER_MATRIX) {
      const denied = denyLegacyLocatorCaller(row.shape);
      expect(denied.ok).toBe(false);
      if (!denied.ok) {
        expect(denied.reasonCode).toBe(row.expectedReasonCode);
        expect(denied.liveWriteWatchIndex).toBe(36);
        expect(denied.deleteCallSites).toBe(false);
      }
    }
  });
});
