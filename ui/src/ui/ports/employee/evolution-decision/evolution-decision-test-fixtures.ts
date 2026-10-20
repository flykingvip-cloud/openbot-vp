/**
 * Test fixtures for the employee Decision Surface. Test-only: nothing in the
 * product imports this module. Facts here stand in for the server-side
 * Timeline/Ledger read projection that D2 does not ship.
 */

import type {
  AuthorityGrantView,
  EvolutionDecisionAuthorityFacts,
  EvolutionDecisionItem,
  EvolutionDecisionPrincipal,
  EvolutionDecisionRouteInput,
  EvolutionEmployeeDecisionFact,
  EvolutionEmployeeDecisionHistory,
} from "@openbot/evolution-core";
import type { EvolutionDecisionHistorySource, EvolutionDecisionSubmitContext } from "./client.ts";

export const DECISION_CURRENT_AS_OF = "2026-09-28T12:00:00.000Z";
export const DECISION_PRIOR_AS_OF = "2026-09-21T12:00:00.000Z";
export const DECISION_LATER = "2026-10-05T00:00:00.000Z";

export function decisionItem(
  overrides: Partial<EvolutionDecisionItem> = {},
): EvolutionDecisionItem {
  return {
    schemaVersion: 1,
    decisionId: "dec-1",
    decisionVersion: "dv-1",
    tenantScope: "tenant-a",
    target: { domain: "agent", agentId: "agent-1" },
    surfaceId: "agent.working-dna",
    sourceFindingIds: ["finding-1"],
    sourceEvidenceRefs: ["ev-1"],
    proposalId: "prop-1",
    decisionType: "hold_or_resume",
    requiredAuthority: "employee",
    allowedActions: ["hold", "reject"],
    status: "pending",
    expiresAt: DECISION_LATER,
    riskLevel: "medium",
    confidentialityScope: "personal",
    ...overrides,
  };
}

export function decisionPrincipal(
  overrides: Partial<EvolutionDecisionPrincipal> = {},
): EvolutionDecisionPrincipal {
  return {
    audience: "employee",
    trustedTenantId: "tenant-a",
    platformOperator: false,
    enterpriseAdmin: false,
    ownerAgentId: "agent-1",
    ...overrides,
  };
}

export function decisionRouteInput(
  overrides: Partial<EvolutionDecisionRouteInput> = {},
): EvolutionDecisionRouteInput {
  return {
    target: { domain: "agent", agentId: "agent-1" },
    surfaceId: "agent.working-dna",
    ownership: { kind: "agent_self" },
    crossTenantRepeat: false,
    platformFixAffectsEnterprise: false,
    touchesEmployeePersonalAsset: false,
    ...overrides,
  };
}

/** Neither participation recorded yet. */
export const DECISION_NO_AUTHORITY_FACTS: EvolutionDecisionAuthorityFacts = Object.freeze({
  enterpriseCanaryAcknowledged: false,
  employeeFinalAuthorization: false,
});

export function decisionFact(
  overrides: {
    item?: Partial<EvolutionDecisionItem>;
    routeInput?: Partial<EvolutionDecisionRouteInput>;
    authorityFacts?: Partial<EvolutionDecisionAuthorityFacts>;
    createdAt?: string;
    updatedAt?: string;
  } = {},
): EvolutionEmployeeDecisionFact {
  const itemOverrides = overrides.item ?? {};
  return {
    item: decisionItem(itemOverrides),
    routeInput: decisionRouteInput({
      ...(itemOverrides.target ? { target: itemOverrides.target } : {}),
      ...(itemOverrides.surfaceId ? { surfaceId: itemOverrides.surfaceId } : {}),
      ...overrides.routeInput,
    }),
    authorityFacts: { ...DECISION_NO_AUTHORITY_FACTS, ...overrides.authorityFacts },
    createdAt: overrides.createdAt ?? DECISION_PRIOR_AS_OF,
    updatedAt: overrides.updatedAt ?? DECISION_CURRENT_AS_OF,
  };
}

