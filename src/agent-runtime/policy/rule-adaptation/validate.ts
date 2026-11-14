import type { AuthorizationAssessment } from "../../contracts/rule-adaptation.js";
import type {
  RuntimeRuleAdaptationItemResult,
  RuntimeRuleAdaptationMissingFact,
  RuntimeRuleAdaptationReason,
  RuntimeRuleAdaptationResultKind,
  RuntimeRuleAdaptationValidationResult,
} from "../../contracts/rule-adaptation.js";
import {
  attachItems,
  collectKindAndMix,
  itemShell,
  mapAuthorizationAssessment,
  resultOf,
} from "./collect.js";
import type { P1ShadowFieldAdapter } from "./descriptors.js";
import { getP1ShadowFieldAdapter } from "./descriptors.js";
import {
  collectInputShapeReasons,
  isAuthStatus,
  isCompatStatus,
  isLane,
  isNonEmptyString,
  isPlainObject,
  isPolicyState,
  isPrincipalType,
  isSafeIntegerNumber,
  isScopeType,
  policyVersionsEqual,
  readItems,
  reason,
  type ItemView,
} from "./inspect.js";
import { collectStage61 } from "./stage61.js";

function hasIdentity(hostFacts: unknown): boolean {
  return (
    isPlainObject(hostFacts) &&
    isPlainObject(hostFacts.identity) &&
    isPrincipalType(hostFacts.identity.principalType) &&
    isNonEmptyString(hostFacts.identity.principalId) &&
    isPlainObject(hostFacts.identity.scope) &&
    isScopeType(hostFacts.identity.scope.type) &&
    isNonEmptyString(hostFacts.identity.scope.id)
  );
}

function collectMissingFacts(
  proposal: Record<string, unknown>,
  hostFacts: unknown,
  kind: "policy_proposal" | "rule_candidate",
  items: ItemView[],
): RuntimeRuleAdaptationReason[] {
  const out: RuntimeRuleAdaptationReason[] = [];
  const missing = (fact: RuntimeRuleAdaptationMissingFact, message: string, path: string) => {
    out.push(reason("missing_host_fact", message, path, fact));
  };
  if (!hasIdentity(hostFacts)) {
    missing("identity", "Trusted host identity is missing.", "host.identity");
  }
  if (
    isPlainObject(hostFacts) &&
    isPlainObject(hostFacts.identity) &&
    !isPlainObject(hostFacts.identity.scope)
  ) {
    missing("scopeContext", "Trusted host scope context is missing.", "host.identity.scope");
  } else if (!isPlainObject(hostFacts) || !isPlainObject(hostFacts.identity)) {
    missing("scopeContext", "Trusted host scope context is missing.", "host.identity.scope");
  }
  if (kind === "rule_candidate") {
    return out;
  }
  const needsLane = items.some((item) => {
    if (typeof item.ruleId !== "string" || typeof item.field !== "string") {
      return false;
    }
    return getP1ShadowFieldAdapter(item.ruleId, item.field)?.requiresLane === true;
  });
  if (needsLane && !(isPlainObject(hostFacts) && isLane(hostFacts.lane))) {
    missing(
      "lane",
      "lane is required for the evaluated collaboration field and was not provided.",
      "host.lane",
    );
  }
  const values = isPlainObject(hostFacts) ? hostFacts.currentEffectiveValues : undefined;
  for (const item of items) {
    if (typeof item.field !== "string") {
      continue;
    }
    if (!isPlainObject(values) || !(item.field in values)) {
      missing(
        "currentEffectiveValue",
        `currentEffectiveValue for field '${item.field}' was not provided by the host.`,
        `host.currentEffectiveValues.${item.field}`,
      );
    }
  }
  if (!(isPlainObject(hostFacts) && isAuthStatus(hostFacts.authorizationStatus))) {
    missing(
      "authorizationStatus",
      "Host authorizationStatus is missing.",
      "host.authorizationStatus",
    );
  }
  if (!(isPlainObject(hostFacts) && isPlainObject(hostFacts.compatibilityRecord))) {
    missing(
      "compatibilityRecord",
      "Host compatibilityRecord is missing.",
      "host.compatibilityRecord",
    );
  }
  if (!(isPlainObject(hostFacts) && isPolicyState(hostFacts.expectedPolicyState))) {
    missing(
      "expectedPolicyState",
      "Host expectedPolicyState is missing.",
      "host.expectedPolicyState",
    );
  }
  return out;
}

function currentValue(hostFacts: unknown, field: string): number | undefined {
  if (!isPlainObject(hostFacts) || !isPlainObject(hostFacts.currentEffectiveValues)) {
    return undefined;
  }
  const value = hostFacts.currentEffectiveValues[field];
  return isSafeIntegerNumber(value) ? value : undefined;
}

