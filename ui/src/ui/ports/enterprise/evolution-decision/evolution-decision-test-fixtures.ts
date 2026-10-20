/**
 * Test fixtures for the enterprise Decision Surface. Test-only: nothing in the
 * product imports this module. Facts here stand in for the server-side
 * Timeline/Ledger read projection that D3 does not ship.
 */

import type {
  AuthorityGrantView,
  EvolutionDecisionAuthorityFacts,
  EvolutionDecisionItem,
  EvolutionDecisionPrincipal,
  EvolutionDecisionRouteInput,
  EvolutionEnterpriseDecisionFact,
  EvolutionEnterpriseDecisionHistory,
} from "@openbot/evolution-core";
import type {
  EvolutionEnterpriseDecisionCommandIdFactory,
  EvolutionEnterpriseDecisionHistorySource,
  EvolutionEnterpriseDecisionSubmitContext,
} from "./types.ts";

export const ENTERPRISE_CURRENT_AS_OF = "2026-09-28T12:00:00.000Z";
export const ENTERPRISE_PRIOR_AS_OF = "2026-09-21T12:00:00.000Z";
export const ENTERPRISE_LATER = "2026-10-05T00:00:00.000Z";

/** Neither participation recorded yet. */
export const ENTERPRISE_NO_AUTHORITY_FACTS: EvolutionDecisionAuthorityFacts = Object.freeze({
  enterpriseCanaryAcknowledged: false,
  employeeFinalAuthorization: false,
});

export function enterpriseGrant(
  actions: string[],
  overrides: Partial<AuthorityGrantView> = {},
): AuthorityGrantView {
  return {
    grantId: "grant-enterprise",
    status: "APPROVED",
    tenantScope: "tenant-a",
    allowedEvidence: ["ev-1"],
    allowedActions: actions,
    confidentialityCeiling: "enterprise",
    ...overrides,
  };
}

/** Enterprise knowledge decision by default. */
export function enterpriseItem(
  overrides: Partial<EvolutionDecisionItem> = {},
): EvolutionDecisionItem {
  return {
    schemaVersion: 1,
    decisionId: "dec-k",
    decisionVersion: "dv-1",
    tenantScope: "tenant-a",
    target: { domain: "knowledge", assetId: "asset-1" },
    surfaceId: "knowledge.experience-capsule",
    sourceFindingIds: ["finding-1"],
    sourceEvidenceRefs: ["ev-1"],
    proposalId: "prop-k",
    decisionType: "hold_or_resume",
    requiredAuthority: "enterprise",
    allowedActions: ["hold", "reject", "start_experiment"],
    status: "pending",
    expiresAt: ENTERPRISE_LATER,
    riskLevel: "medium",
    confidentialityScope: "enterprise",
    ...overrides,
  };
}

/** Server-resolved enterprise admin of tenant-a. */
export function enterprisePrincipal(
  overrides: Partial<EvolutionDecisionPrincipal> = {},
): EvolutionDecisionPrincipal {
  return {
    audience: "enterprise",
    trustedTenantId: "tenant-a",
    platformOperator: false,
    enterpriseAdmin: true,
    ...overrides,
  };
}

export function enterpriseRouteInput(
  overrides: Partial<EvolutionDecisionRouteInput> = {},
): EvolutionDecisionRouteInput {
  return {
    target: { domain: "knowledge", assetId: "asset-1" },
    surfaceId: "knowledge.experience-capsule",
    ownership: { kind: "knowledge_enterprise" },
    crossTenantRepeat: false,
    platformFixAffectsEnterprise: false,
    touchesEmployeePersonalAsset: false,
    ...overrides,
  };
}

export type EnterpriseFactOverrides = {
  item?: Partial<EvolutionDecisionItem>;
  routeInput?: Partial<EvolutionDecisionRouteInput>;
  authorityFacts?: Partial<EvolutionDecisionAuthorityFacts>;
  grant?: EvolutionEnterpriseDecisionFact["grant"];
};

