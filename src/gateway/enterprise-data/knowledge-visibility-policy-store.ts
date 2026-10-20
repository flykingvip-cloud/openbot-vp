import { randomUUID } from "node:crypto";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import { findEnterpriseKnowledgeProjectionSpec } from "./projection-spec-store.js";
import {
  KNOWLEDGE_AGENT_TYPES,
  type EnterpriseDataStore,
  type KnowledgeAgentType,
  type KnowledgeVisibilityPolicy,
} from "./types.js";

export type KnowledgeVisibilityContext = {
  seatId: string;
  teamLabel?: string;
  departmentId?: string;
  roleCode?: string;
  /** Agent category (e.g. employee-agent), not agent instance id. */
  agentType?: KnowledgeAgentType;
};

function normalizeKnowledgeVisibilityPolicy(
  policy: KnowledgeVisibilityPolicy,
): KnowledgeVisibilityPolicy {
  return {
    ...policy,
    visibleDepartments: policy.visibleDepartments ?? [],
    visibleRoles: policy.visibleRoles ?? [],
    visibleAgentTypes: policy.visibleAgentTypes ?? [],
  };
}

function isKnowledgeAgentType(value: string): value is KnowledgeAgentType {
  return (KNOWLEDGE_AGENT_TYPES as readonly string[]).includes(value);
}

export function assertKnowledgeAgentTypes(
  agentTypes: string[],
): asserts agentTypes is KnowledgeAgentType[] {
  for (const agentType of agentTypes) {
    if (!isKnowledgeAgentType(agentType)) {
      throw new EnterpriseDataStoreError(
        "VISIBILITY_AGENT_TYPE_INVALID",
        `Unknown knowledge agent type: ${agentType}. Allowed: ${KNOWLEDGE_AGENT_TYPES.join(", ")}.`,
      );
    }
  }
}

export function listKnowledgeVisibilityPolicies(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  projectionId?: string;
}): KnowledgeVisibilityPolicy[] {
  return Object.values(params.store.knowledgeVisibilityPolicies)
    .map(normalizeKnowledgeVisibilityPolicy)
    .filter((policy) => {
      if (policy.tenantId !== params.tenantId) {
        return false;
      }
      if (params.projectionId && policy.projectionId !== params.projectionId) {
        return false;
      }
      return true;
    })
    .toSorted((left, right) => left.policyId.localeCompare(right.policyId));
}

export function findKnowledgeVisibilityPolicy(
  store: EnterpriseDataStore,
  tenantId: string,
  policyId: string,
): KnowledgeVisibilityPolicy | null {
  const policy = store.knowledgeVisibilityPolicies[policyId];
  if (!policy || policy.tenantId !== tenantId) {
    return null;
  }
  return normalizeKnowledgeVisibilityPolicy(policy);
}

export function upsertKnowledgeVisibilityPolicy(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  policy: Omit<
    KnowledgeVisibilityPolicy,
    "policyId" | "tenantId" | "createdAt" | "updatedAt" | "visibleAgentTypes"
  > & {
    policyId?: string;
    visibleAgentTypes: string[];
  };
  nowIso: string;
}): KnowledgeVisibilityPolicy {
  const projection = findEnterpriseKnowledgeProjectionSpec(
    params.store,
    params.tenantId,
    params.policy.projectionId,
  );
  if (!projection) {
    throw new EnterpriseDataStoreError("PROJECTION_NOT_FOUND", "Projection spec not found.");
  }
  assertKnowledgeAgentTypes(params.policy.visibleAgentTypes);
  const existing =
    params.policy.policyId != null
      ? findKnowledgeVisibilityPolicy(params.store, params.tenantId, params.policy.policyId)
      : null;
  const record: KnowledgeVisibilityPolicy = {
    policyId: params.policy.policyId ?? existing?.policyId ?? randomUUID(),
    tenantId: params.tenantId,
    projectionId: params.policy.projectionId,
    visibleSeats: [...params.policy.visibleSeats],
    visibleTeams: [...params.policy.visibleTeams],
    visibleDepartments: [
      ...(params.policy.visibleDepartments ?? existing?.visibleDepartments ?? []),
    ],
    visibleRoles: [...(params.policy.visibleRoles ?? existing?.visibleRoles ?? [])],
    visibleAgentTypes: [...params.policy.visibleAgentTypes],
    createdAt: existing?.createdAt ?? params.nowIso,
    updatedAt: params.nowIso,
  };
  params.store.knowledgeVisibilityPolicies[record.policyId] = record;
  return record;
}

export function evaluateKnowledgeVisibility(params: {
  policy: KnowledgeVisibilityPolicy;
  context: KnowledgeVisibilityContext;
}): boolean {
  const policy = normalizeKnowledgeVisibilityPolicy(params.policy);
  const { context } = params;
  if (policy.visibleSeats.includes(context.seatId)) {
    return true;
  }
  if (context.teamLabel && policy.visibleTeams.includes(context.teamLabel)) {
    return true;
  }
  if (context.departmentId && policy.visibleDepartments.includes(context.departmentId)) {
    return true;
  }
  if (context.roleCode && policy.visibleRoles.includes(context.roleCode)) {
    return true;
  }
  if (context.agentType && policy.visibleAgentTypes.includes(context.agentType)) {
    return true;
  }
  return false;
}

export function resolveVisibilityForFeedItem(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  projectionId: string;
  visibilityPolicyId?: string;
  context: KnowledgeVisibilityContext;
}): { visible: boolean; policyId?: string } {
  if (!params.visibilityPolicyId) {
    return { visible: true };
  }
  const policy = findKnowledgeVisibilityPolicy(
    params.store,
    params.tenantId,
    params.visibilityPolicyId,
  );
  if (!policy) {
    return { visible: false, policyId: params.visibilityPolicyId };
  }
  if (policy.projectionId !== params.projectionId) {
    return { visible: false, policyId: policy.policyId };
  }
  return {
    visible: evaluateKnowledgeVisibility({ policy, context: params.context }),
    policyId: policy.policyId,
  };
}
