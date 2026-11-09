/** Inventory metadata only. Never grants authority or executes configured code. */
export type RuntimeRuleCategory =
  | "invariant"
  | "lifecycle"
  | "classification"
  | "operational"
  | "quality_experience"
  | "compatibility";

export type RuntimeRuleDeclaration = {
  id: string;
  category: RuntimeRuleCategory;
  owner: "command" | "execution" | "delivery" | "policy" | "capabilities";
  implementation: string;
  checkpoint: string;
  management: "code_required" | "reviewed_parameters" | "retirement_review";
  disposition: "retain" | "review_for_retirement";
};
