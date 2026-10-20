import { isManagedDataMode } from "../../config/data-space.js";
import type { OpenBotConfig } from "../../config/types.js";
import {
  assertSingleWritableCanonicalBinding,
  findActiveCutoverOperation,
  gateCutoverWrite,
  resolveCutoverWritableBindingId,
} from "../workspace-cutover/index.js";
import type { WorkspaceCutoverOperation } from "../workspace-cutover/types.js";
import { requireProvedOwnerScopeForWrite } from "../workspace-ownership/write-guard.js";
import { WorkspaceResourceAccess } from "./access.js";
import { WorkspaceResolverCache } from "./cache.js";
import type { WorkspaceResourceCatalog } from "./catalog.js";
import type {
  WorkspaceBindingRecord,
  WorkspaceCatalogStatus,
  WorkspaceResolveActor,
  WorkspaceResolveAudit,
  WorkspaceResolveDenyReason,
  WorkspaceResolveResult,
  WorkspaceResourceOperation,
  WorkspaceResourceRecord,
} from "./types.js";

export type ResolveWorkspaceResourceParams = {
  catalog: WorkspaceResourceCatalog;
  cache?: WorkspaceResolverCache;
  cfg?: OpenBotConfig;
  actor: WorkspaceResolveActor;
  resourceId: string;
  operation: WorkspaceResourceOperation;
  purpose: string;
  /** Active cutover operations; write path consults these when present. */
  cutoverOperations?: WorkspaceCutoverOperation[];
};

function principalId(actor: WorkspaceResolveActor): string {
  return `${actor.tenantId}:${actor.userId}`;
}

function deny(params: {
  reason: WorkspaceResolveDenyReason;
  audit: WorkspaceResolveAudit;
}): WorkspaceResolveResult {
  return { ok: false, reason: params.reason, audit: params.audit };
}

function allow(params: {
  resourceId: string;
  bindingId: string;
  operation: WorkspaceResourceOperation;
  purpose: string;
  audit: WorkspaceResolveAudit;
}): WorkspaceResolveResult {
  return {
    ok: true,
    resourceId: params.resourceId,
    bindingId: params.bindingId,
    operation: params.operation,
    purpose: params.purpose,
    audit: params.audit,
  };
}

function baseAudit(params: {
  cacheHit: boolean;
  governanceVersion: number;
  snapshotStatus: WorkspaceCatalogStatus;
  bindingId?: string | null;
  denyReason?: WorkspaceResolveDenyReason | null;
}): WorkspaceResolveAudit {
  return {
    cacheHit: params.cacheHit,
    governanceVersion: params.governanceVersion,
    bindingId: params.bindingId ?? null,
    denyReason: params.denyReason ?? null,
    snapshotStatus: params.snapshotStatus,
  };
}

function operationAllowed(params: {
  operation: WorkspaceResourceOperation;
  resource: WorkspaceResourceRecord;
  binding: WorkspaceBindingRecord;
}): WorkspaceResolveDenyReason | null {
  if (params.resource.lifecycleState === "retired") {
    return "lifecycle_denied";
  }
  if (params.binding.state === "retired") {
    return "lifecycle_denied";
  }
  if (params.operation === "write") {
    if (params.resource.lifecycleState === "read_only") {
      return "lifecycle_denied";
    }
    if (params.binding.state !== "active" || params.binding.role !== "canonical") {
      return "binding_not_writable";
    }
    return null;
  }
  if (
    params.operation === "preview" ||
    params.operation === "read" ||
    params.operation === "list"
  ) {
    return null;
  }
  return "operation_denied";
}

function selectBinding(
  catalog: WorkspaceResourceCatalog,
  resourceId: string,
  operation: WorkspaceResourceOperation,
  cutover?: WorkspaceCutoverOperation | null,
): WorkspaceBindingRecord | null {
  const bindings = catalog.listBindingsForResource(resourceId);
  if (bindings.length === 0) {
    return null;
  }
  if (operation === "write") {
    if (cutover) {
      const allowedId = resolveCutoverWritableBindingId(cutover);
      if (!allowedId) {
        return null;
      }
      return catalog.getBinding(allowedId);
    }
    return (
      bindings.find((binding) => binding.role === "canonical" && binding.state === "active") ?? null
    );
  }
  const canonical = bindings.find(
    (binding) => binding.role === "canonical" && binding.state !== "retired",
  );
  if (canonical) {
    return canonical;
  }
  return bindings.find((binding) => binding.state !== "retired") ?? null;
}

function gateWriteBinding(params: {
  catalog: WorkspaceResourceCatalog;
  resourceId: string;
  binding: WorkspaceBindingRecord;
  cutover?: WorkspaceCutoverOperation | null;
}): WorkspaceResolveDenyReason | null {
  const bindings = params.catalog.listBindingsForResource(params.resourceId);
  const single = assertSingleWritableCanonicalBinding(bindings, params.resourceId);
  if (!single.ok) {
    return "binding_not_writable";
  }
  if (params.cutover) {
    const gate = gateCutoverWrite({
      operation: params.cutover,
      bindingId: params.binding.bindingId,
    });
    if (!gate.ok) {
      return "binding_not_writable";
    }
  }
  return null;
}

function catalogAllowsOperation(params: {
  snapshotStatus: WorkspaceCatalogStatus;
  allowDegradedRead?: boolean;
  operation: WorkspaceResourceOperation;
  managedMode: boolean;
}): WorkspaceResolveDenyReason | null {
  if (params.snapshotStatus === "available") {
    return null;
  }
  if (!params.managedMode) {
    return "catalog_unavailable";
  }
  if (
    params.allowDegradedRead &&
    (params.operation === "read" || params.operation === "list" || params.operation === "preview")
  ) {
    return null;
  }
  return "catalog_unavailable";
}

