import { listDataAccessPolicies } from "./data-access-policy-store.js";
import {
  buildConnectorActionRefKey,
  type ConnectorActionRef,
  type EnterpriseDataStore,
  type SeatActionGrant,
} from "./types.js";

function policyIncludesRef(
  policy: { actionRefs: ConnectorActionRef[] },
  ref: ConnectorActionRef,
): boolean {
  const key = buildConnectorActionRefKey(ref);
  return policy.actionRefs.some((entry) => buildConnectorActionRefKey(entry) === key);
}

function syntheticGrant(params: {
  tenantId: string;
  seatId: string;
  ref: ConnectorActionRef;
  policyId: string;
  scopePolicyId?: string;
  approvalPolicyId?: string;
}): SeatActionGrant {
  return {
    grantId: `policy-backed:${params.policyId}:${buildConnectorActionRefKey(params.ref)}`,
    tenantId: params.tenantId,
    seatId: params.seatId,
    connectorId: params.ref.connectorId,
    actionKey: params.ref.actionKey,
    version: params.ref.version,
    scopePolicyId: params.scopePolicyId,
    approvalPolicyId: params.approvalPolicyId,
    dataAccessPolicyId: params.policyId,
    effect: "allow",
    createdAt: new Date().toISOString(),
  };
}

/**
 * Resolves a runtime grant from department/role DataAccessPolicy when no compiled
 * SeatActionGrant exists for the seat.
 */
export function resolvePolicyBackedSeatActionGrant(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  seatId: string;
  ref: ConnectorActionRef;
  departmentId?: string;
  roleCode?: string;
}): SeatActionGrant | null {
  const policies = listDataAccessPolicies({
    store: params.store,
    tenantId: params.tenantId,
  });
  for (const policy of policies) {
    // Only enabled policies can back a runtime grant; listDataAccessPolicies
    // returns all policies regardless of enabled state, so filter here.
    if (!policy.enabled) {
      continue;
    }
    if (!policyIncludesRef(policy, params.ref)) {
      continue;
    }
    if (policy.targetKind === "department" && params.departmentId === policy.targetId) {
      return syntheticGrant({
        tenantId: params.tenantId,
        seatId: params.seatId,
        ref: params.ref,
        policyId: policy.policyId,
        scopePolicyId: policy.scopePolicyId,
        approvalPolicyId: policy.approvalPolicyId,
      });
    }
    if (policy.targetKind === "role" && params.roleCode === policy.targetId) {
      return syntheticGrant({
        tenantId: params.tenantId,
        seatId: params.seatId,
        ref: params.ref,
        policyId: policy.policyId,
        scopePolicyId: policy.scopePolicyId,
        approvalPolicyId: policy.approvalPolicyId,
      });
    }
  }
  return null;
}
