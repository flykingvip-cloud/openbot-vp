import { resolveEmbeddedConfiguredModelMode } from "../../agents/embedded-model-governance.js";
import type { GovernanceMode } from "../../gateway/governance/decision.js";
import { lookupRunModelSet } from "../../gateway/governance/spawn-snapshot-handoff.js";

/** Auxiliary inference purposes: never create or advance business tasks. */
export type AuxiliaryModelPurpose = "memory_flush" | "slug_filename";

export type AuxiliaryModelGovernance = {
  governanceMode: GovernanceMode;
  entitlementAllowlist?: string[];
  absentAllowlistReason?: string;
  governanceContext?: {
    purpose: AuxiliaryModelPurpose;
    parentRunId?: string;
    tenantId?: string;
    actorId?: string;
    commercialAuthorizationId?: string;
  };
};

/**
 * Shared model governance for auxiliary inference (memory flush, slug filename).
 * Inherits the parent turn model set when a parentRunId is supplied; otherwise
 * records absent-allowlist and uses the configured embedded mode.
 * Callers must not open commercial work-item admission or task-board mutations.
 */
export function resolveAuxiliaryModelGovernance(params: {
  purpose: AuxiliaryModelPurpose;
  parentRunId?: string;
  env?: NodeJS.ProcessEnv;
}): AuxiliaryModelGovernance {
  const env = params.env ?? process.env;
  const parentSnapshot = params.parentRunId ? lookupRunModelSet(params.parentRunId) : undefined;
  const configuredMode = resolveEmbeddedConfiguredModelMode(env);
  const allowlist = parentSnapshot?.effectiveModelSet?.allowlist;
  const context = {
    purpose: params.purpose,
    ...(params.parentRunId ? { parentRunId: params.parentRunId } : {}),
    ...(parentSnapshot?.tenantId ? { tenantId: parentSnapshot.tenantId } : {}),
    ...(parentSnapshot?.actorId ? { actorId: parentSnapshot.actorId } : {}),
    ...(parentSnapshot?.commercialAuthorizationId
      ? { commercialAuthorizationId: parentSnapshot.commercialAuthorizationId }
      : {}),
  };

  if (parentSnapshot?.governanceMode === "legacy") {
    return {
      governanceMode: "legacy",
      governanceContext: context,
    };
  }

  if (Array.isArray(allowlist)) {
    return {
      governanceMode: parentSnapshot?.governanceMode ?? configuredMode,
      entitlementAllowlist: [...allowlist],
      governanceContext: context,
    };
  }

  return {
    governanceMode: parentSnapshot?.governanceMode ?? configuredMode,
    absentAllowlistReason: "parent-model-set-absent",
    governanceContext: context,
  };
}
