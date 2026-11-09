import type { RuntimeRuleDeclaration } from "../contracts/policy.js";

/** Selected verified rules, not a complete runtime inventory or a switch engine.
 * Paths identify implementations; they are never dynamically imported.
 */
const RULES: readonly RuntimeRuleDeclaration[] = [
  {
    id: "task.binding.current",
    category: "invariant",
    owner: "policy",
    implementation: "src/agent-runtime/policy/task-binding.ts",
    checkpoint: "before_execution_and_effect",
    management: "code_required",
    disposition: "retain",
  },
  {
    id: "execution.admitted.binding",
    category: "invariant",
    owner: "execution",
    implementation: "src/agent-runtime/execution/runner/admitted-turn.ts",
    checkpoint: "before_outcome_and_admission",
    management: "code_required",
    disposition: "retain",
  },
  {
    id: "interaction.semantic.decision",
    category: "classification",
    owner: "command",
    implementation: "src/agent-runtime/command/interpret-interaction.ts",
    checkpoint: "interaction",
    management: "code_required",
    disposition: "retain",
  },
  {
    id: "execution.retry.bounds",
    category: "operational",
    owner: "policy",
    implementation: "src/agent-runtime/policy/run-limits.ts",
    checkpoint: "retry",
    management: "reviewed_parameters",
    disposition: "retain",
  },
  {
    id: "execution.continuation.bounds",
    category: "operational",
    owner: "policy",
    implementation: "src/agent-runtime/policy/task-board-limits.ts",
    checkpoint: "before_continuation_reservation",
    management: "reviewed_parameters",
    disposition: "retain",
  },
  {
    id: "delivery.receipt.identity",
    category: "lifecycle",
    owner: "delivery",
    implementation: "src/agent-runtime/delivery/dispatch/confirm-pending.ts",
    checkpoint: "delivery_confirmation",
    management: "code_required",
    disposition: "retain",
  },
  {
    id: "execution.lifecycle.preparation",
    category: "lifecycle",
    owner: "execution",
    implementation: "src/agent-runtime/execution/runner/execution-lifecycle.ts",
    checkpoint: "before_provider_startup",
    management: "code_required",
    disposition: "retain",
  },
];

/** Detached data view for management consumers; no mutable runtime authority. */
export function listRuntimeRuleDeclarations(): RuntimeRuleDeclaration[] {
  return RULES.map((rule) => ({ ...rule }));
}
