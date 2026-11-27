/**
 * Controlled Data Bridge Mode A/B/C guard (VB-3). Default Fail-Closed:
 * no mode is unlocked in this wave. Valid declarations still do not execute.
 * Do not wire this into data-capability-tool.ts or Gateway default routes.
 */
export const CONTROLLED_DATA_BRIDGE_UNLOCKED = false;

export type ControlledDataBridgeMode = "A" | "B" | "C";

export type ControlledDataBridgeDeclaration = {
  mode?: string;
  tenant_id?: string;
  policy_generation?: number;
  freshness_ts?: string;
  masking_receipt?: unknown;
  tombstone?: unknown;
  user_delegation_handle?: string;
  service_credential_handle?: string;
  row_level_predicate?: string;
  snapshot_id?: string;
  query_kind?: string;
};

export type ControlledDataBridgeDecision =
  | { allowed: false; code: "BRIDGE_LOCKED"; mode?: ControlledDataBridgeMode }
  | { allowed: false; code: "MODE_UNMATCHED" }
  | { allowed: false; code: "VALIDATION_ERROR" }
  | { allowed: false; code: "TEXT_TO_SQL_FORBIDDEN" };

function isMode(value: unknown): value is ControlledDataBridgeMode {
  return value === "A" || value === "B" || value === "C";
}

export function evaluateControlledDataBridge(
  declaration: ControlledDataBridgeDeclaration,
): ControlledDataBridgeDecision {
  if (declaration.query_kind === "text_to_sql") {
    return { allowed: false, code: "TEXT_TO_SQL_FORBIDDEN" };
  }
  if (!isMode(declaration.mode)) {
    return { allowed: false, code: "MODE_UNMATCHED" };
  }
  if (
    !declaration.tenant_id?.trim() ||
    !Number.isInteger(declaration.policy_generation) ||
    (declaration.policy_generation ?? 0) < 1 ||
    !declaration.freshness_ts ||
    !declaration.masking_receipt ||
    !declaration.tombstone
  ) {
    return { allowed: false, code: "VALIDATION_ERROR" };
  }
  if (declaration.mode === "A" && !declaration.user_delegation_handle) {
    return { allowed: false, code: "VALIDATION_ERROR" };
  }
  if (
    declaration.mode === "B" &&
    (!declaration.service_credential_handle || !declaration.row_level_predicate)
  ) {
    return { allowed: false, code: "VALIDATION_ERROR" };
  }
  if (declaration.mode === "C" && !declaration.snapshot_id) {
    return { allowed: false, code: "VALIDATION_ERROR" };
  }
  // Even a structurally valid declaration stays locked this wave.
  if (!CONTROLLED_DATA_BRIDGE_UNLOCKED) {
    return { allowed: false, code: "BRIDGE_LOCKED", mode: declaration.mode };
  }
  return { allowed: false, code: "BRIDGE_LOCKED", mode: declaration.mode };
}
