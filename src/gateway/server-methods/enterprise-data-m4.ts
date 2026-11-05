import { EnterpriseDataStoreError } from "../enterprise-data/connector-action-store.js";
import { getProcessControlledSarProvider } from "../enterprise-data/controlled-sar-provider.js";
import {
  assertNoMaterializerRunOverrides,
  requireResolvedEnterpriseAdminTenantId,
} from "../enterprise-data/enterprise-data-seat-context.js";
import { upsertEnterpriseKnowledgeProjectionBinding } from "../enterprise-data/enterprise-knowledge-projection-binding-store.js";
import {
  deleteKnowledgeFeedItem,
  findKnowledgeFeedItem,
  isCurrentSuppliedFeedItem,
  listKnowledgeFeedItems,
} from "../enterprise-data/knowledge-feed-item-store.js";
import { assertWritableMaterializationMode } from "../enterprise-data/knowledge-publication.js";
import { resolveKnowledgeSupplyOverview } from "../enterprise-data/knowledge-supply-store.js";
import {
  findKnowledgeVisibilityPolicy,
  listKnowledgeVisibilityPolicies,
  resolveVisibilityForFeedItem,
  upsertKnowledgeVisibilityPolicy,
} from "../enterprise-data/knowledge-visibility-policy-store.js";
import { runProjectionMaterialization } from "../enterprise-data/projection-materializer.js";
import { upsertEnterpriseKnowledgeProjectionSpec } from "../enterprise-data/projection-spec-store.js";
import type {
  EnterpriseDataStore,
  EnterpriseKnowledgeProjectionLifecycle,
  EnterpriseKnowledgeProjectionMaterializationMode,
  EnterpriseKnowledgeProjectionCategory,
  EnterpriseKnowledgeObjectKind,
  KnowledgeAgentType,
  KnowledgePartialPublicationPolicy,
  ProjectionSourceActionRef,
  ProjectionTemplateKey,
} from "../enterprise-data/types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { respondInvalid, stringValue } from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

type WithStoreRunner = <T>(
  tenantId: string,
  client: import("./types.js").GatewayClient | null | undefined,
  run: (store: EnterpriseDataStore) => Promise<T> | T,
) => Promise<T>;

function toEnterpriseDataErrorShape(error: unknown) {
  if (error instanceof EnterpriseDataStoreError) {
    return errorShape(ErrorCodes.INVALID_REQUEST, error.message, { details: { code: error.code } });
  }
  if (error instanceof Error) {
    return errorShape(ErrorCodes.INVALID_REQUEST, error.message);
  }
  return errorShape(ErrorCodes.INVALID_REQUEST, "Enterprise data operation failed.");
}

function parseSourceActions(value: unknown): ProjectionSourceActionRef[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const refs: ProjectionSourceActionRef[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      return null;
    }
    const record = item as Record<string, unknown>;
    const connectorId = typeof record.connectorId === "string" ? record.connectorId : "";
    const actionKey = typeof record.actionKey === "string" ? record.actionKey : "";
    const version = typeof record.version === "string" ? record.version : "";
    if (!connectorId || !actionKey || !version) {
      return null;
    }
    refs.push({ connectorId, actionKey, version });
  }
  return refs.length > 0 ? refs : null;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

const PROJECTION_TEMPLATE_KEYS = new Set<ProjectionTemplateKey>([
  "NormalizeTemplate",
  "AggregateTemplate",
  "TrendTemplate",
  "RiskDetectionTemplate",
  "ForecastTemplate",
]);

const PROJECTION_LIFECYCLES = new Set<EnterpriseKnowledgeProjectionLifecycle>([
  "draft",
  "active",
  "deprecated",
  "frozen",
]);

const MATERIALIZATION_MODES = new Set<EnterpriseKnowledgeProjectionMaterializationMode>([
  "on_demand",
  "scheduled",
  // Minimal event ingest path via runEventDrivenProjectionsForEvent (not a clock scheduler).
  "event_driven",
]);

const PARTIAL_PUBLICATION = new Set<KnowledgePartialPublicationPolicy>([
  "withhold",
  "publish_marked",
]);

const OBJECT_KINDS = new Set<EnterpriseKnowledgeObjectKind>(["data", "metric", "insight"]);

