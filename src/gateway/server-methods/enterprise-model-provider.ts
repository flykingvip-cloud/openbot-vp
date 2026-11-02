/**
 * enterprise-model-provider.* RPC handlers.
 * Spec: `.kiro/specs/enterprise-ai-model-governance/`
 */

import {
  countAssetsReferencingConnection,
  deleteEnterpriseModelAssetsForConnection,
  listEnterpriseModelAssets,
  promoteEnabledEnterpriseModelAssets,
} from "../enterprise-model/asset-store.js";
import { recordEnterpriseModelAuditEvent } from "../enterprise-model/audit.js";
import {
  createEnterpriseModelConnection,
  deleteEnterpriseModelConnection,
  getEnterpriseModelConnection,
  listEnterpriseModelConnections,
  mapProbeCodeToConnectionStatus,
  parseProviderType,
  updateEnterpriseModelConnection,
} from "../enterprise-model/connection-store.js";
import {
  buildSecretHint,
  deleteEnterpriseModelSecret,
  hasEnterpriseModelSecret,
  loadEnterpriseModelSecret,
  saveEnterpriseModelSecret,
} from "../enterprise-model/credential-vault.js";
import { isEnterpriseModelError } from "../enterprise-model/errors.js";
import {
  probeEnterpriseModelConnection,
  SAVED_ENTERPRISE_ENDPOINT_SSRF_POLICY,
} from "../enterprise-model/probe.js";
import type { EnterpriseModelPublicConnection } from "../enterprise-model/types.js";
import { forgetModelIdsFromTenantGrants } from "../model-entitlement/seat-model-grant-store.js";
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

