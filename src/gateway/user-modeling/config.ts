import type { OpenBotConfig } from "../../config/config.js";

function envTruthy(raw: string | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

function envFalsy(raw: string | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "0" || v === "false" || v === "off" || v === "no";
}

function resolveTenantUserModelingCfg(
  cfg: OpenBotConfig | undefined,
  tenantId: string | null | undefined,
) {
  const id = tenantId?.trim();
  if (!id) {
    return undefined;
  }
  return cfg?.gateway?.userModeling?.tenants?.[id];
}

/** Conservative deterministic user modeling (explicit directives + language). Default: on. */
export function userModelingEnabled(cfg?: OpenBotConfig, tenantId?: string | null): boolean {
  if (envFalsy(process.env.OPENBOT_USER_MODELING)) {
    return false;
  }
  const tenantCfg = resolveTenantUserModelingCfg(cfg, tenantId);
  if (tenantCfg?.enabled !== undefined) {
    return tenantCfg.enabled;
  }
  const global = cfg?.gateway?.userModeling?.enabled;
  if (global !== undefined) {
    return global;
  }
  return true;
}

/** LLM inference for user profile — opt-in, default off. */
export function userModelingInferEnabled(cfg?: OpenBotConfig, tenantId?: string | null): boolean {
  if (envFalsy(process.env.OPENBOT_USER_MODELING_INFER)) {
    return false;
  }
  const tenantCfg = resolveTenantUserModelingCfg(cfg, tenantId);
  if (tenantCfg?.inferEnabled !== undefined) {
    return tenantCfg.inferEnabled;
  }
  const global = cfg?.gateway?.userModeling?.inferEnabled;
  if (global !== undefined) {
    return global;
  }
  return envTruthy(process.env.OPENBOT_USER_MODELING_INFER);
}
