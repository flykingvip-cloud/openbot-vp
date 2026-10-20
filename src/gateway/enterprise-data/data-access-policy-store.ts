import { randomUUID } from "node:crypto";
import { findApprovalPolicy } from "./approval-policy-store.js";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import { validateCapabilityActionRefs } from "./data-capability-store.js";
import { findDataSource } from "./data-source-store.js";
import { findScopePolicy } from "./scope-policy-store.js";
import { upsertSeatActionGrant } from "./seat-action-grant-store.js";
import type {
  ConnectorActionRef,
  DataAccessPolicy,
  EnterpriseDataStore,
  SeatActionGrant,
} from "./types.js";

export function listDataAccessPolicies(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  targetKind?: DataAccessPolicy["targetKind"];
  targetId?: string;
  sourceId?: string;
}): DataAccessPolicy[] {
  return Object.values(params.store.dataAccessPolicies)
    .filter((policy) => {
      if (policy.tenantId !== params.tenantId) {
        return false;
      }
      if (params.targetKind && policy.targetKind !== params.targetKind) {
        return false;
      }
      if (params.targetId && policy.targetId !== params.targetId) {
        return false;
      }
      if (params.sourceId && policy.sourceId !== params.sourceId) {
        return false;
      }
      return true;
    })
    .toSorted((left, right) => left.displayName.localeCompare(right.displayName));
}

export function findDataAccessPolicy(
  store: EnterpriseDataStore,
  tenantId: string,
  policyId: string,
): DataAccessPolicy | null {
  const policy = store.dataAccessPolicies[policyId];
  if (!policy || policy.tenantId !== tenantId) {
    return null;
  }
  return policy;
}

export function upsertDataAccessPolicy(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  policy: Omit<
    DataAccessPolicy,
    "policyId" | "tenantId" | "createdAt" | "updatedAt" | "compiledGrantIds"
  > & {
    policyId?: string;
    compiledGrantIds?: string[];
  };
  nowIso: string;
}): DataAccessPolicy {
  validateCapabilityActionRefs({
    store: params.store,
    tenantId: params.tenantId,
    actionRefs: params.policy.actionRefs,
  });
  if (params.policy.sourceId) {
    const source = findDataSource(params.store, params.tenantId, params.policy.sourceId);
    if (!source) {
      throw new EnterpriseDataStoreError(
        "DATA_SOURCE_NOT_FOUND",
        "DataAccessPolicy sourceId not found.",
      );
    }
  }
  if (params.policy.scopePolicyId) {
    const scopePolicy = findScopePolicy(params.store, params.tenantId, params.policy.scopePolicyId);
    if (!scopePolicy) {
      throw new EnterpriseDataStoreError(
        "SCOPE_POLICY_NOT_FOUND",
        "DataAccessPolicy scopePolicyId not found.",
      );
    }
  }
  if (params.policy.approvalPolicyId) {
    const approvalPolicy = findApprovalPolicy(
      params.store,
      params.tenantId,
      params.policy.approvalPolicyId,
    );
    if (!approvalPolicy) {
      throw new EnterpriseDataStoreError(
        "APPROVAL_POLICY_NOT_FOUND",
        "DataAccessPolicy approvalPolicyId not found.",
      );
    }
  }
  const existing =
    params.policy.policyId != null
      ? findDataAccessPolicy(params.store, params.tenantId, params.policy.policyId)
      : null;
  const record: DataAccessPolicy = {
    policyId: params.policy.policyId ?? existing?.policyId ?? randomUUID(),
    tenantId: params.tenantId,
    displayName: params.policy.displayName,
    targetKind: params.policy.targetKind,
    targetId: params.policy.targetId,
    sourceId: params.policy.sourceId,
    actionRefs: params.policy.actionRefs.map((ref) => ({ ...ref })),
    scopePolicyId: params.policy.scopePolicyId,
    approvalPolicyId: params.policy.approvalPolicyId,
    enabled: params.policy.enabled,
    compiledGrantIds: params.policy.compiledGrantIds ?? existing?.compiledGrantIds ?? [],
    createdAt: existing?.createdAt ?? params.nowIso,
    updatedAt: params.nowIso,
  };
  params.store.dataAccessPolicies[record.policyId] = record;
  return record;
}

