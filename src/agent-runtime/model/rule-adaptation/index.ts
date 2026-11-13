/**
 * Model-governance adapter and budget enforcement for the P2 shadow agent.
 * Does not activate policy, write configuration, or call production credentials.
P4 limited test wiring for personal context-cap selection also lives here;
it does not open the production path or the production whitelist.
 */
export { asModelUsage, createBudgetTracker, zeroUsage, type BudgetTracker } from "./budget.js";
export { createCombinedDeadline, type CombinedDeadline } from "./deadline.js";
export { invokeLimitedCompletion, type LimitedCompletion } from "./completion-limits.js";
export {
  createGovernedShadowModelPort,
  resolveShadowRuleAdaptationGovernance,
  type GovernedShadowModelPortDeps,
  type GovernedModelCompletion,
} from "./model-port.js";
export {
  createShadowRegistryOccupancy,
  type ShadowRegistryOccupancy,
  type ShadowRegistryOccupancyOptions,
} from "./occupancy.js";

export {
  CONTEXT_CAP_SELECTION_MODES,
  CONTEXT_CAP_SELECTION_SOURCES,
  CONTEXT_CAP_BLOCK_REASONS,
  PERSONAL_CONTEXT_WINDOW_RULE_ID,
  PERSONAL_CONTEXT_WINDOW_FIELD,
  CONTEXT_CAP_SELECTION_BLOCKED_CODE,
  CONTEXT_CAP_SELECTION_BLOCKED_ERROR_NAME,
  ContextCapSelectionBlockedError,
  createFixturePersonalContextCapPort,
  inheritSelectedContextCap,
  isContextCapSelectionBlocked,
  isContextCapSelectionBlockedError,
  sameRunInheritedContextWindowTokens,
  selectPersonalContextCap,
  selectedTokensOf,
  type ContextCapSelectionMode,
  type ContextCapSelectionResult,
  type PersonalContextCapSelectionPort,
  type PersonalContextCapFixtureResolvePort,
} from "./context-cap-selection.js";
