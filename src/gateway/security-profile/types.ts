import type { DataMode } from "../../config/types.js";

/** Machine-checkable deployment security profile (Gate 0). */
export type SecurityProfileKind = "PersonalLocal" | "ManagedEnterprise";

/** How tenant isolation is enforced at the gateway process boundary. */
export type IsolationLevel = "single_operator" | "dedicated_tenant_boundary" | "shared_process";

export const SECURITY_PROFILE_ERROR_CODES = {
  MANAGED_MISSING_TENANTS_ROOT: "DG0_MANAGED_MISSING_TENANTS_ROOT",
  MANAGED_MISSING_EXECUTION_BOUNDARY: "DG0_MANAGED_MISSING_EXECUTION_BOUNDARY",
  MANAGED_SHARED_CREDENTIAL_ROOT: "DG0_MANAGED_SHARED_CREDENTIAL_ROOT",
  MANAGED_SHARED_BROWSER_ROOT: "DG0_MANAGED_SHARED_BROWSER_ROOT",
  MANAGED_SHARED_QUEUE_OR_CACHE: "DG0_MANAGED_SHARED_QUEUE_OR_CACHE",
  MANAGED_SHARED_STATE_ROOT: "DG0_MANAGED_SHARED_STATE_ROOT",
  MANAGED_SHARED_DATA_ROOT: "DG0_MANAGED_SHARED_DATA_ROOT",
  MANAGED_UNRESTRICTED_PLUGIN_ACCESS: "DG0_MANAGED_UNRESTRICTED_PLUGIN_ACCESS",
  MANAGED_MULTITENANT_SANDBOX_OFF: "DG0_MANAGED_MULTITENANT_SANDBOX_OFF",
  MANAGED_UNSCOPED_GATEWAY_EXEC: "DG0_MANAGED_UNSCOPED_GATEWAY_EXEC",
  MANAGED_DOCKER_RUNTIME_UNAVAILABLE: "DG0_MANAGED_DOCKER_RUNTIME_UNAVAILABLE",
  CLIENT_OVERRIDE_REJECTED: "DG0_CLIENT_OVERRIDE_REJECTED",
  PROFILE_INVALID: "DG0_PROFILE_INVALID",
  PROFILE_CONFLICT: "DG0_PROFILE_CONFLICT",
} as const;

export type SecurityProfileErrorCode =
  (typeof SECURITY_PROFILE_ERROR_CODES)[keyof typeof SECURITY_PROFILE_ERROR_CODES];

export type ResolvedSecurityProfile = {
  kind: SecurityProfileKind;
  isolationLevel: IsolationLevel;
  dataMode: DataMode;
  /** Where `data.mode` was resolved from (server-controlled only). */
  resolutionSource: "env" | "config" | "default";
};

export type SecurityProfileStartupAudit = {
  profile: SecurityProfileKind;
  isolationLevel: IsolationLevel;
  dataMode: DataMode;
  multitenantAddressing: boolean;
  explicitTenantsRoot: boolean;
  dedicatedSingleTenant: boolean;
};

export class SecurityProfileStartupError extends Error {
  readonly code: SecurityProfileErrorCode;

  constructor(params: { code: SecurityProfileErrorCode; message: string }) {
    super(params.message);
    this.name = "SecurityProfileStartupError";
    this.code = params.code;
  }
}
