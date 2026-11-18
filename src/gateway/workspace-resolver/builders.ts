import type { WorkspaceOwnerScope } from "../workspace-ownership/types.js";
import { InMemoryWorkspaceResourceCatalog, type WorkspaceResourceCatalog } from "./catalog.js";
import type { WorkspaceBindingRecord, WorkspaceResourceRecord } from "./types.js";

export function buildWorkspaceResourceId(params: {
  tenantId: string;
  scope: WorkspaceOwnerScope;
}): string {
  switch (params.scope.kind) {
    case "group_owned":
      return `ws:${params.tenantId}:group:${params.scope.groupId}`;
    case "user_owned":
      return `ws:${params.tenantId}:user:${params.scope.userId}:asset:${params.scope.agentAssetId}`;
    case "position_owned":
      return `ws:${params.tenantId}:seat:${params.scope.seatId}:asset:${params.scope.agentAssetId}`;
    case "unknown":
      return `ws:${params.tenantId}:unknown:${params.scope.reason}`;
  }
}

/** Official builtin-steward catalog id. Do not invent a short `:steward` alias. */
export const STEWARD_BUILTIN_AGENT_ASSET_ID = "steward:builtin" as const;

export function buildBuiltinStewardWorkspaceResourceId(params: {
  tenantId: string;
  userId: string;
}): string {
  return buildWorkspaceResourceId({
    tenantId: params.tenantId,
    scope: {
      kind: "user_owned",
      userId: params.userId,
      agentAssetId: STEWARD_BUILTIN_AGENT_ASSET_ID,
      proof: {
        source: "explicit_binding",
        ownerType: "user",
        ownerId: params.userId,
        agentAssetId: STEWARD_BUILTIN_AGENT_ASSET_ID,
      },
    },
  });
}

export function buildGroupWorkspaceCatalogEntry(params: {
  tenantId: string;
  groupId: string;
  workspaceRoot: string;
  governanceVersion?: number;
}): { resource: WorkspaceResourceRecord; binding: WorkspaceBindingRecord } {
  const ownerScope: WorkspaceOwnerScope = { kind: "group_owned", groupId: params.groupId };
  const resourceId = buildWorkspaceResourceId({ tenantId: params.tenantId, scope: ownerScope });
  return {
    resource: {
      resourceId,
      resourceType: "workspace",
      tenantId: params.tenantId,
      ownerScope,
      lifecycleState: "active",
      classification: "collaboration.group.workspace",
      governanceVersion: params.governanceVersion ?? 1,
    },
    binding: {
      bindingId: `${resourceId}:canonical`,
      resourceId,
      role: "canonical",
      locator: params.workspaceRoot,
      state: "active",
      contentVersion: "v1",
    },
  };
}

export function buildUserOwnedWorkspaceCatalogEntry(params: {
  tenantId: string;
  userId: string;
  agentAssetId: string;
  workspaceRoot: string;
  classification?: string;
  governanceVersion?: number;
}): { resource: WorkspaceResourceRecord; binding: WorkspaceBindingRecord } {
  const ownerScope: WorkspaceOwnerScope = {
    kind: "user_owned",
    userId: params.userId,
    agentAssetId: params.agentAssetId,
    proof: {
      source: "explicit_binding",
      ownerType: "user",
      ownerId: params.userId,
      agentAssetId: params.agentAssetId,
    },
  };
  const resourceId = buildWorkspaceResourceId({ tenantId: params.tenantId, scope: ownerScope });
  return {
    resource: {
      resourceId,
      resourceType: "workspace",
      tenantId: params.tenantId,
      ownerScope,
      lifecycleState: "active",
      classification: params.classification ?? "agent.workspace",
      governanceVersion: params.governanceVersion ?? 1,
    },
    binding: {
      bindingId: `${resourceId}:canonical`,
      resourceId,
      role: "canonical",
      locator: params.workspaceRoot,
      state: "active",
      contentVersion: "v1",
    },
  };
}