export function createEnterpriseDataM4Handlers(
  withEnterpriseDataStore: WithStoreRunner,
): GatewayRequestHandlers {
  return {
    "enterprise-data.projection-specs.upsert": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const projectionKey = stringValue(params.projectionKey);
      const displayName = stringValue(params.displayName);
      const category = stringValue(params.category) as EnterpriseKnowledgeProjectionCategory | null;
      const templateKey = stringValue(params.templateKey) as ProjectionTemplateKey | null;
      const lifecycle = stringValue(
        params.lifecycle,
      ) as EnterpriseKnowledgeProjectionLifecycle | null;
      const objectKind = stringValue(params.objectKind) as EnterpriseKnowledgeObjectKind | null;
      const sourceActions = parseSourceActions(params.sourceActions);
      if (
        !projectionKey ||
        !displayName ||
        !category ||
        !templateKey ||
        !lifecycle ||
        !objectKind ||
        !sourceActions
      ) {
        respondInvalid(
          respond,
          "projectionKey, displayName, category, templateKey, lifecycle, objectKind, and sourceActions are required",
        );
        return;
      }
      if (!PROJECTION_TEMPLATE_KEYS.has(templateKey)) {
        respondInvalid(respond, "templateKey is invalid");
        return;
      }
      if (!PROJECTION_LIFECYCLES.has(lifecycle)) {
        respondInvalid(respond, "lifecycle is invalid");
        return;
      }
      if (!OBJECT_KINDS.has(objectKind)) {
        respondInvalid(respond, "objectKind is invalid");
        return;
      }
      const partialRaw = stringValue(params.partialPublication);
      if (partialRaw && !PARTIAL_PUBLICATION.has(partialRaw as KnowledgePartialPublicationPolicy)) {
        respondInvalid(respond, "partialPublication is invalid");
        return;
      }
      const partialPublication = partialRaw
        ? (partialRaw as KnowledgePartialPublicationPolicy)
        : undefined;
      const outputSchema =
        params.outputSchema &&
        typeof params.outputSchema === "object" &&
        !Array.isArray(params.outputSchema)
          ? (params.outputSchema as Record<string, unknown>)
          : { type: "object" };
      try {
        const spec = await withEnterpriseDataStore(tenantId, client, (store) =>
          upsertEnterpriseKnowledgeProjectionSpec({
            store,
            tenantId,
            nowIso: new Date().toISOString(),
            spec: {
              projectionId: stringValue(params.projectionId) || undefined,
              projectionKey,
              displayName,
              category,
              capabilityId: stringValue(params.capabilityId) || undefined,
              sourceId: stringValue(params.sourceId) || undefined,
              partialPublication,
              sourceActions,
              objectKind,
              templateKey,
              description: stringValue(params.description) ?? "",
              outputSchema,
              lifecycle,
              createdBy: stringValue(params.createdBy) || undefined,
            },
          }),
        );
        respond(true, { tenantId, spec });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.projection-bindings.upsert": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const projectionId = stringValue(params.projectionId);
      const materializationMode = stringValue(
        params.materializationMode,
      ) as EnterpriseKnowledgeProjectionMaterializationMode | null;
      const generatorVersion = stringValue(params.generatorVersion);
      if (!projectionId || !materializationMode || !generatorVersion) {
        respondInvalid(
          respond,
          "projectionId, materializationMode, and generatorVersion are required",
        );
        return;
      }
      if (!MATERIALIZATION_MODES.has(materializationMode)) {
        respondInvalid(respond, "materializationMode is invalid");
        return;
      }
      try {
        assertWritableMaterializationMode(materializationMode);
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
        return;
      }
      const materializationTeamLabel = stringValue(params.materializationTeamLabel);
      if (!materializationTeamLabel) {
        respondInvalid(respond, "materializationTeamLabel is required");
        return;
      }
      const enabled = params.enabled !== false;
      const freshnessSlaMinutes =
        typeof params.freshnessSlaMinutes === "number" && params.freshnessSlaMinutes > 0
          ? params.freshnessSlaMinutes
          : undefined;
      try {
        const binding = await withEnterpriseDataStore(tenantId, client, (store) =>
          upsertEnterpriseKnowledgeProjectionBinding({
            store,
            tenantId,
            nowIso: new Date().toISOString(),
            binding: {
              bindingId: stringValue(params.bindingId) || undefined,
              projectionId,
              capabilityId: stringValue(params.capabilityId) || undefined,
              materializationMode,
              materializationTeamLabel,
              freshnessSlaMinutes,
              enabled,
              generatorVersion,
              visibilityPolicyId: stringValue(params.visibilityPolicyId) || undefined,
            },
          }),
        );
        respond(true, { tenantId, binding });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.visibility-policies.upsert": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const projectionId = stringValue(params.projectionId);
      if (!projectionId) {
        respondInvalid(respond, "projectionId is required");
        return;
      }
      try {
        const policy = await withEnterpriseDataStore(tenantId, client, (store) =>
          upsertKnowledgeVisibilityPolicy({
            store,
            tenantId,
            nowIso: new Date().toISOString(),
            policy: {
              policyId: stringValue(params.policyId) || undefined,
              projectionId,
              visibleSeats: parseStringArray(params.visibleSeats),
              visibleTeams: parseStringArray(params.visibleTeams),
              visibleDepartments: parseStringArray(params.visibleDepartments),
              visibleRoles: parseStringArray(params.visibleRoles),
              visibleAgentTypes: parseStringArray(params.visibleAgentTypes),
            },
          }),
        );
        respond(true, { tenantId, policy });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.visibility-policies.list": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      try {
        const policies = await withEnterpriseDataStore(tenantId, client, (store) =>
          listKnowledgeVisibilityPolicies({
            store,
            tenantId,
            projectionId: stringValue(params.projectionId) || undefined,
          }),
        );
        respond(true, { tenantId, policies });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.visibility-policies.get": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const policyId = stringValue(params.policyId);
      if (!policyId) {
        respondInvalid(respond, "policyId is required");
        return;
      }
      try {
        const policy = await withEnterpriseDataStore(tenantId, client, (store) => {
          const found = findKnowledgeVisibilityPolicy(store, tenantId, policyId);
          if (!found) {
            throw new EnterpriseDataStoreError(
              "VISIBILITY_POLICY_NOT_FOUND",
              "Visibility policy not found.",
            );
          }
          return found;
        });
        respond(true, { tenantId, policy });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.feed-items.list": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const seatId = stringValue(params.seatId) || undefined;
      const teamLabel = stringValue(params.teamLabel) || undefined;
      const departmentId = stringValue(params.departmentId) || undefined;
      const roleCode = stringValue(params.roleCode) || undefined;
      const agentType = stringValue(params.agentType) || undefined;
      if (stringValue(params.agentId)) {
        respondInvalid(respond, "Use agentType for visibility preview, not agentId.");
        return;
      }
      try {
        const result = await withEnterpriseDataStore(tenantId, client, (store) => {
          const items = listKnowledgeFeedItems({
            store,
            tenantId,
            projectionId: stringValue(params.projectionId) || undefined,
            freshnessStatus:
              typeof params.freshnessStatus === "string"
                ? (params.freshnessStatus as "fresh" | "stale" | "expired")
                : undefined,
          });
          const annotate = (feedItems: typeof items) =>
            feedItems.map((item) => ({
              ...item,
              isCurrentSupplied: isCurrentSuppliedFeedItem({
                store,
                tenantId,
                objectId: item.objectId,
              }),
            }));
          if (!seatId && !teamLabel && !departmentId && !roleCode && !agentType) {
            return { items: annotate(items), visibilityFiltered: false };
          }
          const filtered = items.filter((item) => {
            const binding = Object.values(store.enterpriseKnowledgeProjectionBindings).find(
              (entry) => entry.tenantId === tenantId && entry.projectionId === item.projectionId,
            );
            const visibility = resolveVisibilityForFeedItem({
              store,
              tenantId,
              projectionId: item.projectionId,
              visibilityPolicyId: binding?.visibilityPolicyId,
              context: {
                seatId: seatId ?? "",
                teamLabel,
                departmentId,
                roleCode,
                agentType: agentType as KnowledgeAgentType | undefined,
              },
            });
            return visibility.visible;
          });
          return { items: annotate(filtered), visibilityFiltered: true };
        });
        respond(true, { tenantId, ...result });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.feed-items.get": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const objectId = stringValue(params.objectId);
      if (!objectId) {
        respondInvalid(respond, "objectId is required");
        return;
      }
      try {
        const item = await withEnterpriseDataStore(tenantId, client, (store) => {
          const found = findKnowledgeFeedItem(store, tenantId, objectId);
          if (!found) {
            throw new EnterpriseDataStoreError(
              "FEED_ITEM_NOT_FOUND",
              "Knowledge feed item not found.",
            );
          }
          return found;
        });
        respond(true, { tenantId, item });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.feed-items.delete": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const objectId = stringValue(params.objectId);
      if (!objectId) {
        respondInvalid(respond, "objectId is required");
        return;
      }
      const force = params.force === true;
      try {
        const item = await withEnterpriseDataStore(tenantId, client, (store) =>
          deleteKnowledgeFeedItem({
            store,
            tenantId,
            objectId,
            nowIso: new Date().toISOString(),
            force,
          }),
        );
        respond(true, {
          tenantId,
          item,
          deleted: true,
          forced: force,
        });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.projection-materializer.run": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      try {
        assertNoMaterializerRunOverrides(params);
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
        return;
      }
      const bindingId = stringValue(params.bindingId);
      if (!bindingId) {
        respondInvalid(respond, "bindingId is required");
        return;
      }
      const input =
        params.input && typeof params.input === "object" && !Array.isArray(params.input)
          ? (params.input as Record<string, unknown>)
          : undefined;
      try {
        const result = await withEnterpriseDataStore(tenantId, client, (store) =>
          runProjectionMaterialization({
            store,
            tenantId,
            bindingId,
            input,
            sarProvider: getProcessControlledSarProvider(),
            nowIso: new Date().toISOString(),
          }),
        );
        respond(true, { tenantId, result });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.knowledge-supply.overview": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      try {
        const overview = await withEnterpriseDataStore(tenantId, client, (store) =>
          resolveKnowledgeSupplyOverview({
            store,
            tenantId,
            nowIso: new Date().toISOString(),
          }),
        );
        respond(true, { tenantId, overview });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },
  };
}
