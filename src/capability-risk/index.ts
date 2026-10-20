/**
 * Capability risk normalization — public surface.
 *
 * Implements the L0-L4 normalization layer from the computer and network
 * capability architecture §8.3. Pure contract: no IO, no policy decisions, no
 * stored enum changes, and no imports from the subsystems it maps, so adopting it
 * cannot alter any existing classification's behavior.
 *
 * Registry row: `risk-normalization` in `docs/design/convergence-registry.yaml`.
 */

export {
  riskLevelFromBlockingGateType,
  riskLevelFromDiagnosisRisk,
  riskLevelFromNodeCommandDanger,
  riskLevelFromShellAdmission,
  riskLevelFromSideEffectClass,
} from "./mappings.js";
export {
  CAPABILITY_RISK_LEVEL_SUMMARY,
  CAPABILITY_RISK_LEVELS,
  type CapabilityRiskLevel,
  compareRiskLevel,
  isAtLeastRiskLevel,
  isCapabilityRiskLevel,
  maxRiskLevel,
  raiseRiskLevel,
  riskRank,
} from "./risk-level.js";
