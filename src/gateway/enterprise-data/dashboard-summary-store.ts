// Enterprise Data Capability Center — home dashboard summary aggregator.
// Spec: .kiro/specs/enterprise-data-capability-center/tasks.md (Task 1.1)
//
// Thin read-only aggregation: composes the existing M2/M3/M4/M5 overviews into
// the five home-page KPI counts. Adds nothing to the store; never invokes Gateway.

import {
  resolveAccessGovernanceOverview,
  listAccessGovernanceMatrix,
} from "./access-governance-store.js";
import { resolveCapabilityOverview } from "./capability-governance-store.js";
import { resolveGovernanceApprovalCenterOverview } from "./governance-approval-store.js";
import { resolveKnowledgeSupplyOverview } from "./knowledge-supply-store.js";
import type { EnterpriseDataStore } from "./types.js";

export type DataCapabilityDashboardSummary = {
  totalDataSources: number;
  totalCapabilities: number;
  /** Distinct departments that appear as a department access target. */
  totalDepartments: number;
  /** Produced knowledge objects (feed items), not supply channels. */
  knowledgeObjectCount: number;
  /** Enabled supply channels (projection bindings); for KPI copy switching. */
  enabledBindingCount: number;
  pendingApprovals: number;
};

export function resolveDataCapabilityDashboardSummary(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
}): DataCapabilityDashboardSummary {
  const { store, tenantId, nowIso } = params;

  const access = resolveAccessGovernanceOverview({ store, tenantId });
  const capability = resolveCapabilityOverview({ store, tenantId });
  const supply = resolveKnowledgeSupplyOverview({ store, tenantId, nowIso });
  const approvals = resolveGovernanceApprovalCenterOverview({ store, tenantId });

  // Distinct department access targets — one matrix entry per department targetId.
  const departmentEntries = listAccessGovernanceMatrix({
    store,
    tenantId,
    dimension: "department",
  });

  return {
    totalDataSources: access.dataSourceCount,
    totalCapabilities: capability.capabilityCount,
    totalDepartments: departmentEntries.length,
    knowledgeObjectCount: supply.feedItemCount,
    enabledBindingCount: supply.enabledBindingCount,
    pendingApprovals: approvals.totalPending,
  };
}
