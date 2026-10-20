/**
 * enterprise-model-catalog.* RPC handlers.
 * Spec: `.kiro/specs/enterprise-ai-model-governance/`
 */

import {
  listEnterpriseModelAssets,
  promoteEnabledEnterpriseModelAssets,
  registerEnterpriseModelAsset,
  setEnterpriseModelAssetEnabled,
  updateEnterpriseModelAsset,
} from "../enterprise-model/asset-store.js";
import { recordEnterpriseModelAuditEvent } from "../enterprise-model/audit.js";
import {
  getEnterpriseModelConnection,
  isEnterpriseModelConnectionCatalogReady,
  updateEnterpriseModelConnection,
} from "../enterprise-model/connection-store.js";
import { loadEnterpriseModelSecret } from "../enterprise-model/credential-vault.js";
import { isEnterpriseModelError } from "../enterprise-model/errors.js";
import {
  probeEnterpriseModelConnection,
  SAVED_ENTERPRISE_ENDPOINT_SSRF_POLICY,
} from "../enterprise-model/probe.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import {
  requireEnterpriseScope,
  respondInvalid,
  respondUnavailable,
  stringValue,
} from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

function respondEnterpriseModelError(
  respond: Parameters<GatewayRequestHandlers[string]>[0]["respond"],
  error: unknown,
): void {
  if (isEnterpriseModelError(error)) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, error.message, {
        details: { code: error.code },
        retryable: error.retryable,
      }),
    );
    return;
  }
  respondUnavailable(respond, error);
}

function requireAdmin(
  scope: { isEnterpriseAdmin: boolean },
  respond: Parameters<GatewayRequestHandlers[string]>[0]["respond"],
): boolean {
  if (!scope.isEnterpriseAdmin) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "仅企业管理员可执行此操作。", {
        details: { code: "ENTERPRISE_MODEL_FORBIDDEN" },
      }),
    );
    return false;
  }
  return true;
}

