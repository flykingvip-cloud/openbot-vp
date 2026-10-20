/**
 * Tenant-scoped durable ValidationRecord for capability-center install.
 *
 * Reuses the E3/E5 enterprise data store (same JSON file as bridges / audits).
 * Does not invent a passed verdict. Cross-tenant rows are never returned to
 * another tenant's install projection. Expired rows are omitted so the gate
 * fails closed the same way as a missing record.
 */

import type { ValidationRecord } from "../../site-capability/validation-record.js";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import type { EnterpriseDataStore, EnterpriseSarValidationRecord } from "./types.js";

function recordsOf(store: EnterpriseDataStore): Record<string, EnterpriseSarValidationRecord> {
  return (store.sarValidationRecords ??= {});
}

function copyValidation(record: ValidationRecord): ValidationRecord {
  return {
    ...record,
    input: { ...record.input },
    basis: record.basis.kind === "human" ? { ...record.basis } : { ...record.basis },
    ...(record.independentReviewEvidence
      ? { independentReviewEvidence: { ...record.independentReviewEvidence } }
      : {}),
  };
}

function isExpired(record: EnterpriseSarValidationRecord, nowIso: string): boolean {
  const expiresAt = record.expiresAt?.trim();
  return Boolean(expiresAt && expiresAt <= nowIso);
}

/**
 * Persist one validation record under a tenant. Overwrites the same recordId.
 * Client-supplied tenantId on the record body is ignored; the caller's tenant wins.
 */
export function upsertSarValidationRecord(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  record: ValidationRecord;
  expiresAt?: string;
  accessibleScope?: string;
}): EnterpriseSarValidationRecord {
  const tenantId = params.tenantId.trim();
  const recordId = params.record.recordId.trim();
  const capabilityId = params.record.capabilityId.trim();
  const version = params.record.version.trim();
  const artifactDigest = params.record.artifactDigest.trim();
  if (!tenantId || !recordId || !capabilityId || !version || !artifactDigest) {
    throw new EnterpriseDataStoreError(
      "SAR_VALIDATION_INVALID",
      "Validation record requires tenantId, recordId, capabilityId, version, and artifactDigest.",
    );
  }
  const stored: EnterpriseSarValidationRecord = {
    ...copyValidation(params.record),
    recordId,
    capabilityId,
    version,
    artifactDigest,
    tenantId,
  };
  const expiresAt = params.expiresAt?.trim();
  if (expiresAt) {
    stored.expiresAt = expiresAt;
  }
  const accessibleScope = params.accessibleScope?.trim();
  if (accessibleScope) {
    stored.accessibleScope = accessibleScope;
  }
  recordsOf(params.store)[recordId] = stored;
  return {
    ...copyValidation(stored),
    tenantId: stored.tenantId,
    ...(stored.expiresAt ? { expiresAt: stored.expiresAt } : {}),
    ...(stored.accessibleScope ? { accessibleScope: stored.accessibleScope } : {}),
  };
}

/**
 * Load validation records for capability-install projection.
 * Same tenant only; expired rows omitted; returned as plain ValidationRecord[].
 */
export function listSarValidationRecordsForInstall(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
  /** When set, only records whose accessibleScope is empty or matches are kept. */
  accessibleScope?: string;
}): ValidationRecord[] {
  const tenantId = params.tenantId.trim();
  if (!tenantId) {
    return [];
  }
  const wantedScope = params.accessibleScope?.trim() || "";
  const out: ValidationRecord[] = [];
  for (const record of Object.values(recordsOf(params.store))) {
    if (record.tenantId !== tenantId) {
      continue;
    }
    if (isExpired(record, params.nowIso)) {
      continue;
    }
    const scope = record.accessibleScope?.trim() || "";
    if (wantedScope && scope && scope !== wantedScope) {
      continue;
    }
    out.push(copyValidation(record));
  }
  return out;
}
