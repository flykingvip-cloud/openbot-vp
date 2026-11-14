import {
  TERMINAL_POLICY_STATES,
  type RuntimeRuleAdaptationReason,
} from "../../contracts/rule-adaptation.js";
import {
  collectCandidateTypeErrors,
  collectDuplicates,
  collectHostUnusable,
  collectItemTypeErrors,
  collectProposalBindings,
} from "./collect.js";
import { getP1ShadowFieldAdapter, isKnownCatalogRuleId } from "./descriptors.js";
import {
  collectForbiddenKeys,
  collectHostUnknownKeys,
  collectProposalUnknownKeys,
  isNonEmptyString,
  isPlainObject,
  isPolicyState,
  isPrincipalType,
  isSafeIntegerNumber,
  isScopeType,
  reason,
  type ItemView,
} from "./inspect.js";

function collectIdentityMismatch(
  proposal: Record<string, unknown>,
  hostFacts: unknown,
  items: ItemView[],
  out: RuntimeRuleAdaptationReason[],
): void {
  if (!isPlainObject(hostFacts) || !isPlainObject(hostFacts.identity)) {
    return;
  }
  const identity = hostFacts.identity;
  if (
    !isPrincipalType(identity.principalType) ||
    !isNonEmptyString(identity.principalId) ||
    !isPlainObject(identity.scope) ||
    !isScopeType(identity.scope.type) ||
    !isNonEmptyString(identity.scope.id)
  ) {
    return;
  }
  const scope = proposal.scope;
  if (!isPlainObject(scope) || !isScopeType(scope.type) || !isNonEmptyString(scope.id)) {
    return;
  }
  if (identity.scope.type !== scope.type || identity.scope.id !== scope.id) {
    out.push(
      reason(
        "identity_scope_mismatch",
        "Trusted host identity scope does not match the proposal scope.",
        "host.identity.scope",
      ),
    );
  }
  if (
    identity.principalType !== "platform" &&
    scope.type !== "task" &&
    identity.principalType !== scope.type
  ) {
    out.push(
      reason(
        "identity_scope_mismatch",
        "Trusted host principal type is incompatible with the proposal scope type.",
        "host.identity.principalType",
      ),
    );
  }
  for (const item of items) {
    if (typeof item.ruleId !== "string" || typeof item.field !== "string") {
      continue;
    }
    const adapter = getP1ShadowFieldAdapter(item.ruleId, item.field);
    if (adapter && !adapter.allowedScopeTypes.includes(scope.type)) {
      out.push(
        reason(
          "identity_scope_mismatch",
          `Field ${item.field} is not adjustable in scope type ${scope.type}.`,
          `${item.path}.field`,
        ),
      );
    }
  }
}

function collectKnownRuleAndFieldRejects(
  items: ItemView[],
  out: RuntimeRuleAdaptationReason[],
): void {
  for (const item of items) {
    if (typeof item.ruleId !== "string" || item.ruleId.trim().length === 0) {
      continue;
    }
    if (!isKnownCatalogRuleId(item.ruleId)) {
      out.push(
        reason(
          "unknown_rule_id",
          `Rule id '${item.ruleId}' is not in the known catalog. This is an independently decidable reject (unknown_rule_id). Missing host facts are not evaluated and must not produce needs_information.`,
          `${item.path}.ruleId`,
        ),
      );
      continue;
    }
    if (typeof item.field !== "string" || item.field.trim().length === 0) {
      continue;
    }
    if (!getP1ShadowFieldAdapter(item.ruleId, item.field)) {
      out.push(
        reason(
          "non_candidate_field",
          `Field '${item.field}' on rule '${item.ruleId}' is not an approved P1 shadow candidate. The whole proposal is blocked; partial adoption is forbidden.`,
          `${item.path}.field`,
        ),
      );
    }
  }
}

