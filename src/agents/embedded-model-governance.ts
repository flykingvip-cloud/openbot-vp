/**
 * Embedded model governance for chat.send / followup / cron-isolated
 * (governance closure P3-1: allowlistEnforcement + explicit mode).
 *
 * Maps the commercial gate outcome onto `runWithModelFallback` params:
 *  - gate skipped (no enterprise scope): `legacy`, no allowlist, no filter.
 *  - gate acquired + allowlist is an array: configured mode (default `shadow`)
 *    + `allowlistEnforcement: "preexisting"` so today's hard-filter stays.
 *  - gate acquired without an allowlist array: configured mode, no allowlist
 *    (envelope records `enterprise-scope-without-allowlist`; no filter).
 *
 * Mode never comes from the security profile. Code default is shadow, never enforced.
 */

import type { GovernanceMode } from "../gateway/governance/decision.js";
import {
  resolveGovernanceModeForCommercialGate,
  resolveGovernanceModeFromEnv,
} from "../gateway/governance/mode.js";
import type { ModelGovernanceContext } from "./model-fallback-governance.js";

export const EMBEDDED_MODEL_MODE_ENV = "OPENBOT_GOVERNANCE_EMBEDDED_MODEL_MODE";

export type AllowlistEnforcement = "preexisting" | "governance-mode";

export function resolveEmbeddedConfiguredModelMode(
  env: NodeJS.ProcessEnv = process.env,
): GovernanceMode {
  return resolveGovernanceModeFromEnv({
    envName: EMBEDDED_MODEL_MODE_ENV,
    defaultMode: "shadow",
    env,
  });
}

export type EmbeddedModelGovernanceInput = {
  /** `skipped` = no enterprise scope; `acquired` = enterprise gate held. */
  gateStatus: "skipped" | "acquired";
  allowlist?: readonly string[];
  tenantId?: string;
  commercialAuthorizationId?: string;
  actorId?: string;
};

export type EmbeddedModelGovernanceParams = {
  governanceMode: GovernanceMode;
  entitlementAllowlist?: string[];
  /**
   * `"preexisting"` keeps the hard-filter these three paths already applied
   * before explicit mode existed. Not a new mode.
   */
  allowlistEnforcement?: AllowlistEnforcement;
  governanceContext?: ModelGovernanceContext;
};

/**
 * Resolve governance params for auto-reply / followup / cron-isolated.
 * Does not re-authorize models — consumes the allowlist this run already has.
 */
export function resolveEmbeddedModelGovernance(
  input: EmbeddedModelGovernanceInput,
  env: NodeJS.ProcessEnv = process.env,
): EmbeddedModelGovernanceParams {
  const governanceMode = resolveGovernanceModeForCommercialGate({
    gateStatus: input.gateStatus,
    configuredMode: resolveEmbeddedConfiguredModelMode(env),
  });
  const actorId = input.actorId?.trim() || undefined;
  if (input.gateStatus === "skipped") {
    return actorId ? { governanceMode, governanceContext: { actorId } } : { governanceMode };
  }
  const tenantId = input.tenantId?.trim() || undefined;
  const commercialAuthorizationId = input.commercialAuthorizationId?.trim() || undefined;
  const context: ModelGovernanceContext = {
    ...(tenantId ? { tenantId } : {}),
    ...(actorId ? { actorId } : {}),
    ...(commercialAuthorizationId ? { commercialAuthorizationId } : {}),
  };
  const hasContext = Object.keys(context).length > 0;
  if (Array.isArray(input.allowlist)) {
    return {
      governanceMode,
      entitlementAllowlist: [...input.allowlist],
      allowlistEnforcement: "preexisting",
      ...(hasContext ? { governanceContext: context } : {}),
    };
  }
  return {
    governanceMode,
    ...(hasContext ? { governanceContext: context } : {}),
  };
}
