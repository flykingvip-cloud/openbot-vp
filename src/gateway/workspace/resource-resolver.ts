/**
 * P0-c minimal workspace Resource Resolver.
 *
 * Authorize-before-resolve. Returns constrained handles — not reusable raw paths.
 * Handlers must not concatenate tenant/user/agent/group roots themselves.
 */

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isWritableWorkspaceScope } from "./ownership-classifier.js";
import type { WorkspaceOwnerScope } from "./types.js";
import type { WorkspaceBindingRecord, WorkspaceResourceRecord } from "./types.js";

export type WorkspaceResolveOperation = "read" | "write" | "list" | "preview";

export type TrustedResolverActor = {
  tenantId: string | null;
  principalId: string;
  profile: "personal_local" | "managed_enterprise";
};

export type ResolveWorkspaceRequest = {
  actor: TrustedResolverActor;
  resourceId: string;
  operation: WorkspaceResolveOperation;
  purpose: string;
  expectedVersion?: string;
};

export type WorkspaceResolveDenyReason =
  | "resource_not_found"
  | "tenant_mismatch"
  | "unknown_ownership"
  | "lifecycle_blocks_write"
  | "lifecycle_blocks_access"
  | "compatibility_read_only"
  | "catalog_unavailable"
  | "catalog_degraded_read"
  | "stale_expected_version"
  | "operation_not_allowed";

export type WorkspaceResolveAudit = {
  resourceId: string;
  operation: WorkspaceResolveOperation;
  purpose: string;
  cacheHit: boolean;
  snapshotVersion: number;
  bindingId: string | null;
  denyReason: WorkspaceResolveDenyReason | null;
  governanceVersion: number | null;
};

export type ConstrainedWorkspaceHandle = {
  resourceId: string;
  contentVersion: string;
  allowedOperations: readonly WorkspaceResolveOperation[];
  /** Internal adapter locator — must not be treated as a public API path. */
  readonly _locator: string;
  readText?: () => Promise<string>;
  writeText?: (input: string, expectedVersion: string) => Promise<{ contentVersion: string }>;
  list?: () => Promise<string[]>;
};

export type WorkspaceResolveResult =
  | { ok: true; handle: ConstrainedWorkspaceHandle; audit: WorkspaceResolveAudit }
  | { ok: false; denyReason: WorkspaceResolveDenyReason; audit: WorkspaceResolveAudit };

type CatalogSnapshot = {
  version: number;
  resources: Map<string, WorkspaceResourceRecord>;
  bindings: Map<string, WorkspaceBindingRecord[]>;
};

type CacheEntry = {
  epoch: number;
  resource: WorkspaceResourceRecord;
  binding: WorkspaceBindingRecord;
};

export type WorkspaceCatalogStore = {
  getSnapshot(): Promise<CatalogSnapshot | null>;
  /**
   * Optional degraded snapshot for personal_local non-write ops when live catalog fails.
   * Managed writes must never use this path.
   */
  getDegradedSnapshot?(): Promise<CatalogSnapshot | null>;
  /** Invalidate after write/transfer/purge before success returns. */
  bumpEpoch(resourceId: string): void;
  currentEpoch(): number;
};

export function createMemoryWorkspaceCatalog(seed?: {
  resources?: WorkspaceResourceRecord[];
  bindings?: WorkspaceBindingRecord[];
}): WorkspaceCatalogStore & {
  upsert(resource: WorkspaceResourceRecord, bindings: WorkspaceBindingRecord[]): void;
} {
  let epoch = 1;
  const resources = new Map<string, WorkspaceResourceRecord>();
  const bindings = new Map<string, WorkspaceBindingRecord[]>();
  for (const resource of seed?.resources ?? []) {
    resources.set(resource.resourceId, resource);
  }
  for (const binding of seed?.bindings ?? []) {
    const list = bindings.get(binding.resourceId) ?? [];
    list.push(binding);
    bindings.set(binding.resourceId, list);
  }
  return {
    currentEpoch: () => epoch,
    bumpEpoch: () => {
      epoch += 1;
    },
    async getSnapshot() {
      return {
        version: epoch,
        resources: new Map(resources),
        bindings: new Map(
          [...bindings.entries()].map(([id, list]) => [id, list.map((b) => ({ ...b }))]),
        ),
      };
    },
    upsert(resource, nextBindings) {
      resources.set(resource.resourceId, resource);
      bindings.set(resource.resourceId, nextBindings);
      epoch += 1;
    },
  };
}

function cacheKey(actor: TrustedResolverActor, resourceId: string, governanceVersion: number) {
  return `${actor.tenantId ?? "local"}:${actor.principalId}:${resourceId}:${governanceVersion}`;
}

