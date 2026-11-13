/**
 * P2 public entry for the read-only rule-adaptation shadow agent.
 * Agent use case and shadow call flow live here, not in policy.
 * Not mounted on the P1 policy barrel. Does not activate policy or persist candidates.
 */
export { runShadowRuleAdaptation, type ShadowRunDependencies } from "./run.js";
export {
  createControlledCandidateEntry,
  refuseCandidateSubmission,
  CONTROLLED_CANDIDATE_ENTRY_DESIGN,
} from "./candidate-entry.js";
export { emptyControlSnapshot, controlSnapshotsEqual } from "./control-snapshot.js";
export {
  DEFAULT_SHADOW_BUDGET_LIMITS,
  SHADOW_AGENT_PROTOCOL_VERSION,
  SHADOW_OUTCOME_CODES,
  INVENTORY_PIN,
} from "../../contracts/rule-adaptation-shadow.js";
export type {
  RuleAdaptationHostView,
  RuleAdaptationModelPort,
  ShadowBudgetLimits,
  ShadowControlSnapshot,
  ShadowOutcomeCode,
  ShadowRunRequest,
  ShadowRunResult,
  ShadowReason,
} from "../../contracts/rule-adaptation-shadow.js";

export {
  activateApprovedRuntimeRuleProposal,
  revokeActivatedRuntimeRulePolicy,
  rollbackActivatedRuntimeRulePolicy,
  readActivatedRuntimeRulePolicy,
  officialActivationBoardIo,
  type ActivationHostDependencies,
  type ActivationBoardIo,
} from "./activate.js";
