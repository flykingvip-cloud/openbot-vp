import { randomUUID } from "node:crypto";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import { findConnectorAction } from "./connector-action-store.js";
import { applyClassificationMasking } from "./masking-engine.js";
import type {
  ClassificationRuntimeConfig,
  ConnectorActionRef,
  EnterpriseDataStore,
  FieldClassification,
  MaskingPolicy,
  UnknownFieldPolicy,
} from "./types.js";
import { buildConnectorActionRefKey } from "./types.js";

export function listFieldClassifications(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  ref?: ConnectorActionRef;
}): FieldClassification[] {
  return Object.values(params.store.fieldClassifications)
    .filter((item) => {
      if (item.tenantId !== params.tenantId) {
        return false;
      }
      if (
        params.ref &&
        buildConnectorActionRefKey(item) !== buildConnectorActionRefKey(params.ref)
      ) {
        return false;
      }
      return true;
    })
    .toSorted((left, right) => left.fieldPath.localeCompare(right.fieldPath));
}

export function upsertFieldClassification(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
  classification: Omit<
    FieldClassification,
    "classificationId" | "tenantId" | "createdAt" | "updatedAt"
  > & {
    classificationId?: string;
  };
}): FieldClassification {
  const action = findConnectorAction(params.store, params.tenantId, params.classification);
  if (!action) {
    throw new EnterpriseDataStoreError(
      "CONNECTOR_ACTION_NOT_FOUND",
      `Action ${params.classification.actionKey}@${params.classification.version} not found.`,
    );
  }
  const existing = params.classification.classificationId
    ? params.store.fieldClassifications[params.classification.classificationId]
    : undefined;
  const record: FieldClassification = {
    classificationId:
      params.classification.classificationId ?? existing?.classificationId ?? randomUUID(),
    tenantId: params.tenantId,
    connectorId: params.classification.connectorId,
    actionKey: params.classification.actionKey,
    version: params.classification.version,
    fieldPath: params.classification.fieldPath,
    classification: params.classification.classification,
    maskingPolicyId: params.classification.maskingPolicyId,
    blockDetail: params.classification.blockDetail,
    createdAt: existing?.createdAt ?? params.nowIso,
    updatedAt: params.nowIso,
  };
  params.store.fieldClassifications[record.classificationId] = record;
  return record;
}

export function listMaskingPolicies(params: {
  store: EnterpriseDataStore;
  tenantId: string;
}): MaskingPolicy[] {
  return Object.values(params.store.maskingPolicies)
    .filter((policy) => policy.tenantId === params.tenantId)
    .toSorted((left, right) => left.displayName.localeCompare(right.displayName));
}

export function upsertMaskingPolicy(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
  policy: Omit<MaskingPolicy, "maskingPolicyId" | "tenantId" | "createdAt" | "updatedAt"> & {
    maskingPolicyId?: string;
  };
}): MaskingPolicy {
  const existing = params.policy.maskingPolicyId
    ? params.store.maskingPolicies[params.policy.maskingPolicyId]
    : undefined;
  const record: MaskingPolicy = {
    maskingPolicyId: params.policy.maskingPolicyId ?? existing?.maskingPolicyId ?? randomUUID(),
    tenantId: params.tenantId,
    displayName: params.policy.displayName,
    strategy: params.policy.strategy,
    config: params.policy.config,
    createdAt: existing?.createdAt ?? params.nowIso,
    updatedAt: params.nowIso,
  };
  params.store.maskingPolicies[record.maskingPolicyId] = record;
  return record;
}

export function ensureClassificationRuntimeConfig(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
  unknownFieldPolicy?: UnknownFieldPolicy;
  strictMode?: boolean;
}): ClassificationRuntimeConfig {
  const existing = params.store.classificationRuntimeConfigs[params.tenantId];
  const record: ClassificationRuntimeConfig = {
    tenantId: params.tenantId,
    unknownFieldPolicy:
      params.unknownFieldPolicy ?? existing?.unknownFieldPolicy ?? "fail_closed_redact",
    strictMode: params.strictMode ?? existing?.strictMode ?? true,
    updatedAt: params.nowIso,
  };
  params.store.classificationRuntimeConfigs[params.tenantId] = record;
  return record;
}

export function previewClassificationMasking(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  ref: ConnectorActionRef;
  samplePayload: unknown;
}): ReturnType<typeof applyClassificationMasking> {
  return applyClassificationMasking({
    store: params.store,
    tenantId: params.tenantId,
    ref: params.ref,
    payload: params.samplePayload,
  });
}
