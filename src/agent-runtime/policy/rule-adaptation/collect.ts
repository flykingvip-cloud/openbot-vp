import type { AuthorizationAssessment } from "../../contracts/rule-adaptation.js";
import type {
  RuntimeRuleAdaptationItemResult,
  RuntimeRuleAdaptationReason,
  RuntimeRuleAdaptationResultKind,
  RuntimeRuleAdaptationValidationResult,
} from "../../contracts/rule-adaptation.js";
import {
  isAction,
  isAuthStatus,
  isCompatStatus,
  isLane,
  isNonEmptyString,
  isPlainObject,
  isPolicyState,
  isPrincipalType,
  isSafeIntegerNumber,
  isScopeType,
  reason,
  type ItemView,
} from "./inspect.js";

export function mapAuthorizationAssessment(hostFacts: unknown): AuthorizationAssessment {
  if (!isPlainObject(hostFacts) || !("authorizationStatus" in hostFacts)) {
    return "assessment_unavailable";
  }
  if (hostFacts.authorizationStatus === "authorized") {
    return "host_authorized";
  }
  if (hostFacts.authorizationStatus === "unauthorized") {
    return "host_unauthorized";
  }
  return "assessment_unavailable";
}

export function resultOf(
  resultKind: RuntimeRuleAdaptationResultKind,
  assessment: AuthorizationAssessment,
  reasons: RuntimeRuleAdaptationReason[],
  items: RuntimeRuleAdaptationItemResult[],
): RuntimeRuleAdaptationValidationResult {
  return {
    resultKind,
    activationAllowed: false,
    authorizationAssessment: assessment,
    reasons,
    items,
  };
}

export function itemShell(
  item: ItemView,
): Pick<RuntimeRuleAdaptationItemResult, "ruleId" | "field"> {
  const shell: Pick<RuntimeRuleAdaptationItemResult, "ruleId" | "field"> = {};
  if (typeof item.ruleId === "string") {
    shell.ruleId = item.ruleId;
  }
  if (typeof item.field === "string") {
    shell.field = item.field;
  }
  return shell;
}

export function attachItems(
  items: ItemView[],
  reasons: RuntimeRuleAdaptationReason[],
  resultKind: RuntimeRuleAdaptationResultKind,
  specialize?: (item: ItemView) => RuntimeRuleAdaptationReason[],
): RuntimeRuleAdaptationItemResult[] {
  return items.map((item) => ({
    ...itemShell(item),
    resultKind,
    reasons: specialize ? specialize(item) : reasons,
  }));
}

function invalidType(message: string, path: string): RuntimeRuleAdaptationReason {
  return reason("structural_invalid_type", message, path);
}

function unusableHost(message: string, path: string): RuntimeRuleAdaptationReason {
  return reason("structural_unusable_host_value", message, path);
}

export function collectKindAndMix(
  proposal: Record<string, unknown>,
  out: RuntimeRuleAdaptationReason[],
): "policy_proposal" | "rule_candidate" | undefined {
  const kind = proposal.kind;
  if (kind !== "policy_proposal" && kind !== "rule_candidate") {
    out.push(
      invalidType("proposal.kind must be policy_proposal or rule_candidate.", "proposal.kind"),
    );
    return undefined;
  }
  const hasItems = "items" in proposal;
  const hasCandidate = "candidate" in proposal;
  if (kind === "policy_proposal" && hasCandidate) {
    out.push(
      reason(
        "structural_mixed_input_kinds",
        "A policy_proposal must not include a rule_candidate body.",
        "proposal.candidate",
      ),
    );
  }
  if (kind === "rule_candidate" && hasItems) {
    out.push(
      reason(
        "structural_mixed_input_kinds",
        "A rule_candidate must not include policy_proposal items.",
        "proposal.items",
      ),
    );
  }
  return kind;
}