/** Phase 1 A_employee steward: legacy source + D1e target bindings (one writer via cutover). */
export function buildEmployeeStewardCutoverCatalogEntries(params: {
  catalog?: WorkspaceResourceCatalog;
  tenantId: string;
  userId: string;
  sourceRoot: string;
  targetRoot: string;
  agentAssetId?: string;
  governanceVersion?: number;
  contentVersion?: string;
}): {
  resource: WorkspaceResourceRecord;
  sourceBinding: WorkspaceBindingRecord;
  targetBinding: WorkspaceBindingRecord;
} {
  const tenantId = params.tenantId.trim();
  const userId = params.userId.trim();
  const agentAssetId = (params.agentAssetId ?? "steward:builtin").trim();
  if (!tenantId || !userId || !agentAssetId) {
    throw new Error(
      !tenantId ? "tenant_id_required" : !userId ? "user_id_required" : "agent_asset_id_required",
    );
  }
  const ownerScope: WorkspaceOwnerScope = {
    kind: "user_owned",
    userId,
    agentAssetId,
    proof: {
      source: "explicit_binding",
      ownerType: "user",
      ownerId: userId,
      agentAssetId,
    },
  };
  const resourceId = buildWorkspaceResourceId({ tenantId, scope: ownerScope });
  void import("./item7-w3-shadow.js").then(({ scheduleItem7W3CatalogSynthesisShadow }) =>
    scheduleItem7W3CatalogSynthesisShadow({
      ledgerId: "S21",
      existingResourceId: resourceId,
    }),
  );
  // Read existing Catalog SoT only. Do not call user-owned synthesis. Do not mint a production row.
  const catalog =
    params.catalog ??
    new InMemoryWorkspaceResourceCatalog({
      governanceVersion: params.governanceVersion ?? 1,
      status: "available",
      resources: {
        [resourceId]: {
          resourceId,
          resourceType: "workspace",
          tenantId,
          ownerScope,
          lifecycleState: "active",
          classification: "employee.steward.workspace",
          governanceVersion: params.governanceVersion ?? 1,
        },
      },
      bindings: {},
    });
  const resource = catalog.getResource(resourceId);
  if (!resource) {
    throw new Error("catalog_record_required");
  }
  if (resource.tenantId !== tenantId) {
    throw new Error("tenant_mismatch");
  }
  const contentVersion = params.contentVersion ?? "v1";
  const sourceBinding: WorkspaceBindingRecord = {
    bindingId: `${resource.resourceId}:canonical:legacy`,
    resourceId: resource.resourceId,
    locator: params.sourceRoot,
    role: "canonical",
    state: "active",
    contentVersion,
  };
  const targetBinding: WorkspaceBindingRecord = {
    bindingId: `${resource.resourceId}:canonical`,
    resourceId: resource.resourceId,
    locator: params.targetRoot,
    role: "compatibility",
    state: "read_only",
    contentVersion,
  };
  return {
    resource,
    sourceBinding,
    targetBinding,
  };
}

export function buildLocalFolderIndexCatalogEntry(params: {
  tenantId: string;
  userId: string;
  bindingId: string;
  workspaceRoot: string;
  governanceVersion?: number;
}): { resource: WorkspaceResourceRecord; binding: WorkspaceBindingRecord } {
  const agentAssetId = `local-folder:${params.bindingId}`;
  const ownerScope: WorkspaceOwnerScope = {
    kind: "user_owned",
    userId: params.userId,
    agentAssetId,
    proof: {
      source: "explicit_binding",
      ownerType: "user",
      ownerId: params.userId,
      agentAssetId,
    },
  };
  const resourceId = buildWorkspaceResourceId({ tenantId: params.tenantId, scope: ownerScope });
  return {
    resource: {
      resourceId,
      resourceType: "workspace",
      tenantId: params.tenantId,
      ownerScope,
      lifecycleState: "active",
      classification: "knowledge.local_index.folder",
      governanceVersion: params.governanceVersion ?? 1,
    },
    binding: {
      bindingId: `${resourceId}:canonical`,
      resourceId,
      role: "canonical",
      locator: params.workspaceRoot,
      state: "active",
      contentVersion: "v1",
    },
  };
}
