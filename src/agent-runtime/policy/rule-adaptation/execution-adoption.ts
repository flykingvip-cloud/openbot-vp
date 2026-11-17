import { getP1ShadowFieldAdapter } from "./descriptors.js";
/** Per-execution adoption, not permanent configuration activation. Pure and fail closed. */
import { collectInputShapeReasons, isPlainObject } from "./inspect.js";
export type ExecutionRuleScope = { type: "personal"; id: string } | { type: "group"; id: string };
export type ExecutionRuleAdoptionInput = {
  mode: "legacy" | "dynamic";
  authorized: boolean;
  scope: ExecutionRuleScope;
  proposalScope: ExecutionRuleScope;
  bindingCurrent: boolean;
  cancelled: boolean;
  ruleId: string;
  field: string;
  action: string;
  currentValue: number;
  proposedValue: number;
};
export function evaluateExecutionRuleAdoption(
  input: ExecutionRuleAdoptionInput,
): { allowed: true; value: number } | { allowed: false; reason: string } {
  if (input.mode !== "dynamic") {
    return { allowed: false, reason: "legacy_mode" };
  }
  if (!input.authorized) {
    return { allowed: false, reason: "host_unauthorized" };
  }
  if (input.cancelled || !input.bindingCurrent) {
    return { allowed: false, reason: "stale_or_cancelled" };
  }
  if (
    !input.scope.id ||
    input.scope.type !== input.proposalScope.type ||
    input.scope.id !== input.proposalScope.id
  ) {
    return { allowed: false, reason: "scope_mismatch" };
  }
  const adapter = getP1ShadowFieldAdapter(input.ruleId, input.field);
  if (
    !adapter ||
    !adapter.allowedScopeTypes.includes(input.scope.type) ||
    input.action !== "tune"
  ) {
    return { allowed: false, reason: "field_not_permitted" };
  }
  if (
    !Number.isSafeInteger(input.currentValue) ||
    !Number.isSafeInteger(input.proposedValue) ||
    input.proposedValue < adapter.hardMin ||
    input.proposedValue > input.currentValue ||
    (adapter.hardCeiling !== undefined && input.proposedValue > adapter.hardCeiling)
  ) {
    return { allowed: false, reason: "parameter_out_of_bounds" };
  }
  return { allowed: true, value: input.proposedValue };
}

/** Run-local validator. Does not impersonate compatibility approval or permit activation. */
export function validateExecutionRuleProposal(
  proposal: unknown,
  facts: ExecutionRuleAdoptionInput,
): import("../../contracts/rule-adaptation.js").RuntimeRuleAdaptationValidationResult {
  const blocked = (
    message: string,
  ): import("../../contracts/rule-adaptation.js").RuntimeRuleAdaptationValidationResult => ({
    resultKind: "blocked",
    activationAllowed: false,
    authorizationAssessment: "host_unauthorized",
    reasons: [{ code: "hard_boundary_conflict", message }],
    items: [],
  });
  if (collectInputShapeReasons(proposal, undefined).length || !isPlainObject(proposal)) {
    return blocked("Invalid proposal");
  }
  const p = proposal;
  if (
    Object.keys(p).some(
      (k) =>
        !["kind", "scope", "implementationVersion", "expectedPolicyVersion", "items"].includes(k),
    )
  ) {
    return blocked("Invalid proposal fields");
  }
  if (
    p.kind !== "policy_proposal" ||
    !Array.isArray(p.items) ||
    p.items.length !== 1 ||
    !p.scope ||
    typeof p.scope !== "object"
  ) {
    return blocked("Expected one scoped parameter proposal");
  }
  if (!isPlainObject(p.scope) || Object.keys(p.scope).some((k) => !["type", "id"].includes(k))) {
    return blocked("Invalid scope");
  }
  const item = p.items[0] as Record<string, unknown>;
  if (
    !item ||
    typeof item !== "object" ||
    Object.keys(item).some((k) => !["ruleId", "field", "action", "proposedValue"].includes(k))
  ) {
    return blocked("Invalid item fields");
  }
  const scope = p.scope;
  const decision = evaluateExecutionRuleAdoption({
    ...facts,
    proposalScope: scope as ExecutionRuleScope,
    ruleId: item.ruleId as string,
    field: item.field as string,
    action: item.action as string,
    proposedValue: item.proposedValue as number,
  });
  if (!decision.allowed) {
    return blocked(decision.reason);
  }
  return {
    resultKind: "shadow_accepted",
    activationAllowed: false,
    authorizationAssessment: "host_authorized",
    reasons: [],
    items: [
      {
        ruleId: item.ruleId as string,
        field: item.field as string,
        resultKind: "shadow_accepted",
        reasons: [],
      },
    ],
  };
}