export function enterpriseFact(
  overrides: EnterpriseFactOverrides = {},
): EvolutionEnterpriseDecisionFact {
  const itemOverrides = overrides.item ?? {};
  return {
    item: enterpriseItem(itemOverrides),
    routeInput: enterpriseRouteInput({
      ...(itemOverrides.target ? { target: itemOverrides.target } : {}),
      ...(itemOverrides.surfaceId ? { surfaceId: itemOverrides.surfaceId } : {}),
      ...overrides.routeInput,
    }),
    authorityFacts: { ...ENTERPRISE_NO_AUTHORITY_FACTS, ...overrides.authorityFacts },
    grant: overrides.grant ?? enterpriseGrant(["hold", "reject", "experiment"]),
    createdAt: ENTERPRISE_PRIOR_AS_OF,
    updatedAt: ENTERPRISE_CURRENT_AS_OF,
  };
}

/** Values of an employee's personal decision that must never reach the page. */
export const PERSONAL_SECRETS = [
  "ev-personal-secret",
  "finding-personal-secret",
  "case-personal-secret",
  "prop-personal-secret",
  "app-personal-secret",
  "ver-personal-secret",
  "grant-ref-personal-secret",
  "delegation-ref-personal-secret",
  "grant-personal-secret",
] as const;

/** Delegated enterprise change on an employee's personal agent. */
export function personalParticipationFact(
  overrides: EnterpriseFactOverrides = {},
): EvolutionEnterpriseDecisionFact {
  return enterpriseFact({
    ...overrides,
    item: {
      decisionId: "dec-personal",
      target: { domain: "agent", agentId: "agent-7" },
      surfaceId: "agent.working-dna",
      requiredAuthority: "employee_and_enterprise",
      confidentialityScope: "personal",
      sourceEvidenceRefs: ["ev-personal-secret"],
      sourceFindingIds: ["finding-personal-secret"],
      sourceCaseId: "case-personal-secret",
      proposalId: "prop-personal-secret",
      applicationId: "app-personal-secret",
      verificationId: "ver-personal-secret",
      evidenceAccessGrantRef: "grant-ref-personal-secret",
      delegationGrantRef: "delegation-ref-personal-secret",
      allowedActions: [
        "hold",
        "reject",
        "start_experiment",
        "apply_canary",
        "promote",
        "employee_final_authorization",
      ],
      ...overrides.item,
    },
    routeInput: {
      ownership: { kind: "agent_enterprise", delegated: true },
      touchesEmployeePersonalAsset: true,
      ...overrides.routeInput,
    },
    grant:
      overrides.grant ??
      enterpriseGrant(["hold", "reject", "experiment", "apply", "promote"], {
        grantId: "grant-personal-secret",
        allowedEvidence: ["ev-personal-secret"],
      }),
  });
}

/** Values of a platform decision that must never reach the page. */
export const PLATFORM_SECRETS = [
  "ev-platform-secret",
  "finding-platform-secret",
  "case-platform-secret",
  "prop-platform-secret",
  "app-platform-secret",
  "system:runtime",
] as const;

/** Platform change that affects this tenant, scoped to this tenant. */
export function canaryParticipationFact(
  overrides: EnterpriseFactOverrides = {},
): EvolutionEnterpriseDecisionFact {
  return enterpriseFact({
    ...overrides,
    item: {
      decisionId: "dec-canary",
      target: { domain: "system", componentId: "runtime" },
      surfaceId: "system.runtime-binding-governance",
      requiredAuthority: "platform_and_enterprise",
      confidentialityScope: "platform",
      decisionType: "canary_participation",
      sourceEvidenceRefs: ["ev-platform-secret"],
      sourceFindingIds: ["finding-platform-secret"],
      sourceCaseId: "case-platform-secret",
      proposalId: "prop-platform-secret",
      applicationId: "app-platform-secret",
      allowedActions: ["participate_canary", "apply_canary", "promote"],
      ...overrides.item,
    },
    routeInput: {
      ownership: { kind: "system" },
      platformFixAffectsEnterprise: true,
      ...overrides.routeInput,
    },
    grant: overrides.grant ?? { status: "missing" },
  });
}