/**
 * Compile management-layer DataAccessPolicy into runtime SeatActionGrants.
 * Administrators edit DataAccessPolicy; execution uses SeatActionGrant.
 */
export function compileDataAccessPolicy(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  policyId: string;
  nowIso: string;
}): { policy: DataAccessPolicy; grants: SeatActionGrant[] } {
  const policy = findDataAccessPolicy(params.store, params.tenantId, params.policyId);
  if (!policy) {
    throw new EnterpriseDataStoreError(
      "DATA_ACCESS_POLICY_NOT_FOUND",
      "DataAccessPolicy not found.",
    );
  }
  if (!policy.enabled) {
    throw new EnterpriseDataStoreError(
      "DATA_ACCESS_POLICY_DISABLED",
      "DataAccessPolicy is disabled.",
    );
  }
  if (policy.targetKind !== "seat") {
    throw new EnterpriseDataStoreError(
      "DATA_ACCESS_POLICY_COMPILE_UNSUPPORTED",
      "Only seat-target policies can be compiled; department and role policies are registration-only.",
    );
  }
  for (const grantId of policy.compiledGrantIds) {
    const grant = params.store.seatActionGrants[grantId];
    if (grant && !grant.revokedAt) {
      grant.revokedAt = params.nowIso;
    }
  }
  const grants: SeatActionGrant[] = [];
  for (const ref of policy.actionRefs) {
    const grant = upsertSeatActionGrant({
      store: params.store,
      tenantId: params.tenantId,
      seatId: policy.targetId,
      connectorId: ref.connectorId,
      actionKey: ref.actionKey,
      version: ref.version,
      scopePolicyId: policy.scopePolicyId,
      approvalPolicyId: policy.approvalPolicyId,
      nowIso: params.nowIso,
    });
    grant.dataAccessPolicyId = policy.policyId;
    grants.push(grant);
  }
  policy.compiledGrantIds = grants.map((grant) => grant.grantId);
  policy.updatedAt = params.nowIso;
  return { policy, grants };
}

/** Reverse lookup: which ConnectorAction@version does a policy compile to? */
export function resolveCompiledActionRefs(
  store: EnterpriseDataStore,
  tenantId: string,
  policyId: string,
): DataAccessPolicy["actionRefs"] {
  const policy = findDataAccessPolicy(store, tenantId, policyId);
  if (!policy) {
    throw new EnterpriseDataStoreError(
      "DATA_ACCESS_POLICY_NOT_FOUND",
      "DataAccessPolicy not found.",
    );
  }
  return policy.actionRefs.map((ref) => ({ ...ref }));
}

export type DataAccessPolicyDetail = {
  policy: DataAccessPolicy;
  runtimeActionRefs: ConnectorActionRef[];
  compiledGrants: SeatActionGrant[];
  compilationSupported: boolean;
};

export function resolveDataAccessPolicyDetail(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  policyId: string;
}): DataAccessPolicyDetail {
  const policy = findDataAccessPolicy(params.store, params.tenantId, params.policyId);
  if (!policy) {
    throw new EnterpriseDataStoreError(
      "DATA_ACCESS_POLICY_NOT_FOUND",
      "DataAccessPolicy not found.",
    );
  }
  const compiledGrants = policy.compiledGrantIds
    .map((grantId) => params.store.seatActionGrants[grantId])
    .filter(
      (grant): grant is SeatActionGrant => grant != null && grant.tenantId === params.tenantId,
    );
  return {
    policy,
    runtimeActionRefs: policy.actionRefs.map((ref) => ({ ...ref })),
    compiledGrants,
    compilationSupported: policy.targetKind === "seat",
  };
}

export function archiveDataAccessPolicy(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  policyId: string;
  nowIso: string;
}): DataAccessPolicy {
  const policy = findDataAccessPolicy(params.store, params.tenantId, params.policyId);
  if (!policy) {
    throw new EnterpriseDataStoreError(
      "DATA_ACCESS_POLICY_NOT_FOUND",
      "DataAccessPolicy not found.",
    );
  }
  for (const grantId of policy.compiledGrantIds) {
    const grant = params.store.seatActionGrants[grantId];
    if (grant && !grant.revokedAt) {
      grant.revokedAt = params.nowIso;
    }
  }
  policy.enabled = false;
  policy.compiledGrantIds = [];
  policy.updatedAt = params.nowIso;
  return policy;
}