function selectBinding(
  bindings: WorkspaceBindingRecord[],
  operation: WorkspaceResolveOperation,
): WorkspaceBindingRecord | null {
  const activeCanonical = bindings.find((b) => b.role === "canonical" && b.state === "active");
  if (operation === "write") {
    return activeCanonical ?? null;
  }
  if (activeCanonical) {
    return activeCanonical;
  }
  return (
    bindings.find((b) => b.role === "compatibility" && b.state === "read_only") ??
    bindings.find((b) => b.state === "read_only") ??
    null
  );
}

export function createWorkspaceResourceResolver(params: {
  catalog: WorkspaceCatalogStore;
  /** When true, catalog miss denies managed writes with no path fallback. */
  managedFailClosed?: boolean;
  now?: () => number;
}) {
  const cache = new Map<string, CacheEntry>();
  let lastSnapshotVersion = 0;

  const invalidateIfEpochChanged = (entry: CacheEntry | undefined) => {
    if (!entry) {
      return;
    }
    if (entry.epoch !== params.catalog.currentEpoch()) {
      cache.clear();
    }
  };

  async function resolve(request: ResolveWorkspaceRequest): Promise<WorkspaceResolveResult> {
    const baseAudit = {
      resourceId: request.resourceId,
      operation: request.operation,
      purpose: request.purpose,
      cacheHit: false,
      snapshotVersion: lastSnapshotVersion,
      bindingId: null as string | null,
      denyReason: null as WorkspaceResolveDenyReason | null,
      governanceVersion: null as number | null,
    };

    let snapshot = await params.catalog.getSnapshot();
    let usedDegraded = false;
    if (!snapshot) {
      const allowDegraded =
        request.actor.profile === "personal_local" && request.operation !== "write";
      if (allowDegraded && params.catalog.getDegradedSnapshot) {
        snapshot = await params.catalog.getDegradedSnapshot();
        usedDegraded = Boolean(snapshot);
      }
    }
    if (!snapshot) {
      const denyReason: WorkspaceResolveDenyReason = "catalog_unavailable";
      if (
        request.actor.profile === "managed_enterprise" &&
        (request.operation === "write" || params.managedFailClosed !== false)
      ) {
        return {
          ok: false,
          denyReason,
          audit: { ...baseAudit, denyReason, snapshotVersion: lastSnapshotVersion },
        };
      }
      return {
        ok: false,
        denyReason,
        audit: { ...baseAudit, denyReason },
      };
    }
    // Degraded snapshot may support personal_local read only — never managed write.
    if (
      usedDegraded &&
      (request.operation === "write" || request.actor.profile === "managed_enterprise")
    ) {
      const denyReason: WorkspaceResolveDenyReason = "catalog_unavailable";
      return {
        ok: false,
        denyReason,
        audit: { ...baseAudit, denyReason, snapshotVersion: snapshot.version },
      };
    }
    lastSnapshotVersion = snapshot.version;

    const resource = snapshot.resources.get(request.resourceId);
    if (!resource) {
      return {
        ok: false,
        denyReason: "resource_not_found",
        audit: {
          ...baseAudit,
          denyReason: "resource_not_found",
          snapshotVersion: snapshot.version,
        },
      };
    }
    baseAudit.governanceVersion = resource.governanceVersion;

    // Non-active governance lifecycles are never implicitly usable from access paths.
    if (
      resource.lifecycleState === "recovery_required" ||
      resource.lifecycleState === "quarantined" ||
      resource.lifecycleState === "archived" ||
      resource.lifecycleState === "retired" ||
      resource.lifecycleState === "pending"
    ) {
      return {
        ok: false,
        denyReason: "lifecycle_blocks_access",
        audit: {
          ...baseAudit,
          denyReason: "lifecycle_blocks_access",
          snapshotVersion: snapshot.version,
          governanceVersion: resource.governanceVersion,
        },
      };
    }

    if (
      request.actor.profile === "managed_enterprise" &&
      resource.tenantId &&
      request.actor.tenantId &&
      resource.tenantId !== request.actor.tenantId
    ) {
      return {
        ok: false,
        denyReason: "tenant_mismatch",
        audit: {
          ...baseAudit,
          denyReason: "tenant_mismatch",
          snapshotVersion: snapshot.version,
          governanceVersion: resource.governanceVersion,
        },
      };
    }

    if (!isWritableWorkspaceScope(resource.ownerScope) && request.operation === "write") {
      return {
        ok: false,
        denyReason: "unknown_ownership",
        audit: {
          ...baseAudit,
          denyReason: "unknown_ownership",
          snapshotVersion: snapshot.version,
          governanceVersion: resource.governanceVersion,
        },
      };
    }
    // Also block reads of unknown in managed mode.
    if (
      !isWritableWorkspaceScope(resource.ownerScope) &&
      request.actor.profile === "managed_enterprise"
    ) {
      return {
        ok: false,
        denyReason: "unknown_ownership",
        audit: {
          ...baseAudit,
          denyReason: "unknown_ownership",
          snapshotVersion: snapshot.version,
          governanceVersion: resource.governanceVersion,
        },
      };
    }

    const key = cacheKey(request.actor, resource.resourceId, resource.governanceVersion);
    invalidateIfEpochChanged(cache.get(key));
    let cached = cache.get(key);
    let cacheHit = false;
    let binding: WorkspaceBindingRecord | null = null;
    if (cached && cached.epoch === params.catalog.currentEpoch()) {
      binding = cached.binding;
      cacheHit = true;
    } else {
      binding = selectBinding(snapshot.bindings.get(resource.resourceId) ?? [], request.operation);
      if (binding) {
        cache.set(key, { epoch: params.catalog.currentEpoch(), resource, binding });
      }
    }

    if (!binding) {
      return {
        ok: false,
        denyReason: "operation_not_allowed",
        audit: {
          ...baseAudit,
          cacheHit,
          denyReason: "operation_not_allowed",
          snapshotVersion: snapshot.version,
          governanceVersion: resource.governanceVersion,
        },
      };
    }

    if (request.operation === "write") {
      if (resource.lifecycleState !== "active" || binding.state !== "active") {
        return {
          ok: false,
          denyReason:
            binding.role === "compatibility" ? "compatibility_read_only" : "lifecycle_blocks_write",
          audit: {
            ...baseAudit,
            cacheHit,
            bindingId: binding.bindingId,
            denyReason:
              binding.role === "compatibility"
                ? "compatibility_read_only"
                : "lifecycle_blocks_write",
            snapshotVersion: snapshot.version,
            governanceVersion: resource.governanceVersion,
          },
        };
      }
    }

    const allowed: WorkspaceResolveOperation[] =
      binding.state === "active" && resource.lifecycleState === "active"
        ? ["read", "write", "list", "preview"]
        : ["read", "list", "preview"];

    if (!allowed.includes(request.operation)) {
      return {
        ok: false,
        denyReason: "operation_not_allowed",
        audit: {
          ...baseAudit,
          cacheHit,
          bindingId: binding.bindingId,
          denyReason: "operation_not_allowed",
          snapshotVersion: snapshot.version,
          governanceVersion: resource.governanceVersion,
        },
      };
    }

    const locator = binding.locator;
    const handle: ConstrainedWorkspaceHandle = {
      resourceId: resource.resourceId,
      contentVersion: binding.contentVersion,
      allowedOperations: allowed,
      _locator: locator,
      readText: async () =>
        fs.readFile(path.join(locator, ".workspace-marker"), "utf8").catch(async () => {
          // Read first text file listing as a bounded probe; handlers use list + specific reads.
          const names = await fs.readdir(locator);
          const first = names.find((name) => !name.startsWith("."));
          if (!first) {
            return "";
          }
          return fs.readFile(path.join(locator, first), "utf8");
        }),
      list: async () => fs.readdir(locator),
      writeText:
        request.operation === "write"
          ? async (input, expectedVersion) => {
              if (expectedVersion !== binding.contentVersion) {
                throw new Error("stale_expected_version");
              }
              await fs.mkdir(locator, { recursive: true });
              const target = path.join(locator, "workspace-write.txt");
              await fs.writeFile(target, input, "utf8");
              const nextVersion = createHash("sha256").update(input).digest("hex");
              binding.contentVersion = nextVersion;
              params.catalog.bumpEpoch(resource.resourceId);
              cache.clear();
              return { contentVersion: nextVersion };
            }
          : undefined,
    };

    return {
      ok: true,
      handle,
      audit: {
        ...baseAudit,
        cacheHit,
        bindingId: binding.bindingId,
        snapshotVersion: snapshot.version,
        governanceVersion: resource.governanceVersion,
        denyReason: null,
      },
    };
  }

  return { resolve };
}

export function buildWorkspaceResourceId(params: {
  tenantId: string | null;
  ownerScope: WorkspaceOwnerScope;
}): string {
  const scopeKey =
    params.ownerScope.kind === "user_owned"
      ? `user:${params.ownerScope.userId}:${params.ownerScope.agentAssetId}`
      : params.ownerScope.kind === "position_owned"
        ? `position:${params.ownerScope.seatId}:${params.ownerScope.agentAssetId}`
        : params.ownerScope.kind === "group_owned"
          ? `group:${params.ownerScope.groupId}`
          : `unknown:${params.ownerScope.reason}`;
  return createHash("sha256")
    .update(`${params.tenantId ?? "local"}:${scopeKey}`)
    .digest("hex")
    .slice(0, 32);
}

export function createWorkspaceBinding(params: {
  resourceId: string;
  locator: string;
  role?: WorkspaceBindingRecord["role"];
  state?: WorkspaceBindingRecord["state"];
  contentVersion?: string;
}): WorkspaceBindingRecord {
  return {
    bindingId: randomUUID(),
    resourceId: params.resourceId,
    role: params.role ?? "canonical",
    locator: params.locator,
    state: params.state ?? "active",
    contentVersion: params.contentVersion ?? "0",
  };
}