export function enterpriseHistory(
  current: readonly EvolutionEnterpriseDecisionFact[],
  prior: readonly EvolutionEnterpriseDecisionFact[] | null,
  asOf: { current?: string; prior?: string } = {},
): EvolutionEnterpriseDecisionHistory {
  return {
    current: { asOf: asOf.current ?? ENTERPRISE_CURRENT_AS_OF, facts: current },
    prior: prior === null ? null : { asOf: asOf.prior ?? ENTERPRISE_PRIOR_AS_OF, facts: prior },
  };
}

/** Injected read-only source that counts how often it was read. */
export function staticEnterpriseHistorySource(
  history: EvolutionEnterpriseDecisionHistory,
): EvolutionEnterpriseDecisionHistorySource & { readonly calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async loadHistory() {
      calls += 1;
      return history;
    },
  };
}

export function failingEnterpriseHistorySource(): EvolutionEnterpriseDecisionHistorySource {
  return {
    async loadHistory() {
      throw new Error("timeline projection unavailable");
    },
  };
}

/** Server-resolved submit context for one fact. */
export function enterpriseSubmitContext(
  fact: EvolutionEnterpriseDecisionFact,
  overrides: Partial<EvolutionEnterpriseDecisionSubmitContext> = {},
): EvolutionEnterpriseDecisionSubmitContext {
  return {
    item: fact.item,
    routeInput: fact.routeInput,
    principal: enterprisePrincipal(),
    grant: fact.grant,
    facts: fact.authorityFacts,
    prior: [],
    now: ENTERPRISE_CURRENT_AS_OF,
    ...overrides,
  };
}

/** Deterministic command ids: `<prefix>-1`, `<prefix>-2`, … */
export function sequentialCommandIds(
  prefix = "cmd-ent",
): EvolutionEnterpriseDecisionCommandIdFactory & { readonly issued: readonly string[] } {
  const issued: string[] = [];
  const factory = () => {
    const id = `${prefix}-${issued.length + 1}`;
    issued.push(id);
    return id;
  };
  return Object.assign(factory, { issued });
}

/**
 * Contract words that must never be admin-visible text. They may appear in
 * types, `data-*` attributes, logs, and tests.
 */
export const ENTERPRISE_DECISION_INTERNAL_CONTRACT_TOKENS = [
  "code-present",
  "runtime-enabled",
  "runtimeEnabled",
  "production-proven",
  "productionProven",
  "E5.2",
  "executed",
  "effectProof",
  "writes",
  "commandId",
  "decisionId",
  "decisionVersion",
  "auditReceiptRef",
  "decision-plan",
  "decision-refusal",
  "requiredAuthority",
  "requiredPermissions",
  "allowedActions",
  "actionReasons",
  "surfaceId",
  "decisionType",
  "uiStatus",
  "knowledge.experience-capsule",
  "agent.working-dna",
  "system.runtime-binding-governance",
  "hold_or_resume",
  "canary_participation",
  "enterprise_participation",
  "employee_final_authorization",
  "participate_canary",
  "start_experiment",
  "apply_canary",
  "employee_and_enterprise",
  "platform_and_enterprise",
  "pending-enterprise-decision",
  "waiting-employee-authorization",
  "participate-platform-canary",
  "history-unavailable",
  "admissible",
  "idempotent_replay",
  "participation_already_satisfied",
  "employee_authorization_required",
  "submit_context_unavailable",
  "command_id_unavailable",
  "action_not_on_item",
  "withheld",
  "hold",
  "reject",
  "promote",
] as const;

/** Text a person can read or hear: text nodes plus labelled attributes. */
export function enterpriseUserVisibleText(root: Element): string {
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
