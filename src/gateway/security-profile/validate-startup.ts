import path from "node:path";
import {
  dockerAccountWorkerExecutionBoundary,
  multitenantSandboxStartupIssue,
} from "../../agents/sandbox/account-sandbox-startup.js";
import { probeGatewayDockerRuntime } from "../../agents/sandbox/gateway-docker-probe.js";
import { isSharedTenantAddressingEnabled, resolveDataRoot } from "../../config/data-space.js";
import type { OpenBotConfig } from "../../config/types.js";
import { CONFIG_DIR } from "../../utils.js";
import { resolveSecurityProfile } from "./resolve.js";
import type { SecurityProfileStartupAudit } from "./types.js";
import { SECURITY_PROFILE_ERROR_CODES, SecurityProfileStartupError } from "./types.js";

/**
 * One managed-startup decision shared by both Gate 0 APIs.
 * `assertSecurityProfileAllowsStartup` maps these reasons onto SECURITY_PROFILE_*.
 * `validateSecurityProfileStartup` throws the first reason as DG0_*.
 * Shared-process is a label, never an allow, until I3 is proven.
 * Multitenant may start only when exec runs in the Docker account worker
 * (P6b: both flags default ON when unset; set either to 0/false/off to opt out),
 * `sandbox.mode=all`, and exec is not on the Gateway host. That case stays
 * account execution isolation (I2). It is not dedicated / I4.
 */
export type ManagedStartupReason =
  | "missing_tenants_root"
  | "missing_execution_boundary"
  | "sandbox_off"
  | "unscoped_gateway_exec"
  | "docker_runtime_unavailable"
  | "shared_credential_root"
  | "shared_browser_root"
  | "shared_queue_or_cache"
  | "unrestricted_plugin"
  | "shared_state_root"
  | "shared_data_root";

export type ManagedStartupAssessment = {
  reasons: ManagedStartupReason[];
  /** Honest addressing label. `shared_process` is refused by `reasons`. */
  addressing: "shared_process" | "dedicated" | "unset";
};

