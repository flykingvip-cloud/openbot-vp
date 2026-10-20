/**
 * 企业治理审批 pending 计数（接 enterprise-data governance-approval-store）。
 */

import { resolveGovernanceApprovalCenterOverview } from "../enterprise-data/governance-approval-store.js";
import { loadEnterpriseDataStore } from "../enterprise-data/store.js";
import type {
  GovernanceApprovalCenterOverview,
  GovernanceApprovalRequest,
} from "../enterprise-data/types.js";

export type GovernancePendingApprovalItem = {
  approvalId: string;
  category: GovernanceApprovalRequest["category"];
  displayName: string;
  requestedAt: string;
};

export type PendingGovernanceApprovalsSnapshot = {
  totalPending: number;
  pendingByCategory: GovernanceApprovalCenterOverview["pendingByCategory"];
  recentPending: GovernancePendingApprovalItem[];
};

export async function resolvePendingGovernanceApprovals(
  enterpriseId: string,
  storePath?: string,
): Promise<PendingGovernanceApprovalsSnapshot> {
  const store = await loadEnterpriseDataStore(storePath);
  const overview = resolveGovernanceApprovalCenterOverview({
    store,
    tenantId: enterpriseId,
  });
  return {
    totalPending: overview.totalPending,
    pendingByCategory: overview.pendingByCategory,
    recentPending: overview.recentPending.slice(0, 5).map((request) => ({
      approvalId: request.approvalId,
      category: request.category,
      displayName: request.displayName,
      requestedAt: request.requestedAt,
    })),
  };
}
