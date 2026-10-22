import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import { loadConfig } from "../../config/config.js";
import { isSharedTenantAddressingEnabled } from "../../config/data-space.js";
import {
  TENANT_ENTERPRISE_DATA_FILE,
  assertSafeTenantId,
  resolveTenantControlPlaneStorePath,
  resolveTenantConnectorOAuthSessionStorePath,
  resolveTenantsRoot,
} from "../tenant-store-paths.js";
import {
  buildNotionAuthorizeUrl,
  exchangeNotionAuthorizationCode,
  resolveNotionOAuthConfig,
} from "./adapters/notion-oauth.js";
import {
  buildSalesforceAuthorizeUrl,
  exchangeSalesforceAuthorizationCode,
  resolveSalesforceOAuthConfig,
} from "./adapters/salesforce-oauth.js";
import {
  buildYonyouTplusAuthorizeUrl,
  exchangeYonyouTplusAuthorizationCode,
  resolveYonyouTplusAppCredentials,
  resolveYonyouTplusOAuthConfig,
  YONYOU_TPLUS_CONNECTOR_ID,
  YONYOU_TPLUS_GATEWAY_ORIGIN,
  YONYOU_TPLUS_SIMULATED_TOKEN_PREFIX,
} from "./adapters/yonyou-tplus-oauth.js";
import { assertKnownDataConnector } from "./connector-catalog.js";
import { upsertDataConnectorCredential } from "./connector-credential-store.js";
import { buildSecretHint, saveCredentialSecret } from "./connector-credential-vault.js";
import {
  loadDataConnectorOAuthSessionStore,
  withDataConnectorOAuthSessionStoreWriteLock,
} from "./connector-oauth-session-persistence.js";
import type {
  DataConnectorOAuthMode,
  DataConnectorOAuthSession,
  DataConnectorOAuthSessionStore,
} from "./connector-oauth-types.js";
import { resolveControlUiEnterpriseDataBasePath } from "./control-ui-paths.js";
import { loadEnterpriseDataStore, saveEnterpriseDataStore } from "./store.js";
import type { DataConnectorCredentialSecret } from "./types.js";

const DEFAULT_OAUTH_SESSION_TTL_MS = 15 * 60 * 1000;

function resolveOAuthModeForConnector(
  connectorId: string,
  redirectUri?: string,
): DataConnectorOAuthMode {
  if (connectorId === "notion" && resolveNotionOAuthConfig({ redirectUri })) {
    return "notion_authorization_code";
  }
  if (connectorId === "crm-salesforce" && resolveSalesforceOAuthConfig({ redirectUri })) {
    return "salesforce_authorization_code";
  }
  return "simulated";
}

// Dev/simulated OAuth (no real client creds): mint a per-connector fake token + workspace.
// The simulated- prefix is recognized by the connector adapters' probe/handler short-circuits.
function buildSimulatedOAuthCredential(
  connectorId: string,
  sessionId: string,
): { accessToken: string; workspaceId: string; workspaceName: string } {
  const suffix = sessionId.slice(0, 8);
  if (connectorId === "crm-salesforce") {
    return {
      accessToken: `simulated-salesforce-token-${suffix}`,
      workspaceId: "https://simulated.my.salesforce.com",
      workspaceName: "Salesforce 模拟组织",
    };
  }
  if (connectorId === YONYOU_TPLUS_CONNECTOR_ID) {
    return {
      accessToken: `${YONYOU_TPLUS_SIMULATED_TOKEN_PREFIX}${suffix}`,
      workspaceId: YONYOU_TPLUS_GATEWAY_ORIGIN,
      workspaceName: "用友 T+ 模拟企业",
    };
  }
  return {
    accessToken: `simulated-notion-token-${suffix}`,
    workspaceId: "simulated-workspace",
    workspaceName: "Notion 模拟工作区",
  };
}

function expireStaleOAuthSessions(store: DataConnectorOAuthSessionStore, nowIso: string): void {
  for (const session of Object.values(store.sessions)) {
    if (session.status === "pending" && session.expiresAt <= nowIso) {
      session.status = "expired";
    }
  }
}

