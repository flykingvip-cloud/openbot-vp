import { randomUUID } from "node:crypto";
import type {
  EnterpriseAccessResourceType,
  EnterpriseAssetAuditEvent,
  EnterpriseAssetAuditEventType,
  EnterpriseAuditMetadataValue,
  EnterpriseSeatAssetsStore,
} from "./enterprise-seat-assets-store.js";

export function recordEnterpriseAssetAuditEvent(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  eventType: EnterpriseAssetAuditEventType;
  nowIso: string;
  auditId?: string;
  actorEmployeeId?: string;
  seatId?: string;
  handoverCaseId?: string;
  bindingId?: string;
  offerId?: string;
  policyId?: string;
  resourceType?: EnterpriseAccessResourceType;
  resourceId?: string;
  metadata?: Record<string, EnterpriseAuditMetadataValue>;
}): EnterpriseAssetAuditEvent {
  const auditEvent: EnterpriseAssetAuditEvent = {
    auditEventId: randomUUID(),
    ...(params.auditId ? { auditId: params.auditId } : {}),
    tenantId: params.tenantId,
    ...(params.actorEmployeeId ? { actorEmployeeId: params.actorEmployeeId } : {}),
    eventType: params.eventType,
    ...(params.seatId ? { seatId: params.seatId } : {}),
    ...(params.handoverCaseId ? { handoverCaseId: params.handoverCaseId } : {}),
    ...(params.bindingId ? { bindingId: params.bindingId } : {}),
    ...(params.offerId ? { offerId: params.offerId } : {}),
    ...(params.policyId ? { policyId: params.policyId } : {}),
    ...(params.resourceType ? { resourceType: params.resourceType } : {}),
    ...(params.resourceId ? { resourceId: params.resourceId } : {}),
    ...(params.metadata ? { metadata: params.metadata } : {}),
    createdAt: params.nowIso,
  };
  params.store.auditEvents[auditEvent.auditEventId] = auditEvent;
  return auditEvent;
}
