import { collectBlockedFollowupDeliveryPersistRoots } from "../../agent-runtime/state/repository/blocked-followup-delivery-recovery.js";
import { listBlockedFollowupDeliveries } from "../../agent-runtime/state/repository/blocked-followup-delivery.js";
import { loadConfig } from "../../config/config.js";
import type { GatewayClient } from "../server-methods/types.js";
import { requireTenantContext } from "../tenant-context.js";
import { confirmAccessReauthorization } from "./followup-workspace-reauthorization.js";

/** Explicit per-record confirmation on the existing admin governance surface.
 * No client path, actor identity, tenant or synthetic grant is accepted.
 */
export async function confirmFollowupWorkspaceAccess(
  client: GatewayClient | null,
  recordId: string,
) {
  if (client?.sessionDomain !== "enterprise" || client.sessionKind !== "enterprise-admin") {
    throw new Error("followup_reauthorization:enterprise_admin_required");
  }
  const actor = await requireTenantContext(client);
  if (!recordId.trim()) {
    throw new Error("followup_reauthorization:record_required");
  }
  const cfg = loadConfig();
  const matches = collectBlockedFollowupDeliveryPersistRoots(cfg).flatMap((persistRoot) =>
    listBlockedFollowupDeliveries(persistRoot)
      .filter((record) => record.id === recordId)
      .map((record) => ({ persistRoot, record })),
  );
  if (matches.length !== 1) {
    throw new Error("followup_reauthorization:record_missing_or_ambiguous");
  }
  const { persistRoot, record } = matches[0];
  if (
    record.workspaceBinding?.tenantId !== actor.tenantId ||
    record.status !== "reauthorization_required" ||
    Boolean(record.claim?.deliveryStartedAtMs) ||
    !record.reauthorization
  ) {
    throw new Error("followup_reauthorization:record_scope_denied");
  }
  return confirmAccessReauthorization({
    persistRoot,
    cfg,
    id: record.id,
    authorization: {
      kind: record.reauthorization.kind,
      actorIdentity: `tenant:${actor.tenantId}:user:${actor.userId}`,
      grantedAtMs: Date.now(),
    },
  });
}

/** Read-only view on the same governance surface; no payload/body/path disclosure. */
export async function listFollowupWorkspaceWaits(client: GatewayClient | null) {
  if (client?.sessionDomain !== "enterprise" || client.sessionKind !== "enterprise-admin") {
    throw new Error("followup_reauthorization:enterprise_admin_required");
  }
  const actor = await requireTenantContext(client);
  return collectBlockedFollowupDeliveryPersistRoots(loadConfig())
    .flatMap((root) => listBlockedFollowupDeliveries(root))
    .filter((record) => record.workspaceBinding?.tenantId === actor.tenantId)
    .map((record) => ({
      id: record.id,
      runId: record.runId,
      deliveryId: record.deliveryId,
      taskId: record.taskId,
      status: record.status,
      reason: record.reason,
      missingItems: record.missingItems,
      startedAtMs: record.claim?.deliveryStartedAtMs,
      receiptReconciliationRequired: record.reason.includes("receipt_reconciliation_required"),
    }));
}
