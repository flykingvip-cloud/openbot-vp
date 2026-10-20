import { resolveDataMode } from "../../config/data-space.js";
import type { OpenBotConfig } from "../../config/types.js";
import type { IsolationLevel, ResolvedSecurityProfile, SecurityProfileKind } from "./types.js";

export type ResolveSecurityProfileInput = {
  cfg: OpenBotConfig | undefined;
  env?: NodeJS.ProcessEnv;
};

function firstEnv(env: NodeJS.ProcessEnv, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
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

function resolveDataModeSource(
  cfg: OpenBotConfig | undefined,
  env: NodeJS.ProcessEnv,
): ResolvedSecurityProfile["resolutionSource"] {
  const envMode = env.OPENBOT_DATA_MODE?.trim() || env.OPENCLAW_DATA_MODE?.trim() || "";
  if (envMode === "managed" || envMode === "local") {
    return "env";
  }
  if (cfg?.data?.mode === "managed" || cfg?.data?.mode === "local") {
    return "config";
  }
  return "default";
}

function truthyFlag(raw: string | undefined): boolean {
  const flag = raw?.trim().toLowerCase() ?? "";
  return flag === "1" || flag === "true" || flag === "yes" || flag === "on";
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

/**
 * Same server-controlled priority as the file gate:
 * OPENBOT_SECURITY_PROFILE → gateway.security.profile → data.mode.
 * Unknown client-shaped keys are ignored.
 */
function resolveKind(
  cfg: OpenBotConfig | undefined,
  env: NodeJS.ProcessEnv,
  dataMode: ReturnType<typeof resolveDataMode>,
): SecurityProfileKind {
  const rawEnv = firstEnv(env, ["OPENBOT_SECURITY_PROFILE", "OPENCLAW_SECURITY_PROFILE"]);
  const envProfile = normalizeProfileToken(rawEnv);
  const cfgProfile = normalizeProfileToken(cfg?.gateway?.security?.profile);
  const selected = envProfile ?? (!rawEnv ? cfgProfile : null);
  if (selected === "managed_enterprise") {
    return "ManagedEnterprise";
  }
  if (selected === "personal_local") {
    return "PersonalLocal";
  }
  return dataMode === "managed" ? "ManagedEnterprise" : "PersonalLocal";
}

function mapIsolationLevel(params: {
  kind: SecurityProfileKind;
  cfg: OpenBotConfig | undefined;
  env: NodeJS.ProcessEnv;
}): IsolationLevel {
  if (params.kind === "PersonalLocal") {
    return "single_operator";
  }
  const multitenant = truthyFlag(
    firstEnv(params.env, ["OPENBOT_MULTITENANT", "OPENCLAW_MULTITENANT", "OPENBOT_MULTI_TENANT"]),
  );
  const boundary = declaredBoundary(params.env, params.cfg);
  if (multitenant || boundary === "shared_process") {
    return "shared_process";
  }
  if (boundary === "dedicated" || params.cfg?.data?.tenantId?.trim()) {
    return "dedicated_tenant_boundary";
  }
  return "single_operator";
}

/**
 * Resolve the deployment security profile from server-controlled config and env only.
 * Client RPC parameters must never influence this result.
 */
export function resolveSecurityProfile(
  input: ResolveSecurityProfileInput,
): ResolvedSecurityProfile {
  const env = input.env ?? process.env;
  const dataMode = resolveDataMode(input.cfg, env);
  const kind = resolveKind(input.cfg, env, dataMode);
  return {
    kind,
    isolationLevel: mapIsolationLevel({ kind, cfg: input.cfg, env }),
    dataMode,
    resolutionSource: resolveDataModeSource(input.cfg, env),
  };
}
