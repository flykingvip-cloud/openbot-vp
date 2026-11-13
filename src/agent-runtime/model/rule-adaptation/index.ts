/**
 * Model-governance adapter and budget enforcement for the P2 shadow agent.
 * Does not activate policy, write configuration, or call production credentials.
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
