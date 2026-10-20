import type { DiagnosisDaibaiDeliveryProjection } from "./daibai-delivery.js";
import type { InterventionCaseStore } from "./intervention-case-store.js";
import { transitionInterventionCase, type InterventionCase } from "./intervention-case.js";
import {
  DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  DIAGNOSIS_P24_5_CANARY_TENANT,
  DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
  DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
  resolveProductionDaibaiTransport,
} from "./production-cutover.js";
import { isDiagnosisContractError } from "./types.js";

/**
 * Track I / M2 — Da Bai canary receipt wiring for InterventionCase.
 * Gate closed → stewardReceipt only; no live send.
 * When DIAGNOSIS_DAIBAI_DELIVERY_ENABLED, build a safe projection and
 * deliver via resolveProductionDaibaiTransport (requires registerProductionDaibaiLiveSend).
 */

export type AttachInterventionDaibaiCanaryInput = {
  case: InterventionCase;
  store: InterventionCaseStore;
  now?: string;
  /** Test override — must not flip production compile-time default. */
  deliveryEnabled?: boolean;
};

function buildInterventionDaibaiProjection(
  row: InterventionCase,
  now: string,
): DiagnosisDaibaiDeliveryProjection {
  const expiresAt = new Date(Date.parse(now) + 60 * 60 * 1000).toISOString();
  const targetId = row.target.agentId?.trim() || row.caseId;
  return {
    schemaVersion: 1,
    signalId: `sig:intervention:${row.caseId}`,
    kind: "event",
    tenantId: row.tenantId,
    route: "employee",
    reasonCode: `intervention_${row.actionKind}`,
    completion: "BLOCKED",
    findingCount: 0,
    evidenceCount: 0,
    observedAt: now,
    expiresAt,
    caseId: row.caseId,
    targetType: row.target.kind,
    targetId: String(targetId),
  };
}

function putReceipt(
  row: InterventionCase,
  store: InterventionCaseStore,
  now: string,
  receipt: NonNullable<InterventionCase["daibaiReceipt"]>,
  toReceipted: boolean,
): InterventionCase {
  if (toReceipted && row.status === "dispatched") {
    const patched = transitionInterventionCase(row, "receipted", {
      daibaiReceipt: receipt,
      updatedAt: now,
    });
    const next = patched.ok
      ? patched.case
      : { ...row, status: "receipted" as const, daibaiReceipt: receipt, updatedAt: now };
    store.put(next);
    return next;
  }
  const next = { ...row, daibaiReceipt: receipt, updatedAt: now };
  store.put(next);
  return next;
}

/**
 * After dispatched: always keep steward receipt path.
 * When gate closed, record daibaiReceipt skipped:gate_closed → receipted.
 * When gate open, deliver via live transport and record a real receipt.
 * Main keeps DIAGNOSIS_DAIBAI_DELIVERY_ENABLED false; the live path stays dormant.
 */
export async function attachInterventionDaibaiCanary(
  input: AttachInterventionDaibaiCanaryInput,
): Promise<InterventionCase> {
  const now = input.now ?? new Date().toISOString();
  const row = input.case;
  if (row.status !== "dispatched" && row.status !== "receipted") {
    return row;
  }

  const enabled = input.deliveryEnabled ?? DIAGNOSIS_DAIBAI_DELIVERY_ENABLED;
  if (!enabled) {
    const transport = resolveProductionDaibaiTransport({ enabled: false });
    void transport;
    return putReceipt(
      row,
      input.store,
      now,
      {
        status: "skipped",
        skipReason: "gate_closed",
        sessionKey: DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
      },
      true,
    );
  }

  // Live canary only for DIAGNOSIS_P24_5_CANARY_TENANT (Path B 2026-10-19: tenant 001).
  if (row.tenantId !== DIAGNOSIS_P24_5_CANARY_TENANT) {
    return putReceipt(
      row,
      input.store,
      now,
      {
        status: "skipped",
        skipReason: "tenant_not_canary",
        sessionKey: DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
      },
      false,
    );
  }

  try {
    const transport = resolveProductionDaibaiTransport({ enabled: true });
    const projection = buildInterventionDaibaiProjection(row, now);
    const result = await transport.deliver(projection);
    const deliveryId = `dlv:${projection.signalId}:${projection.route}`;
    if (result === "accepted") {
      return putReceipt(
        row,
        input.store,
        now,
        {
          deliveryId,
          status: "accepted",
          sessionKey: DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
        },
        true,
      );
    }
    return putReceipt(
      row,
      input.store,
      now,
      {
        deliveryId,
        status: "rejected",
        skipReason: "transport_unavailable",
        sessionKey: DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
      },
      false,
    );
  } catch (err) {
    const code = isDiagnosisContractError(err) ? err.code : "live_deliver_error";
    const message = err instanceof Error ? err.message : String(err);
    return putReceipt(
      row,
      input.store,
      now,
      {
        status: "rejected",
        skipReason: `${code}:${message}`.slice(0, 240),
        sessionKey: DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
      },
      false,
    );
  }
}

/**
 * Compile-time assertion helper for tests / docs.
 * Main keeps DAIBAI delivery false; a flipped const fails this narrowing.
 */
export function interventionDaibaiGatesDefaultClosed(): {
  daibaiDeliveryEnabled: boolean;
  remediationExecutionEnabled: boolean;
} {
  return {
    daibaiDeliveryEnabled: DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
    remediationExecutionEnabled: DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
  };
}