function evaluatePolicyItem(
  item: ItemView,
  hostFacts: unknown,
  assessment: AuthorizationAssessment,
  adapter: P1ShadowFieldAdapter,
): { resultKind: RuntimeRuleAdaptationResultKind; reasons: RuntimeRuleAdaptationReason[] } {
  const current = currentValue(hostFacts, adapter.field);
  if (current === undefined || !isSafeIntegerNumber(item.proposedValue)) {
    return {
      resultKind: "needs_information",
      reasons: [
        reason(
          "missing_host_fact",
          "A necessary host fact is still missing after independently decidable rejects.",
          item.path,
          "currentEffectiveValue",
        ),
      ],
    };
  }
  if (current < adapter.hardMin) {
    return {
      resultKind: "blocked",
      reasons: [
        reason(
          "current_below_hard_min",
          `currentEffectiveValue ${current} is already below hardMin ${adapter.hardMin}. no_change is forbidden.`,
          `host.currentEffectiveValues.${adapter.field}`,
        ),
      ],
    };
  }
  if (adapter.hardCeiling !== undefined && current > adapter.hardCeiling) {
    return {
      resultKind: "blocked",
      reasons: [
        reason(
          "hard_boundary_conflict",
          `currentEffectiveValue ${current} exceeds hardCeiling ${adapter.hardCeiling}.`,
          `host.currentEffectiveValues.${adapter.field}`,
        ),
      ],
    };
  }
  if (item.proposedValue > current) {
    return {
      resultKind: "blocked",
      reasons: [
        reason(
          "above_current_effective",
          `proposedValue ${item.proposedValue} is above currentEffectiveValue ${current}. The original proposal is rejected and must not be clamped through.`,
          `${item.path}.proposedValue`,
        ),
      ],
    };
  }
  if (item.proposedValue === current) {
    return {
      resultKind: "no_change",
      reasons: [
        reason(
          "equal_to_legal_baseline",
          `proposedValue ${item.proposedValue} equals the legal currentEffectiveValue. activationAllowed remains false.`,
          item.path,
        ),
      ],
    };
  }
  const unauthorizedNote =
    assessment === "host_unauthorized"
      ? ", but the host marks adjustment unauthorized. Shadow-legal only; P1 does not activate."
      : ". P1 does not activate; activationAllowed remains false.";
  return {
    resultKind: "shadow_accepted",
    reasons: [
      reason(
        "shadow_legal",
        `Proposed value ${item.proposedValue} is a legal tightening of currentEffectiveValue ${current} under hardMin ${adapter.hardMin}${unauthorizedNote}`,
        item.path,
      ),
    ],
  };
}

function compatibilityReject(
  proposal: Record<string, unknown>,
  hostFacts: unknown,
): RuntimeRuleAdaptationReason | undefined {
  if (!isPlainObject(hostFacts) || !isPlainObject(hostFacts.compatibilityRecord)) {
    return undefined;
  }
  const record = hostFacts.compatibilityRecord;
  if (!isCompatStatus(record.status)) {
    return undefined;
  }
  const bindingMatches =
    record.boundImplementationVersion === proposal.implementationVersion &&
    policyVersionsEqual(record.boundExpectedPolicyVersion, proposal.expectedPolicyVersion);
  if (record.status === "unapproved" || record.status === "incompatible" || !bindingMatches) {
    return reason(
      "compatibility_not_approved",
      bindingMatches
        ? `Host compatibilityRecord.status is ${record.status}.`
        : "Host compatibilityRecord is not bound to this proposal's implementationVersion and expectedPolicyVersion.",
      "host.compatibilityRecord",
    );
  }
  return undefined;
}

function aggregateItemKinds(
  itemResults: RuntimeRuleAdaptationItemResult[],
): RuntimeRuleAdaptationResultKind {
  if (itemResults.some((item) => item.resultKind === "blocked")) {
    return "blocked";
  }
  if (itemResults.some((item) => item.resultKind === "needs_information")) {
    return "needs_information";
  }
  if (itemResults.every((item) => item.resultKind === "no_change")) {
    return "no_change";
  }
  if (
    itemResults.some((item) => item.resultKind === "candidate_validated") &&
    itemResults.every(
      (item) => item.resultKind === "candidate_validated" || item.resultKind === "no_change",
    )
  ) {
    return "candidate_validated";
  }
  return "shadow_accepted";
}

function blockedItemsFromReasons(
  items: ItemView[],
  reasons: RuntimeRuleAdaptationReason[],
): RuntimeRuleAdaptationItemResult[] {
  const duplicate = reasons.some((entry) => entry.code === "structural_duplicate_field");
  if (duplicate) {
    return items.map((item) => ({
      ...itemShell(item),
      resultKind: "blocked",
      reasons: [
        reason(
          "structural_duplicate_field",
          `Whole-proposal reject because this field is repeated with a conflicting value; item ${item.index} proposedValue=${String(item.proposedValue)} is not adopted.`,
          item.path,
        ),
      ],
    }));
  }
  return attachItems(items, reasons, "blocked", (item) => {
    const matched = reasons.filter(
      (entry) =>
        entry.path === item.path ||
        entry.path?.startsWith(`${item.path}.`) ||
        !entry.path?.startsWith("proposal.items["),
    );
    return matched.length > 0 ? matched : reasons;
  });
}

