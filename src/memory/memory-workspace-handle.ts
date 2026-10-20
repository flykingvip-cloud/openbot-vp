/**
 * U0 construction/resolve entry for MemoryWorkspaceHandle.
 * Incomplete objects are never returned. Type assertions and object spread
 * cannot mint a branded handle. Does not write Catalog or wire U1.
 */

const MEMORY_WORKSPACE_HANDLE_BRAND = Symbol();
const ISSUED_MEMORY_WORKSPACE_HANDLES = new WeakSet<object>();

const PERMISSION_KEYS = ["search", "ingest", "distill", "prune", "reset", "export"] as const;
const RETIRED_WRITE_PERMISSION_KEYS = ["ingest", "distill", "prune", "reset"] as const;

export const MEMORY_WORKSPACE_DENIALS = [
  "missing_workspace_resource",
  "missing_memory_asset",
  "ambiguous_agent_asset",
  "tenant_mismatch",
  "missing_binding",
  "stale_fencing_token",
] as const;

export type MemoryWorkspaceDenial = (typeof MEMORY_WORKSPACE_DENIALS)[number];

export type MemoryWorkspaceLifecycle =
  | "active"
  | "read_only"
  | "moving"
  | "recovery_required"
  | "retired"
  | "purged";

export type MemoryWorkspacePermissions = {
  search: boolean;
  ingest: boolean;
  distill: boolean;
  prune: boolean;
  reset: boolean;
  export: boolean;
};

export type MemoryWorkspaceHandleInput = {
  resourceId?: unknown;
  memoryAssetResourceId?: unknown;
  tenantId?: unknown;
  agentAssetId?: unknown;
  bindingId?: unknown;
  canonicalObjectKey?: unknown;
  governanceVersion?: unknown;
  fencingToken?: unknown;
  lifecycle?: unknown;
  permissions?: unknown;
  reasonCode?: MemoryWorkspaceDenial;
};

export type MemoryWorkspaceHandle = {
  readonly resourceId: string;
  readonly memoryAssetResourceId: string;
  readonly tenantId: string;
  readonly agentAssetId?: string;
  readonly bindingId: string;
  readonly canonicalObjectKey: string;
  readonly governanceVersion: number;
  readonly fencingToken: string;
  readonly lifecycle: MemoryWorkspaceLifecycle;
  readonly permissions: MemoryWorkspacePermissions;
};

export type MemoryWorkspaceResolveResult =
  | { ok: true; handle: MemoryWorkspaceHandle }
  | { ok: false; reasonCode: MemoryWorkspaceDenial; reason: string };

const LIFECYCLES = new Set<MemoryWorkspaceLifecycle>([
  "active",
  "read_only",
  "moving",
  "recovery_required",
  "retired",
  "purged",
]);

function requiredText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function deny(reasonCode: MemoryWorkspaceDenial, reason: string): MemoryWorkspaceResolveResult {
  return { ok: false, reasonCode, reason };
}

function parsePermissions(value: unknown): MemoryWorkspacePermissions | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const rec = value as Record<string, unknown>;
  const parsed = {} as MemoryWorkspacePermissions;
  for (const key of PERMISSION_KEYS) {
    if (typeof rec[key] !== "boolean") {
      return null;
    }
    parsed[key] = rec[key];
  }
  return parsed;
}

function parseGovernanceVersion(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return null;
  }
  return value;
}

export function isMemoryWorkspaceHandle(value: unknown): value is MemoryWorkspaceHandle {
  return typeof value === "object" && value !== null && ISSUED_MEMORY_WORKSPACE_HANDLES.has(value);
}

/**
 * The only construction entry. Spread, Object.assign, and `as Handle`
 * do not produce a branded handle.
 */
