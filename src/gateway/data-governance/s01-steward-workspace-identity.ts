/**
 * S01 Stage A: read-only steward workspace identity resolver.
 *
 * Catalog (WorkspaceResourceCatalog) is the only SoT. Does not create
 * workspace_handles / authorized_cwds / tenant_memberships tables.
 * Not imported by get-reply.ts. Does not import the non-production contract.
 */
import { buildWorkspaceResourceId } from "../workspace-resolver/builders.js";
import type { WorkspaceResourceCatalog } from "../workspace-resolver/catalog.js";
import type {
  WorkspaceBindingRecord,
  WorkspaceResourceRecord,
} from "../workspace-resolver/types.js";

export const S01_STEWARD_SLUG = "main" as const;

export type S01IdentityErrorCode =
  | "ERR_PRINCIPAL_REQUIRED"
  | "ERR_WORKSPACE_NOT_FOUND"
  | "ERR_TENANT_MISMATCH"
  | "ERR_CATALOG_UNAVAILABLE"
  | "ERR_BINDING_NOT_CANONICAL"
  | "ERR_WORKSPACE_ARCHIVED"
  | "ERR_WORKSPACE_OWNER_DENIED"
  | "ERR_INVALID_PATH";

export type S01TargetIdentity = {
  tenantId: string;
  employeeOwnerId: string;
  agentAssetId: string;
  workspaceResourceId: string;
  expectedBindingRole: "canonical";
  expectedBindingState: "active";
  governanceVersion: number;
  contentVersion: string;
  fencingToken: { contentVersion: string; bindingId: string };
};

export type S01StewardRegistryPort = {
  resolveUniqueAgentAssetId(input: { tenantId: string; agentId: string }): string | null;
};

export type S01WireIdentityProbe = {
  tenantId?: string;
  ownerId?: string;
  resourceId?: string;
  principal?: unknown;
  executedBy?: unknown;
};

export type ResolveS01StewardWorkspaceIdentityInput = {
  tenantId: string;
  employeeOwnerId: string;
  stewardAgentId: string;
  registry: S01StewardRegistryPort;
  catalog: WorkspaceResourceCatalog;
  expectedFencing?: { contentVersion: string; bindingId: string };
  wireIdentity?: S01WireIdentityProbe;
};

export type ResolveS01StewardWorkspaceIdentityResult =
  | {
      ok: true;
      targetIdentity: S01TargetIdentity;
      locator: string;
      resource: WorkspaceResourceRecord;
      binding: WorkspaceBindingRecord;
    }
  | {
      ok: false;
      code: S01IdentityErrorCode;
      message: string;
      failClosed: true;
    };

function fail(
  code: S01IdentityErrorCode,
  message: string,
): Extract<ResolveS01StewardWorkspaceIdentityResult, { ok: false }> {
  return { ok: false, code, message, failClosed: true };
}

function wireIdentityPresent(probe: S01WireIdentityProbe | undefined): boolean {
  if (!probe) {
    return false;
  }
  const strings = [probe.tenantId, probe.ownerId, probe.resourceId];
  if (strings.some((value) => typeof value === "string" && value.length > 0)) {
    return true;
  }
  return probe.principal != null || probe.executedBy != null;
}

export function createInMemoryS01StewardRegistryPort(
  rows: ReadonlyArray<{ tenantId: string; agentId: string; agentAssetId: string }>,
): S01StewardRegistryPort {
  return {
    resolveUniqueAgentAssetId(input) {
      const matches = rows.filter(
        (row) => row.tenantId === input.tenantId && row.agentId === input.agentId,
      );
      return matches.length === 1 ? (matches[0]?.agentAssetId ?? null) : null;
    },
  };
}