function collectCancelled(hostFacts: unknown, out: RuntimeRuleAdaptationReason[]): void {
  if (!isPlainObject(hostFacts) || !isPolicyState(hostFacts.expectedPolicyState)) {
    return;
  }
  if (TERMINAL_POLICY_STATES.has(hostFacts.expectedPolicyState)) {
    out.push(
      reason(
        "cancelled_or_tombstone",
        `Host expectedPolicyState is ${hostFacts.expectedPolicyState}. This is an independently decidable reject (cancelled_or_tombstone). A missing compatibility record must not produce needs_information, and the cancelled task must not be revived.`,
        "host.expectedPolicyState",
      ),
    );
  }
}

function collectIndependentValueRejects(
  items: ItemView[],
  out: RuntimeRuleAdaptationReason[],
): void {
  for (const item of items) {
    if (item.action === "delete" || item.proposedValue === null) {
      out.push(
        reason(
          "delete_or_relax_as_tighten",
          "Deleting a cap, nulling a value, or submitting a deletion as an ordinary tighten is blocked.",
          `${item.path}.proposedValue`,
        ),
      );
      continue;
    }
    if (
      item.action === "select" ||
      item.action === "modify" ||
      item.action === "create" ||
      item.action === "disable"
    ) {
      out.push(
        reason(
          "unauthorized_action",
          `Action '${String(item.action)}' is not an allowed shadow tighten on this candidate.`,
          `${item.path}.action`,
        ),
      );
    }
    if (!isSafeIntegerNumber(item.proposedValue)) {
      continue;
    }
    if (typeof item.ruleId !== "string" || typeof item.field !== "string") {
      continue;
    }
    const adapter = getP1ShadowFieldAdapter(item.ruleId, item.field);
    if (!adapter) {
      continue;
    }
    if (item.proposedValue < adapter.hardMin) {
      out.push(
        reason(
          "below_hard_min",
          `proposedValue ${item.proposedValue} is below hardMin ${adapter.hardMin}.`,
          `${item.path}.proposedValue`,
        ),
      );
    }
    if (adapter.hardCeiling !== undefined && item.proposedValue > adapter.hardCeiling) {
      out.push(
        reason(
          "above_hard_ceiling",
          `proposedValue ${item.proposedValue} is above hardCeiling ${adapter.hardCeiling}.`,
          `${item.path}.proposedValue`,
        ),
      );
    }
  }
}

export function collectStage61(
  proposal: Record<string, unknown>,
  hostFacts: unknown,
  kind: "policy_proposal" | "rule_candidate" | undefined,
  items: ItemView[],
): RuntimeRuleAdaptationReason[] {
  const out: RuntimeRuleAdaptationReason[] = [];
  collectForbiddenKeys(proposal, "proposal", out);
  collectProposalUnknownKeys(proposal, out);
  if (kind === "policy_proposal") {
    if (!Array.isArray(proposal.items)) {
      out.push(
        reason(
          "structural_invalid_type",
          "policy_proposal.items must be a non-empty array.",
          "proposal.items",
        ),
      );
    } else if (proposal.items.length === 0) {
      out.push(
        reason(
          "structural_invalid_type",
          "policy_proposal.items must be a non-empty array.",
          "proposal.items",
        ),
      );
    } else {
      collectItemTypeErrors(items, out);
    }
  } else if (kind === "rule_candidate") {
    collectCandidateTypeErrors(proposal, out);
  }
  collectProposalBindings(proposal, kind ?? "policy_proposal", out);
  if (kind === "policy_proposal") {
    collectDuplicates(items, out);
  }
  collectHostUnknownKeys(hostFacts, out);
  collectHostUnusable(hostFacts, out);
  collectIdentityMismatch(proposal, hostFacts, items, out);
  if (kind === "policy_proposal") {
    collectKnownRuleAndFieldRejects(items, out);
  }
  collectCancelled(hostFacts, out);
  if (kind === "policy_proposal") {
    collectIndependentValueRejects(items, out);
  }
  return out;
}
