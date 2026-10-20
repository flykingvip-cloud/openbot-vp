import type { OpenBotConfig } from "../../config/types.js";
/**
 * U1 dark Handle producer on the existing workspace-resolver.
 * Reads authority from the Data Governance Catalog adapter.
 * Returns a complete MemoryWorkspaceHandle or structured denial.
 * Does not synthesize Catalog, add a second Resolver, or switch production writes.
 */
import {
  checkConfiguredCloudTenant,
  createMemoryWorkspaceHandle,
  type MemoryWorkspaceDenial,
  type MemoryWorkspaceLifecycle,
  type MemoryWorkspacePermissions,
  type MemoryWorkspaceResolveResult,
} from "../../memory/memory-workspace-handle.js";
import { getSharedDataGovernanceCatalog } from "../data-governance/runtime-catalog.js";
import type { CatalogRecord } from "../data-governance/types.js";
import { loadExistingGovernedWorkspaceIdentity } from "../data-governance/workspace-catalog-projection.js";
import { assertFailClosedWorkspaceIdentity } from "../data-governance/workspace-identity-fail-closed.js";
import { resolveWorkspaceResource } from "./resolve.js";
import type {
  WorkspaceBindingRecord,
  WorkspaceResolveActor,
  WorkspaceResolveDenyReason,
  WorkspaceResourceRecord,
} from "./types.js";

export type MemoryWorkspaceResolvePorts = {
  loadIdentity?: typeof loadExistingGovernedWorkspaceIdentity;
  listMemory?: (params: { stateDir?: string }) => Promise<CatalogRecord[]>;
};

export type ResolveMemoryWorkspaceHandleParams = {
  tenantId: string;
  userId: string;
  agentId: string;
  actor: WorkspaceResolveActor;
  resourceId?: string;
  expectedFencingToken?: string;
  configuredCloudTenantId?: string | null;
  stateDir?: string;
  cfg?: OpenBotConfig;
  ports?: MemoryWorkspaceResolvePorts;
};

const DARK_PERMISSIONS: MemoryWorkspacePermissions = {
  search: true,
  ingest: false,
  distill: false,
  prune: false,
  reset: false,
  export: true,
};

type MemoryWorkspaceDenyResult = Extract<MemoryWorkspaceResolveResult, { ok: false }>;

function deny(reasonCode: MemoryWorkspaceDenial, reason: string): MemoryWorkspaceDenyResult {
  return { ok: false, reasonCode, reason };
}

function isMemoryWorkspaceDeny(value: object): value is MemoryWorkspaceDenyResult {
  // Discriminant `=== false` (not `!ok`) so minted Handle results stay excluded.
  // oxlint-disable-next-line typescript/no-unnecessary-boolean-literal-compare
  return "ok" in value && value.ok === false;
}

async function defaultListMemory(params: { stateDir?: string }): Promise<CatalogRecord[]> {
  return getSharedDataGovernanceCatalog({ stateDir: params.stateDir }).list("memory");
}

function mapLifecycle(value: string | undefined): MemoryWorkspaceLifecycle | null {
  switch (value) {
    case "active":
      return "active";
    case "read_only":
      return "read_only";
    case "moving":
      return "moving";
    case "recovery_required":
      return "recovery_required";
    case "retired":
      return "retired";
    case "purged":
      return "purged";
    default:
      return null;
  }
}

function mapResolveDeny(reason: WorkspaceResolveDenyReason): MemoryWorkspaceResolveResult {
  if (reason === "tenant_mismatch") {
    return deny("tenant_mismatch", "catalog tenantId does not match actor tenantId");
  }
  if (reason === "catalog_unavailable" || reason === "resource_not_found") {
    return deny(
      "missing_workspace_resource",
      "catalog miss; do not synthesize a workspace identity",
    );
  }
  return deny("missing_binding", `workspace resolve denied: ${reason}`);
}

function ownerAgentAssetId(resource: WorkspaceResourceRecord): string | null {
  if (resource.ownerScope.kind === "user_owned" || resource.ownerScope.kind === "position_owned") {
    return resource.ownerScope.agentAssetId;
  }
  return null;
}

function isAllowedWorkspaceResource(resource: WorkspaceResourceRecord, tenantId: string): boolean {
  return (
    resource.resourceType === "workspace" &&
    resource.tenantId === tenantId &&
    ownerAgentAssetId(resource) !== null
  );
}