async function toPublicConnection(
  row: Awaited<ReturnType<typeof getEnterpriseModelConnection>>,
): Promise<EnterpriseModelPublicConnection | null> {
  if (!row) {
    return null;
  }
  const hasCredential = await hasEnterpriseModelSecret(row.credentialRef);
  return { ...row, hasCredential };
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

export const enterpriseModelProviderHandlers: GatewayRequestHandlers = {
  "enterprise-model-provider.list": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const connections = await listEnterpriseModelConnections(scope.enterpriseId);
      const publicRows: EnterpriseModelPublicConnection[] = [];
      for (const row of connections) {
        publicRows.push({
          ...row,
          hasCredential: await hasEnterpriseModelSecret(row.credentialRef),
        });
      }
      respond(true, { tenantId: scope.enterpriseId, connections: publicRows });
    } catch (err) {
      respondEnterpriseModelError(respond, err);
    }
  },

  "enterprise-model-provider.create": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope || !requireAdmin(scope, respond)) {
        return;
      }
      const providerType = parseProviderType(params.providerType);
      const displayName = stringValue(params.displayName);
      if (!providerType || !displayName) {
        respondInvalid(respond, "providerType 与 displayName 必填");
        return;
      }
      const apiKey = typeof params.apiKey === "string" ? params.apiKey : "";
      const connection = await createEnterpriseModelConnection({
        tenantId: scope.enterpriseId,
        providerType,
        displayName,
        ...(stringValue(params.baseUrl) ? { baseUrl: stringValue(params.baseUrl)! } : {}),
        ...(stringValue(params.protocol) ? { protocol: stringValue(params.protocol)! } : {}),
      });
      let status = connection.status;
      let secretHint: string | undefined;
      if (apiKey.trim()) {
        await saveEnterpriseModelSecret(connection.credentialRef, { apiKey: apiKey.trim() });
        secretHint = buildSecretHint(apiKey);
        const updated = await updateEnterpriseModelConnection({
          tenantId: scope.enterpriseId,
          connectionId: connection.connectionId,
          status: "credential_saved",
          secretHint,
        });
        status = updated.status;
        Object.assign(connection, updated);
      }
      await recordEnterpriseModelAuditEvent({
        tenantId: scope.enterpriseId,
        ...(client?.user ? { actorUserId: client.user } : {}),
        action: "connection.created",
        targetType: "connection",
        targetId: connection.connectionId,
        result: "success",
        details: { providerType, status, hasCredential: Boolean(apiKey.trim()) },
      });
      respond(true, {
        connection: await toPublicConnection(connection),
      });
    } catch (err) {
      respondEnterpriseModelError(respond, err);
    }
  },

  "enterprise-model-provider.update": async ({ client, params, respond }) => {
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
      const updated = await updateEnterpriseModelConnection({
        tenantId: scope.enterpriseId,
        connectionId,
        ...(stringValue(params.displayName)
          ? { displayName: stringValue(params.displayName)! }
          : {}),
        ...(params.baseUrl === null
          ? { baseUrl: null }
          : stringValue(params.baseUrl)
            ? { baseUrl: stringValue(params.baseUrl)! }
            : {}),
        ...(stringValue(params.protocol) ? { protocol: stringValue(params.protocol)! } : {}),
      });
      await recordEnterpriseModelAuditEvent({
        tenantId: scope.enterpriseId,
        ...(client?.user ? { actorUserId: client.user } : {}),
        action: "connection.updated",
        targetType: "connection",
        targetId: connectionId,
        result: "success",
      });
      respond(true, { connection: await toPublicConnection(updated) });
    } catch (err) {
      respondEnterpriseModelError(respond, err);
    }
  },

  "enterprise-model-provider.test": async ({ client, params, respond }) => {
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
      await updateEnterpriseModelConnection({
        tenantId: scope.enterpriseId,
        connectionId,
        status: "verifying",
      });
      const secret = await loadEnterpriseModelSecret(connection.credentialRef);
      if (!secret?.apiKey) {
        const failed = await updateEnterpriseModelConnection({
          tenantId: scope.enterpriseId,
          connectionId,
          status: "invalid_credential",
          healthStatus: "unhealthy",
          lastVerifiedAt: new Date().toISOString(),
          lastVerificationResult: {
            code: "ENTERPRISE_MODEL_INVALID_CREDENTIAL",
            message: "credential not saved",
          },
        });
        await recordEnterpriseModelAuditEvent({
          tenantId: scope.enterpriseId,
          ...(client?.user ? { actorUserId: client.user } : {}),
          action: "connection.tested",
          targetType: "connection",
          targetId: connectionId,
          result: "failure",
          code: "ENTERPRISE_MODEL_INVALID_CREDENTIAL",
        });
        respond(true, {
          ok: false,
          code: "ENTERPRISE_MODEL_INVALID_CREDENTIAL",
          connection: await toPublicConnection(failed),
          discoveredModels: [],
        });
        return;
      }
      const probe = await probeEnterpriseModelConnection({
        providerType: connection.providerType,
        protocol: connection.protocol,
        ...(connection.baseUrl ? { baseUrl: connection.baseUrl } : {}),
        secret,
        ssrfPolicy: SAVED_ENTERPRISE_ENDPOINT_SSRF_POLICY,
      });
      const nextStatus = probe.ok
        ? probe.discoveredModels.length > 0
          ? "models_discovered"
          : "verified"
        : mapProbeCodeToConnectionStatus(probe.code);
      const updated = await updateEnterpriseModelConnection({
        tenantId: scope.enterpriseId,
        connectionId,
        status: nextStatus,
        healthStatus: probe.ok ? "healthy" : "unhealthy",
        lastVerifiedAt: new Date().toISOString(),
        lastVerificationResult: {
          code: probe.code,
          message: probe.message,
          discoveredModelCount: probe.discoveredModels.length,
        },
      });
      if (probe.ok) {
        await promoteEnabledEnterpriseModelAssets(scope.enterpriseId, connectionId);
      }
      await recordEnterpriseModelAuditEvent({
        tenantId: scope.enterpriseId,
        ...(client?.user ? { actorUserId: client.user } : {}),
        action: "connection.tested",
        targetType: "connection",
        targetId: connectionId,
        result: probe.ok ? "success" : "failure",
        code: probe.code,
        details: { discoveredModelCount: probe.discoveredModels.length },
      });
      respond(true, {
        ok: probe.ok,
        code: probe.code,
        message: probe.message,
        discoveredModels: probe.discoveredModels,
        connection: await toPublicConnection(updated),
      });
    } catch (err) {
      respondEnterpriseModelError(respond, err);
    }
  },

  "enterprise-model-provider.rotate-credential": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope || !requireAdmin(scope, respond)) {
        return;
      }
      const connectionId = stringValue(params.connectionId);
      const apiKey = typeof params.apiKey === "string" ? params.apiKey.trim() : "";
      if (!connectionId || !apiKey) {
        respondInvalid(respond, "connectionId 与 apiKey 必填");
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
      const previous = await loadEnterpriseModelSecret(connection.credentialRef);
      // Write new → verify → atomic status update; restore previous on probe failure.
      await saveEnterpriseModelSecret(connection.credentialRef, { apiKey });
      const probe = await probeEnterpriseModelConnection({
        providerType: connection.providerType,
        protocol: connection.protocol,
        ...(connection.baseUrl ? { baseUrl: connection.baseUrl } : {}),
        secret: { apiKey },
        ssrfPolicy: SAVED_ENTERPRISE_ENDPOINT_SSRF_POLICY,
      });
      if (!probe.ok) {
        if (previous?.apiKey) {
          await saveEnterpriseModelSecret(connection.credentialRef, previous);
        } else {
          await deleteEnterpriseModelSecret(connection.credentialRef);
        }
        await recordEnterpriseModelAuditEvent({
          tenantId: scope.enterpriseId,
          ...(client?.user ? { actorUserId: client.user } : {}),
          action: "connection.credential_rotated",
          targetType: "connection",
          targetId: connectionId,
          result: "failure",
          code: probe.code,
        });
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, probe.message, {
            details: { code: probe.code },
          }),
        );
        return;
      }
      const updated = await updateEnterpriseModelConnection({
        tenantId: scope.enterpriseId,
        connectionId,
        status: probe.discoveredModels.length > 0 ? "models_discovered" : "verified",
        healthStatus: "healthy",
        secretHint: buildSecretHint(apiKey),
        lastVerifiedAt: new Date().toISOString(),
        lastVerificationResult: {
          code: "OK",
          message: probe.message,
          discoveredModelCount: probe.discoveredModels.length,
        },
      });
      await promoteEnabledEnterpriseModelAssets(scope.enterpriseId, connectionId);
      await recordEnterpriseModelAuditEvent({
        tenantId: scope.enterpriseId,
        ...(client?.user ? { actorUserId: client.user } : {}),
        action: "connection.credential_rotated",
        targetType: "connection",
        targetId: connectionId,
        result: "success",
      });
      respond(true, {
        connection: await toPublicConnection(updated),
        discoveredModels: probe.discoveredModels,
      });
    } catch (err) {
      respondEnterpriseModelError(respond, err);
    }
  },

  "enterprise-model-provider.disable": async ({ client, params, respond }) => {
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
      const updated = await updateEnterpriseModelConnection({
        tenantId: scope.enterpriseId,
        connectionId,
        status: "disabled",
        healthStatus: "unhealthy",
        disabledAt: new Date().toISOString(),
      });
      await recordEnterpriseModelAuditEvent({
        tenantId: scope.enterpriseId,
        ...(client?.user ? { actorUserId: client.user } : {}),
        action: "connection.disabled",
        targetType: "connection",
        targetId: connectionId,
        result: "success",
      });
      respond(true, { connection: await toPublicConnection(updated) });
    } catch (err) {
      respondEnterpriseModelError(respond, err);
    }
  },

  "enterprise-model-provider.delete": async ({ client, params, respond }) => {
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
      const force = params.force === true;
      const refs = await countAssetsReferencingConnection(scope.enterpriseId, connectionId);
      if (refs.enabled > 0 && !force) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `连接仍有 ${refs.enabled} 个已启用模型，请先停用或传入 force=true`,
            {
              details: {
                code: "ENTERPRISE_MODEL_DEPENDENCY_BLOCKED",
                enabledAssets: refs.enabled,
                totalAssets: refs.total,
              },
            },
          ),
        );
        return;
      }
      // Soft dependency check: also warn when grants reference assets (caller can force).
      const assets = await listEnterpriseModelAssets(scope.enterpriseId, { connectionId });
      const connection = await deleteEnterpriseModelConnection(scope.enterpriseId, connectionId);
      await deleteEnterpriseModelAssetsForConnection(scope.enterpriseId, connectionId);
      await forgetModelIdsFromTenantGrants({
        tenantId: scope.enterpriseId,
        modelIds: assets.map((asset) => asset.runtimeModelId),
        ...(client?.user ? { actorUserId: client.user } : {}),
      });
      await deleteEnterpriseModelSecret(connection.credentialRef);
      await recordEnterpriseModelAuditEvent({
        tenantId: scope.enterpriseId,
        ...(client?.user ? { actorUserId: client.user } : {}),
        action: "connection.deleted",
        targetType: "connection",
        targetId: connectionId,
        result: "success",
        details: { removedAssets: assets.length, force },
      });
      respond(true, {
        deleted: true,
        connectionId,
        removedAssets: assets.length,
      });
    } catch (err) {
      respondEnterpriseModelError(respond, err);
    }
  },
};
