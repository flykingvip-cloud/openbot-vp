import { randomUUID } from "node:crypto";
import { findConnectorAction, EnterpriseDataStoreError } from "./connector-action-store.js";
import { findDataCapability } from "./data-capability-store.js";
import { findDataSource } from "./data-source-store.js";
import { resolveConnectorAccessMethod } from "./source-account.js";
import {
  buildConnectorActionRefKey,
  type ConnectorActionRef,
  type EnterpriseDataStore,
  type EnterpriseKnowledgeProjectionSpec,
  type KnowledgePartialPublicationPolicy,
  type ProjectionSourceActionRef,
} from "./types.js";

export function validateProjectionSourceActions(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  sourceActions: ProjectionSourceActionRef[];
}): void {
  if (params.sourceActions.length === 0) {
    throw new EnterpriseDataStoreError(
      "PROJECTION_SOURCE_ACTIONS_REQUIRED",
      "EnterpriseKnowledgeProjectionSpec requires explicit sourceActions with precise versions.",
    );
  }
  if (params.sourceActions.length > 1) {
    throw new EnterpriseDataStoreError(
      "PROJECTION_SINGLE_SOURCE_REQUIRED",
      "M4 projections support exactly one sourceAction; register separate projections for additional sources.",
    );
  }
  for (const ref of params.sourceActions) {
    if (!ref.connectorId?.trim() || !ref.actionKey?.trim() || !ref.version?.trim()) {
      throw new EnterpriseDataStoreError(
        "PROJECTION_SOURCE_ACTION_INVALID",
        "Each source action must include connectorId, actionKey, and version.",
      );
    }
    const action = findConnectorAction(params.store, params.tenantId, ref);
    if (!action) {
      throw new EnterpriseDataStoreError(
        "CONNECTOR_ACTION_NOT_FOUND",
        `Projection references unknown action ${ref.actionKey}@${ref.version}.`,
      );
    }
    if (action.lifecycle === "draft" || action.lifecycle === "frozen") {
      throw new EnterpriseDataStoreError(
        "CONNECTOR_ACTION_FROZEN",
        `Projection cannot reference ${ref.actionKey}@${ref.version} in lifecycle ${action.lifecycle}.`,
      );
    }
    if (!action.readOnly) {
      throw new EnterpriseDataStoreError(
        "PROJECTION_WRITE_ACTION_FORBIDDEN",
        `Write action ${ref.actionKey}@${ref.version} cannot enter a projection or knowledge object.`,
      );
    }
  }
}

function assertPartialPublicationPolicy(
  value: string | undefined,
): KnowledgePartialPublicationPolicy | undefined {
  if (value == null || value === "") {
    return undefined;
  }
  if (value === "withhold" || value === "publish_marked") {
    return value;
  }
  throw new EnterpriseDataStoreError(
    "PROJECTION_PARTIAL_POLICY_INVALID",
    "partialPublication must be withhold or publish_marked.",
  );
}

function assertProjectionSource(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  spec: Pick<EnterpriseKnowledgeProjectionSpec, "sourceId" | "capabilityId" | "sourceActions">;
}): string | undefined {
  const sourceId = params.spec.sourceId?.trim() || undefined;
  const website = params.spec.sourceActions.some(
    (ref) => resolveConnectorAccessMethod(ref.connectorId) === "website_session",
  );
  if (website && !sourceId) {
    throw new EnterpriseDataStoreError(
      "PROJECTION_SOURCE_REQUIRED",
      "Website projections require an explicit DataSource sourceId.",
    );
  }
  if (!sourceId) {
    return undefined;
  }
  const source = findDataSource(params.store, params.tenantId, sourceId);
  if (!source) {
    throw new EnterpriseDataStoreError(
      "DATA_SOURCE_NOT_FOUND",
      `Projection references unknown DataSource ${sourceId}.`,
    );
  }
  const connectorIds = new Set(params.spec.sourceActions.map((ref) => ref.connectorId));
  if (!connectorIds.has(source.connectorId)) {
    throw new EnterpriseDataStoreError(
      "PROJECTION_SOURCE_MISMATCH",
      `sourceId ${sourceId} does not match the projection source action connector.`,
    );
  }
  return sourceId;
}

/** Governance cross-check only — never replaces explicit sourceActions. */
export function assertSourceActionsAlignWithCapability(params: {
  capabilityActionRefs: ConnectorActionRef[];
  sourceActions: ProjectionSourceActionRef[];
}): void {
  for (const ref of params.sourceActions) {
    const key = buildConnectorActionRefKey(ref);
    const aligned = params.capabilityActionRefs.some(
      (capabilityRef) => buildConnectorActionRefKey(capabilityRef) === key,
    );
    if (!aligned) {
      throw new EnterpriseDataStoreError(
        "PROJECTION_SOURCE_ACTION_NOT_IN_CAPABILITY",
        `sourceActions must be explicit and align with linked DataCapability: ${ref.actionKey}@${ref.version}.`,
      );
    }
  }
}

