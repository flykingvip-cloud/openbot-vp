/**
 * Managed-tenant entitlement force policy.
 *
 * Personal / non-enterprise paths stay skipped; confirmed managed enterprise
 * runs use strict + all-bot-runs effective defaults when config is unsafe.
 */

import type { OpenBotConfig } from "../../config/types.js";
import {
  resolveModelEntitlementEnforce,
  resolveModelEntitlementScope,
  type ModelEntitlementEnforceMode,
  type ModelEntitlementScope,
} from "./entitlement-config.js";

export type ManagedTenantEntitlementPolicy = {
  enforce: ModelEntitlementEnforceMode;
  scope: ModelEntitlementScope;
  /** True when production defaults overrode a missing-allow/employee-chat config. */
  appliedManagedDefaults: boolean;
  /** Human-readable unsafe config warning for doctor/status. */
  unsafeConfigWarning?: string;
};

/**
 * Effective enforce/scope for a run that is known to belong to a managed enterprise.
 */
export function resolveManagedTenantEntitlementPolicy(
  cfg: OpenBotConfig | undefined,
  params: { isManagedEnterprise: boolean },
): ManagedTenantEntitlementPolicy {
  const configuredEnforce = resolveModelEntitlementEnforce(cfg);
  const configuredScope = resolveModelEntitlementScope(cfg);

  if (!params.isManagedEnterprise) {
    return {
      enforce: configuredEnforce,
      scope: configuredScope,
      appliedManagedDefaults: false,
    };
  }

  let enforce = configuredEnforce;
  let scope = configuredScope;
  let appliedManagedDefaults = false;
  const warnings: string[] = [];

  if (enforce === "off" || enforce === "missing-allow") {
    enforce = "strict";
    appliedManagedDefaults = true;
    warnings.push(
      `managed enterprise overrides enforce=${configuredEnforce} → strict (fail-closed)`,
    );
  }
  if (scope === "employee-chat") {
    scope = "all-bot-runs";
    appliedManagedDefaults = true;
    warnings.push(
      `managed enterprise overrides scope=employee-chat → all-bot-runs (cover cron/channel/cli)`,
    );
  }

  return {
    enforce,
    scope,
    appliedManagedDefaults,
    ...(warnings.length > 0 ? { unsafeConfigWarning: warnings.join("; ") } : {}),
  };
}