function pathsEqual(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

function isContainedWithin(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function resolveStateDir(env: NodeJS.ProcessEnv): string {
  const raw =
    env.OPENBOT_STATE_DIR?.trim() ||
    env.OPENCLAW_STATE_DIR?.trim() ||
    env.OPENBOT_CONFIG_DIR?.trim() ||
    env.OPENCLAW_CONFIG_DIR?.trim() ||
    "";
  return raw ? path.resolve(raw) : "";
}

function firstEnv(env: NodeJS.ProcessEnv, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function truthyFlag(raw: string | undefined): boolean {
  const flag = raw?.trim().toLowerCase() ?? "";
  return flag === "1" || flag === "true" || flag === "yes" || flag === "on";
}

function envMultitenant(env: NodeJS.ProcessEnv): boolean {
  return truthyFlag(
    firstEnv(env, ["OPENBOT_MULTITENANT", "OPENCLAW_MULTITENANT", "OPENBOT_MULTI_TENANT"]),
  );
}

function declaredBoundary(
  env: NodeJS.ProcessEnv,
  cfg: OpenBotConfig | undefined,
): "dedicated" | "shared_process" | "unset" {
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

function hasSharedRoot(env: NodeJS.ProcessEnv, keys: readonly string[]): boolean {
  return keys.some((key) => Boolean(env[key]?.trim()));
}

function pushReason(reasons: ManagedStartupReason[], reason: ManagedStartupReason): void {
  if (!reasons.includes(reason)) {
    reasons.push(reason);
  }
}

export type ValidateSecurityProfileStartupInput = {
  cfg: OpenBotConfig;
  env?: NodeJS.ProcessEnv;
  /** Reject if present. Client input cannot choose the profile. */
  clientProfileHint?: string | null;
};

export type SecurityProfileStartupValidation = {
  profile: ReturnType<typeof resolveSecurityProfile>;
  audit: SecurityProfileStartupAudit;
};

function buildAudit(params: {
  profile: ReturnType<typeof resolveSecurityProfile>;
  cfg: OpenBotConfig;
  env: NodeJS.ProcessEnv;
}): SecurityProfileStartupAudit {
  const explicitTenantsRoot = Boolean(params.env.OPENBOT_TENANTS_ROOT?.trim());
  const dedicatedSingleTenant = Boolean(params.cfg.data?.tenantId?.trim());
  return {
    profile: params.profile.kind,
    isolationLevel: params.profile.isolationLevel,
    dataMode: params.profile.dataMode,
    multitenantAddressing: isSharedTenantAddressingEnabled(params.cfg, params.env),
    explicitTenantsRoot,
    dedicatedSingleTenant,
  };
}

/**
 * Managed Enterprise startup predicate. Both gates must use this and no other.
 * `tenantsRootConfigured` and `OPENCLAW_TENANTS_ROOT` are not a volume: runtime
 * resolution reads only `OPENBOT_TENANTS_ROOT`.
 */
export function evaluateManagedEnterpriseStartup(
  cfg: OpenBotConfig | undefined,
  env: NodeJS.ProcessEnv,
  options?: {
    /** Test seam: override docker transport probe. */
    probeDockerRuntime?: () => { ok: boolean };
  },
): ManagedStartupAssessment {
  const reasons: ManagedStartupReason[] = [];
  const canonicalRoot = env.OPENBOT_TENANTS_ROOT?.trim() ?? "";
  if (!canonicalRoot) {
    pushReason(reasons, "missing_tenants_root");
  }

  if (
    hasSharedRoot(env, ["OPENBOT_SHARED_CREDENTIAL_ROOT", "OPENCLAW_SHARED_CREDENTIAL_ROOT"]) ||
    cfg?.gateway?.security?.sharedCredentialRoot === true
  ) {
    pushReason(reasons, "shared_credential_root");
  }
  if (
    hasSharedRoot(env, ["OPENBOT_SHARED_BROWSER_ROOT", "OPENCLAW_SHARED_BROWSER_ROOT"]) ||
    cfg?.gateway?.security?.sharedBrowserRoot === true
  ) {
    pushReason(reasons, "shared_browser_root");
  }
  if (
    truthyFlag(
      firstEnv(env, ["OPENBOT_SHARED_QUEUE_OR_CACHE", "OPENCLAW_SHARED_QUEUE_OR_CACHE"]),
    ) ||
    cfg?.gateway?.security?.sharedQueueOrCache === true
  ) {
    pushReason(reasons, "shared_queue_or_cache");
  }
  const pluginAccess =
    firstEnv(env, [
      "OPENBOT_PLUGIN_TENANT_ACCESS",
      "OPENCLAW_PLUGIN_TENANT_ACCESS",
    ])?.toLowerCase() ||
    cfg?.gateway?.security?.pluginTenantAccess ||
    "restricted";
  if (pluginAccess === "unrestricted") {
    pushReason(reasons, "unrestricted_plugin");
  }

  if (canonicalRoot) {
    const tenantsRoot = path.resolve(canonicalRoot);
    const configDir = path.resolve(CONFIG_DIR);
    if (pathsEqual(tenantsRoot, configDir) || isContainedWithin(tenantsRoot, configDir)) {
      pushReason(reasons, "shared_credential_root");
    }
    const stateDir = resolveStateDir(env);
    if (
      stateDir &&
      (pathsEqual(tenantsRoot, stateDir) || isContainedWithin(tenantsRoot, stateDir))
    ) {
      pushReason(reasons, "shared_state_root");
    }
    const dataRoot = path.resolve(resolveDataRoot(cfg, env));
    if (pathsEqual(tenantsRoot, dataRoot)) {
      pushReason(reasons, "shared_data_root");
    }
  }

  const multitenant = envMultitenant(env);
  const boundary = declaredBoundary(env, cfg);
  const tenantId = Boolean(cfg?.data?.tenantId?.trim());
  let addressing: ManagedStartupAssessment["addressing"] = "unset";
  if (multitenant || boundary === "shared_process") {
    addressing = "shared_process";
    const sandboxIssue = multitenant ? multitenantSandboxStartupIssue(cfg) : null;
    if (sandboxIssue === "sandbox-off") {
      pushReason(reasons, "sandbox_off");
    } else if (sandboxIssue === "unscoped-gateway-exec") {
      pushReason(reasons, "unscoped_gateway_exec");
    }
    // Memory-driver and host exec are not a tenant boundary. Docker account
    // worker plus sandbox.mode=all is. Still labeled shared_process / I2.
    const dockerAccountBoundary =
      multitenant && sandboxIssue === null && dockerAccountWorkerExecutionBoundary(env);
    if (!dockerAccountBoundary) {
      pushReason(reasons, "missing_execution_boundary");
    } else {
      const dockerProbe = options?.probeDockerRuntime
        ? options.probeDockerRuntime()
        : probeGatewayDockerRuntime({ env });
      if (!dockerProbe.ok) {
        // Cross-tenant: refuse ready when sandbox/account-worker docker cannot spawn.
        pushReason(reasons, "docker_runtime_unavailable");
      }
    }
  } else if (boundary === "dedicated" || tenantId) {
    addressing = "dedicated";
  } else {
    pushReason(reasons, "missing_execution_boundary");
  }

  return { reasons, addressing };
}

const REASON_ERRORS: Record<
  ManagedStartupReason,
  {
    code: (typeof SECURITY_PROFILE_ERROR_CODES)[keyof typeof SECURITY_PROFILE_ERROR_CODES];
    message: string;
  }
> = {
  missing_tenants_root: {
    code: SECURITY_PROFILE_ERROR_CODES.MANAGED_MISSING_TENANTS_ROOT,
    message:
      "Managed Enterprise startup rejected: set OPENBOT_TENANTS_ROOT to a dedicated tenant volume root before serving employee traffic.",
  },
  missing_execution_boundary: {
    code: SECURITY_PROFILE_ERROR_CODES.MANAGED_MISSING_EXECUTION_BOUNDARY,
    message:
      "Managed Enterprise startup rejected: shared-process startup is refused until I3. Set OPENBOT_TENANT_EXECUTION_BOUNDARY=dedicated or server-side data.tenantId on a dedicated worker and do not enable OPENBOT_MULTITENANT, or run multitenant exec in the Docker account worker (OPENBOT_ACCOUNT_WORKER + OPENBOT_ACCOUNT_WORKER_DOCKER default ON since P6b; set either to 0 to opt out; sandbox.mode=all, exec host not gateway).",
  },
  sandbox_off: {
    code: SECURITY_PROFILE_ERROR_CODES.MANAGED_MULTITENANT_SANDBOX_OFF,
    message:
      "Managed multitenant startup rejected: sandbox.mode=off. Account execution isolation is required. This is not Gateway blast-radius isolation.",
  },
  unscoped_gateway_exec: {
    code: SECURITY_PROFILE_ERROR_CODES.MANAGED_UNSCOPED_GATEWAY_EXEC,
    message: "Managed multitenant startup rejected: exec would run on the unbound Gateway host.",
  },
  docker_runtime_unavailable: {
    code: SECURITY_PROFILE_ERROR_CODES.MANAGED_DOCKER_RUNTIME_UNAVAILABLE,
    message:
      "Managed multitenant startup rejected: docker CLI and engine socket are both missing. Rebuild with OPENCLAW_INSTALL_DOCKER_CLI=1 and/or mount docker.sock / podman.sock. Without this, every tenant hits spawn docker ENOENT.",
  },
  shared_credential_root: {
    code: SECURITY_PROFILE_ERROR_CODES.MANAGED_SHARED_CREDENTIAL_ROOT,
    message:
      "Managed Enterprise startup rejected: shared credential root is not allowed, including a tenant volume that aliases the gateway config root.",
  },
  shared_browser_root: {
    code: SECURITY_PROFILE_ERROR_CODES.MANAGED_SHARED_BROWSER_ROOT,
    message: "Managed Enterprise startup rejected: shared browser root is not allowed.",
  },
  shared_queue_or_cache: {
    code: SECURITY_PROFILE_ERROR_CODES.MANAGED_SHARED_QUEUE_OR_CACHE,
    message: "Managed Enterprise startup rejected: shared queue or cache roots are not allowed.",
  },
  unrestricted_plugin: {
    code: SECURITY_PROFILE_ERROR_CODES.MANAGED_UNRESTRICTED_PLUGIN_ACCESS,
    message:
      "Managed Enterprise startup rejected: unrestricted in-process plugin access to tenant data is not allowed.",
  },
  shared_state_root: {
    code: SECURITY_PROFILE_ERROR_CODES.MANAGED_SHARED_STATE_ROOT,
    message:
      "Managed Enterprise startup rejected: tenant volume root must not share the gateway state root (browser/session/credential state).",
  },
  shared_data_root: {
    code: SECURITY_PROFILE_ERROR_CODES.MANAGED_SHARED_DATA_ROOT,
    message:
      "Managed Enterprise startup rejected: tenant volume root must not alias the global data root.",
  },
};

function assertManagedEnterpriseBoundary(params: {
  cfg: OpenBotConfig;
  env: NodeJS.ProcessEnv;
}): void {
  const assessment = evaluateManagedEnterpriseStartup(params.cfg, params.env);
  const reason = assessment.reasons[0];
  if (!reason) {
    return;
  }
  const mapped = REASON_ERRORS[reason];
  throw new SecurityProfileStartupError({
    code: mapped.code,
    message: `[${mapped.code}] ${mapped.message}`,
  });
}

function normalizeProfileToken(
  raw: string | undefined,
): "personal_local" | "managed_enterprise" | null {
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

function explicitProfileInvalid(cfg: OpenBotConfig, env: NodeJS.ProcessEnv): boolean {
  const rawEnv = firstEnv(env, ["OPENBOT_SECURITY_PROFILE", "OPENCLAW_SECURITY_PROFILE"]);
  if (rawEnv && !normalizeProfileToken(rawEnv)) {
    return true;
  }
  const rawCfg = cfg.gateway?.security?.profile;
  if (!rawEnv && rawCfg && !normalizeProfileToken(rawCfg)) {
    return true;
  }
  return false;
}

/**
 * Fail closed before serving employee traffic when Managed Enterprise settings
 * are incompatible with the dedicated tenant execution boundary contract.
 * Client profile hints are rejected here as well, so this gate cannot return
 * ok for an input that the file gate rejects.
 */
export function validateSecurityProfileStartup(
  input: ValidateSecurityProfileStartupInput,
): SecurityProfileStartupValidation {
  const env = input.env ?? process.env;
  if (input.clientProfileHint != null && String(input.clientProfileHint).trim() !== "") {
    const code = SECURITY_PROFILE_ERROR_CODES.CLIENT_OVERRIDE_REJECTED;
    throw new SecurityProfileStartupError({
      code,
      message: `[${code}] Client-supplied security profile hints are rejected. Profile selection stays server-controlled.`,
    });
  }

  const profile = resolveSecurityProfile({ cfg: input.cfg, env });
  if (explicitProfileInvalid(input.cfg, env)) {
    const code = SECURITY_PROFILE_ERROR_CODES.PROFILE_INVALID;
    throw new SecurityProfileStartupError({
      code,
      message: `[${code}] Security profile must be personal_local or managed_enterprise.`,
    });
  }
  if (profile.kind === "PersonalLocal" && profile.dataMode === "managed") {
    const code = SECURITY_PROFILE_ERROR_CODES.PROFILE_CONFLICT;
    throw new SecurityProfileStartupError({
      code,
      message: `[${code}] personal_local conflicts with managed data mode.`,
    });
  }
  if (profile.kind === "ManagedEnterprise") {
    assertManagedEnterpriseBoundary({ cfg: input.cfg, env });
  }

  return {
    profile,
    audit: buildAudit({ profile, cfg: input.cfg, env }),
  };
}