export const enterpriseModelCatalogHandlers: GatewayRequestHandlers = {
  "enterprise-model-catalog.list": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const connectionId = stringValue(params.connectionId);
      const assets = await listEnterpriseModelAssets(scope.enterpriseId, {
        ...(connectionId ? { connectionId } : {}),
        ...(params.enabledOnly === true ? { enabledOnly: true } : {}),
      });
      respond(true, { tenantId: scope.enterpriseId, assets });
    } catch (err) {
      respondEnterpriseModelError(respond, err);
    }
  },

  "enterprise-model-catalog.discover": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope || !requireAdmin(scope, respond)) {
        return;
      }
      const connectionId = stringValue(params.connectionId);
      if (!connectionId) {
        respondInvalid(respond, "connectionId 必填");
        return;
      }
      const connection = await getEnterpriseModelConnection(scope.enterpriseId, connectionId);
      if (!connection) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "connection not found", {
            details: { code: "ENTERPRISE_MODEL_NOT_FOUND" },
          }),
        );
        return;
      }
      const secret = await loadEnterpriseModelSecret(connection.credentialRef);
      if (!secret?.apiKey) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "credential not saved", {
            details: { code: "ENTERPRISE_MODEL_INVALID_CREDENTIAL" },
          }),
        );
        return;
      }
      const probe = await probeEnterpriseModelConnection({
        providerType: connection.providerType,
        protocol: connection.protocol,
        ...(connection.baseUrl ? { baseUrl: connection.baseUrl } : {}),
        secret,
        ssrfPolicy: SAVED_ENTERPRISE_ENDPOINT_SSRF_POLICY,
      });
      if (probe.ok) {
        await updateEnterpriseModelConnection({
          tenantId: scope.enterpriseId,
          connectionId,
          status: "models_discovered",
          healthStatus: "healthy",
          lastVerifiedAt: new Date().toISOString(),
          lastVerificationResult: {
            code: "OK",
            message: probe.message,
            discoveredModelCount: probe.discoveredModels.length,
          },
        });
        await promoteEnabledEnterpriseModelAssets(scope.enterpriseId, connectionId);
      }
      await recordEnterpriseModelAuditEvent({
        tenantId: scope.enterpriseId,
        ...(client?.user ? { actorUserId: client.user } : {}),
        action: "catalog.discovered",
        targetType: "connection",
        targetId: connectionId,
        result: probe.ok ? "success" : "failure",
        code: probe.code,
        details: { discoveredModelCount: probe.discoveredModels.length },
      });
      if (!probe.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, probe.message, {
            details: { code: probe.code },
          }),
        );
        return;
      }
      respond(true, {
        connectionId,
        discoveredModels: probe.discoveredModels,
      });
    } catch (err) {
      respondEnterpriseModelError(respond, err);
    }
  },

  "enterprise-model-catalog.register": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope || !requireAdmin(scope, respond)) {
        return;
      }
      const connectionId = stringValue(params.connectionId);
      const upstreamModelId = stringValue(params.upstreamModelId);
      if (!connectionId || !upstreamModelId) {
        respondInvalid(respond, "connectionId 与 upstreamModelId 必填");
        return;
      }
      const connection = await getEnterpriseModelConnection(scope.enterpriseId, connectionId);
      if (!connection) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "connection not found", {
            details: { code: "ENTERPRISE_MODEL_NOT_FOUND" },
          }),
        );
        return;
      }
      const capabilities = Array.isArray(params.capabilities)
        ? params.capabilities.filter((v): v is string => typeof v === "string")
        : undefined;
      const asset = await registerEnterpriseModelAsset({
        tenantId: scope.enterpriseId,
        connectionId,
        upstreamModelId,
        ...(stringValue(params.displayName)
          ? { displayName: stringValue(params.displayName)! }
          : {}),
        ...(stringValue(params.tier) ? { tier: stringValue(params.tier)! } : {}),
        ...(capabilities ? { capabilities } : {}),
        ...(typeof params.contextWindow === "number"
          ? { contextWindow: params.contextWindow }
          : {}),
        ...(params.enabled === false ? { enabled: false } : { enabled: true }),
        // 模型库只在连接探测成功后登记。已验证连接上的资产必须是 healthy，
        // 否则席位授权上界（enabled ∧ healthy）永远看不到企业自供模型。
        healthStatus:
          isEnterpriseModelConnectionCatalogReady(connection.status) &&
          connection.healthStatus === "healthy"
            ? "healthy"
            : "unknown",
      });
      if (connection.status === "verified" || connection.status === "models_discovered") {
        await updateEnterpriseModelConnection({
          tenantId: scope.enterpriseId,
          connectionId,
          status: "active",
        });
      }
      await recordEnterpriseModelAuditEvent({
        tenantId: scope.enterpriseId,
        ...(client?.user ? { actorUserId: client.user } : {}),
        action: "catalog.registered",
        targetType: "asset",
        targetId: asset.assetId,
        result: "success",
        details: { runtimeModelId: asset.runtimeModelId, upstreamModelId },
      });
      respond(true, { asset });
    } catch (err) {
      respondEnterpriseModelError(respond, err);
    }
  },

  "enterprise-model-catalog.update": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope || !requireAdmin(scope, respond)) {
        return;
      }
      const assetId = stringValue(params.assetId);
      if (!assetId) {
        respondInvalid(respond, "assetId 必填");
        return;
      }
      const capabilities = Array.isArray(params.capabilities)
        ? params.capabilities.filter((v): v is string => typeof v === "string")
        : undefined;
      const asset = await updateEnterpriseModelAsset({
        tenantId: scope.enterpriseId,
        assetId,
        ...(stringValue(params.displayName)
          ? { displayName: stringValue(params.displayName)! }
          : {}),
        ...(params.tier === null
          ? { tier: null }
          : stringValue(params.tier)
            ? { tier: stringValue(params.tier)! }
            : {}),
        ...(capabilities ? { capabilities } : {}),
        ...(typeof params.contextWindow === "number" || params.contextWindow === null
          ? { contextWindow: params.contextWindow }
          : {}),
      });
      await recordEnterpriseModelAuditEvent({
        tenantId: scope.enterpriseId,
        ...(client?.user ? { actorUserId: client.user } : {}),
        action: "catalog.updated",
        targetType: "asset",
        targetId: assetId,
        result: "success",
      });
      respond(true, { asset });
    } catch (err) {
      respondEnterpriseModelError(respond, err);
    }
  },

  "enterprise-model-catalog.enable": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope || !requireAdmin(scope, respond)) {
        return;
      }
      const assetId = stringValue(params.assetId);
      if (!assetId) {
        respondInvalid(respond, "assetId 必填");
        return;
      }
      const asset = await setEnterpriseModelAssetEnabled(scope.enterpriseId, assetId, true);
      await recordEnterpriseModelAuditEvent({
        tenantId: scope.enterpriseId,
        ...(client?.user ? { actorUserId: client.user } : {}),
        action: "catalog.enabled",
        targetType: "asset",
        targetId: assetId,
        result: "success",
      });
      respond(true, { asset });
    } catch (err) {
      respondEnterpriseModelError(respond, err);
    }
  },

  "enterprise-model-catalog.disable": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope || !requireAdmin(scope, respond)) {
        return;
      }
      const assetId = stringValue(params.assetId);
      if (!assetId) {
        respondInvalid(respond, "assetId 必填");
        return;
      }
      const asset = await setEnterpriseModelAssetEnabled(scope.enterpriseId, assetId, false);
      await recordEnterpriseModelAuditEvent({
        tenantId: scope.enterpriseId,
        ...(client?.user ? { actorUserId: client.user } : {}),
        action: "catalog.disabled",
        targetType: "asset",
        targetId: assetId,
        result: "success",
      });
      respond(true, { asset });
    } catch (err) {
      respondEnterpriseModelError(respond, err);
    }
  },
};
