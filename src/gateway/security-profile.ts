/**
 * Gate 0 security profiles for Data Governance v2.
 *
 * Personal Local and Managed Enterprise are mutually exclusive trust models.
 * Profile selection is server-controlled (env / gateway config). Client input
 * must never alter the selected profile.
 */

import { ACCOUNT_EXECUTION_ISOLATION_CLAIM } from "../agents/sandbox/account-sandbox-startup.js";
import { resolveDataMode } from "../config/data-space.js";
import type { OpenBotConfig } from "../config/types.js";
import { openExistingGovernanceShadowSwitches } from "./governance/shadow-switch-names.js";
import {
  evaluateManagedEnterpriseStartup,
  type ManagedStartupReason,
} from "./security-profile/validate-startup.js";

export type SecurityProfileKind = "personal_local" | "managed_enterprise";

/** Isolation levels from Data Governance Architecture v2 §14.1. */
export type SecurityIsolationLevel = "I1" | "I2" | "I3" | "I4";

export type SecurityProfileErrorCode =
  | "SECURITY_PROFILE_INVALID"
  | "SECURITY_PROFILE_CONFLICT"
  | "SECURITY_PROFILE_MISSING_EXECUTION_BOUNDARY"
  | "SECURITY_PROFILE_SHARED_BROWSER_ROOT"
  | "SECURITY_PROFILE_SHARED_CREDENTIAL_ROOT"
  | "SECURITY_PROFILE_SHARED_QUEUE_OR_CACHE"
  | "SECURITY_PROFILE_SHARED_STATE_ROOT"
  | "SECURITY_PROFILE_SHARED_DATA_ROOT"
  | "SECURITY_PROFILE_UNRESTRICTED_PLUGIN_ACCESS"
  | "SECURITY_PROFILE_MISSING_TENANTS_ROOT"
  | "SECURITY_PROFILE_CLIENT_OVERRIDE_REJECTED"
  | "SECURITY_PROFILE_MULTITENANT_SANDBOX_OFF"
  | "SECURITY_PROFILE_UNSCOPED_GATEWAY_EXEC"
  | "SECURITY_PROFILE_DOCKER_RUNTIME_UNAVAILABLE";

export type SecurityProfileError = {
  code: SecurityProfileErrorCode;
  /** Operator-safe message; must not include credentials, user IDs, tenant IDs, or host paths. */
  message: string;
};

export type SecurityProfileResolution = {
  ok: boolean;
  profile: SecurityProfileKind;
  isolationLevel: SecurityIsolationLevel;
  /** How the profile was selected. */
  source: "env" | "config" | "derived_data_mode";
  /** Dedicated tenant execution boundary declared for managed enterprise. */
  tenantExecutionBoundary: "dedicated" | "shared_process" | "unset";
  /**
   * Honest isolation claim. `dedicated` is only the non-multitenant I4 case.
   * Multitenant P0 is account execution isolation, not Gateway blast-radius isolation.
   */
  isolationClaim: "personal_local" | "dedicated" | typeof ACCOUNT_EXECUTION_ISOLATION_CLAIM;
  errors: SecurityProfileError[];
};

export type SecurityProfileStartupAudit = {
  profile: SecurityProfileKind;
  isolationLevel: SecurityIsolationLevel;
  source: SecurityProfileResolution["source"];
  tenantExecutionBoundary: SecurityProfileResolution["tenantExecutionBoundary"];
  isolationClaim: SecurityProfileResolution["isolationClaim"];
  ok: boolean;
  errorCodes: SecurityProfileErrorCode[];
};

const PROFILE_ENV_KEYS = ["OPENBOT_SECURITY_PROFILE", "OPENCLAW_SECURITY_PROFILE"] as const;

