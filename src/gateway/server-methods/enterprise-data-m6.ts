// Enterprise Data Capability Center — home dashboard RPCs (Phase 1+).
// Spec: .kiro/specs/enterprise-data-capability-center/tasks.md
//
// Read-only aggregations for the home page. All handlers require enterprise-admin
// tenant resolution and never accept a client-forged tenantId.

import { resolveAssetLandscapeGraph } from "../enterprise-data/asset-landscape-store.js";
import { EnterpriseDataStoreError } from "../enterprise-data/connector-action-store.js";
import { resolveDataConnectorCatalog } from "../enterprise-data/connector-catalog.js";
import {
  listDataConnectorCredentials,
  revokeDataConnectorCredential,
  upsertDataConnectorCredential,
} from "../enterprise-data/connector-credential-store.js";
import {
  buildSecretHint,
  deleteCredentialSecret,
  loadCredentialSecret,
  saveCredentialSecret,
} from "../enterprise-data/connector-credential-vault.js";
import { ensureConnectorDemoPackage } from "../enterprise-data/connector-demo-packages.js";
import { withDataConnectorOAuthSessionStoreWriteLock } from "../enterprise-data/connector-oauth-session-persistence.js";
import {
  getDataConnectorOAuthSession,
  simulateCompleteDataConnectorOAuthSession,
  startDataConnectorOAuthSession,
} from "../enterprise-data/connector-oauth.js";
import { ensureConnectorPackage } from "../enterprise-data/connector-packages.js";
import { resolveDataAuthorizationCards } from "../enterprise-data/dashboard-authorization-store.js";
import { resolveDataCapabilityUsageRows } from "../enterprise-data/dashboard-capability-rows-store.js";
import { resolveDataSourceHealthRows } from "../enterprise-data/dashboard-source-health-store.js";
import { resolveDataCapabilityDashboardSummary } from "../enterprise-data/dashboard-summary-store.js";
import { recordSourceConnectionCheck } from "../enterprise-data/data-asset-linkage.js";
import { findDataSource } from "../enterprise-data/data-source-store.js";
import { requireResolvedEnterpriseAdminTenantId } from "../enterprise-data/enterprise-data-seat-context.js";
import { listKnowledgeSupplyAuditEvents } from "../enterprise-data/knowledge-supply-audit-store.js";
import { resolveOrgTargets } from "../enterprise-data/org-targets-store.js";
import {
  listSemanticObjects,
  loadSemanticObjectStore,
} from "../enterprise-data/semantic-object-store.js";
import { probeDataSourceConnection } from "../enterprise-data/source-connection-probe.js";
import type { EnterpriseDataStore, HttpRestAuthScheme } from "../enterprise-data/types.js";
import { listTenantSeats, loadEnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { resolveConnectorOAuthSessionStorePathForTenantId } from "../tenant-context.js";
import { resolveControlPlaneStorePathForClient } from "../tenant-context.js";
import { TENANT_SEAT_ASSETS_FILE } from "../tenant-store-paths.js";
import { respondInvalid, respondUnavailable, stringValue } from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

type WithStoreRunner = <T>(
  tenantId: string,
  client: import("./types.js").GatewayClient | null | undefined,
  run: (store: EnterpriseDataStore) => Promise<T> | T,
) => Promise<T>;

const HTTP_REST_AUTH_SCHEMES: ReadonlySet<HttpRestAuthScheme> = new Set([
  "bearer",
  "basic",
  "header",
  "query",
  "none",
]);

/**
 * Extract the optional HTTP REST connector tuning fields (auth scheme + probe
 * path) from RPC params. Returns undefined for any field not supplied so callers
 * can fall back to a previously stored secret.
 */
function resolveHttpRestSecretFields(params: Record<string, unknown>): {
  authScheme?: HttpRestAuthScheme;
  authHeaderName?: string;
  authQueryParam?: string;
  basicUsername?: string;
  probePath?: string;
} {
  const rawScheme = stringValue(params.authScheme);
  const authScheme =
    rawScheme && HTTP_REST_AUTH_SCHEMES.has(rawScheme as HttpRestAuthScheme)
      ? (rawScheme as HttpRestAuthScheme)
      : undefined;
  return {
    authScheme,
    authHeaderName: stringValue(params.authHeaderName) || undefined,
    authQueryParam: stringValue(params.authQueryParam) || undefined,
    basicUsername: stringValue(params.basicUsername) || undefined,
    probePath: stringValue(params.probePath) || undefined,
  };
}

export function createEnterpriseDataM6Handlers(
  withEnterpriseDataStore: WithStoreRunner,
): GatewayRequestHandlers {
  return {
    "enterprise-data.dashboard.summary": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      try {
        const summary = await withEnterpriseDataStore(tenantId, client, (store) =>
          resolveDataCapabilityDashboardSummary({
            store,
            tenantId,
            nowIso: new Date().toISOString(),
          }),
        );
        respond(true, { tenantId, summary });
      } catch (error) {
        respondUnavailable(respond, error);
      }
    },

    "enterprise-data.dashboard.capability-rows": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      try {
        const limitRaw = stringValue(params.limit);
        const parsedLimit = limitRaw ? Number.parseInt(limitRaw, 10) : Number.NaN;
        const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined;
        const rows = await withEnterpriseDataStore(tenantId, client, (store) =>
          resolveDataCapabilityUsageRows({ store, tenantId, limit }),
        );
        respond(true, { tenantId, rows });
      } catch (error) {
        respondUnavailable(respond, error);
      }
    },

    "enterprise-data.dashboard.authorization-cards": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      try {
        // 跨库：组织/席位权威数据在 EnterpriseSeatAssetsStore（非 enterprise-data store）。
        const seatStore = await loadEnterpriseSeatAssetsStore(
          await resolveControlPlaneStorePathForClient(client, TENANT_SEAT_ASSETS_FILE),
        );
        const cards = await withEnterpriseDataStore(tenantId, client, (store) =>
          resolveDataAuthorizationCards({ store, seatStore, tenantId }),
        );
        respond(true, { tenantId, cards });
      } catch (error) {
        respondUnavailable(respond, error);
      }
    },

    "enterprise-data.asset-landscape.graph": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      try {
        const limitRaw = stringValue(params.limit);
        const parsedLimit = limitRaw ? Number.parseInt(limitRaw, 10) : Number.NaN;
        const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined;
        // 跨库：seat 标题在 EnterpriseSeatAssetsStore；用于把 targetId 解析成人类可读标签（P3 质量）。
        const seatStore = await loadEnterpriseSeatAssetsStore(
          await resolveControlPlaneStorePathForClient(client, TENANT_SEAT_ASSETS_FILE),
        );
        const seats = listTenantSeats(seatStore, tenantId);
        const seatTitleById = new Map(seats.map((seat) => [seat.seatId, seat.title] as const));
        const targetLabelResolver = (kind: string, targetId: string): string => {
          if (kind === "seat") {
            return seatTitleById.get(targetId) ?? targetId;
          }
          if (kind === "department") {
            // department 合成 id 形如 `roleCode:teamLabel`，取末段团队名兜底（决策 a 落地后改为实体名）。
            const parts = targetId.split(":");
            return parts.length > 1 ? parts[parts.length - 1] : targetId;
          }
          return targetId;
        };
        // 跨库：语义对象目录在独立 SemanticObjectStore（openbot-enterprise-semantic-objects.json）。
        const semanticCatalog = await loadSemanticObjectStore();
        const semanticObjects = listSemanticObjects({ store: semanticCatalog, tenantId });
        const graph = await withEnterpriseDataStore(tenantId, client, (store) =>
          resolveAssetLandscapeGraph({
            store,
            tenantId,
            limit,
            targetLabelResolver,
            semanticObjects,
          }),
        );
        respond(true, { tenantId, graph });
      } catch (error) {
        respondUnavailable(respond, error);
      }
    },

    "enterprise-data.dashboard.source-health": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      try {
        // 跨库：凭据状态在 EnterpriseSeatAssetsStore（运营身份绑定）。
        const seatStore = await loadEnterpriseSeatAssetsStore(
          await resolveControlPlaneStorePathForClient(client, TENANT_SEAT_ASSETS_FILE),
        );
        const rows = await withEnterpriseDataStore(tenantId, client, (store) =>
          resolveDataSourceHealthRows({
            store,
            seatStore,
            tenantId,
            nowIso: new Date().toISOString(),
          }),
        );
        respond(true, { tenantId, rows });
      } catch (error) {
        respondUnavailable(respond, error);
      }
    },

    "enterprise-data.org.targets": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      try {
        // 跨库：组织/席位权威数据在 EnterpriseSeatAssetsStore（非 enterprise-data store）。
        const seatStore = await loadEnterpriseSeatAssetsStore(
          await resolveControlPlaneStorePathForClient(client, TENANT_SEAT_ASSETS_FILE),
        );
        const targets = resolveOrgTargets({ seatStore, tenantId });
        respond(true, { tenantId, targets });
      } catch (error) {
        respondUnavailable(respond, error);
      }
    },

    "enterprise-data.connectors.catalog": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      try {
        const connectors = await withEnterpriseDataStore(tenantId, client, (store) =>
          resolveDataConnectorCatalog({ store, tenantId }),
        );
        respond(true, { tenantId, connectors });
      } catch (error) {
        respondUnavailable(respond, error);
      }
    },

    "enterprise-data.connectors.ensure-demo-package": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      const connectorId = stringValue(params.connectorId);
      if (!tenantId || !connectorId) {
        respondInvalid(respond, "connectorId is required");
        return;
      }
      try {
        const result = await withEnterpriseDataStore(tenantId, client, (store) =>
          ensureConnectorDemoPackage({
            store,
            tenantId,
            connectorId,
            nowIso: new Date().toISOString(),
          }),
        );
        respond(true, { tenantId, connectorId, ...result });
      } catch (error) {
        respondUnavailable(respond, error);
      }
    },

    "enterprise-data.sources.test-connection": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      const connectorId = stringValue(params.connectorId);
      if (!tenantId || !connectorId) {
        respondInvalid(respond, "connectorId is required");
        return;
      }
      const credentialId = stringValue(params.credentialId) || undefined;
      const sourceId = stringValue(params.sourceId) || undefined;
      const instanceUrl = stringValue(params.instanceUrl) || undefined;
      const apiKey = stringValue(params.apiKey) || undefined;
      const httpRest = resolveHttpRestSecretFields(params);
      const checkedAt = new Date().toISOString();
      try {
        const probed = await withEnterpriseDataStore(tenantId, client, async (store) => {
          const probe = await probeDataSourceConnection({
            store,
            tenantId,
            connectorId,
            credentialId,
            inlineCredential:
              instanceUrl || apiKey || httpRest.authScheme
                ? { instanceUrl, apiKey, ...httpRest }
                : undefined,
          });
          if (!sourceId) {
            return { probe, observation: undefined };
          }
          const source = findDataSource(store, tenantId, sourceId);
          if (!source || source.connectorId.toLowerCase() !== probe.connectorId.toLowerCase()) {
            throw new EnterpriseDataStoreError(
              "DATA_SOURCE_NOT_FOUND",
              "DataSource not found for this connector.",
            );
          }
          recordSourceConnectionCheck({
            store,
            tenantId,
            sourceId,
            nowIso: checkedAt,
          });
          return {
            probe,
            observation: {
              lastCheckedAt: source.lastCheckedAt,
              lastSucceededAt: source.lastSucceededAt,
              lastMaterializedAt: source.lastMaterializedAt,
              materializationCount: source.materializationCount ?? 0,
              updatedAt: source.updatedAt,
            },
          };
        });
        respond(true, { tenantId, probe: probed.probe, observation: probed.observation });
      } catch (error) {
        respondUnavailable(respond, error);
      }
    },

    "enterprise-data.connector-credentials.list": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      if (!tenantId) {
        return;
      }
      const connectorId = stringValue(params.connectorId) || undefined;
      try {
        const credentials = await withEnterpriseDataStore(tenantId, client, (store) =>
          listDataConnectorCredentials({ store, tenantId, connectorId }),
        );
        respond(true, { tenantId, credentials });
      } catch (error) {
        respondUnavailable(respond, error);
      }
    },

    "enterprise-data.connector-credentials.upsert": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      const connectorId = stringValue(params.connectorId);
      const label = stringValue(params.label);
      if (!tenantId || !connectorId || !label) {
        respondInvalid(respond, "connectorId and label are required");
        return;
      }
      const instanceUrl = stringValue(params.instanceUrl) || undefined;
      const apiKey = stringValue(params.apiKey) || undefined;
      const credentialId = stringValue(params.credentialId) || undefined;
      const httpRest = resolveHttpRestSecretFields(params);
      const hasHttpRestConfig =
        httpRest.authScheme != null ||
        httpRest.authHeaderName != null ||
        httpRest.authQueryParam != null ||
        httpRest.basicUsername != null ||
        httpRest.probePath != null;
      const kind = params.kind === "oauth2" || params.kind === "api_key" ? params.kind : "api_key";
      try {
        const credential = await withEnterpriseDataStore(tenantId, client, async (store) => {
          const existingSecret = credentialId ? await loadCredentialSecret(credentialId) : null;
          if (!apiKey && !instanceUrl && !existingSecret) {
            throw new Error("apiKey or instanceUrl is required for a new credential.");
          }
          const record = upsertDataConnectorCredential({
            store,
            tenantId,
            connectorId,
            label,
            kind,
            instanceUrl,
            secretHint: apiKey
              ? buildSecretHint(apiKey)
              : existingSecret?.apiKey
                ? buildSecretHint(existingSecret.apiKey)
                : undefined,
            credentialId,
            nowIso: new Date().toISOString(),
          });
          if (apiKey || instanceUrl || hasHttpRestConfig) {
            await saveCredentialSecret(record.credentialId, {
              instanceUrl: instanceUrl ?? existingSecret?.instanceUrl,
              apiKey: apiKey ?? existingSecret?.apiKey,
              oauthAccessToken: existingSecret?.oauthAccessToken,
              authScheme: httpRest.authScheme ?? existingSecret?.authScheme,
              authHeaderName: httpRest.authHeaderName ?? existingSecret?.authHeaderName,
              authQueryParam: httpRest.authQueryParam ?? existingSecret?.authQueryParam,
              basicUsername: httpRest.basicUsername ?? existingSecret?.basicUsername,
              probePath: httpRest.probePath ?? existingSecret?.probePath,
            });
          }
          return record;
        });
        respond(true, { tenantId, credential });
      } catch (error) {
        respondUnavailable(respond, error);
      }
    },

    "enterprise-data.connectors.ensure-package": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      const connectorId = stringValue(params.connectorId);
      if (!tenantId || !connectorId) {
        respondInvalid(respond, "connectorId is required");
        return;
      }
      try {
        const result = await withEnterpriseDataStore(tenantId, client, (store) =>
          ensureConnectorPackage({
            store,
            tenantId,
            connectorId,
            nowIso: new Date().toISOString(),
          }),
        );
        respond(true, { tenantId, connectorId, ...result });
      } catch (error) {
        respondUnavailable(respond, error);
      }
    },

    "enterprise-data.connector-credentials.oauth.start": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      const connectorId = stringValue(params.connectorId);
      const label = stringValue(params.label);
      if (!tenantId || !connectorId || !label) {
        respondInvalid(respond, "connectorId and label are required");
        return;
      }
      const nowIso = new Date().toISOString();
      const oauthStorePath = resolveConnectorOAuthSessionStorePathForTenantId(tenantId);
      const result = await withDataConnectorOAuthSessionStoreWriteLock(
        (store) =>
          startDataConnectorOAuthSession({
            store,
            tenantId,
            connectorId,
            label,
            returnPath: stringValue(params.returnPath) || undefined,
            callbackOrigin: stringValue(params.callbackOrigin) || undefined,
            basePath: stringValue(params.basePath) || undefined,
            nowIso,
          }),
        oauthStorePath,
      );
      if (!result.ok) {
        respondInvalid(respond, result.error);
        return;
      }
      respond(true, {
        tenantId,
        sessionId: result.session.sessionId,
        state: result.session.state,
        mode: result.session.mode,
        authorizeUrl: result.authorizeUrl,
        simulateAllowed: result.simulateAllowed,
        callbackUrl: result.callbackUrl,
        expiresAt: result.session.expiresAt,
      });
    },

    "enterprise-data.connector-credentials.oauth.status": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      const sessionId = stringValue(params.sessionId);
      if (!tenantId || !sessionId) {
        respondInvalid(respond, "sessionId is required");
        return;
      }
      const oauthStorePath = resolveConnectorOAuthSessionStorePathForTenantId(tenantId);
      const session = await withDataConnectorOAuthSessionStoreWriteLock(
        (store) => getDataConnectorOAuthSession(store, tenantId, sessionId),
        oauthStorePath,
      );
      if (!session) {
        respondInvalid(respond, "OAuth session not found");
        return;
      }
      respond(true, { tenantId, session });
    },

    "enterprise-data.connector-credentials.oauth.simulate-complete": async ({
      client,
      params,
      respond,
    }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      const sessionId = stringValue(params.sessionId);
      if (!tenantId || !sessionId) {
        respondInvalid(respond, "sessionId is required");
        return;
      }
      const result = await simulateCompleteDataConnectorOAuthSession({
        tenantId,
        sessionId,
        workspaceName: stringValue(params.workspaceName) || undefined,
        nowIso: new Date().toISOString(),
      });
      if (!result.ok) {
        respondInvalid(respond, result.error);
        return;
      }
      respond(true, {
        tenantId,
        session: result.session,
        credentialId: result.credentialId,
      });
    },

    "enterprise-data.connector-credentials.revoke": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      const credentialId = stringValue(params.credentialId);
      if (!tenantId || !credentialId) {
        respondInvalid(respond, "credentialId is required");
        return;
      }
      try {
        const credential = await withEnterpriseDataStore(tenantId, client, async (store) => {
          const record = revokeDataConnectorCredential({
            store,
            tenantId,
            credentialId,
            nowIso: new Date().toISOString(),
          });
          await deleteCredentialSecret(credentialId);
          return record;
        });
        respond(true, { tenantId, credential });
      } catch (error) {
        respondUnavailable(respond, error);
      }
    },

    "enterprise-data.sources.sync-log": async ({ client, params, respond }) => {
      const tenantId = await requireResolvedEnterpriseAdminTenantId({ client, params, respond });
      const sourceId = stringValue(params.sourceId);
      if (!tenantId || !sourceId) {
        respondInvalid(respond, "sourceId is required");
        return;
      }
      try {
        const events = await withEnterpriseDataStore(tenantId, client, (store) => {
          const source = store.dataSources[sourceId];
          if (!source || source.tenantId !== tenantId) {
            throw new Error("DataSource not found.");
          }
          const projectionIds = new Set(
            Object.values(store.enterpriseKnowledgeProjectionSpecs)
              .filter(
                (spec) =>
                  spec.tenantId === tenantId &&
                  Object.values(store.dataCapabilities).some(
                    (capability) =>
                      capability.tenantId === tenantId &&
                      capability.capabilityId === spec.capabilityId &&
                      capability.sourceIds.includes(sourceId),
                  ),
              )
              .map((spec) => spec.projectionId),
          );
          return listKnowledgeSupplyAuditEvents({
            store,
            tenantId,
            limit: 50,
          }).filter((event) => projectionIds.has(event.projectionId));
        });
        respond(true, { tenantId, events });
      } catch (error) {
        respondUnavailable(respond, error);
      }
    },
  };
}
