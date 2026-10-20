/**
 * governanceMode resolution (governance closure plan v1.0 §4.3, ADR-6, Q4).
 *
 * `legacy` means exactly one thing: this run has no enterprise scope (the commercial
 * gate returned `skipped`). The mode is never derived from the security profile
 * (Profile A/B); this module deliberately does not read it.
 *
 * Defaults are restricted to `legacy | shadow` at the type level: no flag may default
 * to `enforced` (plan §7.1 / Q3).
 */

import { GOVERNANCE_MODES, type GovernanceMode } from "./decision.js";

export type GovernanceDefaultMode = Exclude<GovernanceMode, "enforced">;

export function parseGovernanceMode(raw: string | undefined | null): GovernanceMode | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  return (GOVERNANCE_MODES as readonly string[]).includes(normalized)
    ? (normalized as GovernanceMode)
    : undefined;
}

/** Reads a mode flag; unknown or empty values fall back to `defaultMode` (never enforced). */
export function resolveGovernanceModeFromEnv(params: {
  envName: string;
  defaultMode: GovernanceDefaultMode;
  env?: NodeJS.ProcessEnv;
}): GovernanceMode {
  const env = params.env ?? process.env;
  return parseGovernanceMode(env[params.envName]) ?? params.defaultMode;
}

export type CommercialGateStatus = "skipped" | "acquired" | "denied";

/**
 * Commercial gate `skipped` → `legacy`. Otherwise the configured mode applies.
 * (A `denied` gate aborts the run before any model call; the configured mode is
 * returned only for completeness.)
 */
export function resolveGovernanceModeForCommercialGate(params: {
  gateStatus: CommercialGateStatus;
  configuredMode: GovernanceMode;
}): GovernanceMode {
  return params.gateStatus === "skipped" ? "legacy" : params.configuredMode;
}
