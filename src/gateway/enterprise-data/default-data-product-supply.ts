/**
 * Connector-pack default data products.
 *
 * Successful connect or sync ensures a DataCapability, an active projection,
 * and a scheduled binding for each declared read model, then materializes any
 * binding that does not yet have a FeedItem. Seat authorization stays a
 * separate human gate. Opening Knowledge Universe does not call this.
 */

import { EnterpriseDataStoreError } from "./connector-action-store.js";
import {
  CONNECTOR_DEFAULT_PRODUCT_ACTOR,
  CONNECTOR_DEFAULT_PRODUCT_GENERATOR,
} from "./connector-default-product-marker.js";
import {
  listConnectorDefaultProducts,
  type ConnectorDefaultProductTemplate,
} from "./connector-default-products.js";
import { ensureConnectorPackage } from "./connector-packages.js";
import { getProcessControlledSarProvider } from "./controlled-sar-provider.js";
import { listDataCapabilities, upsertDataCapability } from "./data-capability-store.js";
import { findDataSource } from "./data-source-store.js";
import {
  listEnterpriseKnowledgeProjectionBindings,
  upsertEnterpriseKnowledgeProjectionBinding,
} from "./enterprise-knowledge-projection-binding-store.js";
import { listKnowledgeFeedItems } from "./knowledge-feed-item-store.js";
import { runProjectionMaterialization } from "./projection-materializer.js";
import {
  listEnterpriseKnowledgeProjectionSpecs,
  upsertEnterpriseKnowledgeProjectionSpec,
} from "./projection-spec-store.js";
import type {
  DataCapability,
  EnterpriseDataStore,
  EnterpriseKnowledgeProjectionBinding,
  EnterpriseKnowledgeProjectionSpec,
  ProjectionSourceActionRef,
} from "./types.js";

const MAX_PRODUCTS_PER_SUPPLY = 8;
const DEFAULT_FRESHNESS_SLA_MINUTES = 24 * 60;
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    count: { type: "number" },
    items: { type: "array" },
  },
} as const;

export type DefaultDataProductSupplyResult = {
  ensured: number;
  materialized: number;
  skipped: number;
  failed: number;
  capabilityIds: string[];
  errors: string[];
};

function emptyResult(): DefaultDataProductSupplyResult {
  return {
    ensured: 0,
    materialized: 0,
    skipped: 0,
    failed: 0,
    capabilityIds: [],
    errors: [],
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "默认数据产品供给失败";
}

function actionRef(
  connectorId: string,
  template: ConnectorDefaultProductTemplate,
): ProjectionSourceActionRef {
  return {
    connectorId,
    actionKey: template.actionKey,
    version: template.version,
  };
}

function sameAction(left: ProjectionSourceActionRef, right: ProjectionSourceActionRef): boolean {
  return (
    left.connectorId === right.connectorId &&
    left.actionKey === right.actionKey &&
    left.version === right.version
  );
}

function capabilityKey(connectorId: string, sourceId: string, productKey: string): string {
  return `default.${connectorId}.${sourceId}.${productKey}`;
}

function findCapabilityForProduct(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  sourceId: string;
  connectorId: string;
  template: ConnectorDefaultProductTemplate;
}): DataCapability | null {
  const ref = actionRef(params.connectorId, params.template);
  const key = capabilityKey(params.connectorId, params.sourceId, params.template.productKey);
  const linked = listDataCapabilities({
    store: params.store,
    tenantId: params.tenantId,
    sourceId: params.sourceId,
  });
  return (
    linked.find((capability) => capability.capabilityKey === key) ??
    linked.find((capability) =>
      capability.actionRefs.some((candidate) => sameAction(candidate, ref)),
    ) ??
    null
  );
}

function specMatchesProduct(params: {
  spec: EnterpriseKnowledgeProjectionSpec;
  sourceId: string;
  capabilityId: string;
  ref: ProjectionSourceActionRef;
}): boolean {
  if (params.spec.lifecycle !== "active") {
    return false;
  }
  if (params.spec.capabilityId && params.spec.capabilityId !== params.capabilityId) {
    return false;
  }
  if (params.spec.sourceId && params.spec.sourceId !== params.sourceId) {
    return false;
  }
  const sourceAction = params.spec.sourceActions[0];
  return Boolean(sourceAction && sameAction(sourceAction, params.ref));
}

