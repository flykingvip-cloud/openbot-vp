/**
 * Adapters from OpenBot's existing risk classifications onto L0-L4.
 *
 * Architecture §3.1 lists the risk model as "semantically present but
 * inconsistent" and §8.3 requires normalization "through tested adapters" before
 * any stored enum changes. These are those adapters.
 *
 * Two rules govern every mapping here:
 *
 *  1. **A mapping returns a floor, never a ceiling.** A source classification
 *     describes the *shape* of an action, not the sensitivity of the resource it
 *     touches. `raiseRiskLevel` may lift a result; nothing may lower one.
 *  2. **Unknown input maps to the highest level, not the lowest.** Fail closed
 *     (§4.6): an unrecognized classification is treated as critical until
 *     something explicitly classifies it.
 *
 * Each mapping states its rationale, because a risk mapping is a reviewable
 * judgment rather than a mechanical translation.
 */

import type { CapabilityRiskLevel } from "./risk-level.js";

/**
 * `src/diagnosis` remediation and evolution risk (`"low" | "medium" | "high"`).
 *
 * Floor is L2 rather than L0/L1: a remediation or evolution action always changes
 * something, so even the mildest case is a bounded mutation rather than pure
 * observation.
 */
export function riskLevelFromDiagnosisRisk(
  risk: "low" | "medium" | "high" | (string & {}),
): CapabilityRiskLevel {
  switch (risk) {
    case "low":
      return "L2";
    case "medium":
      return "L3";
    case "high":
      return "L4";
    default:
      // Fail closed on an unrecognized level.
      return "L4";
  }
}

/**
 * ConversationTask `SideEffectClass`
 * (`"none" | "outbound_message" | "external_write" | "broadcast"`).
 *
 * `none` maps to L1, not L0: the absence of an *external* side effect does not
 * make an action public-observation only; it may still read private context.
 * The three effect classes are all consequential external effects (L3). They are
 * not collapsed further here because audience and reversibility — what would
 * separate a broadcast from a single message — are resource properties the class
 * alone does not carry, and §4.3 forbids guessing them upward without evidence.
 */
export function riskLevelFromSideEffectClass(
  sideEffect: "none" | "outbound_message" | "external_write" | "broadcast" | (string & {}),
): CapabilityRiskLevel {
  switch (sideEffect) {
    case "none":
      return "L1";
    case "outbound_message":
    case "external_write":
    case "broadcast":
      return "L3";
    default:
      return "L4";
  }
}

/**
 * Node command policy's default-versus-dangerous split
 * (`DEFAULT_DANGEROUS_NODE_COMMANDS` in `src/gateway/node-command-policy.ts`).
 *
 * The dangerous set is camera capture, screen recording, contact writes, calendar
 * writes, reminder writes and SMS sends — all consequential, so L3. A
 * non-dangerous node command still reaches a real user device, so its floor is L2
 * rather than L0.
 */
export function riskLevelFromNodeCommandDanger(params: {
  isDangerous: boolean;
}): CapabilityRiskLevel {
  return params.isDangerous ? "L3" : "L2";
}

/**
 * Node-host shell admission (`src/node-host/exec-policy.ts`).
 *
 * `security=deny` has no level: the action does not happen, so callers must not
 * ask for a risk level instead of honoring the denial. An allowlisted command is
 * a bounded local mutation (L2); anything needing human approval is consequential
 * (L3).
 */
export function riskLevelFromShellAdmission(
  admission: "allowlisted" | "approval-required" | (string & {}),
): CapabilityRiskLevel {
  switch (admission) {
    case "allowlisted":
      return "L2";
    case "approval-required":
      return "L3";
    default:
      return "L4";
  }
}

/**
 * Progress Ledger `BlockingGateType`, for the gates that imply a risk floor.
 *
 * Only `authorization` and `policy` carry risk meaning: they indicate the action
 * was stopped for authority reasons. The others (`user_confirmation`, `external`,
 * `data`, `system`) describe why work is waiting, not how dangerous it is, so
 * they return `null` and contribute nothing to a composed level.
 */
export function riskLevelFromBlockingGateType(
  gate:
    | "user_confirmation"
    | "authorization"
    | "external"
    | "data"
    | "policy"
    | "system"
    | (string & {}),
): CapabilityRiskLevel | null {
  switch (gate) {
    case "authorization":
    case "policy":
      return "L3";
    case "user_confirmation":
    case "external":
    case "data":
    case "system":
      return null;
    default:
      return "L4";
  }
}
