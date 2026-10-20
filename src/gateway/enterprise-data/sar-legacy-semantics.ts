/**
 * Older records keep the fields they had. Missing SAR fields are not filled
 * in, and they are not treated as a verified website capability.
 */

import type { SiteCompleteness, SiteVerification } from "../../site-capability/result.js";
import { lineageRecordsVerifiedSar } from "./knowledge-publication.js";
import type { InvocationAuditEvent, KnowledgeLineageRecord } from "./types.js";

function text(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function verification(value: unknown): SiteVerification | undefined {
  if (value === "passed" || value === "failed" || value === "not_performed") {
    return value;
  }
  return undefined;
}

function completeness(value: unknown): SiteCompleteness | undefined {
  if (value === "complete" || value === "partial") {
    return value;
  }
  return undefined;
}

/**
 * Read one pre-E4/E5 lineage object. Absent SAR fields stay absent.
 * `verifiedInProduction` and maturity are ignored.
 */
export function readLegacyKnowledgeLineage(raw: unknown): KnowledgeLineageRecord | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const source = raw as Record<string, unknown>;
  const lineageId = text(source.lineageId);
  const tenantId = text(source.tenantId);
  const objectId = text(source.objectId);
  const projectionId = text(source.projectionId);
  const generatedAt = text(source.generatedAt);
  const generatorVersion = text(source.generatorVersion);
  if (!lineageId || !tenantId || !objectId || !projectionId || !generatedAt || !generatorVersion) {
    return null;
  }
  const record: KnowledgeLineageRecord = {
    lineageId,
    tenantId,
    objectId,
    projectionId,
    sourceActions: stringList(source.sourceActions),
    sourceTraceIds: stringList(source.sourceTraceIds),
    generatedAt,
    generatorVersion,
  };
  const sourceId = text(source.sourceId);
  const sarCapabilityId = text(source.sarCapabilityId);
  const sarVersion = text(source.sarVersion);
  const sarRunId = text(source.sarRunId);
  const sarEvidenceRef = text(source.sarEvidenceRef);
  const validator = text(source.validator);
  const sarVerification = verification(source.sarVerification);
  const sarCompleteness = completeness(source.sarCompleteness);
  if (sourceId) {
    record.sourceId = sourceId;
  }
  if (sarCapabilityId) {
    record.sarCapabilityId = sarCapabilityId;
  }
  if (sarVersion) {
    record.sarVersion = sarVersion;
  }
  if (sarRunId) {
    record.sarRunId = sarRunId;
  }
  if (sarEvidenceRef) {
    record.sarEvidenceRef = sarEvidenceRef;
  }
  if (validator) {
    record.validator = validator;
  }
  if (sarVerification) {
    record.sarVerification = sarVerification;
  }
  if (sarCompleteness) {
    record.sarCompleteness = sarCompleteness;
  }
  if (source.publication === "complete" || source.publication === "partial") {
    record.publication = source.publication;
  }
  return record;
}

export function legacyLineageVerifiedWebsite(raw: unknown): boolean {
  const record = readLegacyKnowledgeLineage(raw);
  if (!record) {
    return false;
  }
  return lineageRecordsVerifiedSar(record);
}

/**
 * An invocation audit records a verified website run only when the SAR facts
 * are already on the event. Missing fields stay unverified.
 */
export function invocationAuditRecordsVerifiedSar(
  event: Partial<InvocationAuditEvent> | null | undefined,
): boolean {
  if (!event) {
    return false;
  }
  return (
    event.status === "SUCCESS" &&
    Boolean(event.sarRunId?.trim()) &&
    event.sarVerification === "passed" &&
    event.sarCompleteness === "complete" &&
    Boolean(event.artifactDigest?.trim())
  );
}