export function collectProposalBindings(
  proposal: Record<string, unknown>,
  kind: "policy_proposal" | "rule_candidate",
  out: RuntimeRuleAdaptationReason[],
): void {
  const scope = proposal.scope;
  if (!isPlainObject(scope)) {
    out.push(
      reason(
        "structural_missing_binding",
        "Proposal scope is missing or not an object.",
        "proposal.scope",
      ),
    );
  } else {
    if (!isScopeType(scope.type)) {
      if (typeof scope.type === "string") {
        out.push(
          invalidType("proposal.scope.type is not a defined enum value.", "proposal.scope.type"),
        );
      } else {
        out.push(
          reason(
            "structural_missing_binding",
            "Proposal scope.type is missing.",
            "proposal.scope.type",
          ),
        );
      }
    }
    if (!isNonEmptyString(scope.id)) {
      out.push(
        reason(
          "structural_missing_binding",
          "Proposal scope.id must be a non-empty string.",
          "proposal.scope.id",
        ),
      );
    }
  }
  if (kind === "policy_proposal") {
    if (!isNonEmptyString(proposal.implementationVersion)) {
      out.push(
        reason(
          "structural_missing_binding",
          "policy_proposal must bind implementationVersion.",
          "proposal.implementationVersion",
        ),
      );
    }
    const expected = proposal.expectedPolicyVersion;
    if (!isPlainObject(expected)) {
      out.push(
        reason(
          "structural_missing_binding",
          "policy_proposal must bind expectedPolicyVersion.",
          "proposal.expectedPolicyVersion",
        ),
      );
    } else {
      for (const key of ["policyHash", "protocolVersion", "compilerRevision"] as const) {
        if (!isNonEmptyString(expected[key])) {
          out.push(
            reason(
              "structural_missing_binding",
              `expectedPolicyVersion.${key} must be a non-empty string.`,
              `proposal.expectedPolicyVersion.${key}`,
            ),
          );
        }
      }
    }
  } else if (
    "implementationVersion" in proposal &&
    !isNonEmptyString(proposal.implementationVersion)
  ) {
    out.push(
      invalidType(
        "implementationVersion, when present, must be a non-empty string.",
        "proposal.implementationVersion",
      ),
    );
  }
}

export function collectItemTypeErrors(items: ItemView[], out: RuntimeRuleAdaptationReason[]): void {
  for (const item of items) {
    if (!item.object) {
      out.push(invalidType("Each proposal item must be an object.", item.path));
      continue;
    }
    if (!isNonEmptyString(item.ruleId)) {
      out.push(invalidType("ruleId must be a non-empty string.", `${item.path}.ruleId`));
    }
    if (!isNonEmptyString(item.field)) {
      out.push(invalidType("field must be a non-empty string.", `${item.path}.field`));
    }
    if (item.action !== undefined && !isAction(item.action)) {
      out.push(invalidType("action is not a defined enum value.", `${item.path}.action`));
    }
    if (item.action === undefined) {
      out.push(invalidType("action is required.", `${item.path}.action`));
    }
    const value = item.proposedValue;
    if (value === null) {
      continue;
    }
    if (value === undefined) {
      out.push(invalidType("proposedValue is required.", `${item.path}.proposedValue`));
      continue;
    }
    if (typeof value !== "number") {
      out.push(
        invalidType(
          "proposedValue must be a number that satisfies Number.isSafeInteger; string, object, and other types are rejected.",
          `${item.path}.proposedValue`,
        ),
      );
      continue;
    }
    if (!Number.isSafeInteger(value)) {
      out.push(
        invalidType(
          "proposedValue must satisfy Number.isSafeInteger(value). Non-integers, non-finite numbers, and values outside the safe integer range are rejected. Business bounds are checked only after this test.",
          `${item.path}.proposedValue`,
        ),
      );
    }
  }
}

export function collectCandidateTypeErrors(
  proposal: Record<string, unknown>,
  out: RuntimeRuleAdaptationReason[],
): void {
  const candidate = proposal.candidate;
  if (!isPlainObject(candidate)) {
    out.push(invalidType("rule_candidate.candidate must be an object.", "proposal.candidate"));
    return;
  }
  for (const key of ["proposedRuleId", "summary", "body"] as const) {
    if (!isNonEmptyString(candidate[key])) {
      out.push(
        invalidType(`candidate.${key} must be a non-empty string.`, `proposal.candidate.${key}`),
      );
    }
  }
}

export function collectDuplicates(items: ItemView[], out: RuntimeRuleAdaptationReason[]): void {
  const seen = new Map<string, number[]>();
  for (const item of items) {
    if (typeof item.field !== "string" || item.field.length === 0) {
      continue;
    }
    const list = seen.get(item.field) ?? [];
    list.push(item.index);
    seen.set(item.field, list);
  }
  for (const [field, indexes] of seen) {
    if (indexes.length < 2) {
      continue;
    }
    const values = indexes.map((index) => items[index]?.proposedValue);
    out.push(
      reason(
        "structural_duplicate_field",
        `Field ${field} is repeated in proposal.items with conflicting values ${String(values[0])} and ${String(values[1])}. The whole proposal is blocked (structural_duplicate_field). A missing host compatibility record is not evaluated and must not produce needs_information. Partial adoption is forbidden.`,
        "proposal.items",
      ),
    );
  }
}

