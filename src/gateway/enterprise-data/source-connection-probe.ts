import { listConnectorActions } from "./connector-action-store.js";
import {
  assertKnownDataConnector,
  type DataConnectorIntegrationTier,
} from "./connector-catalog.js";
import { findDataConnectorCredential } from "./connector-credential-store.js";
import { loadCredentialSecret } from "./connector-credential-vault.js";
import { executeConnectorHandlerAsync } from "./connector-handler-runtime.js";
import { listRuntimeRegistryEntries } from "./runtime-registry.js";
import type {
  DataConnectorCredentialSecret,
  EnterpriseDataStore,
  HttpRestAuthScheme,
} from "./types.js";

export type SourceConnectionProbeMode =
  | "mock_smoke_ok"
  | "live_probe_ok"
  | "live_probe_failed"
  | "actions_missing"
  | "handlers_missing"
  | "credential_required"
  | "unknown_connector"
  | "handler_error"
  | "website_session_not_verified";

export type SourceConnectionProbeResult = {
  ok: boolean;
  connectorId: string;
  integrationTier: DataConnectorIntegrationTier | null;
  mode: SourceConnectionProbeMode;
  message: string;
  actionCount: number;
  handlerCount: number;
};

export type InlineConnectorCredential = {
  instanceUrl?: string;
  apiKey?: string;
  authScheme?: HttpRestAuthScheme;
  authHeaderName?: string;
  authQueryParam?: string;
  basicUsername?: string;
  probePath?: string;
  appKey?: string;
  appSecret?: string;
  openToken?: string;
  refreshToken?: string;
  orgId?: string;
  appName?: string;
};