export function resolveS01StewardWorkspaceIdentity(
  input: ResolveS01StewardWorkspaceIdentityInput,
): ResolveS01StewardWorkspaceIdentityResult {
  if (wireIdentityPresent(input.wireIdentity)) {
    return fail("ERR_PRINCIPAL_REQUIRED", "Wire identity fields are not trusted");
  }
  const tenantId = input.tenantId.trim();
  const employeeOwnerId = input.employeeOwnerId.trim();
  const stewardAgentId = input.stewardAgentId.trim();
  if (!tenantId || !employeeOwnerId || !stewardAgentId) {
    return fail("ERR_PRINCIPAL_REQUIRED", "Trusted tenant, owner, and steward slug are required");
  }
  if (typeof input.registry?.resolveUniqueAgentAssetId !== "function") {
    return fail("ERR_WORKSPACE_NOT_FOUND", "Registry port missing or ambiguous");
  }

  const agentAssetId = input.registry.resolveUniqueAgentAssetId({
    tenantId,
    agentId: stewardAgentId,
  });
  if (!agentAssetId) {
    return fail("ERR_WORKSPACE_NOT_FOUND", "Registry steward asset missing or ambiguous");
  }
  if (agentAssetId === stewardAgentId) {
    return fail("ERR_WORKSPACE_NOT_FOUND", "agentId slug must not be used as agentAssetId");
  }

  const snapshot = input.catalog.snapshot();
  if (snapshot.status === "unavailable") {
    return fail("ERR_CATALOG_UNAVAILABLE", "Catalog snapshot unavailable");
  }

  const workspaceResourceId = buildWorkspaceResourceId({
    tenantId,
    scope: {
      kind: "user_owned",
      userId: employeeOwnerId,
      agentAssetId,
      proof: {
        source: "explicit_binding",
        ownerType: "user",
        ownerId: employeeOwnerId,
        agentAssetId,
      },
    },
  });

  const resource = input.catalog.getResource(workspaceResourceId);
  if (!resource || resource.resourceType !== "workspace") {
    return fail("ERR_WORKSPACE_NOT_FOUND", "Catalog workspace resource missing");
  }
  if (resource.tenantId !== tenantId) {
    return fail("ERR_TENANT_MISMATCH", "Workspace tenant does not match trusted tenant");
  }
  if (resource.lifecycleState === "retired") {
    return fail("ERR_WORKSPACE_ARCHIVED", "Workspace resource is retired");
  }
  if (resource.ownerScope.kind !== "user_owned" || resource.ownerScope.userId !== employeeOwnerId) {
    return fail("ERR_WORKSPACE_OWNER_DENIED", "Workspace ownership does not match employee owner");
  }
  if (resource.ownerScope.agentAssetId !== agentAssetId) {
    return fail("ERR_WORKSPACE_OWNER_DENIED", "Workspace agentAssetId does not match Registry");
  }

  const canonical = input.catalog
    .listBindingsForResource(workspaceResourceId)
    .filter((binding) => binding.role === "canonical");
  if (canonical.length > 1) {
    return fail("ERR_WORKSPACE_NOT_FOUND", "Duplicate canonical bindings");
  }
  const binding = canonical[0];
  if (!binding) {
    return fail("ERR_BINDING_NOT_CANONICAL", "Canonical binding missing");
  }
  if (binding.state === "retired") {
    return fail("ERR_WORKSPACE_ARCHIVED", "Canonical binding is revoked");
  }
  if (binding.state !== "active" || binding.role !== "canonical") {
    return fail("ERR_BINDING_NOT_CANONICAL", "Binding is not canonical and active");
  }
  if (
    !binding.locator.startsWith("/") ||
    binding.locator.includes("\0") ||
    binding.locator.includes("..")
  ) {
    return fail("ERR_INVALID_PATH", "Canonical locator is not a safe absolute path");
  }
  if (
    input.expectedFencing &&
    (input.expectedFencing.contentVersion !== binding.contentVersion ||
      input.expectedFencing.bindingId !== binding.bindingId)
  ) {
    return fail("ERR_WORKSPACE_ARCHIVED", "Handle fencing token is stale");
  }

  return {
    ok: true,
    targetIdentity: {
      tenantId,
      employeeOwnerId,
      agentAssetId,
      workspaceResourceId,
      expectedBindingRole: "canonical",
      expectedBindingState: "active",
      governanceVersion: resource.governanceVersion,
      contentVersion: binding.contentVersion,
      fencingToken: {
        contentVersion: binding.contentVersion,
        bindingId: binding.bindingId,
      },
    },
    locator: binding.locator,
    resource,
    binding,
  };
}
