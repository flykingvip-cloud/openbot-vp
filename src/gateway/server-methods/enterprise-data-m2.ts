import { resolveBillingScope } from "../billing/scope.js";
import {
  listAccessGovernanceMatrix,
  resolveAccessGovernanceOverview,
  resolveAccessGovernanceTarget,
  resolveDataSourceGovernanceView,
  type AccessGovernanceDimension,
} from "../enterprise-data/access-governance-store.js";
import { EnterpriseDataStoreError } from "../enterprise-data/connector-action-store.js";
import { findDataConnectorDefinition } from "../enterprise-data/connector-catalog.js";
import {
  archiveDataAccessPolicy,
  resolveDataAccessPolicyDetail,
} from "../enterprise-data/data-access-policy-store.js";
import { assertWebsiteBindingAssignable } from "../enterprise-data/data-asset-linkage.js";
import { archiveDataSource, upsertDataSource } from "../enterprise-data/data-source-store.js";
import { requireResolvedEnterpriseAdminTenantId } from "../enterprise-data/enterprise-data-seat-context.js";
import type {
  DataAccessPolicyTargetKind,
  DataSourceCategory,
  EnterpriseDataStore,
} from "../enterprise-data/types.js";
import { resolveDataSourceOperationalIdentityBindings } from "../enterprise-operational-identity-access.js";
import { loadEnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { resolveControlPlaneStorePathForClient } from "../tenant-context.js";
import { TENANT_SEAT_ASSETS_FILE } from "../tenant-store-paths.js";
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

function parseDataSourceCategory(value: unknown): DataSourceCategory | null {
  if (
    value === "crm" ||
    value === "erp" ||
    value === "finance" ||
    value === "oa" ||
    value === "mes" ||
    value === "external"
  ) {
    return value;
  }
  return null;
}

function parseGovernanceDimension(value: unknown): AccessGovernanceDimension | null {
  if (value === "source" || value === "seat" || value === "department" || value === "role") {
    return value;
  }
  return null;
}

function parseTargetKind(value: unknown): DataAccessPolicyTargetKind | null {
  if (value === "seat" || value === "department" || value === "role") {
    return value;
  }
  return null;
}

export function createEnterpriseDataM2Handlers(
  withEnterpriseDataStore: WithStoreRunner,
): GatewayRequestHandlers {
  return {
    "enterprise-data.sources.upsert": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const sourceKey = stringValue(params.sourceKey);
      const displayName = stringValue(params.displayName);
      const connectorId = stringValue(params.connectorId);
      const category = parseDataSourceCategory(params.category);
      if (!sourceKey || !displayName || !connectorId || !category) {
        respondInvalid(respond, "sourceKey, displayName, connectorId, and category are required");
        return;
      }
      const status =
        params.status === "connected" ||
        params.status === "disconnected" ||
        params.status === "error"
          ? params.status
          : "connected";
      const bindingId = stringValue(params.bindingId) || undefined;
      const caller = await resolveBillingScope(client, { requestedTenantId: tenantId });
      const callerUserId = caller.user?.id?.trim() || null;
      try {
        const source = await withEnterpriseDataStore(tenantId, client, (store) => {
          if (findDataConnectorDefinition(connectorId)?.accessMethod === "website_session") {
            assertWebsiteBindingAssignable({
              store,
              tenantId,
              callerUserId,
              sourceId: stringValue(params.sourceId) || undefined,
              bindingId,
            });
          }
          return upsertDataSource({
            store,
            tenantId,
            nowIso: new Date().toISOString(),
            source: {
              sourceId: stringValue(params.sourceId) || undefined,
              sourceKey,
              displayName,
              category,
              status,
              connectorId,
              credentialId: stringValue(params.credentialId) || undefined,
              bindingId,
            },
          });
        });
        respond(true, { tenantId, source });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.sources.archive": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const sourceId = stringValue(params.sourceId);
      if (!sourceId) {
        respondInvalid(respond, "sourceId is required");
        return;
      }
      try {
        const source = await withEnterpriseDataStore(tenantId, client, (store) =>
          archiveDataSource({
            store,
            tenantId,
            sourceId,
            nowIso: new Date().toISOString(),
          }),
        );
        respond(true, { tenantId, source });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.sources.governance-view": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const sourceId = stringValue(params.sourceId);
      if (!sourceId) {
        respondInvalid(respond, "sourceId is required");
        return;
      }
      try {
        const nowIso = new Date().toISOString();
        const seatStore = await loadEnterpriseSeatAssetsStore(
          await resolveControlPlaneStorePathForClient(client, TENANT_SEAT_ASSETS_FILE),
        );
        const view = await withEnterpriseDataStore(tenantId, client, (store) =>
          resolveDataSourceGovernanceView({ store, tenantId, sourceId }),
        );
        const boundOperationalIdentities = resolveDataSourceOperationalIdentityBindings({
          seatStore,
          tenantId,
          sourceId,
          nowIso,
        });
        respond(true, {
          tenantId,
          view: {
            ...view,
            boundOperationalIdentities,
          },
        });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.access-policies.get": async ({ client, params, respond }) => {
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
        const detail = await withEnterpriseDataStore(tenantId, client, (store) =>
          resolveDataAccessPolicyDetail({ store, tenantId, policyId }),
        );
        respond(true, { tenantId, detail });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.access-policies.archive": async ({ client, params, respond }) => {
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
        const policy = await withEnterpriseDataStore(tenantId, client, (store) =>
          archiveDataAccessPolicy({
            store,
            tenantId,
            policyId,
            nowIso: new Date().toISOString(),
          }),
        );
        respond(true, { tenantId, policy });
      } catch (error) {
        respond(false, undefined, toEnterpriseDataErrorShape(error));
      }
    },

    "enterprise-data.access-governance.overview": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const overview = await withEnterpriseDataStore(tenantId, client, (store) =>
        resolveAccessGovernanceOverview({ store, tenantId }),
      );
      respond(true, { tenantId, overview });
    },

    "enterprise-data.access-governance.matrix": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const dimension = parseGovernanceDimension(params.dimension);
      if (!dimension) {
        respondInvalid(respond, "dimension must be source, seat, department, or role");
        return;
      }
      const entries = await withEnterpriseDataStore(tenantId, client, (store) =>
        listAccessGovernanceMatrix({
          store,
          tenantId,
          dimension,
          targetId: stringValue(params.targetId) || undefined,
        }),
      );
      respond(true, { tenantId, dimension, entries });
    },

    "enterprise-data.access-governance.resolve-target": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const targetKind = parseTargetKind(params.targetKind);
      const targetId = stringValue(params.targetId);
      if (!targetKind || !targetId) {
        respondInvalid(respond, "targetKind and targetId are required");
        return;
      }
      const resolved = await withEnterpriseDataStore(tenantId, client, (store) =>
        resolveAccessGovernanceTarget({ store, tenantId, targetKind, targetId }),
      );
      respond(true, { tenantId, resolved });
    },
  };
}
