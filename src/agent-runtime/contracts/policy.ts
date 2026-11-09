/** Inventory metadata only. Never grants authority or executes configured code. */
export type RuntimeRuleCategory =
  | "invariant"
  | "lifecycle"
  | "classification"
  | "operational"
  | "quality_experience"
  | "compatibility";

/** Where a rule's live implementation currently sits, or where it should land. */
export type RuntimeRuleOwner =
  | "command"
  | "execution"
  | "delivery"
  | "policy"
  | "capabilities"
  | "state"
  | "gateway"
  | "conversation-task";

export type RuntimeRuleManagement = "code_required" | "reviewed_parameters" | "retirement_review";

export type RuntimeRuleDisposition = "retain" | "review_for_retirement" | "pending_migration";

/** Rule-id edges plus non-rule artifacts (paths/contracts). Nested on purpose for detach tests. */
export type RuntimeRuleDependencies = {
  rules: readonly string[];
  artifacts: readonly string[];
};

/**
 * Queryable rule-catalog declaration.
 * Fields match the Batch A catalog contract; this is not a control plane.
 */
export type RuntimeRuleDeclaration = {
  id: string;
  category: RuntimeRuleCategory;
  /** Live responsibility today (may still be gateway / conversation-task / state). */
  currentOwner: RuntimeRuleOwner;
  /** Intended post-migration responsibility. */
  targetOwner: RuntimeRuleOwner;
  scope: string;
  implementation: string;
  enforcementPoints: readonly string[];
  /**
   * Concrete pin for the surveyed tree, never a vague "tip" label.
   * Format: `inventory:<full-sha>`.
   */
  version: string;
  dependencies: RuntimeRuleDependencies;
  configuration: string;
  tests: readonly string[];
  retirementCondition: string;
  management: RuntimeRuleManagement;
  disposition: RuntimeRuleDisposition;
};