export function resolveDataConnectorOAuthCallbackPath(basePath?: string): string {
  return `${resolveControlUiEnterpriseDataBasePath(basePath)}/oauth/callback`;
}

export function buildDataConnectorOAuthCallbackUrl(params: {
  origin: string;
  basePath?: string;
}): string {
  const origin = params.origin.trim().replace(/\/+$/, "");
  return `${origin}${resolveDataConnectorOAuthCallbackPath(params.basePath)}`;
}

export function buildDataConnectorOAuthReturnUrl(params: {
  origin: string;
  basePath?: string;
  sessionId: string;
  status: "success" | "error";
  message?: string;
  returnPath?: string;
}): string {
  const origin = params.origin.trim().replace(/\/+$/, "");
  const returnPath = params.returnPath?.trim() || "/";
  const url = new URL(returnPath, origin);
  url.searchParams.set("dataConnectorOAuth", params.status);
  url.searchParams.set("dataConnectorOAuthSessionId", params.sessionId);
  if (params.message) {
    url.searchParams.set("dataConnectorOAuthMessage", params.message);
  }
  return url.toString();
}

export function getDataConnectorOAuthSession(
  store: DataConnectorOAuthSessionStore,
  tenantId: string,
  sessionId: string,
): DataConnectorOAuthSession | null {
  const session = store.sessions[sessionId];
  if (!session || session.tenantId !== tenantId) {
    return null;
  }
  return session;
}

export function getDataConnectorOAuthSessionByState(
  store: DataConnectorOAuthSessionStore,
  state: string,
): DataConnectorOAuthSession | null {
  const normalized = state.trim();
  if (!normalized) {
    return null;
  }
  return (
    Object.values(store.sessions).find(
      (session) => session.state === normalized && session.status === "pending",
    ) ?? null
  );
}

/** HTTP callback has no client ctx — locate pending session store by global state (per-tenant scan when multitenant). */
async function resolveDataConnectorOAuthSessionStoreByState(state: string): Promise<{
  storePath?: string;
} | null> {
  const normalized = state.trim();
  if (!normalized) {
    return null;
  }
  const cfg = loadConfig();
  if (!isSharedTenantAddressingEnabled(cfg)) {
    const store = await loadDataConnectorOAuthSessionStore();
    return getDataConnectorOAuthSessionByState(store, normalized) ? { storePath: undefined } : null;
  }
  let tenantIds: string[] = [];
  try {
    tenantIds = fs.readdirSync(resolveTenantsRoot());
  } catch {
    tenantIds = [];
  }
  for (const tenantId of tenantIds) {
    try {
      assertSafeTenantId(tenantId);
    } catch {
      continue;
    }
    const storePath = resolveTenantConnectorOAuthSessionStorePath(tenantId);
    const store = await loadDataConnectorOAuthSessionStore(storePath);
    const session = getDataConnectorOAuthSessionByState(store, normalized);
    if (session && session.tenantId === tenantId) {
      return { storePath };
    }
  }
  const legacyStore = await loadDataConnectorOAuthSessionStore();
  return getDataConnectorOAuthSessionByState(legacyStore, normalized)
    ? { storePath: undefined }
    : null;
}