export function createMemoryWorkspaceHandle(
  input: MemoryWorkspaceHandleInput,
): MemoryWorkspaceResolveResult {
  if (input.reasonCode === "ambiguous_agent_asset") {
    return deny(
      "ambiguous_agent_asset",
      "agent asset is not uniquely bound; do not construct a handle",
    );
  }
  if (input.reasonCode === "stale_fencing_token") {
    return deny("stale_fencing_token", "fencing token is stale; do not construct a handle");
  }

  const resourceId = requiredText(input.resourceId);
  if (!resourceId) {
    return deny("missing_workspace_resource", "workspace resourceId is required");
  }
  const memoryAssetResourceId = requiredText(input.memoryAssetResourceId);
  if (!memoryAssetResourceId) {
    return deny("missing_memory_asset", "memoryAssetResourceId is required");
  }
  const tenantId = requiredText(input.tenantId);
  if (!tenantId) {
    return deny(
      "tenant_mismatch",
      "tenantId is required and must come from the authorized workspace",
    );
  }
  const bindingId = requiredText(input.bindingId);
  if (!bindingId) {
    return deny("missing_binding", "bindingId is required");
  }
  const fencingToken = requiredText(input.fencingToken);
  if (!fencingToken) {
    return deny("stale_fencing_token", "fencingToken is required");
  }
  const canonicalObjectKey = requiredText(input.canonicalObjectKey);
  if (!canonicalObjectKey) {
    return deny("missing_binding", "canonicalObjectKey is required");
  }
  const governanceVersion = parseGovernanceVersion(input.governanceVersion);
  if (governanceVersion === null) {
    return deny("stale_fencing_token", "governanceVersion must be a positive integer");
  }
  if (
    typeof input.lifecycle !== "string" ||
    !LIFECYCLES.has(input.lifecycle as MemoryWorkspaceLifecycle)
  ) {
    return deny("missing_binding", "lifecycle is required");
  }
  const lifecycle = input.lifecycle as MemoryWorkspaceLifecycle;
  const permissions = parsePermissions(input.permissions);
  if (!permissions) {
    return deny("missing_binding", "permissions must include six boolean fields");
  }
  if (lifecycle === "retired" || lifecycle === "purged") {
    const openWrite = RETIRED_WRITE_PERMISSION_KEYS.filter((key) => permissions[key]);
    if (openWrite.length > 0) {
      return deny("missing_binding", `lifecycle=${lifecycle} forbids ingest/distill/prune/reset`);
    }
  }

  const agentAssetId = requiredText(input.agentAssetId);
  const handle = Object.defineProperty(
    {
      resourceId,
      memoryAssetResourceId,
      tenantId,
      bindingId,
      canonicalObjectKey,
      governanceVersion,
      fencingToken,
      lifecycle,
      permissions: Object.freeze({ ...permissions }),
    },
    MEMORY_WORKSPACE_HANDLE_BRAND,
    { value: true, writable: false, enumerable: false, configurable: false },
  ) as MemoryWorkspaceHandle;
  if (agentAssetId) {
    Object.defineProperty(handle, "agentAssetId", {
      value: agentAssetId,
      writable: false,
      enumerable: true,
      configurable: false,
    });
  }
  const issued = Object.freeze(handle);
  ISSUED_MEMORY_WORKSPACE_HANDLES.add(issued);
  return { ok: true, handle: issued };
}

export function deriveCloudTenantId(handle: MemoryWorkspaceHandle): string {
  if (!isMemoryWorkspaceHandle(handle)) {
    throw new Error("cloud tenantId can only be derived from a branded MemoryWorkspaceHandle");
  }
  return handle.tenantId;
}

export function checkConfiguredCloudTenant(params: {
  handle: MemoryWorkspaceHandle;
  configuredTenantId?: string | null;
}): MemoryWorkspaceResolveResult {
  if (!isMemoryWorkspaceHandle(params.handle)) {
    return deny("missing_binding", "cloud tenant check requires a branded MemoryWorkspaceHandle");
  }
  const configured = requiredText(params.configuredTenantId);
  if (configured && configured !== params.handle.tenantId) {
    return deny(
      "tenant_mismatch",
      "configured cloud tenantId is not a second tenant source; it must equal Handle.tenantId",
    );
  }
  return { ok: true, handle: params.handle };
}
