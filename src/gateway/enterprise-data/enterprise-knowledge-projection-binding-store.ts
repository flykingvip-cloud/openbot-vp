import { randomUUID } from "node:crypto";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import { findDataCapability } from "./data-capability-store.js";
import { findEnterpriseKnowledgeProjectionSpec } from "./projection-spec-store.js";
import type { EnterpriseDataStore, EnterpriseKnowledgeProjectionBinding } from "./types.js";

export function listEnterpriseKnowledgeProjectionBindings(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  projectionId?: string;
  capabilityId?: string;
  enabled?: boolean;
}): EnterpriseKnowledgeProjectionBinding[] {
  return Object.values(params.store.enterpriseKnowledgeProjectionBindings)
    .filter((binding) => {
      if (binding.tenantId !== params.tenantId) {
        return false;
      }
      if (params.projectionId && binding.projectionId !== params.projectionId) {
        return false;
      }
      if (params.capabilityId && binding.capabilityId !== params.capabilityId) {
        return false;
      }
      if (params.enabled != null && binding.enabled !== params.enabled) {
        return false;
      }
      return true;
    })
    .toSorted((left, right) => left.projectionId.localeCompare(right.projectionId));
}

export function findEnterpriseKnowledgeProjectionBinding(
  store: EnterpriseDataStore,
  tenantId: string,
  bindingId: string,
): EnterpriseKnowledgeProjectionBinding | null {
  const binding = store.enterpriseKnowledgeProjectionBindings[bindingId];
  if (!binding || binding.tenantId !== tenantId) {
    return null;
  }
  return binding;
}

export function upsertEnterpriseKnowledgeProjectionBinding(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  binding: Omit<
    EnterpriseKnowledgeProjectionBinding,
    "bindingId" | "tenantId" | "createdAt" | "updatedAt"
  > & { bindingId?: string };
  nowIso: string;
}): EnterpriseKnowledgeProjectionBinding {
  const projection = findEnterpriseKnowledgeProjectionSpec(
    params.store,
    params.tenantId,
    params.binding.projectionId,
  );
  if (!projection) {
    throw new EnterpriseDataStoreError("PROJECTION_NOT_FOUND", "Projection spec not found.");
  }
  if (params.binding.capabilityId) {
    const capability = findDataCapability(
      params.store,
      params.tenantId,
      params.binding.capabilityId,
    );
    if (!capability) {
      throw new EnterpriseDataStoreError("DATA_CAPABILITY_NOT_FOUND", "DataCapability not found.");
    }
    if (projection.capabilityId && projection.capabilityId !== params.binding.capabilityId) {
      throw new EnterpriseDataStoreError(
        "PROJECTION_CAPABILITY_MISMATCH",
        "Projection capabilityId must match binding capabilityId.",
      );
    }
  }
  const materializationTeamLabel = params.binding.materializationTeamLabel?.trim();
  if (!materializationTeamLabel) {
    throw new EnterpriseDataStoreError(
      "MATERIALIZATION_TEAM_LABEL_REQUIRED",
      "materializationTeamLabel is required on projection bindings.",
    );
  }
  const existing =
    params.binding.bindingId != null
      ? findEnterpriseKnowledgeProjectionBinding(
          params.store,
          params.tenantId,
          params.binding.bindingId,
        )
      : null;
  const record: EnterpriseKnowledgeProjectionBinding = {
    bindingId: params.binding.bindingId ?? existing?.bindingId ?? randomUUID(),
    tenantId: params.tenantId,
    projectionId: params.binding.projectionId,
    capabilityId: params.binding.capabilityId,
    materializationMode: params.binding.materializationMode,
    materializationTeamLabel,
    freshnessSlaMinutes: params.binding.freshnessSlaMinutes,
    enabled: params.binding.enabled,
    generatorVersion: params.binding.generatorVersion,
    visibilityPolicyId: params.binding.visibilityPolicyId,
    createdAt: existing?.createdAt ?? params.nowIso,
    updatedAt: params.nowIso,
  };
  params.store.enterpriseKnowledgeProjectionBindings[record.bindingId] = record;
  return record;
}
