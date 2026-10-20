/**
 * Capability risk levels L0-L4 — the normalization target.
 *
 * Contract from `docs/design/openbot-computer-network-capability-architecture-2026-09-29.md`
 * §8.3. This is deliberately a *normalization layer*, not a migration: existing
 * low/medium/high classifications, side-effect classes, human gates, approval
 * modes and the node command policy's default-versus-dangerous split map into it
 * through tested adapters. No stored enum changes, and nothing here decides
 * policy — it only names a level so a policy decision can reason about one scale.
 *
 * Naming caution: the "L0 / L1" in `src/gateway/tenant-context.ts` refers to
 * control-plane *store tiers* and is unrelated to these risk levels.
 */

export type CapabilityRiskLevel = "L0" | "L1" | "L2" | "L3" | "L4";

/** Ascending order. Index is the comparable rank. */
export const CAPABILITY_RISK_LEVELS: readonly CapabilityRiskLevel[] = [
  "L0",
  "L1",
  "L2",
  "L3",
  "L4",
] as const;

/** Human-readable intent of each level, mirroring §8.3. */
export const CAPABILITY_RISK_LEVEL_SUMMARY: Readonly<Record<CapabilityRiskLevel, string>> = {
  L0: "Observe public. Autonomous.",
  L1: "User-directed. Execute with visible status.",
  L2: "Bounded private or reversible. Existing scoped grant or approval.",
  L3: "Consequential external effect. Prepare, preview, approve, single-use commit.",
  L4: "Critical authority or value. Strong identity and transaction-specific confirmation.",
} as const;

export function isCapabilityRiskLevel(value: unknown): value is CapabilityRiskLevel {
  return typeof value === "string" && (CAPABILITY_RISK_LEVELS as readonly string[]).includes(value);
}

/** Comparable rank; higher means more dangerous. */
export function riskRank(level: CapabilityRiskLevel): number {
  return CAPABILITY_RISK_LEVELS.indexOf(level);
}

export function compareRiskLevel(left: CapabilityRiskLevel, right: CapabilityRiskLevel): number {
  return riskRank(left) - riskRank(right);
}

/**
 * The most dangerous of the given levels.
 *
 * This is the only combinator a caller should use to merge signals. Risk from
 * independent sources composes upward: if any signal says an action is
 * consequential, the action is consequential.
 */
export function maxRiskLevel(...levels: readonly CapabilityRiskLevel[]): CapabilityRiskLevel {
  let highest: CapabilityRiskLevel = "L0";
  for (const level of levels) {
    if (riskRank(level) > riskRank(highest)) {
      highest = level;
    }
  }
  return highest;
}

export function isAtLeastRiskLevel(
  level: CapabilityRiskLevel,
  floor: CapabilityRiskLevel,
): boolean {
  return riskRank(level) >= riskRank(floor);
}

/**
 * Raise a level to at least `floor`, never lowering it.
 *
 * Mapping adapters return a *floor*, because a source classification knows the
 * shape of an action but not the sensitivity of the resource it touches. Policy
 * may therefore raise a level; nothing may lower one (§4.3: the model does not
 * choose its own security level).
 */
export function raiseRiskLevel(
  level: CapabilityRiskLevel,
  floor: CapabilityRiskLevel,
): CapabilityRiskLevel {
  return maxRiskLevel(level, floor);
}
