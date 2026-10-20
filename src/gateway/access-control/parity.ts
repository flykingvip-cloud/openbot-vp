// Feature: shared-agent-identity-access-control-plane

import type { AgentRegistryStore } from "../agent-registry/types.js";
import { evaluateAgentAssetAccess } from "./policy-v2-evaluator.js";
import type {
  AccessDecision,
  AccessPermission,
  AccessResourceRef,
  AccessSubject,
  EnterpriseAccessPolicyV2,
} from "./policy-v2-types.js";

/**
 * One authorization the current (v1) world grants, restated as a V2 question.
 *
 * Parity checking asks the V2 evaluator the same questions v1 answers today. Any
 * disagreement is what would change the moment enforcement is switched on, so it must
 * be reviewed before flipping a tenant rather than discovered from user reports.
 */
export type ParityExpectation = {
  /** Source v1 policy id, so a divergence can be traced back. */
  sourcePolicyId: string;
  subject: AccessSubject;
  resource: AccessResourceRef;
  permission: AccessPermission;
  /** What v1 grants today. Revoked rows are expected to be denied. */
  expected: "allow" | "deny";
};

/** A single v1 policy row, before rows are collapsed into one question per grant. */
export type ParityGrantRow = {
  sourcePolicyId: string;
  subject: AccessSubject;
  resource: AccessResourceRef;
  permission: AccessPermission;
  revoked: boolean;
};

function grantKey(row: ParityGrantRow): string {
  return [
    row.subject.subjectType,
    row.subject.subjectId,
    row.resource.resourceType,
    row.resource.resourceId,
    row.permission,
  ].join("|");
}

/**
 * Collapses v1 rows into one expectation per distinct (subject, resource, action) grant.
 *
 * v1 answers "is this allowed?" by looking for *any* active row, so a revoked row is only
 * a denial when no active row grants the same thing. Historic revoked rows frequently sit
 * alongside a live re-grant; expecting those to deny would report divergences that do not
 * exist in the running system.
 */
export function resolveParityExpectations(rows: ParityGrantRow[]): ParityExpectation[] {
  const grants = new Map<string, ParityExpectation>();
  for (const row of rows) {
    const key = grantKey(row);
    const existing = grants.get(key);
    if (existing?.expected === "allow") {
      continue;
    }
    const expectation: ParityExpectation = {
      sourcePolicyId: row.sourcePolicyId,
      subject: row.subject,
      resource: row.resource,
      permission: row.permission,
      expected: row.revoked ? "deny" : "allow",
    };
    // An active row wins over any revoked row for the same grant.
    if (!existing || expectation.expected === "allow") {
      grants.set(key, expectation);
    }
  }
  return [...grants.values()];
}

export type ParityDivergence = {
  sourcePolicyId: string;
  subjectType: AccessSubject["subjectType"];
  subjectId: string;
  resourceType: AccessResourceRef["resourceType"];
  resourceId: string;
  permission: AccessPermission;
  expected: "allow" | "deny";
  actual: "allow" | "deny";
  reason?: string;
};

export type ParityReport = {
  checked: number;
  agreed: number;
  divergences: ParityDivergence[];
  /** Divergence counts keyed by the evaluator's deny reason, for triage. */
  reasonCounts: Record<string, number>;
};

export type CheckParityParams = {
  expectations: ParityExpectation[];
  policies: EnterpriseAccessPolicyV2[];
  registry: AgentRegistryStore;
  resolveMembershipSubject?: (membershipId: string) => AccessSubject | null;
  /** Injectable for tests; defaults to the real evaluator. */
  evaluate?: (params: {
    policies: EnterpriseAccessPolicyV2[];
    registry: AgentRegistryStore;
    subject: AccessSubject;
    resource: AccessResourceRef;
    permission: string;
  }) => AccessDecision;
};

/**
 * Compares the V2 verdict against what v1 grants today.
 *
 * This is deliberately an offline batch check rather than an audit hook on every
 * request: the same evidence is produced completely and repeatably, without adding I/O
 * to a hot authorization path.
 */
export function checkAccessParity(params: CheckParityParams): ParityReport {
  const evaluate = params.evaluate ?? evaluateAgentAssetAccess;
  const divergences: ParityDivergence[] = [];
  const reasonCounts: Record<string, number> = {};
  let agreed = 0;

  for (const expectation of params.expectations) {
    const decision = evaluate({
      policies: params.policies,
      registry: params.registry,
      subject: expectation.subject,
      resource: expectation.resource,
      permission: expectation.permission,
      ...(params.resolveMembershipSubject
        ? { resolveMembershipSubject: params.resolveMembershipSubject }
        : {}),
    });
    const actual = decision.allowed ? "allow" : "deny";
    if (actual === expectation.expected) {
      agreed += 1;
      continue;
    }
    const reason = decision.allowed ? undefined : decision.reason;
    if (reason) {
      reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    }
    divergences.push({
      sourcePolicyId: expectation.sourcePolicyId,
      subjectType: expectation.subject.subjectType,
      subjectId: expectation.subject.subjectId,
      resourceType: expectation.resource.resourceType,
      resourceId: expectation.resource.resourceId,
      permission: expectation.permission,
      expected: expectation.expected,
      actual,
      ...(reason ? { reason } : {}),
    });
  }

  return { checked: params.expectations.length, agreed, divergences, reasonCounts };
}