/** Enterprise-decided item waiting on the owner's final authorization. */
export function participationDecisionFact(
  overrides: Partial<EvolutionDecisionItem> = {},
  authorityFacts: Partial<EvolutionDecisionAuthorityFacts> = {},
): EvolutionEmployeeDecisionFact {
  return decisionFact({
    authorityFacts,
    item: {
      decisionId: "dec-final",
      decisionType: "employee_final_authorization",
      requiredAuthority: "employee_and_enterprise",
      allowedActions: ["hold", "reject", "employee_final_authorization"],
      confidentialityScope: "enterprise",
      sourceEvidenceRefs: ["ev-enterprise-secret"],
      sourceFindingIds: ["finding-enterprise-secret"],
      sourceCaseId: "case-enterprise-secret",
      proposalId: "prop-enterprise-secret",
      ...overrides,
    },
    routeInput: {
      ownership: { kind: "agent_enterprise", delegated: true },
      touchesEmployeePersonalAsset: true,
    },
  });
}

export function decisionHistory(
  current: readonly EvolutionEmployeeDecisionFact[],
  prior: readonly EvolutionEmployeeDecisionFact[] | null,
): EvolutionEmployeeDecisionHistory {
  return {
    current: { asOf: DECISION_CURRENT_AS_OF, facts: current },
    prior: prior === null ? null : { asOf: DECISION_PRIOR_AS_OF, facts: prior },
  };
}

export function staticHistorySource(
  history: EvolutionEmployeeDecisionHistory,
): EvolutionDecisionHistorySource {
  return {
    async loadHistory() {
      return history;
    },
  };
}

export function failingHistorySource(): EvolutionDecisionHistorySource {
  return {
    async loadHistory() {
      throw new Error("timeline projection unavailable");
    },
  };
}

export function decisionGrant(actions: string[]): AuthorityGrantView {
  return {
    grantId: "grant-1",
    status: "APPROVED",
    tenantScope: "tenant-a",
    allowedEvidence: ["ev-1"],
    allowedActions: actions,
    confidentialityCeiling: "enterprise",
  };
}

export function decisionSubmitContext(
  item: EvolutionDecisionItem,
  overrides: Partial<EvolutionDecisionSubmitContext> = {},
): EvolutionDecisionSubmitContext {
  return {
    item,
    routeInput: decisionRouteInput({ target: item.target, surfaceId: item.surfaceId }),
    principal: decisionPrincipal(),
    grant: decisionGrant(["hold", "reject"]),
    facts: DECISION_NO_AUTHORITY_FACTS,
    prior: [],
    now: DECISION_CURRENT_AS_OF,
    ...overrides,
  };
}

/**
 * Contract words that must never be employee-visible text. They may appear
 * in types, `data-*` attributes, logs, and tests.
 */
export const DECISION_INTERNAL_CONTRACT_TOKENS = [
  "code-present",
  "runtime-enabled",
  "runtimeEnabled",
  "production-proven",
  "E5.2",
  "executed",
  "effectProof",
  "decision-plan",
  "decision-refusal",
  "auditReceiptRef",
  "requiredAuthority",
  "requiredPermissions",
  "allowedActions",
  "surfaceId",
  "decisionType",
  "agent.working-dna",
  "hold_or_resume",
  "employee_final_authorization",
  "employee_and_enterprise",
  "wrong_endpoint",
  "action_not_on_item",
  "handled",
  "admissible",
  "idempotent_replay",
  "version_mismatch",
  "endpoint_action_forbidden",
  "submit_context_unavailable",
  "pending-my-confirm",
  "system-done",
  "history-unavailable",
  "hold",
  "reject",
  "rollback",
] as const;

/** Text a person can read or hear: text nodes plus labelled attributes. */
export function userVisibleText(root: Element): string {
  const parts = [root.textContent ?? ""];
  for (const element of [root, ...root.querySelectorAll("*")]) {
    for (const attribute of ["title", "aria-label", "placeholder", "alt", "aria-description"]) {
      const value = element.getAttribute(attribute);
      if (value) {
        parts.push(value);
      }
    }
  }
  return parts.join("\n");
}
