import { randomUUID } from "node:crypto";

export type KnowledgeAccessRequestRecord = {
  requestId: string;
  capabilityId: string;
  capabilityTitle: string;
  tenantId: string | null;
  seatId: string | null;
  status: "pending";
  createdAt: number;
};

export type KnowledgeEnterpriseAccessRequestRecord = {
  requestId: string;
  projectionId: string;
  projectionTitle: string;
  tenantId: string | null;
  seatId: string | null;
  status: "pending";
  createdAt: number;
};

const pendingRequests = new Map<string, KnowledgeAccessRequestRecord>();
const pendingEnterpriseRequests = new Map<string, KnowledgeEnterpriseAccessRequestRecord>();

export function requestKnowledgeDataCapabilityAccess(params: {
  capabilityId: string;
  capabilityTitle: string;
  tenantId?: string | null;
  seatId?: string | null;
}): KnowledgeAccessRequestRecord {
  const requestId = randomUUID();
  const record: KnowledgeAccessRequestRecord = {
    requestId,
    capabilityId: params.capabilityId,
    capabilityTitle: params.capabilityTitle,
    tenantId: params.tenantId ?? null,
    seatId: params.seatId ?? null,
    status: "pending",
    createdAt: Date.now(),
  };
  pendingRequests.set(requestId, record);
  return record;
}

export function listPendingKnowledgeAccessRequests(): KnowledgeAccessRequestRecord[] {
  return [...pendingRequests.values()].toSorted((left, right) => right.createdAt - left.createdAt);
}

export function requestKnowledgeEnterpriseAccess(params: {
  projectionId: string;
  projectionTitle: string;
  tenantId?: string | null;
  seatId?: string | null;
}): KnowledgeEnterpriseAccessRequestRecord {
  const requestId = randomUUID();
  const record: KnowledgeEnterpriseAccessRequestRecord = {
    requestId,
    projectionId: params.projectionId,
    projectionTitle: params.projectionTitle,
    tenantId: params.tenantId ?? null,
    seatId: params.seatId ?? null,
    status: "pending",
    createdAt: Date.now(),
  };
  pendingEnterpriseRequests.set(requestId, record);
  return record;
}

export function listPendingKnowledgeEnterpriseAccessRequests(): KnowledgeEnterpriseAccessRequestRecord[] {
  return [...pendingEnterpriseRequests.values()].toSorted(
    (left, right) => right.createdAt - left.createdAt,
  );
}
