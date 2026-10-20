/**
 * Audience projection. Omitted items are ids only, so evidence stays out of
 * the response for the wrong tenant or audience.
 */
import { confidentialityRank } from "../contracts.js";
import {
  evolutionTargetKey,
  type EvolutionConfidentialityScope,
  type EvolutionRiskLevel,
  type EvolutionTarget,
} from "../types.js";
import { evolutionDecisionEndpointAllows } from "./command-map.js";
import type {
  EvolutionDecisionAction,
  EvolutionDecisionEndpoint,
  EvolutionDecisionItem,
  EvolutionDecisionPrincipal,
  EvolutionDecisionRequiredAuthority,
  EvolutionDecisionType,
} from "./dto.js";
import type { EvolutionDecisionRoute } from "./router.js";

/**
 * Employee participation view. Enterprise evidence and control-plane ids stay
 * on the server item and are not copied here.
 */
export type EvolutionDecisionEmployeeParticipationView = {
  schemaVersion: 1;
  decisionId: string;
  decisionVersion: string;
  tenantScope: string | null;
  target: EvolutionTarget;
  surfaceId: string;
  decisionType: EvolutionDecisionType;
  requiredAuthority: EvolutionDecisionRequiredAuthority;
  allowedActions: readonly EvolutionDecisionAction[];
  status: EvolutionDecisionItem["status"];
  expiresAt?: string;
  riskLevel: EvolutionRiskLevel;
  confidentialityScope: EvolutionConfidentialityScope;
};

export const EVOLUTION_DECISION_ENTERPRISE_PARTICIPATIONS = [
  "employee_final_authorization",
  "enterprise_canary",
] as const;
export type EvolutionDecisionEnterpriseParticipation =
  (typeof EVOLUTION_DECISION_ENTERPRISE_PARTICIPATIONS)[number];

/**
 * Enterprise participation view. The enterprise sees that a decision needs
 * its part, not the evidence behind it. Evidence refs, findings, case, and
 * control-plane ids stay on the server item and are not copied here.
 *
 * - `employee_final_authorization`: an enterprise-side change that touches an
 *   employee's personal asset. The enterprise decides; actions are the
 *   item's actions within the enterprise matrix, and the judge still waits
 *   for the employee's final authorization.
 * - `enterprise_canary`: a platform change that affects this tenant, on a
 *   decision scoped to this tenant. Only `participate_canary` is offered.
 */
export type EvolutionDecisionEnterpriseParticipationView = {
  schemaVersion: 1;
  decisionId: string;
  decisionVersion: string;
  tenantScope: string | null;
  target: EvolutionTarget;
  surfaceId: string;
  decisionType: EvolutionDecisionType;
  requiredAuthority: EvolutionDecisionRequiredAuthority;
  participation: EvolutionDecisionEnterpriseParticipation;
  allowedActions: readonly EvolutionDecisionAction[];
  status: EvolutionDecisionItem["status"];
  expiresAt?: string;
  riskLevel: EvolutionRiskLevel;
  confidentialityScope: EvolutionConfidentialityScope;
};

export type EvolutionDecisionAudienceView =
  | { kind: "item"; item: EvolutionDecisionItem }
  | { kind: "employee_participation"; view: EvolutionDecisionEmployeeParticipationView }
  | { kind: "enterprise_participation"; view: EvolutionDecisionEnterpriseParticipationView };

/**
 * Which enterprise participation applies, if any. Cross-tenant repeats stay
 * a redacted platform case and never become an enterprise canary view.
 */
function enterpriseParticipationOf(
  route: Extract<EvolutionDecisionRoute, { ok: true }>,
  principal: EvolutionDecisionPrincipal,
): EvolutionDecisionEnterpriseParticipation | null {
  if (principal.audience !== "enterprise") {
    return null;
  }
  if (route.endpoint === "enterprise" && route.participation === "employee_final_authorization") {
    return "employee_final_authorization";
  }
  if (
    route.endpoint === "platform" &&
    route.participation === "enterprise_canary" &&
    route.reason !== "cross_tenant_repeat"
  ) {
    return "enterprise_canary";
  }
  return null;
}

function enterpriseParticipationView(
  item: EvolutionDecisionItem,
  participation: EvolutionDecisionEnterpriseParticipation,
): EvolutionDecisionEnterpriseParticipationView {
  return {
    schemaVersion: 1,
    decisionId: item.decisionId,
    decisionVersion: item.decisionVersion,
    tenantScope: item.tenantScope,
    target: item.target,
    surfaceId: item.surfaceId,
    decisionType: item.decisionType,
    requiredAuthority: item.requiredAuthority,
    participation,
    allowedActions: item.allowedActions.filter((action) =>
      participation === "enterprise_canary"
        ? action === "participate_canary"
        : action !== "participate_canary" && evolutionDecisionEndpointAllows("enterprise", action),
    ),
    status: item.status,
    ...(item.expiresAt ? { expiresAt: item.expiresAt } : {}),
    riskLevel: item.riskLevel,
    confidentialityScope: item.confidentialityScope,
  };
}

