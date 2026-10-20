import { randomUUID } from "node:crypto";
import type { EnterpriseDataStore, KnowledgeLineageRecord } from "./types.js";

export function listKnowledgeLineageRecords(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  objectId?: string;
  projectionId?: string;
}): KnowledgeLineageRecord[] {
  return Object.values(params.store.knowledgeLineageRecords)
    .filter((record) => {
      if (record.tenantId !== params.tenantId) {
        return false;
      }
      if (params.objectId && record.objectId !== params.objectId) {
        return false;
      }
      if (params.projectionId && record.projectionId !== params.projectionId) {
        return false;
      }
      return true;
    })
    .toSorted((left, right) => right.generatedAt.localeCompare(left.generatedAt));
}

export function findKnowledgeLineageRecord(
  store: EnterpriseDataStore,
  tenantId: string,
  lineageId: string,
): KnowledgeLineageRecord | null {
  const record = store.knowledgeLineageRecords[lineageId];
  if (!record || record.tenantId !== tenantId) {
    return null;
  }
  return record;
}

function presentText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function createKnowledgeLineageRecord(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  record: Omit<KnowledgeLineageRecord, "lineageId" | "tenantId">;
}): KnowledgeLineageRecord {
  const source = params.record;
  const lineage: KnowledgeLineageRecord = {
    lineageId: randomUUID(),
    tenantId: params.tenantId,
    objectId: source.objectId,
    projectionId: source.projectionId,
    sourceActions: [...source.sourceActions],
    sourceTraceIds: [...source.sourceTraceIds],
    generatedAt: source.generatedAt,
    generatorVersion: source.generatorVersion,
  };
  const sourceId = presentText(source.sourceId);
  const sarCapabilityId = presentText(source.sarCapabilityId);
  const sarVersion = presentText(source.sarVersion);
  const sarRunId = presentText(source.sarRunId);
  const sarEvidenceRef = presentText(source.sarEvidenceRef);
  const validator = presentText(source.validator);
  if (sourceId) {
    lineage.sourceId = sourceId;
  }
  if (sarCapabilityId) {
    lineage.sarCapabilityId = sarCapabilityId;
  }
  if (sarVersion) {
    lineage.sarVersion = sarVersion;
  }
  if (sarRunId) {
    lineage.sarRunId = sarRunId;
  }
  if (sarEvidenceRef) {
    lineage.sarEvidenceRef = sarEvidenceRef;
  }
  if (validator) {
    lineage.validator = validator;
  }
  if (source.sarVerification) {
    lineage.sarVerification = source.sarVerification;
  }
  if (source.sarCompleteness) {
    lineage.sarCompleteness = source.sarCompleteness;
  }
  if (source.publication) {
    lineage.publication = source.publication;
  }
  params.store.knowledgeLineageRecords[lineage.lineageId] = lineage;
  return lineage;
}
