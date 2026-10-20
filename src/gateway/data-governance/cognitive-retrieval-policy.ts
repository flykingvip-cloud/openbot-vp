export type RetrievalPolicyEvaluation = "allow" | "deny" | "unknown" | "evaluator_missing";

export type RetrievalPolicyEvaluator = {
  evaluate(policyId: string): RetrievalPolicyEvaluation;
};

/**
 * First-wave production adapter: no Governance Policy Registry is shipped.
 * Always undefined so decideConstrainedRetrieval fail-closes with
 * policy_evaluator_missing. Tests replace this getter with vi.mock.
 */
export function getRetrievalPolicyEvaluator(): RetrievalPolicyEvaluator | undefined {
  return undefined;
}
