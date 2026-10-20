import {
  resolveCapabilitiesByActionRef,
  resolveCapabilityActionMapper,
  resolveCapabilityGovernanceView,
  resolveCapabilityOverview,
  resolveCapabilitySourceMapper,
} from "../enterprise-data/capability-governance-store.js";
import { EnterpriseDataStoreError } from "../enterprise-data/connector-action-store.js";
import {
  archiveDataCapability,
  upsertDataCapability,
} from "../enterprise-data/data-capability-store.js";
import { requireResolvedEnterpriseAdminTenantId } from "../enterprise-data/enterprise-data-seat-context.js";
import type { ConnectorActionRef, EnterpriseDataStore } from "../enterprise-data/types.js";
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

function parseActionRef(params: Record<string, unknown>): ConnectorActionRef | null {
  const connectorId = stringValue(params.connectorId);
  const actionKey = stringValue(params.actionKey);
  const version = stringValue(params.version);
  if (!connectorId || !actionKey || !version) {
    return null;
  }
  return { connectorId, actionKey, version };
}

function parseActionRefs(value: unknown): ConnectorActionRef[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const refs: ConnectorActionRef[] = [];
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

function parseSourceIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const sourceIds = value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  return sourceIds.length > 0 ? sourceIds : null;
}

export function createEnterpriseDataM3Handlers(
  withEnterpriseDataStore: WithStoreRunner,
): GatewayRequestHandlers {
  return {
    "enterprise-data.capabilities.upsert": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const capabilityKey = stringValue(params.capabilityKey);
      const displayName = stringValue(params.displayName);
      const description = stringValue(params.description) ?? "";
      const sourceIds = parseSourceIds(params.sourceIds);
      const actionRefs = parseActionRefs(params.actionRefs);
      if (!capabilityKey || !displayName || !sourceIds || !actionRefs) {
        respondInvalid(
          respond,
          "capabilityKey, displayName, sourceIds, and actionRefs are required",
        );
        return;
      }
      try {
        const capability = await withEnterpriseDataStore(tenantId, client, (store) =>
          upsertDataCapability({
            store,
            tenantId,
            nowIso: new Date().toISOString(),
            capability: {
              capabilityId: stringValue(params.capabilityId) || undefined,
              capabilityKey,
              displayName,
              description,
              sourceIds,
              actionRefs,
              enabled: params.enabled !== false,
            },
          }),
        );
        respond(true, { tenantId, capability });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.capabilities.archive": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const capabilityId = stringValue(params.capabilityId);
      if (!capabilityId) {
        respondInvalid(respond, "capabilityId is required");
        return;
      }
      try {
        const capability = await withEnterpriseDataStore(tenantId, client, (store) =>
          archiveDataCapability({
            store,
            tenantId,
            capabilityId,
            nowIso: new Date().toISOString(),
          }),
        );
        respond(true, { tenantId, capability });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.capabilities.governance-view": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const capabilityId = stringValue(params.capabilityId);
      if (!capabilityId) {
        respondInvalid(respond, "capabilityId is required");
        return;
      }
      try {
        const view = await withEnterpriseDataStore(tenantId, client, (store) =>
          resolveCapabilityGovernanceView({ store, tenantId, capabilityId }),
        );
        respond(true, { tenantId, view });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.capabilities.map-sources": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const capabilityId = stringValue(params.capabilityId);
      if (!capabilityId) {
        respondInvalid(respond, "capabilityId is required");
        return;
      }
      try {
        const sourceMappings = await withEnterpriseDataStore(tenantId, client, (store) =>
          resolveCapabilitySourceMapper({ store, tenantId, capabilityId }),
        );
        respond(true, { tenantId, capabilityId, sourceMappings });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.capabilities.map-actions": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const capabilityId = stringValue(params.capabilityId);
      if (!capabilityId) {
        respondInvalid(respond, "capabilityId is required");
        return;
      }
      try {
        const actionMappings = await withEnterpriseDataStore(tenantId, client, (store) =>
          resolveCapabilityActionMapper({ store, tenantId, capabilityId }),
        );
        respond(true, { tenantId, capabilityId, actionMappings });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.capabilities.resolve-by-action": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const ref = parseActionRef(params);
      if (!ref) {
        respondInvalid(respond, "connectorId, actionKey, and version are required");
        return;
      }
      const capabilities = await withEnterpriseDataStore(tenantId, client, (store) =>
        resolveCapabilitiesByActionRef({ store, tenantId, ref }),
      );
      respond(true, { tenantId, ref, capabilities });
    },

    "enterprise-data.capabilities.overview": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const overview = await withEnterpriseDataStore(tenantId, client, (store) =>
        resolveCapabilityOverview({ store, tenantId }),
      );
      respond(true, { tenantId, overview });
    },
  };
}
