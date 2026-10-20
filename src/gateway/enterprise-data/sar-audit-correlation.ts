/**
 * Associates an enterprise traceId with a SAR runId.
 * The stored record is an allowlist. Payloads and trace bodies are dropped.
 */

import { randomUUID } from "node:crypto";
import { sha256Digest } from "./digest-utils.js";
import { resolveSarFailureDisplay } from "./sar-failure-display.js";
import type {
  EnterpriseDataStore,
  InvocationDenialReason,
  SarGatewayCorrelation,
  SarTraceCorrelation,
} from "./types.js";

const EVIDENCE_REF_MAX = 128;
const SENSITIVE_EVIDENCE = /cookie|password|secret|token|authorization/i;

function correlationsOf(store: EnterpriseDataStore): Record<string, SarTraceCorrelation> {
  return (store.sarTraceCorrelations ??= {});
}

function boundEvidenceRef(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length > 0 &&
    trimmed.length <= EVIDENCE_REF_MAX &&
    !trimmed.includes("\n") &&
    !SENSITIVE_EVIDENCE.test(trimmed)
  ) {
    return trimmed;
  }
  return `sha256:${sha256Digest(trimmed)}`;
}

/**
 * Build one correlation. `trace` is accepted so callers can pass a full trace
 * and tests can prove it is not stored.
 */
export function buildSarTraceCorrelation(params: {
  tenantId: string;
  traceId: string;
  sar: SarGatewayCorrelation;
  denialReason?: InvocationDenialReason;
  recordedAt: string;
  correlationId?: string;
  trace?: unknown;
}): SarTraceCorrelation | null {
  const traceId = params.traceId.trim();
  const sarRunId = params.sar.runId.trim();
  const capabilityId = params.sar.capabilityId.trim();
  const version = params.sar.version.trim();
  if (!traceId || !sarRunId || !capabilityId || !version) {
    return null;
  }
  const display = resolveSarFailureDisplay({
    status: params.sar.status,
    errorCode: params.sar.errorCode,
    denialReason: params.denialReason,
  });
  const record: SarTraceCorrelation = {
    correlationId: params.correlationId ?? randomUUID(),
    tenantId: params.tenantId,
    traceId,
    sarRunId,
    capabilityId,
    version,
    evidenceRef: boundEvidenceRef(params.sar.evidenceRef),
    status: params.sar.status,
    recordedAt: params.recordedAt,
  };
  if (params.denialReason) {
    record.denialReason = params.denialReason;
  }
  if (params.sar.errorCode?.trim()) {
    record.sarErrorCode = params.sar.errorCode.trim();
  }
  if (display?.failureClass) {
    record.failureClass = display.failureClass;
  }
  if (display) {
    record.displayClass = display.class;
    record.displayLabel = display.label;
  }
  return record;
}

export function recordSarTraceCorrelation(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  traceId: string;
  sar: SarGatewayCorrelation;
  denialReason?: InvocationDenialReason;
  recordedAt: string;
  trace?: unknown;
}): SarTraceCorrelation | null {
  const existing = findSarTraceCorrelationByTraceId({
    store: params.store,
    tenantId: params.tenantId,
    traceId: params.traceId,
  });
  if (existing) {
    return existing;
  }
  const record = buildSarTraceCorrelation(params);
  if (!record) {
    return null;
  }
  correlationsOf(params.store)[record.correlationId] = record;
  return record;
}

export function findSarTraceCorrelationByTraceId(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  traceId: string;
}): SarTraceCorrelation | null {
  return (
    Object.values(params.store.sarTraceCorrelations ?? {}).find(
      (record) => record.tenantId === params.tenantId && record.traceId === params.traceId,
    ) ?? null
  );
}

export function findSarTraceCorrelationByRunId(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  sarRunId: string;
}): SarTraceCorrelation | null {
  const matches = Object.values(params.store.sarTraceCorrelations ?? {})
    .filter((record) => record.tenantId === params.tenantId && record.sarRunId === params.sarRunId)
    .toSorted((left, right) => right.recordedAt.localeCompare(left.recordedAt));
  return matches[0] ?? null;
}