/**
 * Pure P1 validator. Public API takes independent function parameters for the
 * model proposal and the trusted host facts. The `{ proposal, host }` JSON
 * envelope is a test-fixture format only and is not an external authorization
 * interface. `fixture` on host facts is a test marker and must not be treated
 * as an identity or authorization credential.
 *
 * Programmatic values must be JSON-like acyclic plain data. Circular
 * references, non-plain objects, and input deeper than
 * `RUNTIME_RULE_ADAPTATION_MAX_INPUT_DEPTH` are rejected as `blocked` and
 * never throw. This function performs no I/O, no model calls, no config
 * reads or writes, no storage, no registration, and no mutation of its
 * inputs.
 */
export function validateRuntimeRuleProposal(
  proposal: unknown,
  hostFacts: unknown,
): RuntimeRuleAdaptationValidationResult {
  const assessment = mapAuthorizationAssessment(hostFacts);
  const shapeReasons = collectInputShapeReasons(proposal, hostFacts);
  if (shapeReasons.length > 0) {
    return resultOf("blocked", assessment, shapeReasons, [
      { resultKind: "blocked", reasons: shapeReasons },
    ]);
  }
  if (!isPlainObject(proposal)) {
    const reasons = [
      reason("structural_invalid_type", "proposal must be a plain object.", "proposal"),
    ];
    return resultOf("blocked", assessment, reasons, [{ resultKind: "blocked", reasons }]);
  }
  const kindReasons: RuntimeRuleAdaptationReason[] = [];
  const kind = collectKindAndMix(proposal, kindReasons);
  const items = kind === "policy_proposal" ? readItems(proposal) : [];
  const independent = [...kindReasons, ...collectStage61(proposal, hostFacts, kind, items)];
  if (independent.length > 0 || kind === undefined) {
    const reasons = independent.length > 0 ? independent : kindReasons;
    if (kind === "rule_candidate") {
      const proposedRuleId =
        isPlainObject(proposal.candidate) && typeof proposal.candidate.proposedRuleId === "string"
          ? proposal.candidate.proposedRuleId
          : undefined;
      return resultOf("blocked", assessment, reasons, [
        { ...(proposedRuleId ? { proposedRuleId } : {}), resultKind: "blocked", reasons },
      ]);
    }
    return resultOf("blocked", assessment, reasons, blockedItemsFromReasons(items, reasons));
  }
  const missing = collectMissingFacts(proposal, hostFacts, kind, items);
  if (missing.length > 0) {
    if (kind === "rule_candidate") {
      return resultOf("needs_information", assessment, missing, [
        { resultKind: "needs_information", reasons: missing },
      ]);
    }
    return resultOf(
      "needs_information",
      assessment,
      missing,
      attachItems(items, missing, "needs_information"),
    );
  }
  if (kind === "rule_candidate") {
    const candidate = isPlainObject(proposal.candidate) ? proposal.candidate : {};
    const proposedRuleId =
      typeof candidate.proposedRuleId === "string" ? candidate.proposedRuleId : undefined;
    const reasons = [
      reason(
        "candidate_validated",
        "The rule_candidate payload is structurally valid under the candidate schema. This result means candidate_validated only: the P1 validator does not register, persist, or assign a storage id, and this object is not a registration receipt.",
        "proposal.candidate",
      ),
    ];
    return resultOf("candidate_validated", assessment, reasons, [
      { ...(proposedRuleId ? { proposedRuleId } : {}), resultKind: "candidate_validated", reasons },
    ]);
  }
  const compat = compatibilityReject(proposal, hostFacts);
  if (compat) {
    return resultOf("blocked", assessment, [compat], attachItems(items, [compat], "blocked"));
  }
  const itemResults: RuntimeRuleAdaptationItemResult[] = [];
  for (const item of items) {
    const adapter =
      typeof item.ruleId === "string" && typeof item.field === "string"
        ? getP1ShadowFieldAdapter(item.ruleId, item.field)
        : undefined;
    if (!adapter) {
      itemResults.push({
        ...itemShell(item),
        resultKind: "blocked",
        reasons: [
          reason("non_candidate_field", "Field is not an approved P1 shadow candidate.", item.path),
        ],
      });
      continue;
    }
    const evaluated = evaluatePolicyItem(item, hostFacts, assessment, adapter);
    itemResults.push({ ...itemShell(item), ...evaluated });
  }
  const resultKind = aggregateItemKinds(itemResults);
  const reasons = itemResults.flatMap((item) => item.reasons);
  return resultOf(resultKind, assessment, reasons, itemResults);
}