export function startDataConnectorOAuthSession(params: {
  store: DataConnectorOAuthSessionStore;
  tenantId: string;
  connectorId: string;
  label: string;
  returnPath?: string;
  callbackOrigin?: string;
  basePath?: string;
  orgId?: string;
  appName?: string;
  nowIso: string;
}):
  | {
      ok: true;
      session: DataConnectorOAuthSession;
      authorizeUrl: string | null;
      simulateAllowed: boolean;
      callbackUrl: string | null;
    }
  | { ok: false; code: string; error: string } {
  const connectorId = params.connectorId.trim();
  try {
    assertKnownDataConnector(connectorId);
  } catch {
    return { ok: false, code: "CONNECTOR_UNKNOWN", error: "Connector is not in catalog." };
  }
  const label = params.label.trim();
  if (!label) {
    return { ok: false, code: "CONNECTOR_OAUTH_LABEL_REQUIRED", error: "label is required." };
  }
  expireStaleOAuthSessions(params.store, params.nowIso);
  const callbackUrl = params.callbackOrigin?.trim()
    ? buildDataConnectorOAuthCallbackUrl({
        origin: params.callbackOrigin,
        basePath: params.basePath,
      })
    : null;
  let mode = resolveOAuthModeForConnector(connectorId, callbackUrl ?? undefined);
  let yonyouAuthorize: { appKey: string; orgId: string; appName: string } | null = null;
  if (connectorId === YONYOU_TPLUS_CONNECTOR_ID) {
    const app = resolveYonyouTplusAppCredentials();
    if (!app) {
      mode = "simulated";
    } else {
      const orgId =
        params.orgId?.trim() ||
        process.env.OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_ORG_ID?.trim() ||
        "";
      const redirectUri =
        callbackUrl || process.env.OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_REDIRECT_URI?.trim() || "";
      if (!orgId) {
        return {
          ok: false,
          code: "CONNECTOR_OAUTH_ORG_ID_REQUIRED",
          error: "用友 T+ 授权需要云企业 ID（orgId）。",
        };
      }
      if (!redirectUri) {
        return {
          ok: false,
          code: "CONNECTOR_OAUTH_CONFIG_MISSING",
          error: "用友 T+ OAuth 回调地址未配置。",
        };
      }
      mode = "yonyou_tplus_authorization_code";
      yonyouAuthorize = {
        appKey: app.appKey,
        orgId,
        appName: params.appName?.trim() || app.appName,
      };
    }
  }
  const session: DataConnectorOAuthSession = {
    sessionId: randomUUID(),
    state: randomBytes(24).toString("hex"),
    tenantId: params.tenantId,
    connectorId,
    label,
    mode,
    status: "pending",
    orgId: yonyouAuthorize?.orgId,
    appName: yonyouAuthorize?.appName,
    returnPath: params.returnPath?.trim() || undefined,
    createdAt: params.nowIso,
    expiresAt: new Date(
      new Date(params.nowIso).getTime() + DEFAULT_OAUTH_SESSION_TTL_MS,
    ).toISOString(),
  };
  params.store.sessions[session.sessionId] = session;

  let authorizeUrl: string | null = null;
  if (mode === "notion_authorization_code" && callbackUrl) {
    const notion = resolveNotionOAuthConfig({ redirectUri: callbackUrl });
    if (notion) {
      authorizeUrl = buildNotionAuthorizeUrl({
        clientId: notion.clientId,
        redirectUri: notion.redirectUri,
        state: session.state,
      });
    }
  }
  if (mode === "salesforce_authorization_code" && callbackUrl) {
    const salesforce = resolveSalesforceOAuthConfig({ redirectUri: callbackUrl });
    if (salesforce) {
      authorizeUrl = buildSalesforceAuthorizeUrl({
        clientId: salesforce.clientId,
        redirectUri: salesforce.redirectUri,
        state: session.state,
        loginUrl: salesforce.loginUrl,
      });
    }
  }
  if (mode === "yonyou_tplus_authorization_code" && yonyouAuthorize) {
    authorizeUrl = buildYonyouTplusAuthorizeUrl({
      appKey: yonyouAuthorize.appKey,
      orgId: yonyouAuthorize.orgId,
      appName: yonyouAuthorize.appName,
      state: session.state,
    });
  }

  return {
    ok: true,
    session,
    authorizeUrl,
    simulateAllowed: mode === "simulated",
    callbackUrl,
  };
}

async function finalizeDataConnectorOAuthSession(params: {
  session: DataConnectorOAuthSession;
  accessToken: string;
  workspaceId?: string;
  workspaceName?: string;
  extraSecret?: Partial<DataConnectorCredentialSecret>;
  nowIso: string;
}): Promise<
  | { ok: true; session: DataConnectorOAuthSession; credentialId: string }
  | { ok: false; code: string; error: string }