function resourcesForAgentAsset(
  resources: Record<string, WorkspaceResourceRecord>,
  tenantId: string,
  agentAssetId: string,
): WorkspaceResourceRecord[] {
  return Object.values(resources).filter(
    (resource) =>
      isAllowedWorkspaceResource(resource, tenantId) &&
      ownerAgentAssetId(resource) === agentAssetId,
  );
}

function uniqueActiveCanonicalBinding(
  bindings: WorkspaceBindingRecord[],
  resourceId: string,
): WorkspaceBindingRecord | MemoryWorkspaceDenyResult {
  const canonical = bindings.filter(
    (binding) =>
      binding.resourceId === resourceId &&
      binding.role === "canonical" &&
      binding.state === "active",
  );
  if (canonical.length === 0) {
    return deny("missing_binding", "workspace resource must have one active canonical binding");
  }
  if (canonical.length > 1) {
    return deny("missing_binding", "workspace resource has duplicate active canonical bindings");
  }
  return canonical[0];
}

function relatedMemoryAssets(
  records: CatalogRecord[],
  resourceId: string,
  tenantId: string,
): CatalogRecord[] {
  return records.filter((record) => {
    if (record.envelope.resourceType !== "memory") {
      return false;
    }
    if (record.envelope.tenantId !== tenantId) {
      return false;
    }
    if (record.envelope.resourceId === resourceId) {
      return false;
    }
    if (record.envelope.projection?.sourceWorkspaceResourceId !== resourceId) {
      return false;
    }
    const lifecycle = record.envelope.lifecycleState;
    return lifecycle === "active" || lifecycle === "read_only";
  });
}

function uniqueMemoryCanonicalBinding(
  record: CatalogRecord,
): CatalogRecord["bindings"][number] | MemoryWorkspaceDenyResult {
  const canonical = record.bindings.filter(
    (binding) =>
      binding.resourceId === record.envelope.resourceId &&
      binding.role === "canonical" &&
      (binding.state === "active" || binding.state === "read_only"),
  );
  if (canonical.length === 0) {
    return deny("missing_binding", "canonical memory binding is required");
  }
  if (canonical.length > 1) {
    return deny("missing_binding", "memory asset has duplicate canonical bindings");
  }
  return canonical[0];
}

function memoryOwnerMatchesWorkspace(
  record: CatalogRecord,
  resource: WorkspaceResourceRecord,
  userId: string,
): boolean {
  const owner = record.envelope.owner;
  if (resource.ownerScope.kind === "user_owned") {
    return (
      owner.kind === "user" &&
      owner.userId === resource.ownerScope.userId &&
      owner.userId === userId
    );
  }
  if (resource.ownerScope.kind === "position_owned") {
    return owner.kind === "position" && owner.seatId === resource.ownerScope.seatId;
  }
  return false;
}