export function collectHostUnusable(hostFacts: unknown, out: RuntimeRuleAdaptationReason[]): void {
  if (hostFacts === undefined) {
    return;
  }
  if (!isPlainObject(hostFacts)) {
    out.push(unusableHost("Trusted host facts must be a plain object when provided.", "host"));
    return;
  }
  if ("fixture" in hostFacts && typeof hostFacts.fixture !== "boolean") {
    out.push(
      unusableHost("host.fixture, when present, must be a boolean test marker.", "host.fixture"),
    );
  }
  if ("identity" in hostFacts) {
    const identity = hostFacts.identity;
    if (!isPlainObject(identity)) {
      out.push(unusableHost("host.identity is present but is not an object.", "host.identity"));
    } else {
      if ("principalType" in identity && !isPrincipalType(identity.principalType)) {
        out.push(
          unusableHost(
            "host.identity.principalType is not a defined enum value.",
            "host.identity.principalType",
          ),
        );
      } else if (!isPrincipalType(identity.principalType)) {
        out.push(
          unusableHost(
            "host.identity.principalType is missing or blank.",
            "host.identity.principalType",
          ),
        );
      }
      if (!isNonEmptyString(identity.principalId)) {
        out.push(
          unusableHost(
            "host.identity.principalId must be a non-empty string.",
            "host.identity.principalId",
          ),
        );
      }
      if (!isPlainObject(identity.scope)) {
        out.push(
          unusableHost("host.identity.scope is missing or not an object.", "host.identity.scope"),
        );
      } else {
        if ("type" in identity.scope && !isScopeType(identity.scope.type)) {
          out.push(
            unusableHost(
              "host.identity.scope.type is not a defined enum value.",
              "host.identity.scope.type",
            ),
          );
        } else if (!isScopeType(identity.scope.type)) {
          out.push(
            unusableHost("host.identity.scope.type is missing.", "host.identity.scope.type"),
          );
        }
        if (!isNonEmptyString(identity.scope.id)) {
          out.push(
            unusableHost(
              "host.identity.scope.id must be a non-empty string.",
              "host.identity.scope.id",
            ),
          );
        }
      }
    }
  }
  if ("lane" in hostFacts && !isLane(hostFacts.lane)) {
    out.push(unusableHost("host.lane is present but is not a defined enum value.", "host.lane"));
  }
  if ("authorizationStatus" in hostFacts && !isAuthStatus(hostFacts.authorizationStatus)) {
    out.push(
      unusableHost(
        "host.authorizationStatus is present but is not a defined enum value.",
        "host.authorizationStatus",
      ),
    );
  }
  if ("expectedPolicyState" in hostFacts && !isPolicyState(hostFacts.expectedPolicyState)) {
    out.push(
      unusableHost(
        "host.expectedPolicyState is present but is not a defined enum value.",
        "host.expectedPolicyState",
      ),
    );
  }
  if ("currentEffectiveValues" in hostFacts) {
    const values = hostFacts.currentEffectiveValues;
    if (!isPlainObject(values)) {
      out.push(
        unusableHost(
          "host.currentEffectiveValues is present but is not an object.",
          "host.currentEffectiveValues",
        ),
      );
    } else {
      for (const [key, value] of Object.entries(values)) {
        if (!isSafeIntegerNumber(value)) {
          out.push(
            unusableHost(
              `host.currentEffectiveValues['${key}'] must be a safe integer (Number.isSafeInteger).`,
              `host.currentEffectiveValues.${key}`,
            ),
          );
        }
      }
    }
  }
  if ("compatibilityRecord" in hostFacts) {
    const record = hostFacts.compatibilityRecord;
    if (!isPlainObject(record)) {
      out.push(
        unusableHost(
          "host.compatibilityRecord is present but is not an object.",
          "host.compatibilityRecord",
        ),
      );
    } else {
      if (!isCompatStatus(record.status)) {
        out.push(
          unusableHost(
            "host.compatibilityRecord.status is missing or not a defined enum value.",
            "host.compatibilityRecord.status",
          ),
        );
      }
      if (!isNonEmptyString(record.boundImplementationVersion)) {
        out.push(
          unusableHost(
            "host.compatibilityRecord.boundImplementationVersion must be a non-empty string.",
            "host.compatibilityRecord.boundImplementationVersion",
          ),
        );
      }
      if (!isPlainObject(record.boundExpectedPolicyVersion)) {
        out.push(
          unusableHost(
            "host.compatibilityRecord.boundExpectedPolicyVersion must be an object.",
            "host.compatibilityRecord.boundExpectedPolicyVersion",
          ),
        );
      } else {
        for (const key of ["policyHash", "protocolVersion", "compilerRevision"] as const) {
          if (!isNonEmptyString(record.boundExpectedPolicyVersion[key])) {
            out.push(
              unusableHost(
                `boundExpectedPolicyVersion.${key} must be a non-empty string.`,
                `host.compatibilityRecord.boundExpectedPolicyVersion.${key}`,
              ),
            );
          }
        }
      }
    }
  }
}
