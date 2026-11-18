import { randomUUID } from "node:crypto";
import { hashObjectKey, objectKeyHint } from "./digest-utils.js";
import { queryEnterpriseRecordEntries } from "./indexed-store.js";
import type {
  ConnectorActionRiskLevel,
  DataAuditEvent,
  DataObjectRef,
  EnterpriseDataStore,
  InvocationAuditEvent,
  InvocationDenialReason,
  MaskingResult,
} from "./types.js";

export type AuditWritePolicy = "fail_open" | "fail_closed";

const MAX_OBJECT_REFS = 50;

export function resolveAuditWritePolicy(riskLevel: ConnectorActionRiskLevel): AuditWritePolicy {
  return riskLevel === "HIGH" || riskLevel === "CRITICAL" ? "fail_closed" : "fail_open";
}

export function extractObjectRefs(params: {
  tenantId: string;
  payload: unknown;
  riskLevel: ConnectorActionRiskLevel;
}): { objectRefs: DataObjectRef[]; objectRefTruncated: boolean } {
  const refs: DataObjectRef[] = [];
  const candidates: Array<{ objectType: string; objectKey: string }> = [];

  function walk(value: unknown, path: string): void {
    if (value == null || typeof value !== "object") {
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item, path);
      }
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.id === "string" && path) {
      const objectType = path.split(".").at(-1) ?? "object";
      candidates.push({ objectType, objectKey: record.id });
    }
    for (const [key, child] of Object.entries(record)) {
      walk(child, path ? `${path}.${key}` : key);
    }
  }

  walk(params.payload, "");
  const minRefs = params.riskLevel === "HIGH" || params.riskLevel === "CRITICAL" ? 10 : 0;
  const limit = Math.max(minRefs, MAX_OBJECT_REFS);
  for (const candidate of candidates.slice(0, limit)) {
    refs.push({
      objectType: candidate.objectType,
      objectKeyHash: hashObjectKey(params.tenantId, candidate.objectType, candidate.objectKey),
      objectKeyHint: objectKeyHint(candidate.objectType, candidate.objectKey),
    });
  }
  return {
    objectRefs: refs,
    objectRefTruncated: candidates.length > limit,
  };
}

export function countRecords(payload: unknown): number {
  if (Array.isArray(payload)) {
    return payload.length;
  }
  if (payload == null) {
    return 0;
  }
  return 1;
}

export type AuditWriteOptions = {
  forceFailure?: boolean;
};

export function recordInvocationAudit(params: {
  store: EnterpriseDataStore;
  traceId: string;
  tenantId: string;
  seatId: string;
  employeeId?: string;
  agentId?: string;
  connectorId: string;
  actionKey: string;
  version: string;
  riskLevel: ConnectorActionRiskLevel;
  scopeType: string;
  scopeAppliedLabel?: string;
  approvalContextId?: string;
  approvalId?: string;
  status: InvocationAuditEvent["status"];
  denialReason?: InvocationDenialReason;
  errorMessage?: string;
  durationMs?: number;
  nowIso: string;
  options?: AuditWriteOptions;
  sarRunId?: string;
  sarEvidenceRef?: string;
  sarStatus?: InvocationAuditEvent["sarStatus"];
  sarVerification?: InvocationAuditEvent["sarVerification"];
  sarCompleteness?: InvocationAuditEvent["sarCompleteness"];
  artifactDigest?: string;
}): boolean {
  if (params.options?.forceFailure) {
    return false;
  }
  const event: InvocationAuditEvent = {
    invocationAuditId: randomUUID(),
    traceId: params.traceId,
    tenantId: params.tenantId,
    seatId: params.seatId,
    employeeId: params.employeeId,
    agentId: params.agentId,
    connectorId: params.connectorId,
    actionKey: params.actionKey,
    version: params.version,
    riskLevel: params.riskLevel,
    scopeType: params.scopeType,
    scopeAppliedLabel: params.scopeAppliedLabel,
    approvalContextId: params.approvalContextId,
    approvalId: params.approvalId,
    status: params.status,
    denialReason: params.denialReason,
    errorMessage: params.errorMessage,
    durationMs: params.durationMs,
    timestamp: params.nowIso,
    sarRunId: params.sarRunId,
    sarEvidenceRef: params.sarEvidenceRef,
    sarStatus: params.sarStatus,
    sarVerification: params.sarVerification,
    sarCompleteness: params.sarCompleteness,
    artifactDigest: params.artifactDigest,
  };
  params.store.invocationAuditEvents[event.invocationAuditId] = event;
  return true;
}