> {
  const cfg = loadConfig();
  const storePath =
    isSharedTenantAddressingEnabled(cfg) && params.session.tenantId
      ? resolveTenantControlPlaneStorePath(params.session.tenantId, TENANT_ENTERPRISE_DATA_FILE)
      : undefined;
  const dataStore = await loadEnterpriseDataStore(storePath);
  const credential = upsertDataConnectorCredential({
    store: dataStore,
    tenantId: params.session.tenantId,
    connectorId: params.session.connectorId,
    label: params.workspaceName?.trim() || params.session.label,
    kind: "oauth2",
    instanceUrl: params.workspaceId,
    secretHint: buildSecretHint(params.accessToken),
    nowIso: params.nowIso,
  });
  await saveCredentialSecret(credential.credentialId, {
    oauthAccessToken: params.accessToken,
    instanceUrl: params.workspaceId,
    ...params.extraSecret,
  });
  await saveEnterpriseDataStore(dataStore, storePath);

  params.session.status = "completed";
  params.session.completedAt = params.nowIso;
  params.session.credentialId = credential.credentialId;
  return { ok: true, session: params.session, credentialId: credential.credentialId };
}

export async function completeDataConnectorOAuthCallback(params: {
  state: string;
  code: string;
  redirectUri: string;
  nowIso: string;
}): Promise<
  | { ok: true; session: DataConnectorOAuthSession; returnPath?: string }
  | { ok: false; code: string; error: string }
> {
  const located = await resolveDataConnectorOAuthSessionStoreByState(params.state);
  if (!located) {
    return {
      ok: false,
      code: "CONNECTOR_OAUTH_SESSION_NOT_FOUND",
      error: "OAuth session not found.",
    };
  }
  return withDataConnectorOAuthSessionStoreWriteLock(async (store) => {
    const session = getDataConnectorOAuthSessionByState(store, params.state);
    if (!session) {
      return {
        ok: false,
        code: "CONNECTOR_OAUTH_SESSION_NOT_FOUND",
        error: "OAuth session not found.",
      };
    }
    if (
      session.mode !== "notion_authorization_code" &&
      session.mode !== "salesforce_authorization_code" &&
      session.mode !== "yonyou_tplus_authorization_code"
    ) {
      return {
        ok: false,
        code: "CONNECTOR_OAUTH_MODE_INVALID",
        error: "OAuth session does not accept authorization codes.",
      };
    }
    try {
      let accessToken: string;
      let workspaceId: string | undefined;
      let workspaceName: string | undefined;
      let extraSecret: Partial<DataConnectorCredentialSecret> | undefined;
      if (session.mode === "notion_authorization_code") {
        const notion = resolveNotionOAuthConfig({ redirectUri: params.redirectUri });
        if (!notion) {
          return {
            ok: false,
            code: "CONNECTOR_OAUTH_CONFIG_MISSING",
            error: "Notion OAuth is not configured.",
          };
        }
        const exchanged = await exchangeNotionAuthorizationCode({
          code: params.code,
          redirectUri: params.redirectUri,
          clientId: notion.clientId,
          clientSecret: notion.clientSecret,
        });
        accessToken = exchanged.accessToken;
        workspaceId = exchanged.workspaceId;
        workspaceName = exchanged.workspaceName;
      } else if (session.mode === "yonyou_tplus_authorization_code") {
        const yonyou = resolveYonyouTplusOAuthConfig({
          redirectUri: params.redirectUri,
          orgId: session.orgId,
          appName: session.appName,
        });
        if (!yonyou) {
          return {
            ok: false,
            code: "CONNECTOR_OAUTH_CONFIG_MISSING",
            error: "用友 T+ OAuth 未配置。",
          };
        }
        const exchanged = await exchangeYonyouTplusAuthorizationCode({
          code: params.code,
          redirectUri: params.redirectUri,
          appKey: yonyou.appKey,
          appSecret: yonyou.appSecret,
          gatewayOrigin: yonyou.gatewayOrigin,
        });
        accessToken = exchanged.accessToken;
        workspaceId = yonyou.gatewayOrigin;
        workspaceName = session.label;
        extraSecret = {
          oauthRefreshToken: exchanged.refreshToken,
          oauthPermanentCode: exchanged.permanentCode,
          orgId: exchanged.orgId || session.orgId,
          appName: exchanged.appName || session.appName || yonyou.appName,
          sid: exchanged.sid,
        };
      } else {
        const salesforce = resolveSalesforceOAuthConfig({ redirectUri: params.redirectUri });
        if (!salesforce) {
          return {
            ok: false,
            code: "CONNECTOR_OAUTH_CONFIG_MISSING",
            error: "Salesforce OAuth is not configured.",
          };
        }
        const exchanged = await exchangeSalesforceAuthorizationCode({
          code: params.code,
          redirectUri: params.redirectUri,
          clientId: salesforce.clientId,
          clientSecret: salesforce.clientSecret,
          loginUrl: salesforce.loginUrl,
        });
        accessToken = exchanged.accessToken;
        // Salesforce returns the org-specific API base; persist it as the credential instanceUrl.
        workspaceId = exchanged.instanceUrl;
        workspaceName = session.label;
      }
      const finalized = await finalizeDataConnectorOAuthSession({
        session,
        accessToken,
        workspaceId,
        workspaceName,
        extraSecret,
        nowIso: params.nowIso,
      });
      if (!finalized.ok) {
        return finalized;
      }
      return {
        ok: true,
        session: finalized.session,
        returnPath: finalized.session.returnPath,
      };
    } catch (error) {
      session.status = "failed";
      session.errorMessage = error instanceof Error ? error.message : "OAuth exchange failed.";
      return {
        ok: false,
        code: "CONNECTOR_OAUTH_EXCHANGE_FAILED",
        error: session.errorMessage,
      };
    }
  }, located.storePath);
}

