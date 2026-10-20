import {
  evaluateKnowledgeVisibility,
  resolveVisibilityForFeedItem,
  type KnowledgeVisibilityContext,
} from "../../enterprise-data/knowledge-visibility-policy-store.js";
import type { EnterpriseDataStore } from "../../enterprise-data/types.js";
import type { KnowledgeSourceContext } from "../sources/types.js";
import type { KnowledgeAccessState } from "../types.js";

export function toKnowledgeVisibilityContext(
  context: KnowledgeSourceContext,
): KnowledgeVisibilityContext | null {
  if (!context.seatId) {
    return null;
  }
  return {
    seatId: context.seatId,
    teamLabel: context.teamLabel ?? undefined,
    departmentId: context.departmentId ?? undefined,
    roleCode: context.roleCode ?? undefined,
    agentType: context.agentType ?? undefined,
  };
}

export function evaluateProjectionVisibility(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  projectionId: string;
  visibilityPolicyId?: string;
  context: KnowledgeSourceContext;
}): { visible: boolean; accessState: KnowledgeAccessState } {
  const visibilityContext = toKnowledgeVisibilityContext(params.context);
  if (!params.visibilityPolicyId) {
    return { visible: true, accessState: "accessible" };
  }
  if (!visibilityContext) {
    return { visible: false, accessState: "restricted" };
  }
  const resolved = resolveVisibilityForFeedItem({
    store: params.store,
    tenantId: params.tenantId,
    projectionId: params.projectionId,
    visibilityPolicyId: params.visibilityPolicyId,
    context: visibilityContext,
  });
  return {
    visible: resolved.visible,
    accessState: resolved.visible ? "accessible" : "restricted",
  };
}

export function visibilityScopeLabel(params: {
  scopeApplied?: string;
  visibilityPolicyId?: string;
  accessState: KnowledgeAccessState;
}): string {
  if (params.accessState === "restricted") {
    return "需申请访问权限";
  }
  if (params.scopeApplied?.trim()) {
    return params.scopeApplied.trim();
  }
  if (params.visibilityPolicyId) {
    return "受限知识空间";
  }
  return "企业知识库";
}

export function evaluatePolicyVisibility(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  policyId: string;
  context: KnowledgeSourceContext;
}): boolean {
  const visibilityContext = toKnowledgeVisibilityContext(params.context);
  if (!visibilityContext) {
    return false;
  }
  const policy = params.store.knowledgeVisibilityPolicies[params.policyId];
  if (!policy || policy.tenantId !== params.tenantId) {
    return false;
  }
  return evaluateKnowledgeVisibility({ policy, context: visibilityContext });
}
