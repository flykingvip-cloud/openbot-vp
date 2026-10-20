// Capability authorization — single source of truth.
// Spec: .kiro/specs/agent-data-planner/{design,tasks}.md (D5)
//
// A DataCapability is invokable by a seat only when EVERY backing actionRef resolves
// to a seat action grant — either a direct compiled SeatActionGrant or one backed by
// a department / role DataAccessPolicy. This is the authorization contract shared by
// the W5 invoke bridge (capability-agent-invoke-runtime.ts) and the Agent Data Planner
// (agent-data-planner.ts). Kept in the enterprise-data plane (never imports the
// knowledge-plane resolver) to avoid a cycle.

import { resolvePolicyBackedSeatActionGrant } from "./policy-backed-grant-resolver.js";
import { findSeatActionGrant } from "./seat-action-grant-store.js";
import type { ConnectorActionRef, DataCapability, EnterpriseDataStore } from "./types.js";

/**
 * Structural minimum a caller must supply to evaluate a capability grant. Both
 * TrustedEnterpriseDataExecutionContext and ScopeEvaluationContext satisfy it, so the
 * resolver stays decoupled from any concrete execution-context type.
 */
export type CapabilityGrantContext = {
  tenantId: string;
  seatId: string;
  departmentId?: string;
  roleCode?: string;
};

/**
 * True iff the seat is authorized for every backing action of the capability (direct
 * grant OR department/role policy-backed grant). A capability with no actionRefs is
 * never granted. Mirrors the resolution the data gateway performs at invoke time.
 */
export function isCapabilityGrantedForSeat(params: {
  store: EnterpriseDataStore;
  context: CapabilityGrantContext;
  capability: DataCapability;
}): boolean {
  const { store, context, capability } = params;
  if (capability.actionRefs.length === 0) {
    return false;
  }
  return capability.actionRefs.every((ref: ConnectorActionRef) =>
    Boolean(
      findSeatActionGrant(store, context.tenantId, context.seatId, ref) ??
      resolvePolicyBackedSeatActionGrant({
        store,
        tenantId: context.tenantId,
        seatId: context.seatId,
        ref,
        departmentId: context.departmentId,
        roleCode: context.roleCode,
      }),
    ),
  );
}