export async function simulateCompleteDataConnectorOAuthSession(params: {
  tenantId: string;
  sessionId: string;
  workspaceName?: string;
  nowIso: string;
}): Promise<
  | { ok: true; session: DataConnectorOAuthSession; credentialId: string }
  | { ok: false; code: string; error: string }
> {
  const cfg = loadConfig();
  const storePath =
    isSharedTenantAddressingEnabled(cfg) && params.tenantId.trim()
      ? resolveTenantConnectorOAuthSessionStorePath(params.tenantId.trim())
      : undefined;
  return withDataConnectorOAuthSessionStoreWriteLock(async (store) => {
    const session = getDataConnectorOAuthSession(store, params.tenantId, params.sessionId);
    if (!session) {
      return {
        ok: false,
        code: "CONNECTOR_OAUTH_SESSION_NOT_FOUND",
        error: "OAuth session not found.",
      };
    }
    if (session.status !== "pending") {
      return {
        ok: false,
        code: "CONNECTOR_OAUTH_SESSION_NOT_PENDING",
        error: "OAuth session is not pending.",
      };
    }
    if (session.mode !== "simulated") {
      return {
        ok: false,
        code: "CONNECTOR_OAUTH_SIMULATE_NOT_ALLOWED",
        error: "OAuth session does not allow simulation.",
      };
    }
    const simulated = buildSimulatedOAuthCredential(session.connectorId, session.sessionId);
    const extraSecret =
      session.connectorId === YONYOU_TPLUS_CONNECTOR_ID
        ? {
            orgId: session.orgId,
            appName: session.appName,
          }
        : undefined;
    return finalizeDataConnectorOAuthSession({
      session,
      accessToken: simulated.accessToken,
      workspaceId: simulated.workspaceId,
      workspaceName: params.workspaceName?.trim() || simulated.workspaceName,
      extraSecret,
      nowIso: params.nowIso,
    });
  }, storePath);
}