export function recordDataAudit(params: {
  store: EnterpriseDataStore;
  traceId: string;
  tenantId: string;
  payload: unknown;
  masking: MaskingResult;
  riskLevel: ConnectorActionRiskLevel;
  approvalId?: string;
  nowIso: string;
  options?: AuditWriteOptions;
}): boolean {
  if (params.options?.forceFailure) {
    return false;
  }
  const { objectRefs, objectRefTruncated } = extractObjectRefs({
    tenantId: params.tenantId,
    payload: params.masking.data,
    riskLevel: params.riskLevel,
  });
  const event: DataAuditEvent = {
    dataAuditId: randomUUID(),
    traceId: params.traceId,
    tenantId: params.tenantId,
    recordCount: countRecords(params.masking.data),
    objectRefs,
    objectRefTruncated,
    masked: params.masking.masked,
    maskedFields: params.masking.maskedFields,
    blockedFields: params.masking.blockedFields,
    unknownFields: params.masking.unknownFields,
    classifications: params.masking.classifications,
    approvalId: params.approvalId,
    timestamp: params.nowIso,
  };
  params.store.dataAuditEvents[event.dataAuditId] = event;
  return true;
}

export function removeDataAuditForTrace(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  traceId: string;
}): void {
  for (const [auditId, event] of queryEnterpriseRecordEntries(
    params.store.dataAuditEvents,
    params,
  )) {
    if (event.tenantId === params.tenantId && event.traceId === params.traceId) {
      delete params.store.dataAuditEvents[auditId];
    }
  }
}

export function findInvocationAuditForTrace(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  traceId: string;
}): InvocationAuditEvent | null {
  return (
    queryEnterpriseRecordEntries(params.store.invocationAuditEvents, params)
      .map(([, row]) => row)
      .find((event) => event.tenantId === params.tenantId && event.traceId === params.traceId) ??
    null
  );
}

export function getAuditTrace(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  traceId: string;
}): {
  traceId: string;
  invocation: InvocationAuditEvent | null;
  data: DataAuditEvent | null;
  dataAuditMissing: boolean;
} {
  const invocation =
    queryEnterpriseRecordEntries(params.store.invocationAuditEvents, params)
      .map(([, row]) => row)
      .find((event) => event.tenantId === params.tenantId && event.traceId === params.traceId) ??
    null;
  const data =
    queryEnterpriseRecordEntries(params.store.dataAuditEvents, params)
      .map(([, row]) => row)
      .find((event) => event.tenantId === params.tenantId && event.traceId === params.traceId) ??
    null;
  return {
    traceId: params.traceId,
    invocation,
    data,
    dataAuditMissing: invocation?.status === "SUCCESS" && data == null,
  };
}

export function listInvocationAuditEvents(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  seatId?: string;
  employeeId?: string;
  limit?: number;
}): InvocationAuditEvent[] {
  return Object.values(params.store.invocationAuditEvents)
    .filter((event) => {
      if (event.tenantId !== params.tenantId) {
        return false;
      }
      if (params.seatId && event.seatId !== params.seatId) {
        return false;
      }
      if (params.employeeId && event.employeeId !== params.employeeId) {
        return false;
      }
      return true;
    })
    .toSorted((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, params.limit ?? 100);
}
