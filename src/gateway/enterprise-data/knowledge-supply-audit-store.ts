import { randomUUID } from "node:crypto";
import { MATERIALIZER_SEAT_ID } from "./enterprise-data-seat-context.js";
import type {
  EnterpriseDataStore,
  KnowledgeSupplyAuditEvent,
  KnowledgeSupplyAuditEventType,
} from "./types.js";

export function listKnowledgeSupplyAuditEvents(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  projectionId?: string;
  bindingId?: string;
  objectId?: string;
  eventType?: KnowledgeSupplyAuditEventType;
  status?: KnowledgeSupplyAuditEvent["status"];
  limit?: number;
}): KnowledgeSupplyAuditEvent[] {
  return Object.values(params.store.knowledgeSupplyAuditEvents)
    .filter((event) => {
      if (event.tenantId !== params.tenantId) {
        return false;
      }
      if (params.projectionId && event.projectionId !== params.projectionId) {
        return false;
      }
      if (params.bindingId && event.bindingId !== params.bindingId) {
        return false;
      }
      if (params.objectId && event.objectId !== params.objectId) {
        return false;
      }
      if (params.eventType && event.eventType !== params.eventType) {
        return false;
      }
      if (params.status && event.status !== params.status) {
        return false;
      }
      return true;
    })
    .toSorted((left, right) => right.recordedAt.localeCompare(left.recordedAt))
    .slice(0, params.limit ?? 100);
}

export function findKnowledgeSupplyAuditEvent(
  store: EnterpriseDataStore,
  tenantId: string,
  auditId: string,
): KnowledgeSupplyAuditEvent | null {
  const event = store.knowledgeSupplyAuditEvents[auditId];
  if (!event || event.tenantId !== tenantId) {
    return null;
  }
  return event;
}

export function recordKnowledgeSupplyAudit(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  eventType: KnowledgeSupplyAuditEventType;
  bindingId: string;
  projectionId: string;
  nowIso: string;
  objectId?: string;
  lineageId?: string;
  sourceTraceIds?: string[];
  status: KnowledgeSupplyAuditEvent["status"];
  errorCode?: string;
  errorMessage?: string;
  generatorVersion?: string;
}): KnowledgeSupplyAuditEvent {
  const event: KnowledgeSupplyAuditEvent = {
    auditId: randomUUID(),
    tenantId: params.tenantId,
    eventType: params.eventType,
    bindingId: params.bindingId,
    projectionId: params.projectionId,
    objectId: params.objectId,
    lineageId: params.lineageId,
    sourceTraceIds: [...(params.sourceTraceIds ?? [])],
    status: params.status,
    errorCode: params.errorCode,
    errorMessage: params.errorMessage,
    generatorVersion: params.generatorVersion,
    materializerSeatId: MATERIALIZER_SEAT_ID,
    recordedAt: params.nowIso,
  };
  params.store.knowledgeSupplyAuditEvents[event.auditId] = event;
  return event;
}