function findSpecForProduct(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  sourceId: string;
  capabilityId: string;
  connectorId: string;
  template: ConnectorDefaultProductTemplate;
}): EnterpriseKnowledgeProjectionSpec | null {
  const ref = actionRef(params.connectorId, params.template);
  const key = capabilityKey(params.connectorId, params.sourceId, params.template.productKey);
  const specs = listEnterpriseKnowledgeProjectionSpecs({
    store: params.store,
    tenantId: params.tenantId,
    lifecycle: "active",
  });
  return (
    specs.find((spec) => spec.projectionKey === key) ??
    specs.find((spec) =>
      specMatchesProduct({
        spec,
        sourceId: params.sourceId,
        capabilityId: params.capabilityId,
        ref,
      }),
    ) ??
    null
  );
}

function projectionHasFeed(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  projectionId: string;
}): boolean {
  return listKnowledgeFeedItems({
    store: params.store,
    tenantId: params.tenantId,
  }).some((item) => item.projectionId === params.projectionId);
}

/**
 * Ensure pack defaults for one DataSource and materialize bindings that have
 * no feed yet. `actionKeys` limits the run to streams that actually synced.
 * Absent `actionKeys` supplies every template the connector declares.
 * A disabled binding is left disabled. An existing on_demand binding for the
 * same source and action is promoted to scheduled so the maintenance tick
 * keeps refreshing it.
 */
export async function supplyDefaultDataProducts(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  sourceId: string;
  nowIso: string;
  actionKeys?: readonly string[];
}): Promise<DefaultDataProductSupplyResult> {
  const result = emptyResult();
  const source = findDataSource(params.store, params.tenantId, params.sourceId);
  if (!source) {
    return result;
  }
  const connectorId = source.connectorId.trim().toLowerCase();
  const allowed = params.actionKeys ? new Set(params.actionKeys) : null;
  const templates = listConnectorDefaultProducts(connectorId)
    .filter((template) => !allowed || allowed.has(template.actionKey))
    .slice(0, MAX_PRODUCTS_PER_SUPPLY);
  if (templates.length === 0) {
    return result;
  }
  ensureConnectorPackage({
    store: params.store,
    tenantId: params.tenantId,
    connectorId,
    nowIso: params.nowIso,
  });

  const pending: string[] = [];
  for (const template of templates) {
    try {
      const bindingId = ensureOneProduct({
        store: params.store,
        tenantId: params.tenantId,
        sourceId: source.sourceId,
        sourceDisplayName: source.displayName,
        connectorId,
        template,
        nowIso: params.nowIso,
        result,
      });
      if (bindingId) {
        pending.push(bindingId);
      }
    } catch (error) {
      result.failed += 1;
      result.errors.push(`${template.displayName}: ${errorText(error)}`);
    }
  }

  for (const bindingId of pending) {
    try {
      await runProjectionMaterialization({
        store: params.store,
        tenantId: params.tenantId,
        bindingId,
        sarProvider: getProcessControlledSarProvider(),
        nowIso: params.nowIso,
      });
      result.materialized += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push(errorText(error));
    }
  }
  return result;
}

/** Connect and sync stay successful when supply itself fails. */
export async function supplyDefaultDataProductsSafely(
  params: Parameters<typeof supplyDefaultDataProducts>[0],
): Promise<DefaultDataProductSupplyResult> {
  try {
    return await supplyDefaultDataProducts(params);
  } catch (error) {
    const result = emptyResult();
    result.failed = 1;
    result.errors.push(errorText(error));
    return result;
  }
}