export async function probeDataSourceConnection(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  connectorId: string;
  credentialId?: string;
  inlineCredential?: InlineConnectorCredential;
}): Promise<SourceConnectionProbeResult> {
  const connectorId = params.connectorId.trim();
  let definition;
  try {
    definition = assertKnownDataConnector(connectorId);
  } catch {
    return {
      ok: false,
      connectorId,
      integrationTier: null,
      mode: "unknown_connector",
      message: "连接器不在企业数据目录中，请从目录选择。",
      actionCount: 0,
      handlerCount: 0,
    };
  }

  const actions = listConnectorActions({
    store: params.store,
    tenantId: params.tenantId,
    connectorId: definition.connectorId,
  });
  const handlers = listRuntimeRegistryEntries({
    store: params.store,
    tenantId: params.tenantId,
    connectorId: definition.connectorId,
  });

  if (actions.length === 0) {
    return {
      ok: false,
      connectorId: definition.connectorId,
      integrationTier: definition.integrationTier,
      mode: "actions_missing",
      message:
        definition.integrationTier === "demo"
          ? "尚未安装连接器 Action 目录。请先点击「安装演示包」。"
          : "尚未注册连接器 Action。请联系平台管理员安装连接器包。",
      actionCount: 0,
      handlerCount: handlers.length,
    };
  }

  if (handlers.length === 0) {
    return {
      ok: false,
      connectorId: definition.connectorId,
      integrationTier: definition.integrationTier,
      mode: "handlers_missing",
      message: "Action 已注册但缺少运行时 Handler，无法执行连通性探测。",
      actionCount: actions.length,
      handlerCount: 0,
    };
  }

  const secret = await resolveProbeCredentialSecret({
    store: params.store,
    tenantId: params.tenantId,
    connectorId: definition.connectorId,
    credentialKind: definition.credentialKind,
    credentialId: params.credentialId,
    inlineCredential: params.inlineCredential,
  });

  if (
    definition.integrationTier === "production" &&
    definition.credentialKind !== "none" &&
    !secret
  ) {
    return {
      ok: false,
      connectorId: definition.connectorId,
      integrationTier: definition.integrationTier,
      mode: "credential_required",
      message: "生产级连接器需先绑定 API/OAuth 凭证后再测试连通性。",
      actionCount: actions.length,
      handlerCount: handlers.length,
    };
  }

  if (secret && definition.connectorId === "crm-salesforce") {
    const { probeSalesforceConnection } = await import("./adapters/salesforce.js");
    const live = await probeSalesforceConnection(secret);
    return {
      ok: live.ok,
      connectorId: definition.connectorId,
      integrationTier: definition.integrationTier,
      mode: live.ok ? "live_probe_ok" : "live_probe_failed",
      message: live.message,
      actionCount: actions.length,
      handlerCount: handlers.length,
    };
  }

  if (secret && definition.connectorId === "notion") {
    const { probeNotionConnection } = await import("./adapters/notion.js");
    const live = await probeNotionConnection(secret);
    return {
      ok: live.ok,
      connectorId: definition.connectorId,
      integrationTier: definition.integrationTier,
      mode: live.ok ? "live_probe_ok" : "live_probe_failed",
      message: live.message,
      actionCount: actions.length,
      handlerCount: handlers.length,
    };
  }

  if (secret && definition.connectorId === "http-rest") {
    const { probeHttpRestConnection } = await import("./adapters/http-rest.js");
    const live = await probeHttpRestConnection(secret);
    return {
      ok: live.ok,
      connectorId: definition.connectorId,
      integrationTier: definition.integrationTier,
      mode: live.ok ? "live_probe_ok" : "live_probe_failed",
      message: live.message,
      actionCount: actions.length,
      handlerCount: handlers.length,
    };
  }

  if (secret && definition.connectorId === "db-postgres") {
    const { probePostgresConnection } = await import("./adapters/postgres.js");
    const live = await probePostgresConnection(secret);
    return {
      ok: live.ok,
      connectorId: definition.connectorId,
      integrationTier: definition.integrationTier,
      mode: live.ok ? "live_probe_ok" : "live_probe_failed",
      message: live.message,
      actionCount: actions.length,
      handlerCount: handlers.length,
    };
  }

  if (secret && definition.connectorId === "db-mysql") {
    const { probeMysqlConnection } = await import("./adapters/mysql.js");
    const live = await probeMysqlConnection(secret);
    return {
      ok: live.ok,
      connectorId: definition.connectorId,
      integrationTier: definition.integrationTier,
      mode: live.ok ? "live_probe_ok" : "live_probe_failed",
      message: live.message,
      actionCount: actions.length,
      handlerCount: handlers.length,
    };
  }

  if (secret && definition.connectorId === "erp-yonyou-tplus") {
    const { probeYonyouTplusConnection } = await import("./adapters/yonyou-tplus.js");
    const live = await probeYonyouTplusConnection(secret);
    return {
      ok: live.ok,
      connectorId: definition.connectorId,
      integrationTier: definition.integrationTier,
      mode: live.ok ? "live_probe_ok" : "live_probe_failed",
      message: live.message,
      actionCount: actions.length,
      handlerCount: handlers.length,
    };
  }

  if (secret && definition.connectorId === "erp-sap") {
    const { probeErpSapConnection } = await import("./adapters/erp-sap.js");
    const live = await probeErpSapConnection(secret);
    return {
      ok: live.ok,
      connectorId: definition.connectorId,
      integrationTier: definition.integrationTier,
      mode: live.ok ? "live_probe_ok" : "live_probe_failed",
      message: live.message,
      actionCount: actions.length,
      handlerCount: handlers.length,
    };
  }

  if (definition.accessMethod === "website_session") {
    return {
      ok: false,
      connectorId: definition.connectorId,
      integrationTier: definition.integrationTier,
      mode: "website_session_not_verified",
      message:
        "网站会话不使用 mock 探测成功。缺账户绑定或已验证制品时拒绝，mock_smoke_ok 不是生产成功。",
      actionCount: actions.length,
      handlerCount: handlers.length,
    };
  }

  const smokeHandler =
    handlers.find((entry) => {
      const action = actions.find(
        (candidate) =>
          candidate.connectorId === entry.connectorId &&
          candidate.actionKey === entry.actionKey &&
          candidate.version === entry.version &&
          candidate.readOnly,
      );
      return Boolean(action);
    }) ?? handlers[0];

  try {
    await executeConnectorHandlerAsync(smokeHandler.handlerRef, {
      input: {},
      scope: { scopeType: "ALL", resolvedValues: {}, appliedFilters: [], scopeAppliedLabel: "ALL" },
      employeeId: "connection-probe",
    });
    return {
      ok: true,
      connectorId: definition.connectorId,
      integrationTier: definition.integrationTier,
      mode: "mock_smoke_ok",
      message: `演示连接器连通性正常（Mock Handler：${smokeHandler.actionKey}@${smokeHandler.version}）。`,
      actionCount: actions.length,
      handlerCount: handlers.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Handler smoke test failed.";
    return {
      ok: false,
      connectorId: definition.connectorId,
      integrationTier: definition.integrationTier,
      mode: "handler_error",
      message,
      actionCount: actions.length,
      handlerCount: handlers.length,
    };
  }
}

async function resolveProbeCredentialSecret(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  connectorId: string;
  credentialKind: "none" | "api_key" | "oauth2";
  credentialId?: string;
  inlineCredential?: InlineConnectorCredential;
}) {
  if (params.credentialKind === "none") {
    return null;
  }
  if (params.credentialId) {
    const credential = findDataConnectorCredential(
      params.store,
      params.tenantId,
      params.credentialId,
    );
    if (!credential || credential.status !== "active") {
      return null;
    }
    return loadCredentialSecret(credential.credentialId);
  }
  if (params.connectorId === "erp-yonyou-tplus" && params.inlineCredential) {
    const inline = params.inlineCredential;
    const openToken = inline.openToken?.trim() || inline.apiKey?.trim();
    const appKey = inline.appKey?.trim();
    const appSecret = inline.appSecret?.trim();
    if (openToken || appKey || appSecret || inline.orgId?.trim()) {
      const secret: DataConnectorCredentialSecret = {
        instanceUrl: inline.instanceUrl?.trim() || undefined,
        apiKey: inline.apiKey?.trim() || undefined,
        oauthAccessToken: openToken || undefined,
        appKey: appKey || undefined,
        appSecret: appSecret || undefined,
        oauthRefreshToken: inline.refreshToken?.trim() || undefined,
        orgId: inline.orgId?.trim() || undefined,
        appName: inline.appName?.trim() || undefined,
      };
      return secret;
    }
  }
  if (params.credentialKind === "api_key") {
    const inline = params.inlineCredential;
    const inlineUrl = inline?.instanceUrl?.trim();
    const inlineKey = inline?.apiKey?.trim();
    // Build an inline secret when a URL is present and either a token is given
    // or the connector is explicitly unauthenticated ("none"). Connectors that
    // need a token (e.g. Salesforce) keep requiring both via the default path.
    if (inlineUrl && (inlineKey || inline?.authScheme === "none")) {
      const secret: DataConnectorCredentialSecret = {
        instanceUrl: inlineUrl,
        apiKey: inlineKey || undefined,
      };
      if (inline?.authScheme) {
        secret.authScheme = inline.authScheme;
      }
      if (inline?.authHeaderName?.trim()) {
        secret.authHeaderName = inline.authHeaderName.trim();
      }
      if (inline?.authQueryParam?.trim()) {
        secret.authQueryParam = inline.authQueryParam.trim();
      }
      if (inline?.basicUsername?.trim()) {
        secret.basicUsername = inline.basicUsername.trim();
      }
      if (inline?.probePath?.trim()) {
        secret.probePath = inline.probePath.trim();
      }
      return secret;
    }
  }
  return null;
}