function firstEnv(env: NodeJS.ProcessEnv, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function normalizeProfileToken(raw: string | undefined): SecurityProfileKind | null {
  if (!raw) {
    return null;
  }
  const token = raw.trim().toLowerCase().replace(/-/g, "_");
  if (token === "personal_local" || token === "personal" || token === "local") {
    return "personal_local";
  }
  if (token === "managed_enterprise" || token === "managed" || token === "enterprise") {
    return "managed_enterprise";
  }
  return null;
}

function truthyFlag(raw: string | undefined): boolean {
  const flag = raw?.trim().toLowerCase() ?? "";
  return flag === "1" || flag === "true" || flag === "yes" || flag === "on";
}

function resolveTenantExecutionBoundary(
  env: NodeJS.ProcessEnv,
  cfg: OpenBotConfig | undefined,
): SecurityProfileResolution["tenantExecutionBoundary"] {
  const fromEnv = firstEnv(env, [
    "OPENBOT_TENANT_EXECUTION_BOUNDARY",
    "OPENCLAW_TENANT_EXECUTION_BOUNDARY",
  ])?.toLowerCase();
  const fromCfg = cfg?.gateway?.security?.tenantExecutionBoundary;
  const raw = fromEnv || fromCfg || "";
  if (raw === "dedicated") {
    return "dedicated";
  }
  if (raw === "shared_process" || raw === "shared") {
    return "shared_process";
  }
  return "unset";
}

function managedFileError(reason: ManagedStartupReason): SecurityProfileError {
  switch (reason) {
    case "missing_tenants_root":
      return {
        code: "SECURITY_PROFILE_MISSING_TENANTS_ROOT",
        message:
          "Managed Enterprise requires OPENBOT_TENANTS_ROOT. tenantsRootConfigured or OPENCLAW_TENANTS_ROOT alone does not name the volume the runtime reads.",
      };
    case "missing_execution_boundary":
      return {
        code: "SECURITY_PROFILE_MISSING_EXECUTION_BOUNDARY",
        message:
          "Managed Enterprise requires a dedicated tenant execution boundary until shared-process I3 isolation is proven. Multitenant startup is allowed only when exec runs in the Docker account worker (OPENBOT_ACCOUNT_WORKER and OPENBOT_ACCOUNT_WORKER_DOCKER (default ON; set 0 to opt out)) with sandbox.mode=all and exec off the Gateway host. That remains account execution isolation, not I4.",
      };
    case "sandbox_off":
      return {
        code: "SECURITY_PROFILE_MULTITENANT_SANDBOX_OFF",
        message:
          "Managed multitenant refuses sandbox.mode=off. P0 account execution isolation requires an account sandbox. This is not Gateway blast-radius isolation.",
      };
    case "unscoped_gateway_exec":
      return {
        code: "SECURITY_PROFILE_UNSCOPED_GATEWAY_EXEC",
        message:
          "Managed multitenant refuses exec on the unbound Gateway host. Use sandbox.mode=all without tools.exec.host=gateway.",
      };
    case "docker_runtime_unavailable":
      return {
        code: "SECURITY_PROFILE_DOCKER_RUNTIME_UNAVAILABLE",
        message:
          "Managed multitenant refuses startup when docker CLI and engine socket are both missing. Rebuild with OPENCLAW_INSTALL_DOCKER_CLI=1 and/or mount docker.sock / podman.sock.",
      };
    case "shared_credential_root":
      return {
        code: "SECURITY_PROFILE_SHARED_CREDENTIAL_ROOT",
        message:
          "Managed Enterprise rejects a shared credential root. Use tenant-scoped credentials.",
      };
    case "shared_browser_root":
      return {
        code: "SECURITY_PROFILE_SHARED_BROWSER_ROOT",
        message:
          "Managed Enterprise rejects a shared browser root. Use a tenant-scoped browser state boundary.",
      };
    case "shared_queue_or_cache":
      return {
        code: "SECURITY_PROFILE_SHARED_QUEUE_OR_CACHE",
        message: "Managed Enterprise rejects shared queue or cache roots across tenants.",
      };
    case "shared_state_root":
      return {
        code: "SECURITY_PROFILE_SHARED_STATE_ROOT",
        message: "Managed Enterprise rejects a tenant volume that shares the gateway state root.",
      };
    case "shared_data_root":
      return {
        code: "SECURITY_PROFILE_SHARED_DATA_ROOT",
        message: "Managed Enterprise rejects a tenant volume that aliases the global data root.",
      };
    case "unrestricted_plugin":
      return {
        code: "SECURITY_PROFILE_UNRESTRICTED_PLUGIN_ACCESS",
        message:
          "Managed Enterprise rejects unrestricted in-process plugin access to all tenant data.",
      };
  }
}

/**
 * Resolve and validate the deployment security profile.
 *
 * Priority: OPENBOT_SECURITY_PROFILE env → gateway.security.profile config →
 * derived from data.mode (local → personal_local, managed → managed_enterprise).
 */
export function resolveSecurityProfile(
  cfg: OpenBotConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
  options?: {
    /** Reject if present — client/request cannot choose the profile. */
    clientProfileHint?: string | null;
  },
): SecurityProfileResolution {
  const errors: SecurityProfileError[] = [];

  if (options?.clientProfileHint != null && String(options.clientProfileHint).trim() !== "") {
    errors.push({
      code: "SECURITY_PROFILE_CLIENT_OVERRIDE_REJECTED",
      message: "Client-supplied security profile hints are ignored and rejected.",
    });
  }

  const envProfile = normalizeProfileToken(firstEnv(env, PROFILE_ENV_KEYS));
  const cfgProfile = normalizeProfileToken(cfg?.gateway?.security?.profile);
  let profile: SecurityProfileKind;
  let source: SecurityProfileResolution["source"];

  if (envProfile) {
    profile = envProfile;
    source = "env";
  } else if (cfgProfile) {
    profile = cfgProfile;
    source = "config";
  } else {
    profile = resolveDataMode(cfg, env) === "managed" ? "managed_enterprise" : "personal_local";
    source = "derived_data_mode";
  }

  // Invalid explicit tokens already normalized to null; detect garbage env/config.
  const rawEnv = firstEnv(env, PROFILE_ENV_KEYS);
  if (rawEnv && !envProfile) {
    errors.push({
      code: "SECURITY_PROFILE_INVALID",
      message: "OPENBOT_SECURITY_PROFILE must be personal_local or managed_enterprise.",
    });
    profile = "personal_local";
    source = "env";
  }
  const rawCfg = cfg?.gateway?.security?.profile;
  if (!rawEnv && rawCfg && !cfgProfile) {
    errors.push({
      code: "SECURITY_PROFILE_INVALID",
      message: "gateway.security.profile must be personal_local or managed_enterprise.",
    });
    profile = "personal_local";
    source = "config";
  }

  const dataMode = resolveDataMode(cfg, env);
  if (profile === "personal_local" && dataMode === "managed") {
    errors.push({
      code: "SECURITY_PROFILE_CONFLICT",
      message:
        "personal_local security profile conflicts with managed data mode. Set OPENBOT_SECURITY_PROFILE=managed_enterprise or data.mode=local.",
    });
  }
  if (profile === "managed_enterprise" && dataMode === "local" && source !== "derived_data_mode") {
    // Explicit managed profile with local data mode is allowed for staged rollout
    // only when execution boundary is not claimed as multi-tenant production.
  }

  let tenantExecutionBoundary = resolveTenantExecutionBoundary(env, cfg);
  let isolationLevel: SecurityIsolationLevel = profile === "personal_local" ? "I1" : "I4";

  if (profile === "managed_enterprise") {
    // Same predicate as validateSecurityProfileStartup. Shared-process stays
    // labeled I2 and is refused until I3; it is never rewritten into an allow.
    const assessment = evaluateManagedEnterpriseStartup(cfg, env);
    if (assessment.addressing === "shared_process") {
      tenantExecutionBoundary = "shared_process";
      isolationLevel = "I2";
    } else if (assessment.addressing === "dedicated") {
      tenantExecutionBoundary = "dedicated";
      isolationLevel = "I4";
    }
    for (const reason of assessment.reasons) {
      errors.push(managedFileError(reason));
    }
  }

  const ok = errors.length === 0;
  const isolationClaim =
    profile === "personal_local"
      ? "personal_local"
      : isolationLevel === "I4"
        ? "dedicated"
        : ACCOUNT_EXECUTION_ISOLATION_CLAIM;
  return {
    ok,
    profile,
    isolationLevel,
    source,
    tenantExecutionBoundary,
    isolationClaim,
    errors,
  };
}

/** Build a redacted startup audit summary (safe to log). */
export function toSecurityProfileStartupAudit(
  resolution: SecurityProfileResolution,
): SecurityProfileStartupAudit {
  return {
    profile: resolution.profile,
    isolationLevel: resolution.isolationLevel,
    source: resolution.source,
    tenantExecutionBoundary: resolution.tenantExecutionBoundary,
    isolationClaim: resolution.isolationClaim,
    ok: resolution.ok,
    errorCodes: resolution.errors.map((error) => error.code),
  };
}

export class SecurityProfileStartupError extends Error {
  readonly codes: SecurityProfileErrorCode[];
  readonly resolution: SecurityProfileResolution;

  constructor(resolution: SecurityProfileResolution) {
    const codes = resolution.errors.map((error) => error.code);
    const messages = resolution.errors.map((error) => error.message).join(" ");
    super(
      `Gateway startup blocked by security profile validation (${codes.join(", ")}). ${messages}`,
    );
    this.name = "SecurityProfileStartupError";
    this.codes = codes;
    this.resolution = resolution;
  }
}

/**
 * Fail closed before serving employee traffic when Managed Enterprise
 * requirements are not met (or profiles conflict).
 */
export function assertSecurityProfileAllowsStartup(
  cfg: OpenBotConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
  options?: {
    /** Reject if present — client/request cannot choose the profile. */
    clientProfileHint?: string | null;
  },
): SecurityProfileResolution {
  const resolution = resolveSecurityProfile(cfg, env, options);
  if (!resolution.ok) {
    throw new SecurityProfileStartupError(resolution);
  }
  if (
    resolution.profile === "managed_enterprise" &&
    truthyFlag(
      firstEnv(env, ["OPENBOT_MULTITENANT", "OPENCLAW_MULTITENANT", "OPENBOT_MULTI_TENANT"]),
    )
  ) {
    openExistingGovernanceShadowSwitches(env);
  }
  return resolution;
}