function employeeParticipationView(
  item: EvolutionDecisionItem,
): EvolutionDecisionEmployeeParticipationView {
  return {
    schemaVersion: 1,
    decisionId: item.decisionId,
    decisionVersion: item.decisionVersion,
    tenantScope: item.tenantScope,
    target: item.target,
    surfaceId: item.surfaceId,
    decisionType: item.decisionType,
    requiredAuthority: item.requiredAuthority,
    allowedActions: item.allowedActions.filter((action) =>
      evolutionDecisionEndpointAllows("employee", action),
    ),
    status: item.status,
    ...(item.expiresAt ? { expiresAt: item.expiresAt } : {}),
    riskLevel: item.riskLevel,
    confidentialityScope: item.confidentialityScope,
  };
}

export type EvolutionDecisionVisibilityDenial =
  | "tenant_mismatch"
  | "audience_mismatch"
  | "confidentiality"
  | "owner_mismatch"
  | "route_binding_mismatch"
  | "unrouted";

function audienceCeiling(audience: EvolutionDecisionEndpoint): EvolutionConfidentialityScope {
  if (audience === "employee") {
    return "personal";
  }
  if (audience === "enterprise") {
    return "enterprise";
  }
  return "platform";
}

export function evolutionDecisionTenantMatches(
  item: Pick<EvolutionDecisionItem, "tenantScope" | "confidentialityScope">,
  principal: EvolutionDecisionPrincipal,
): boolean {
  if (item.tenantScope !== null && item.tenantScope === principal.trustedTenantId) {
    return true;
  }
  return (
    item.tenantScope === null &&
    principal.trustedTenantId === null &&
    principal.platformOperator &&
    principal.audience === "platform" &&
    item.confidentialityScope === "platform"
  );
}

function ownerMatches(item: EvolutionDecisionItem, principal: EvolutionDecisionPrincipal): boolean {
  if (principal.audience !== "employee") {
    return true;
  }
  if (item.target.domain === "agent") {
    return Boolean(principal.ownerAgentId) && principal.ownerAgentId === item.target.agentId;
  }
  if (item.target.domain === "knowledge") {
    return Boolean(principal.ownerAssetId) && principal.ownerAssetId === item.target.assetId;
  }
  return false;
}

export function projectEvolutionDecisionAudience(input: {
  item: EvolutionDecisionItem;
  route: EvolutionDecisionRoute;
  principal: EvolutionDecisionPrincipal;
}): { visible: true } | { visible: false; code: EvolutionDecisionVisibilityDenial } {
  if (!input.route.ok) {
    return { visible: false, code: "unrouted" };
  }
  if (
    input.route.targetKey !== evolutionTargetKey(input.item.target) ||
    input.route.surfaceId !== input.item.surfaceId ||
    input.route.requiredAuthority !== input.item.requiredAuthority
  ) {
    return { visible: false, code: "route_binding_mismatch" };
  }
  if (!evolutionDecisionTenantMatches(input.item, input.principal)) {
    return { visible: false, code: "tenant_mismatch" };
  }
  const employeeFinal =
    input.principal.audience === "employee" &&
    input.route.participation === "employee_final_authorization";
  const enterpriseCanary =
    enterpriseParticipationOf(input.route, input.principal) === "enterprise_canary";
  if (input.principal.audience !== input.route.endpoint && !employeeFinal && !enterpriseCanary) {
    return { visible: false, code: "audience_mismatch" };
  }
  if (!ownerMatches(input.item, input.principal)) {
    return { visible: false, code: "owner_mismatch" };
  }
  // Participation views are redacted, so they may show items one level above
  // the audience ceiling: enterprise items to the owning employee, platform
  // canary items to the affected enterprise.
  const ceiling = employeeFinal
    ? "enterprise"
    : enterpriseCanary
      ? "platform"
      : audienceCeiling(input.principal.audience);
  if (confidentialityRank(input.item.confidentialityScope) > confidentialityRank(ceiling)) {
    return { visible: false, code: "confidentiality" };
  }
  return { visible: true };
}

export function projectEvolutionDecisionVisibility(input: {
  entries: readonly { item: EvolutionDecisionItem; route: EvolutionDecisionRoute }[];
  principal: EvolutionDecisionPrincipal;
}): {
  visible: EvolutionDecisionAudienceView[];
  omitted: { decisionId: string; code: EvolutionDecisionVisibilityDenial }[];
} {
  const visible: EvolutionDecisionAudienceView[] = [];
  const omitted: { decisionId: string; code: EvolutionDecisionVisibilityDenial }[] = [];
  for (const entry of input.entries) {
    const verdict = projectEvolutionDecisionAudience({
      item: entry.item,
      route: entry.route,
      principal: input.principal,
    });
    if (!verdict.visible) {
      omitted.push({ decisionId: entry.item.decisionId, code: verdict.code });
      continue;
    }
    const employeeFinal =
      input.principal.audience === "employee" &&
      entry.route.ok &&
      entry.route.participation === "employee_final_authorization";
    const enterpriseParticipation = entry.route.ok
      ? enterpriseParticipationOf(entry.route, input.principal)
      : null;
    if (employeeFinal) {
      visible.push({ kind: "employee_participation", view: employeeParticipationView(entry.item) });
    } else if (enterpriseParticipation) {
      visible.push({
        kind: "enterprise_participation",
        view: enterpriseParticipationView(entry.item, enterpriseParticipation),
      });
    } else {
      visible.push({ kind: "item", item: entry.item });
    }
  }
  return { visible, omitted };
}
