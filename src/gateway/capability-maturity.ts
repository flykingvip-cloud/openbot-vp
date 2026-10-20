import type { RuntimeCapabilityBinding } from "./agent-runtime-store.js";
import type { GovernanceRegistryEntry } from "./capability-governance-store.js";
import { exactMember } from "./records.js";

/**
 * Single maturity SoT for enterprise list/detail and the incubation candidate pool.
 * Usage math and admin grants (certify / promote-to-standard) must not fork.
 */
export const CAPABILITY_MATURITY_ORDER = [
  "初步形成",
  "稳定使用",
  "多人复用",
  "企业认证",
  "企业标准",
  "核心资产",
] as const;

export type CapabilityMaturity = (typeof CAPABILITY_MATURITY_ORDER)[number];

export function uniqueAgentCount(bindings: RuntimeCapabilityBinding[]): number {
  return new Set(bindings.map((binding) => binding.runtimeAgentId)).size;
}

/** 30-day call estimate used by both 全部技能 and 孵化中心. */
export function monthlyExecutionsFromBindings(bindings: RuntimeCapabilityBinding[]): number {
  return bindings.reduce((sum, binding) => sum + binding.invocationMetrics.calls7d * 4, 0);
}

export function maturityFromUsage(bindings: RuntimeCapabilityBinding[]): CapabilityMaturity {
  const robots = uniqueAgentCount(bindings);
  const executions = monthlyExecutionsFromBindings(bindings);
  if (executions >= 1000 || robots >= 10) {
    return "核心资产";
  }
  if (executions >= 500 || robots >= 5) {
    return "企业标准";
  }
  if (executions >= 120 || robots >= 3) {
    return "企业认证";
  }
  if (robots >= 2) {
    return "多人复用";
  }
  if (robots >= 1) {
    return "稳定使用";
  }
  return "初步形成";
}

/**
 * Higher of usage-computed maturity and any admin grant floor.
 * A grant never silently disappears when short-term usage dips.
 */
export function effectiveMaturity(
  entry: GovernanceRegistryEntry,
  bindings: RuntimeCapabilityBinding[],
): CapabilityMaturity {
  const auto = maturityFromUsage(bindings);
  const grant = exactMember(entry.manualMaturityGrant, CAPABILITY_MATURITY_ORDER);
  if (!grant) {
    return auto;
  }
  const grantIdx = CAPABILITY_MATURITY_ORDER.indexOf(grant);
  return grantIdx > CAPABILITY_MATURITY_ORDER.indexOf(auto) ? grant : auto;
}