function ensureOneProduct(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  sourceId: string;
  sourceDisplayName: string;
  connectorId: string;
  template: ConnectorDefaultProductTemplate;
  nowIso: string;
  result: DefaultDataProductSupplyResult;
}): string | null {
  const ref = actionRef(params.connectorId, params.template);
  const key = capabilityKey(params.connectorId, params.sourceId, params.template.productKey);
  const existingCapability = findCapabilityForProduct(params);
  const capability =
    existingCapability ??
    upsertDataCapability({
      store: params.store,
      tenantId: params.tenantId,
      nowIso: params.nowIso,
      capability: {
        capabilityKey: key,
        displayName: `${params.sourceDisplayName} · ${params.template.displayName}`,
        description: params.template.description,
        sourceIds: [params.sourceId],
        actionRefs: [ref],
        enabled: true,
      },
    });
  if (!params.result.capabilityIds.includes(capability.capabilityId)) {
    params.result.capabilityIds.push(capability.capabilityId);
  }
  if (!existingCapability) {
    params.result.ensured += 1;
  }
  if (!capability.enabled) {
    params.result.skipped += 1;
    return null;
  }
  if (!capability.sourceIds.includes(params.sourceId)) {
    throw new EnterpriseDataStoreError(
      "DATA_CAPABILITY_SOURCE_MISMATCH",
      "Matched data product is not linked to this data asset.",
    );
  }

  const existingSpec = findSpecForProduct({
    ...params,
    capabilityId: capability.capabilityId,
  });
  const spec =
    existingSpec ??
    upsertEnterpriseKnowledgeProjectionSpec({
      store: params.store,
      tenantId: params.tenantId,
      nowIso: params.nowIso,
      spec: {
        projectionKey: key,
        displayName: `${params.sourceDisplayName} · ${params.template.displayName}`,
        category: params.template.category,
        capabilityId: capability.capabilityId,
        sourceId: params.sourceId,
        sourceActions: [ref],
        objectKind: params.template.objectKind,
        templateKey: params.template.templateKey,
        description: params.template.description,
        outputSchema: { ...OUTPUT_SCHEMA },
        lifecycle: "active",
        createdBy: CONNECTOR_DEFAULT_PRODUCT_ACTOR,
      },
    });

  const bindings = listEnterpriseKnowledgeProjectionBindings({
    store: params.store,
    tenantId: params.tenantId,
    projectionId: spec.projectionId,
  });
  const enabled = bindings.find((binding) => binding.enabled);
  if (bindings.length > 0 && !enabled) {
    params.result.skipped += 1;
    return null;
  }
  const binding = enabled
    ? promoteManualBinding({
        store: params.store,
        tenantId: params.tenantId,
        binding: enabled,
        capabilityId: capability.capabilityId,
        nowIso: params.nowIso,
      })
    : upsertEnterpriseKnowledgeProjectionBinding({
        store: params.store,
        tenantId: params.tenantId,
        nowIso: params.nowIso,
        binding: {
          projectionId: spec.projectionId,
          capabilityId: capability.capabilityId,
          materializationMode: "scheduled",
          materializationTeamLabel: params.sourceDisplayName.trim() || "default",
          freshnessSlaMinutes: DEFAULT_FRESHNESS_SLA_MINUTES,
          enabled: true,
          generatorVersion: CONNECTOR_DEFAULT_PRODUCT_GENERATOR,
        },
      });
  if (
    projectionHasFeed({
      store: params.store,
      tenantId: params.tenantId,
      projectionId: spec.projectionId,
    })
  ) {
    params.result.skipped += 1;
    return null;
  }
  return binding.bindingId;
}

function promoteManualBinding(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  binding: EnterpriseKnowledgeProjectionBinding;
  capabilityId: string;
  nowIso: string;
}): EnterpriseKnowledgeProjectionBinding {
  if (params.binding.materializationMode !== "on_demand") {
    return params.binding;
  }
  return upsertEnterpriseKnowledgeProjectionBinding({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    binding: {
      bindingId: params.binding.bindingId,
      projectionId: params.binding.projectionId,
      capabilityId: params.binding.capabilityId ?? params.capabilityId,
      materializationMode: "scheduled",
      materializationTeamLabel: params.binding.materializationTeamLabel,
      freshnessSlaMinutes: params.binding.freshnessSlaMinutes ?? DEFAULT_FRESHNESS_SLA_MINUTES,
      enabled: true,
      generatorVersion: params.binding.generatorVersion,
      visibilityPolicyId: params.binding.visibilityPolicyId,
    },
  });
}