export async function resolveMemoryWorkspaceHandle(
  params: ResolveMemoryWorkspaceHandleParams,
): Promise<MemoryWorkspaceResolveResult> {
  const loadIdentity = params.ports?.loadIdentity ?? loadExistingGovernedWorkspaceIdentity;
  const listMemory = params.ports?.listMemory ?? defaultListMemory;

  const identity = await loadIdentity({
    tenantId: params.tenantId,
    userId: params.userId,
    agentId: params.agentId,
    stateDir: params.stateDir,
  });
  if (!identity.catalog) {
    return deny(
      "missing_workspace_resource",
      "catalog miss; do not synthesize a workspace identity",
    );
  }
  if (!identity.agentAssetId) {
    return createMemoryWorkspaceHandle({ reasonCode: "ambiguous_agent_asset" });
  }

  const snapshot = identity.catalog.snapshot();
  const catalogRecordCount = Object.keys(snapshot.resources).length;
  const identityGate = assertFailClosedWorkspaceIdentity({
    catalogRecordCount,
    agentId: params.agentId,
    agentAssetId: identity.agentAssetId,
  });
  if (!identityGate.ok) {
    if (identityGate.reason === "agentId_is_not_agentAssetId") {
      return createMemoryWorkspaceHandle({ reasonCode: "ambiguous_agent_asset" });
    }
    return deny("missing_workspace_resource", identityGate.reason);
  }

  if (params.actor.tenantId !== params.tenantId) {
    return deny("tenant_mismatch", "actor tenantId does not match params tenantId");
  }

  const matches = resourcesForAgentAsset(
    snapshot.resources,
    params.tenantId,
    identity.agentAssetId,
  );
  let resourceId = params.resourceId;
  if (!resourceId) {
    if (matches.length === 0) {
      return deny(
        "missing_workspace_resource",
        "agentAssetId did not map to a workspace resource; do not default to resources[0]",
      );
    }
    if (matches.length > 1) {
      return createMemoryWorkspaceHandle({ reasonCode: "ambiguous_agent_asset" });
    }
    resourceId = matches[0].resourceId;
  }
  const resource = snapshot.resources[resourceId];
  if (!resource) {
    return deny("missing_workspace_resource", "catalog miss; requested resourceId is absent");
  }
  if (!isAllowedWorkspaceResource(resource, params.tenantId)) {
    return deny(
      "missing_workspace_resource",
      "resourceType/kind is not an allowed Workspace bound to this tenant",
    );
  }
  if (ownerAgentAssetId(resource) !== identity.agentAssetId) {
    return deny(
      "missing_workspace_resource",
      "workspace resource is not bound to identity.agentAssetId",
    );
  }
  const workspaceCanonical = uniqueActiveCanonicalBinding(
    Object.values(snapshot.bindings),
    resourceId,
  );
  // oxlint-disable-next-line typescript/no-unnecessary-boolean-literal-compare
  if ("ok" in workspaceCanonical && workspaceCanonical.ok === false) {
    return workspaceCanonical;
  }

  const resolved = resolveWorkspaceResource({
    catalog: identity.catalog,
    cfg: params.cfg,
    actor: params.actor,
    resourceId,
    operation: "read",
    purpose: "u1.memory-workspace-handle.dark",
  });
  if (!resolved.ok) {
    return mapResolveDeny(resolved.reason);
  }

  const memoryRecords = await listMemory({ stateDir: params.stateDir });
  const related = relatedMemoryAssets(memoryRecords, resourceId, params.tenantId);
  if (related.length === 0) {
    return deny("missing_memory_asset", "memory asset is required and must not be synthesized");
  }
  if (related.length > 1) {
    return deny(
      "missing_binding",
      "one workspace resourceId must not have multiple active memory assets",
    );
  }

  const memory = related[0];
  if (memory.envelope.resourceId === resourceId) {
    return deny(
      "missing_binding",
      "Memory Asset and workspace resource must remain distinct identities",
    );
  }
  if (!memoryOwnerMatchesWorkspace(memory, resource, params.userId)) {
    return deny("missing_binding", "memory asset owner does not match workspace owner");
  }
  const canonical = uniqueMemoryCanonicalBinding(memory);
  if (isMemoryWorkspaceDeny(canonical)) {
    return canonical;
  }

  const fencingToken = String(
    memory.envelope.lastAcceptedFencingToken ?? resource.governanceVersion,
  );
  if (params.expectedFencingToken && params.expectedFencingToken !== fencingToken) {
    return createMemoryWorkspaceHandle({ reasonCode: "stale_fencing_token" });
  }

  const lifecycle =
    mapLifecycle(memory.envelope.lifecycleState) ?? mapLifecycle(resource.lifecycleState);
  if (!lifecycle) {
    return deny("missing_binding", "lifecycle is required");
  }

  const minted = createMemoryWorkspaceHandle({
    resourceId,
    memoryAssetResourceId: memory.envelope.resourceId,
    tenantId: resource.tenantId ?? params.tenantId,
    agentAssetId: identity.agentAssetId,
    bindingId: canonical.bindingId,
    canonicalObjectKey: canonical.objectKey ?? canonical.locator,
    governanceVersion: resource.governanceVersion,
    fencingToken,
    lifecycle,
    permissions: DARK_PERMISSIONS,
  });
  if (!minted.ok) {
    return minted;
  }
  return checkConfiguredCloudTenant({
    handle: minted.handle,
    configuredTenantId: params.configuredCloudTenantId,
  });
}

export const U1_DARK_HANDLE_PERMISSIONS = DARK_PERMISSIONS;