export function resolveWorkspaceResource(
  params: ResolveWorkspaceResourceParams,
): WorkspaceResolveResult {
  const snapshot = params.catalog.snapshot();
  const managedMode = isManagedDataMode(params.cfg);
  const cache = params.cache;
  const cacheKey = cache?.buildKey({
    tenantId: params.actor.tenantId,
    principalId: principalId(params.actor),
    resourceId: params.resourceId,
    operation: params.operation,
    governanceVersion: snapshot.governanceVersion,
  });

  if (cache && cacheKey) {
    const hit = cache.get(cacheKey);
    if (hit) {
      return allow({
        resourceId: params.resourceId,
        bindingId: hit.bindingId,
        operation: params.operation,
        purpose: params.purpose,
        audit: baseAudit({
          cacheHit: true,
          governanceVersion: snapshot.governanceVersion,
          snapshotStatus: snapshot.status,
          bindingId: hit.bindingId,
        }),
      });
    }
  }

  const catalogGate = catalogAllowsOperation({
    snapshotStatus: snapshot.status,
    allowDegradedRead: snapshot.allowDegradedRead,
    operation: params.operation,
    managedMode,
  });
  if (catalogGate) {
    return deny({
      reason: catalogGate,
      audit: baseAudit({
        cacheHit: false,
        governanceVersion: snapshot.governanceVersion,
        snapshotStatus: snapshot.status,
        denyReason: catalogGate,
      }),
    });
  }

  const resource = params.catalog.getResource(params.resourceId);
  if (!resource) {
    return deny({
      reason: "resource_not_found",
      audit: baseAudit({
        cacheHit: false,
        governanceVersion: snapshot.governanceVersion,
        snapshotStatus: snapshot.status,
        denyReason: "resource_not_found",
      }),
    });
  }

  if (resource.tenantId && resource.tenantId !== params.actor.tenantId) {
    return deny({
      reason: "tenant_mismatch",
      audit: baseAudit({
        cacheHit: false,
        governanceVersion: snapshot.governanceVersion,
        snapshotStatus: snapshot.status,
        denyReason: "tenant_mismatch",
      }),
    });
  }

  if (resource.ownerScope.kind === "unknown") {
    return deny({
      reason: "unknown_ownership",
      audit: baseAudit({
        cacheHit: false,
        governanceVersion: snapshot.governanceVersion,
        snapshotStatus: snapshot.status,
        denyReason: "unknown_ownership",
      }),
    });
  }

  if (params.operation === "write") {
    try {
      requireProvedOwnerScopeForWrite(resource.ownerScope);
    } catch {
      return deny({
        reason: "unknown_ownership",
        audit: baseAudit({
          cacheHit: false,
          governanceVersion: snapshot.governanceVersion,
          snapshotStatus: snapshot.status,
          denyReason: "unknown_ownership",
        }),
      });
    }
  }

  const cutover = findActiveCutoverOperation(params.cutoverOperations, params.resourceId);

  const binding = selectBinding(params.catalog, params.resourceId, params.operation, cutover);
  if (!binding) {
    return deny({
      reason: "binding_not_found",
      audit: baseAudit({
        cacheHit: false,
        governanceVersion: snapshot.governanceVersion,
        snapshotStatus: snapshot.status,
        denyReason: "binding_not_found",
      }),
    });
  }

  if (params.operation === "write") {
    const writeGate = gateWriteBinding({
      catalog: params.catalog,
      resourceId: params.resourceId,
      binding,
      cutover,
    });
    if (writeGate) {
      return deny({
        reason: writeGate,
        audit: baseAudit({
          cacheHit: false,
          governanceVersion: snapshot.governanceVersion,
          snapshotStatus: snapshot.status,
          bindingId: binding.bindingId,
          denyReason: writeGate,
        }),
      });
    }
  }

  const opDenied = operationAllowed({
    operation: params.operation,
    resource,
    binding,
  });
  if (opDenied) {
    return deny({
      reason: opDenied,
      audit: baseAudit({
        cacheHit: false,
        governanceVersion: snapshot.governanceVersion,
        snapshotStatus: snapshot.status,
        bindingId: binding.bindingId,
        denyReason: opDenied,
      }),
    });
  }

  if (cache && cacheKey) {
    cache.set(cacheKey, { bindingId: binding.bindingId, rootPath: binding.locator });
  }

  return allow({
    resourceId: params.resourceId,
    bindingId: binding.bindingId,
    operation: params.operation,
    purpose: params.purpose,
    audit: baseAudit({
      cacheHit: false,
      governanceVersion: snapshot.governanceVersion,
      snapshotStatus: snapshot.status,
      bindingId: binding.bindingId,
    }),
  });
}

export function openWorkspaceResourceAccess(params: {
  catalog: WorkspaceResourceCatalog;
  resolved: Extract<WorkspaceResolveResult, { ok: true }>;
}): WorkspaceResourceAccess | null {
  const binding = params.catalog.getBinding(params.resolved.bindingId);
  if (!binding) {
    return null;
  }
  return new WorkspaceResourceAccess({
    resourceId: params.resolved.resourceId,
    bindingId: params.resolved.bindingId,
    operation: params.resolved.operation,
    purpose: params.resolved.purpose,
    rootPath: binding.locator,
  });
}

export function invalidateWorkspaceResourceCacheAfterWrite(
  cache: WorkspaceResolverCache,
  resourceId: string,
): void {
  cache.invalidateResource(resourceId);
}