export function listEnterpriseKnowledgeProjectionSpecs(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  lifecycle?: EnterpriseKnowledgeProjectionSpec["lifecycle"];
  capabilityId?: string;
}): EnterpriseKnowledgeProjectionSpec[] {
  return Object.values(params.store.enterpriseKnowledgeProjectionSpecs)
    .filter((spec) => {
      if (spec.tenantId !== params.tenantId) {
        return false;
      }
      if (params.lifecycle && spec.lifecycle !== params.lifecycle) {
        return false;
      }
      if (params.capabilityId && spec.capabilityId !== params.capabilityId) {
        return false;
      }
      return true;
    })
    .toSorted((left, right) => left.projectionKey.localeCompare(right.projectionKey));
}

export function findEnterpriseKnowledgeProjectionSpec(
  store: EnterpriseDataStore,
  tenantId: string,
  projectionId: string,
): EnterpriseKnowledgeProjectionSpec | null {
  const spec = store.enterpriseKnowledgeProjectionSpecs[projectionId];
  if (!spec || spec.tenantId !== tenantId) {
    return null;
  }
  return spec;
}

export function upsertEnterpriseKnowledgeProjectionSpec(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  spec: Omit<
    EnterpriseKnowledgeProjectionSpec,
    "projectionId" | "tenantId" | "createdAt" | "updatedAt"
  > & { projectionId?: string };
  nowIso: string;
}): EnterpriseKnowledgeProjectionSpec {
  if (!params.spec.sourceActions?.length) {
    throw new EnterpriseDataStoreError(
      "PROJECTION_SOURCE_ACTIONS_REQUIRED",
      "sourceActions must be explicitly provided; implicit derivation from DataCapability is forbidden.",
    );
  }
  validateProjectionSourceActions({
    store: params.store,
    tenantId: params.tenantId,
    sourceActions: params.spec.sourceActions,
  });
  const sourceId = assertProjectionSource({
    store: params.store,
    tenantId: params.tenantId,
    spec: params.spec,
  });
  const partialPublication = assertPartialPublicationPolicy(params.spec.partialPublication);
  if (params.spec.capabilityId) {
    const capability = findDataCapability(params.store, params.tenantId, params.spec.capabilityId);
    if (!capability) {
      throw new EnterpriseDataStoreError("DATA_CAPABILITY_NOT_FOUND", "DataCapability not found.");
    }
    assertSourceActionsAlignWithCapability({
      capabilityActionRefs: capability.actionRefs,
      sourceActions: params.spec.sourceActions,
    });
    if (sourceId && !capability.sourceIds.includes(sourceId)) {
      throw new EnterpriseDataStoreError(
        "PROJECTION_SOURCE_NOT_IN_CAPABILITY",
        `sourceId ${sourceId} is not on the linked DataCapability.`,
      );
    }
  }
  const existing =
    params.spec.projectionId != null
      ? findEnterpriseKnowledgeProjectionSpec(
          params.store,
          params.tenantId,
          params.spec.projectionId,
        )
      : null;
  const duplicateKey = Object.values(params.store.enterpriseKnowledgeProjectionSpecs).find(
    (spec) =>
      spec.tenantId === params.tenantId &&
      spec.projectionKey === params.spec.projectionKey &&
      spec.projectionId !== (existing?.projectionId ?? params.spec.projectionId),
  );
  if (duplicateKey) {
    throw new EnterpriseDataStoreError(
      "PROJECTION_KEY_CONFLICT",
      `Projection key ${params.spec.projectionKey} already exists.`,
    );
  }
  const record: EnterpriseKnowledgeProjectionSpec = {
    projectionId: params.spec.projectionId ?? existing?.projectionId ?? randomUUID(),
    tenantId: params.tenantId,
    projectionKey: params.spec.projectionKey,
    displayName: params.spec.displayName,
    category: params.spec.category,
    capabilityId: params.spec.capabilityId,
    ...(sourceId ? { sourceId } : {}),
    ...(partialPublication ? { partialPublication } : {}),
    sourceActions: params.spec.sourceActions.map((ref) => ({ ...ref })),
    objectKind: params.spec.objectKind,
    templateKey: params.spec.templateKey,
    description: params.spec.description,
    outputSchema: params.spec.outputSchema,
    lifecycle: params.spec.lifecycle,
    createdAt: existing?.createdAt ?? params.nowIso,
    updatedAt: params.nowIso,
    createdBy: params.spec.createdBy ?? existing?.createdBy,
  };
  params.store.enterpriseKnowledgeProjectionSpecs[record.projectionId] = record;
  return record;
}
