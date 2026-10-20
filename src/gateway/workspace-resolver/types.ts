import type { WorkspaceOwnerScope } from "../workspace-ownership/types.js";

export type WorkspaceResourceOperation = "read" | "write" | "list" | "preview";

export type WorkspaceLifecycleState = "active" | "read_only" | "retired";
export type WorkspaceBindingRole = "canonical" | "compatibility";
export type WorkspaceBindingState = "active" | "read_only" | "retired";

export type WorkspaceResourceRecord = {
  resourceId: string;
  resourceType: "workspace";
  tenantId: string | null;
  ownerScope: WorkspaceOwnerScope;
  lifecycleState: WorkspaceLifecycleState;
  classification: string;
  governanceVersion: number;
};

export type WorkspaceBindingRecord = {
  bindingId: string;
  resourceId: string;
  role: WorkspaceBindingRole;
  locator: string;
  state: WorkspaceBindingState;
  contentVersion: string;
};

export type WorkspaceCatalogStatus = "available" | "unavailable";

export type WorkspaceResourceCatalogSnapshot = {
  governanceVersion: number;
  status: WorkspaceCatalogStatus;
  /** Managed degraded read only when explicitly enabled on a valid snapshot. */
  allowDegradedRead?: boolean;
  resources: Record<string, WorkspaceResourceRecord>;
  bindings: Record<string, WorkspaceBindingRecord>;
};

export type WorkspaceResolveActor = {
  tenantId: string;
  userId: string;
};

export type WorkspaceResolveAudit = {
  cacheHit: boolean;
  governanceVersion: number;
  bindingId: string | null;
  denyReason: WorkspaceResolveDenyReason | null;
  snapshotStatus: WorkspaceCatalogStatus;
};

export type WorkspaceResolveDenyReason =
  | "catalog_unavailable"
  | "resource_not_found"
  | "tenant_mismatch"
  | "lifecycle_denied"
  | "binding_not_found"
  | "binding_not_writable"
  | "unknown_ownership"
  | "operation_denied";

export type WorkspaceResolveSuccess = {
  ok: true;
  resourceId: string;
  bindingId: string;
  operation: WorkspaceResourceOperation;
  purpose: string;
  audit: WorkspaceResolveAudit;
};

export type WorkspaceResolveFailure = {
  ok: false;
  reason: WorkspaceResolveDenyReason;
  audit: WorkspaceResolveAudit;
};

export type WorkspaceResolveResult = WorkspaceResolveSuccess | WorkspaceResolveFailure;
