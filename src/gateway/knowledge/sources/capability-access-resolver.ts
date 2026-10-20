import { listDataAccessPolicies } from "../../enterprise-data/data-access-policy-store.js";
import {
  buildConnectorActionRefKey,
  type DataCapability,
  type DataAccessPolicy,
  type EnterpriseDataStore,
  type SeatActionGrant,
} from "../../enterprise-data/types.js";

export type CapabilityAccessState = "granted" | "requestable" | "external" | "pending";

export type KnowledgeCapabilityAccessContext = {
  tenantId: string;
  seatId?: string | null;
  departmentId?: string | null;
  roleCode?: string | null;
};

function capabilityRefsCoveredByPolicy(
  capability: DataCapability,
  policy: DataAccessPolicy,
): boolean {
  if (!policy.enabled || policy.actionRefs.length === 0) {
    return false;
  }
  const policyKeys = new Set(
    policy.actionRefs.map((ref) =>
      buildConnectorActionRefKey({
        connectorId: ref.connectorId,
        actionKey: ref.actionKey,
        version: ref.version,
      }),
    ),
  );
  return capability.actionRefs.every((ref) =>
    policyKeys.has(
      buildConnectorActionRefKey({
        connectorId: ref.connectorId,
        actionKey: ref.actionKey,
        version: ref.version,
      }),
    ),
  );
}

function capabilityGrantedByDepartmentOrRolePolicies(params: {
  store: EnterpriseDataStore;
  capability: DataCapability;
  context: KnowledgeCapabilityAccessContext;
}): boolean {
  const policies = listDataAccessPolicies({
    store: params.store,
    tenantId: params.context.tenantId,
  });
  for (const policy of policies) {
    if (policy.targetKind === "department") {
      if (
        params.context.departmentId &&
        policy.targetId === params.context.departmentId &&
        capabilityRefsCoveredByPolicy(params.capability, policy)
      ) {
        return true;
      }
      continue;
    }
    if (policy.targetKind === "role") {
      if (
        params.context.roleCode &&
        policy.targetId === params.context.roleCode &&
        capabilityRefsCoveredByPolicy(params.capability, policy)
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Seat grant coverage only. Live DataSource category and connection status are
 * not access truth: a disconnected or "external" source must not become
 * accessState "external", and must not change granted vs requestable.
 */
export function resolveCapabilityAccessState(params: {
  capability: DataCapability;
  grants: SeatActionGrant[];
}): CapabilityAccessState {
  const refs = params.capability.actionRefs;
  if (refs.length === 0) {
    return "requestable";
  }
  const grantKeys = new Set(
    params.grants.map((grant) =>
      buildConnectorActionRefKey({
        connectorId: grant.connectorId,
        actionKey: grant.actionKey,
        version: grant.version,
      }),
    ),
  );
  const covered = refs.every((ref) => grantKeys.has(buildConnectorActionRefKey(ref)));
  if (covered) {
    return "granted";
  }
  return "requestable";
}

export function resolveCapabilityAccessForKnowledge(params: {
  store: EnterpriseDataStore;
  capability: DataCapability;
  context: KnowledgeCapabilityAccessContext;
  grants: SeatActionGrant[];
}): CapabilityAccessState {
  const seatState = resolveCapabilityAccessState({
    capability: params.capability,
    grants: params.grants,
  });
  if (seatState === "granted") {
    return "granted";
  }
  if (capabilityGrantedByDepartmentOrRolePolicies(params)) {
    return "granted";
  }
  return seatState;
}

/**
 * Count capabilities already labeled external by a persisted access decision.
 * Does not inspect live DataSource category or connection status.
 */
export function countExternalAccessCapabilities(
  capabilities: readonly { accessState: CapabilityAccessState }[],
): number {
  return capabilities.filter((item) => item.accessState === "external").length;
}
