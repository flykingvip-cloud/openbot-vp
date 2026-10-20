import { randomUUID } from "node:crypto";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import type { ApprovalPolicy, EnterpriseDataStore } from "./types.js";

export function listApprovalPolicies(params: {
  store: EnterpriseDataStore;
  tenantId: string;
}): ApprovalPolicy[] {
  return Object.values(params.store.approvalPolicies)
    .filter((policy) => policy.tenantId === params.tenantId)
    .toSorted((left, right) => left.displayName.localeCompare(right.displayName));
}

export function findApprovalPolicy(
  store: EnterpriseDataStore,
  tenantId: string,
  approvalPolicyId: string,
): ApprovalPolicy | null {
  const policy = store.approvalPolicies[approvalPolicyId];
  if (!policy || policy.tenantId !== tenantId) {
    return null;
  }
  return policy;
}

export function upsertApprovalPolicy(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
  policy: Omit<ApprovalPolicy, "approvalPolicyId" | "tenantId" | "createdAt" | "updatedAt"> & {
    approvalPolicyId?: string;
  };
}): ApprovalPolicy {
  if (params.policy.approverRole !== "enterprise-admin") {
    throw new EnterpriseDataStoreError(
      "APPROVAL_ROLE_UNSUPPORTED",
      "Only enterprise-admin approverRole is supported in M1.",
    );
  }
  const existing =
    params.policy.approvalPolicyId != null
      ? findApprovalPolicy(params.store, params.tenantId, params.policy.approvalPolicyId)
      : null;
  const record: ApprovalPolicy = {
    approvalPolicyId: params.policy.approvalPolicyId ?? existing?.approvalPolicyId ?? randomUUID(),
    tenantId: params.tenantId,
    displayName: params.policy.displayName,
    mode: params.policy.mode,
    approverRole: "enterprise-admin",
    expiryHours: params.policy.expiryHours,
    createdAt: existing?.createdAt ?? params.nowIso,
    updatedAt: params.nowIso,
  };
  params.store.approvalPolicies[record.approvalPolicyId] = record;
  return record;
}
