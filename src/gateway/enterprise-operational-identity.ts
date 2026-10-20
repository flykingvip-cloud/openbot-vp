import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { GatewayTrustedProxyConfig } from "../config/types.gateway.js";
import { resolveControlUiEnterpriseBasePath } from "./control-ui-contract.js";
import { ownershipProofForEnterpriseOperationalIdentity } from "./data-governance/ownership-proof.js";
import { listDataSources } from "./enterprise-data/data-source-store.js";
import { ensureEnterpriseDataCatalogSeeded } from "./enterprise-data/seeds.js";
import { loadEnterpriseDataStore, saveEnterpriseDataStore } from "./enterprise-data/store.js";
import { saveEnterpriseSeatAssetsStoreWithOiGovernance } from "./enterprise-operational-identity-governance.js";
import {
  loadEnterpriseOperationalIdentityCredentialSecretStore,
  withEnterpriseOperationalIdentityCredentialSecretStoreWriteLock,
} from "./enterprise-operational-identity-oauth/credential-secrets-persistence.js";
import {
  buildWechatComponentAuthorizeUrl,
  completeEnterpriseSocialOAuthCallback,
  completeEnterpriseWechatOAuthSession,
  createEnterpriseWechatOAuthSession,
  createWechatComponentPreAuthCode,
  exchangeWechatAuthorizerTokens,
  expireEnterpriseSocialOAuthSessions,
  expireEnterpriseWechatOAuthSessions,
  getEnterpriseWechatOAuthSessionByState,
  getEnterpriseWechatOAuthSessionById,
  isWechatComponentOAuthConfigured,
  isWechatComponentVerifyTicketReady,
  parseEnterpriseSocialOAuthProviderSlug,
  renderEnterpriseOAuthCallbackHtml,
  resolveWechatComponentOAuthConfig,
  startEnterpriseSocialOAuthSession,
} from "./enterprise-operational-identity-oauth/index.js";
import {
  isSupportedOperationalIdentityConnectorId,
  listOperationalIdentityProviderCatalogWithRuntime,
  probeOperationalIdentityCredential,
  discoverOperationalIdentityCapabilities,
  enrichOperationalIdentityApiView,
  maybeRefreshOperationalIdentityCredential,
  resolveOperationalIdentityStatusHint,
  tryGetOperationalIdentityProviderAdapter,
  upsertEnterpriseOperationalIdentityCredential,
} from "./enterprise-operational-identity-providers.js";
import { buildOperationalIdentityCredentialEditPreview } from "./enterprise-operational-identity-providers/credential-edit-preview.js";
import { resolveOperationalIdentityActorEmployeeIdFromPlatformUser } from "./enterprise-operational-identity-runtime.js";
import {
  createDataSourceIdentityBinding,
  listEligibleOperationalIdentityCredentialBindings,
  listTenantDataSourceIdentityBindings,
  listTenantEnterpriseIdentities,
  listTenantIdentityUsagePolicies,
  listEmployeeIdentityBindingActivity,
  registerEnterpriseIdentity,
  reauthorizeEnterpriseIdentity,
  removeDataSourceIdentityBinding,
  revokeEnterpriseIdentity,
  resolveEnterpriseIdentitySteward,
  resolveEnterpriseIdentityStewardLabel,
  snapshotEnterpriseIdentityConfigReadiness,
  summarizeEnterpriseIdentityCatalog,
  updateEnterpriseIdentity,
  upsertIdentityUsagePolicy,
  verifyEnterpriseIdentity,
  getTenantEnterpriseIdentity,
} from "./enterprise-operational-identity-store.js";
import type {
  DataSourceIdentityBindingPurpose,
  EnterpriseIdentity,
  EnterpriseIdentityStatus,
  EnterpriseOperationalIdentityProvider,
} from "./enterprise-operational-identity-types.js";
import { registerConnectorCredentialBinding } from "./enterprise-seat-assets-store.js";
import { readJsonBody } from "./hooks.js";
import { sendJson } from "./http-common.js";
import {
  readPlatformAuthSessionContextFromRequest,
  resolvePlatformAuthConfig,
} from "./platform-auth.js";
import { isLocalOrConfiguredPublicPlatformAccess } from "./platform-auth/public-request.js";
import {
  loadSeatAssetsStoreForContext,
  loadSeatAssetsStoreForTenantId,
  resolveSeatAssetsStorePathFromContext,
  resolveSeatAssetsStorePathForTenantId,
} from "./platform-auth/seat-store-loader.js";
import { loadPlatformAuthStore } from "./platform-auth/store.js";
import { resolveUserOperationalIdentityGatewayEgressIp } from "./user-operational-identity-egress.js";

const ENTERPRISE_IDENTITY_BODY_LIMIT_BYTES = 256 * 1024;

async function persistEnterpriseOiMutation(params: {
  storePath: string | undefined;
  store: Awaited<ReturnType<typeof loadSeatAssetsStoreForContext>>;
  tenantId: string;
  governedIdentityIds: string[];
  providerByIdentityId?: Record<string, string | null | undefined>;
  credentialHandleByIdentityId?: Record<string, string | null | undefined>;
}): Promise<void> {
  await saveEnterpriseSeatAssetsStoreWithOiGovernance({
    storePath: params.storePath,
    store: params.store,
    tenantId: params.tenantId,
    governedIdentityIds: params.governedIdentityIds,
    ownershipProof: ownershipProofForEnterpriseOperationalIdentity({
      tenantId: params.tenantId,
    }),
    providerByIdentityId: params.providerByIdentityId,
    credentialHandleByIdentityId: params.credentialHandleByIdentityId,
  });
}

function resolveActiveEnterpriseOperationalIdentityProvider(
  provider: EnterpriseIdentity["provider"],
): EnterpriseOperationalIdentityProvider | null {
  return tryGetOperationalIdentityProviderAdapter(provider)?.provider ?? null;
}

function resolveEnterpriseOperationalIdentityStatusHint(params: {
  provider: EnterpriseIdentity["provider"];
  status: EnterpriseIdentityStatus;
}) {
  const activeProvider = resolveActiveEnterpriseOperationalIdentityProvider(params.provider);
  if (activeProvider) {
    return resolveOperationalIdentityStatusHint({
      provider: activeProvider,
      status: params.status,
    });
  }
  return {
    status: params.status,
    label: "目录已移除",
    tone: "warn" as const,
    detail: "该历史 Provider 已从企业运营身份目录移除，仅保留只读兼容。",
  };
}

export type EnterpriseIdentityRequestOptions = {
  basePath?: string;
  trustedProxy: GatewayTrustedProxyConfig | undefined;
  localDirect?: boolean;
};

function resolveEnterpriseRoute(params: { pathname: string; basePath?: string }) {
  const routeBase = resolveControlUiEnterpriseBasePath(params.basePath);
  if (params.pathname !== routeBase && !params.pathname.startsWith(`${routeBase}/`)) {
    return null;
  }
  const relative = params.pathname.slice(routeBase.length).replace(/^\/+/, "");
  const segments = relative
    ? relative.split("/").map((segment) => decodeURIComponent(segment))
    : [];
  const tenantId = segments[0]?.trim() ?? "";
  return {
    routeBase,
    tenantId,
    segments: segments.slice(1),
  };
}

function sendForbidden(res: ServerResponse, code: string, error: string) {
  sendJson(res, 403, { ok: false, code, error });
}

function sendBadRequest(res: ServerResponse, code: string, error: string) {
  sendJson(res, 400, { ok: false, code, error });
}

function sendNotFound(res: ServerResponse, code: string, error: string) {
  sendJson(res, 404, { ok: false, code, error });
}

function sendHtml(res: ServerResponse, status: number, body: string) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(body);
}

function parseRequestBody(body: unknown): Record<string, unknown> | null {
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function parseBindingPurpose(value: unknown): DataSourceIdentityBindingPurpose | null {
  return value === "source_authentication" ||
    value === "source_collection" ||
    value === "source_sync"
    ? value
    : null;
}

function resolveRequestOrigin(req: IncomingMessage): string {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol =
    (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)?.split(",")[0]?.trim() ||
    "http";
  const host = req.headers.host?.trim() || "127.0.0.1";
  return `${protocol}://${host}`;
}

async function handleEnterpriseWechatOfficialOAuthCallback(params: {
  req: IncomingMessage;
  res: ServerResponse;
  route: NonNullable<ReturnType<typeof resolveEnterpriseRoute>>;
  url: URL;
}): Promise<boolean> {
  const [resource, resourceId, action] = params.route.segments;
  if (
    params.req.method !== "GET" ||
    resource !== "oauth" ||
    resourceId !== "wechat-official" ||
    action !== "callback"
  ) {
    return false;
  }
  const nowIso = new Date().toISOString();
  const state = params.url.searchParams.get("state")?.trim() ?? "";
  const authorizationCode =
    params.url.searchParams.get("auth_code")?.trim() ||
    params.url.searchParams.get("code")?.trim() ||
    "";
  expireEnterpriseWechatOAuthSessions(nowIso);
  const session = getEnterpriseWechatOAuthSessionByState(state);
  if (!session || session.tenantId !== params.route.tenantId || session.status !== "pending") {
    sendHtml(
      params.res,
      400,
      renderEnterpriseOAuthCallbackHtml({
        ok: false,
        title: "授权失败",
        message: "OAuth 会话无效或已过期，请返回控制台重新发起扫码。",
      }),
    );
    return true;
  }
  if (!authorizationCode) {
    sendHtml(
      params.res,
      400,
      renderEnterpriseOAuthCallbackHtml({
        ok: false,
        title: "授权失败",
        message: "缺少 auth_code 参数。",
      }),
    );
    return true;
  }
  const origin = resolveRequestOrigin(params.req);
  const redirectUri = `${origin}${params.route.routeBase}/${params.route.tenantId}/oauth/wechat-official/callback`;
  const config = resolveWechatComponentOAuthConfig({ redirectUri });
  if (!config) {
    sendHtml(
      params.res,
      400,
      renderEnterpriseOAuthCallbackHtml({
        ok: false,
        title: "授权失败",
        message: "微信第三方平台 OAuth 未配置。",
      }),
    );
    return true;
  }
  try {
    const tokens = await exchangeWechatAuthorizerTokens({
      config,
      authorizationCode,
    });
    completeEnterpriseWechatOAuthSession({
      session,
      authorizerAppId: tokens.authorizerAppId,
      nowIso,
    });
    const seatStore = await loadSeatAssetsStoreForTenantId(params.route.tenantId);
    const auditId = randomUUID();
    const targetIdentityId = session.targetIdentityId?.trim();
    const targetCredentialBindingId = session.targetCredentialBindingId?.trim();
    let credentialBindingId: string;
    let responseIdentityId: string;

    if (targetIdentityId && targetCredentialBindingId) {
      const existingIdentity = getTenantEnterpriseIdentity(
        seatStore,
        params.route.tenantId,
        targetIdentityId,
      );
      const existingBinding = seatStore.credentialBindings[targetCredentialBindingId];
      if (
        !existingIdentity ||
        !existingBinding ||
        existingBinding.tenantId !== params.route.tenantId ||
        existingIdentity.credentialBindingId !== targetCredentialBindingId
      ) {
        sendHtml(
          params.res,
          400,
          renderEnterpriseOAuthCallbackHtml({
            ok: false,
            title: "授权失败",
            message: "目标身份或凭证绑定无效。",
          }),
        );
        return true;
      }
      credentialBindingId = targetCredentialBindingId;
      responseIdentityId = targetIdentityId;
      const updated = updateEnterpriseIdentity({
        store: seatStore,
        tenantId: params.route.tenantId,
        identityId: targetIdentityId,
        displayName: session.displayName?.trim() || existingIdentity.displayName,
        externalAccountId: tokens.authorizerAppId,
        nowIso,
        auditId,
        actorEmployeeId: session.createdByEmployeeId,
      });
      if (!updated.ok) {
        sendHtml(
          params.res,
          400,
          renderEnterpriseOAuthCallbackHtml({
            ok: false,
            title: "授权失败",
            message: updated.error,
          }),
        );
        return true;
      }
      existingBinding.status = "active";
      existingBinding.updatedAt = nowIso;
      seatStore.credentialBindings[credentialBindingId] = existingBinding;
    } else {
      const ownerId =
        session.seatId?.trim() || session.createdByEmployeeId?.trim() || "wechat-oauth";
      const credential = registerConnectorCredentialBinding({
        store: seatStore,
        tenantId: params.route.tenantId,
        connectorId: "wechat-official",
        ownerType: session.seatId ? "seat" : "employee",
        ownerId,
        nowIso,
        createdBy: session.createdByEmployeeId,
        auditId,
        allowMultiple: true,
      });
      const identity = registerEnterpriseIdentity({
        store: seatStore,
        tenantId: params.route.tenantId,
        displayName: session.displayName ?? `公众号 ${tokens.authorizerAppId}`,
        credentialBindingId: credential.credentialBindingId,
        externalAccountId: tokens.authorizerAppId,
        nowIso,
        auditId,
      });
      if (!identity.ok) {
        sendHtml(
          params.res,
          400,
          renderEnterpriseOAuthCallbackHtml({
            ok: false,
            title: "授权失败",
            message: identity.error,
          }),
        );
        return true;
      }
      credentialBindingId = credential.credentialBindingId;
      responseIdentityId = identity.identity.identityId;
    }

    await withEnterpriseOperationalIdentityCredentialSecretStoreWriteLock(async (secretStore) => {
      const previous = secretStore.secrets[credentialBindingId];
      secretStore.secrets[credentialBindingId] = {
        credentialBindingId,
        tenantId: params.route.tenantId,
        connectorId: "wechat-official",
        kind: "oauth_token",
        accessToken: tokens.authorizerAccessToken,
        refreshToken: tokens.authorizerRefreshToken,
        expiresAt: tokens.expiresIn
          ? new Date(new Date(nowIso).getTime() + tokens.expiresIn * 1000).toISOString()
          : undefined,
        externalAccountId: tokens.authorizerAppId,
        accountLabel: session.displayName ?? `公众号 ${tokens.authorizerAppId}`,
        createdAt: previous?.createdAt ?? nowIso,
        updatedAt: nowIso,
        metadata: {
          ...previous?.metadata,
          authMode: "authorizer",
          appId: tokens.authorizerAppId,
        },
      };
    });
    await persistEnterpriseOiMutation({
      storePath: resolveSeatAssetsStorePathForTenantId(params.route.tenantId),
      store: seatStore,
      tenantId: params.route.tenantId,
      governedIdentityIds: [responseIdentityId],
      credentialHandleByIdentityId: {
        [responseIdentityId]: credentialBindingId,
      },
    });
    const refreshedIdentity = getTenantEnterpriseIdentity(
      seatStore,
      params.route.tenantId,
      responseIdentityId,
    );
    const displayName =
      refreshedIdentity?.displayName ?? session.displayName ?? `公众号 ${tokens.authorizerAppId}`;
    sendHtml(
      params.res,
      200,
      renderEnterpriseOAuthCallbackHtml({
        ok: true,
        title: "授权成功",
        message: `${displayName} 已绑定。请关闭此窗口并返回企业控制台。`,
      }),
    );
    return true;
  } catch (error) {
    sendHtml(
      params.res,
      400,
      renderEnterpriseOAuthCallbackHtml({
        ok: false,
        title: "授权失败",
        message: error instanceof Error ? error.message : "WeChat OAuth exchange failed.",
      }),
    );
    return true;
  }
}

async function handleEnterpriseSocialOAuthCallback(params: {
  req: IncomingMessage;
  res: ServerResponse;
  route: NonNullable<ReturnType<typeof resolveEnterpriseRoute>>;
  url: URL;
}): Promise<boolean> {
  const [resource, resourceId, action] = params.route.segments;
  if (
    params.req.method !== "GET" ||
    resource !== "oauth" ||
    !resourceId ||
    action !== "callback" ||
    resourceId === "wechat-official"
  ) {
    return false;
  }
  const spec = parseEnterpriseSocialOAuthProviderSlug(resourceId);
  if (!spec) {
    return false;
  }
  const nowIso = new Date().toISOString();
  const oauthError = params.url.searchParams.get("error")?.trim() ?? "";
  if (oauthError) {
    sendHtml(
      params.res,
      400,
      renderEnterpriseOAuthCallbackHtml({
        ok: false,
        title: "授权失败",
        message: `平台返回错误：${oauthError}`,
      }),
    );
    return true;
  }
  const state = params.url.searchParams.get("state")?.trim() ?? "";
  const code = params.url.searchParams.get("code")?.trim() ?? "";
  if (!state || !code) {
    sendHtml(
      params.res,
      400,
      renderEnterpriseOAuthCallbackHtml({
        ok: false,
        title: "授权失败",
        message: "缺少 state 或 code 参数。",
      }),
    );
    return true;
  }
  const origin = resolveRequestOrigin(params.req);
  const result = await completeEnterpriseSocialOAuthCallback({
    tenantId: params.route.tenantId,
    spec,
    routeBase: params.route.routeBase,
    origin,
    state,
    code,
    nowIso,
  });
  if (!result.ok) {
    sendHtml(
      params.res,
      400,
      renderEnterpriseOAuthCallbackHtml({
        ok: false,
        title: "授权失败",
        message: result.error,
      }),
    );
    return true;
  }
  sendHtml(
    params.res,
    200,
    renderEnterpriseOAuthCallbackHtml({
      ok: true,
      title: "授权成功",
      message: `${result.displayName} 已绑定。请关闭此窗口并返回企业控制台刷新目录。`,
    }),
  );
  return true;
}

async function loadSeededEnterpriseDataStoreForTenant(params: {
  tenantId: string;
  nowIso: string;
  storePath?: string;
}) {
  const dataStore = await loadEnterpriseDataStore(params.storePath);
  const sourceCountBeforeSeed = listDataSources({
    store: dataStore,
    tenantId: params.tenantId,
  }).length;
  ensureEnterpriseDataCatalogSeeded({
    store: dataStore,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
  });
  const sourceCountAfterSeed = listDataSources({
    store: dataStore,
    tenantId: params.tenantId,
  }).length;
  if (sourceCountAfterSeed !== sourceCountBeforeSeed) {
    await saveEnterpriseDataStore(dataStore, params.storePath);
  }
  return dataStore;
}

export async function listEligibleOperationalIdentityDataSources(params: {
  tenantId: string;
  nowIso: string;
  storePath?: string;
}): Promise<
  Array<{
    sourceId: string;
    sourceKey: string;
    displayName: string;
    connectorId: string;
    status: string;
  }>
> {
  const dataStore = await loadSeededEnterpriseDataStoreForTenant(params);
  return listDataSources({
    store: dataStore,
    tenantId: params.tenantId,
  }).map((source) => ({
    sourceId: source.sourceId,
    sourceKey: source.sourceKey,
    displayName: source.displayName,
    connectorId: source.connectorId,
    status: source.status,
  }));
}

async function requireEnterpriseAdminContext(
  req: IncomingMessage,
  res: ServerResponse,
  params: {
    trustedProxy: GatewayTrustedProxyConfig | undefined;
    localDirect?: boolean;
    tenantId: string;
  },
) {
  if (!isLocalOrConfiguredPublicPlatformAccess({ req, localDirect: params.localDirect })) {
    sendForbidden(
      res,
      "ENTERPRISE_IDENTITY_LOCAL_ONLY",
      "Enterprise operational identity commands require a local or configured public Control UI entry.",
    );
    return null;
  }
  const context = await readPlatformAuthSessionContextFromRequest({
    req,
    trustedProxy: params.trustedProxy,
    localDirect: params.localDirect,
  });
  if (!context) {
    sendJson(res, 401, {
      ok: false,
      code: "ENTERPRISE_IDENTITY_UNAUTHORIZED",
      error: "Sign in with an enterprise administrator account first.",
    });
    return null;
  }
  if (!context.membership || context.membership.enterpriseId !== params.tenantId) {
    sendForbidden(
      res,
      "ENTERPRISE_IDENTITY_TENANT_FORBIDDEN",
      "This tenant is not available in the current session.",
    );
    return null;
  }
  if (context.membership.membershipRole !== "enterprise-admin") {
    sendForbidden(
      res,
      "ENTERPRISE_IDENTITY_ADMIN_REQUIRED",
      "Only enterprise administrators can manage operational identities.",
    );
    return null;
  }
  return context;
}

export async function handleEnterpriseOperationalIdentityHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: EnterpriseIdentityRequestOptions,
): Promise<boolean> {
  const urlRaw = req.url;
  if (!urlRaw) {
    return false;
  }
  const url = new URL(urlRaw, "http://localhost");
  const route = resolveEnterpriseRoute({ pathname: url.pathname, basePath: opts.basePath });
  if (!route) {
    return false;
  }
  if (!route.tenantId) {
    sendNotFound(res, "ENTERPRISE_IDENTITY_TENANT_REQUIRED", "Tenant id is required.");
    return true;
  }

  if (await handleEnterpriseWechatOfficialOAuthCallback({ req, res, route, url })) {
    return true;
  }
  if (await handleEnterpriseSocialOAuthCallback({ req, res, route, url })) {
    return true;
  }

  const config = resolvePlatformAuthConfig(opts.trustedProxy);
  if (!config) {
    sendNotFound(
      res,
      "ENTERPRISE_IDENTITY_NOT_ENABLED",
      "Enterprise operational identity is unavailable until platform auth is enabled.",
    );
    return true;
  }

  const context = await requireEnterpriseAdminContext(req, res, {
    trustedProxy: opts.trustedProxy,
    localDirect: opts.localDirect,
    tenantId: route.tenantId,
  });
  if (!context) {
    return true;
  }

  const [resource, resourceId, action] = route.segments;
  const nowIso = new Date().toISOString();
  const actorEmployeeId = resolveOperationalIdentityActorEmployeeIdFromPlatformUser(
    context.user.id,
  );

  if (req.method === "GET" && resource === "identities" && !resourceId) {
    const seatStore = await loadSeatAssetsStoreForContext(context);
    const secretStore = await loadEnterpriseOperationalIdentityCredentialSecretStore();
    const platformStore = await loadPlatformAuthStore(config);
    const userLabelById = new Map(
      Object.values(platformStore.users).map((user) => [
        user.id,
        { displayName: user.displayName, email: user.email },
      ]),
    );
    const catalog = summarizeEnterpriseIdentityCatalog({
      store: seatStore,
      tenantId: route.tenantId,
      nowIso,
    });
    const [eligibleDataSources, gatewayEgressIp] = await Promise.all([
      listEligibleOperationalIdentityDataSources({
        tenantId: route.tenantId,
        nowIso,
      }),
      resolveUserOperationalIdentityGatewayEgressIp(),
    ]);
    sendJson(res, 200, {
      ok: true,
      identities: catalog.identities.map((identity) => {
        const enriched = enrichOperationalIdentityApiView({
          identity,
          store: seatStore,
          tenantId: route.tenantId,
          nowIso,
        });
        const secret = secretStore.secrets[identity.credentialBindingId] ?? null;
        const activeProvider = resolveActiveEnterpriseOperationalIdentityProvider(
          identity.provider,
        );
        const credentialEditPreview = activeProvider
          ? buildOperationalIdentityCredentialEditPreview({
              provider: activeProvider,
              secret,
              externalAccountId: identity.externalAccountId,
            })
          : undefined;
        const steward =
          resolveEnterpriseIdentitySteward({
            store: seatStore,
            tenantId: route.tenantId,
            credentialBindingId: identity.credentialBindingId,
          }) ?? undefined;
        const stewardDisplay = steward
          ? resolveEnterpriseIdentityStewardLabel({
              store: seatStore,
              tenantId: route.tenantId,
              steward,
              userLabelById,
            })
          : undefined;
        return {
          ...enriched,
          providerLabel: identity.providerLabel,
          category: identity.category,
          policyCount: identity.policyCount,
          dataSourceBindingCount: identity.dataSourceBindingCount,
          ...(credentialEditPreview ? { credentialEditPreview } : {}),
          steward,
          ...(stewardDisplay
            ? { stewardLabel: stewardDisplay.label, stewardDetail: stewardDisplay.detail }
            : {}),
          statusHint: resolveEnterpriseOperationalIdentityStatusHint({
            provider: identity.provider,
            status: identity.status,
          }),
          configReadiness: snapshotEnterpriseIdentityConfigReadiness({
            store: seatStore,
            tenantId: route.tenantId,
            identity,
            secret: secretStore.secrets[identity.credentialBindingId] ?? null,
          }),
        };
      }),
      providerCounts: catalog.providerCounts,
      providerCatalog: await listOperationalIdentityProviderCatalogWithRuntime(),
      eligibleCredentialBindings: listEligibleOperationalIdentityCredentialBindings({
        store: seatStore,
        tenantId: route.tenantId,
      }),
      eligibleDataSources,
      policies: listTenantIdentityUsagePolicies(seatStore, route.tenantId),
      dataSourceBindings: listTenantDataSourceIdentityBindings(seatStore, route.tenantId),
      employeeEnrollments: Object.values(seatStore.employeeIdentityEnrollments ?? {}).filter(
        (enrollment) => enrollment.tenantId === route.tenantId,
      ),
      bindingActivity: listEmployeeIdentityBindingActivity(seatStore, route.tenantId),
      gatewayEgressIp,
    });
    return true;
  }

  if (
    req.method === "GET" &&
    resource === "identities" &&
    resourceId &&
    action === "capabilities"
  ) {
    const seatStore = await loadSeatAssetsStoreForContext(context);
    const identity = listTenantEnterpriseIdentities(seatStore, route.tenantId).find(
      (entry) => entry.identityId === resourceId,
    );
    if (!identity) {
      sendNotFound(res, "ENTERPRISE_IDENTITY_NOT_FOUND", "Identity not found.");
      return true;
    }
    const view = enrichOperationalIdentityApiView({
      identity,
      store: seatStore,
      tenantId: route.tenantId,
      nowIso,
    });
    sendJson(res, 200, {
      ok: true,
      identityId: resourceId,
      capabilities: view.capabilityDetails,
      granted: view.capabilities ?? [],
      missing: view.capabilityMissing ?? [],
      agentReady: view.agentReady,
    });
    return true;
  }

  if (
    req.method === "GET" &&
    resource === "identities" &&
    resourceId &&
    action === "credential-edit-preview"
  ) {
    const seatStore = await loadSeatAssetsStoreForContext(context);
    const secretStore = await loadEnterpriseOperationalIdentityCredentialSecretStore();
    const identity = listTenantEnterpriseIdentities(seatStore, route.tenantId).find(
      (entry) => entry.identityId === resourceId,
    );
    if (!identity) {
      sendNotFound(res, "ENTERPRISE_IDENTITY_NOT_FOUND", "Identity not found.");
      return true;
    }
    const activeProvider = resolveActiveEnterpriseOperationalIdentityProvider(identity.provider);
    const credentialEditPreview = activeProvider
      ? buildOperationalIdentityCredentialEditPreview({
          provider: activeProvider,
          secret: secretStore.secrets[identity.credentialBindingId] ?? null,
          externalAccountId: identity.externalAccountId,
        })
      : undefined;
    sendJson(res, 200, {
      ok: true,
      identityId: resourceId,
      credentialBindingId: identity.credentialBindingId,
      ...(identity.externalAccountId ? { externalAccountId: identity.externalAccountId } : {}),
      credentialEditPreview: credentialEditPreview ?? { fields: {}, secretsConfigured: [] },
    });
    return true;
  }

  if (req.method === "GET" && resource === "identities" && resourceId && !action) {
    const seatStore = await loadSeatAssetsStoreForContext(context);
    const identity = listTenantEnterpriseIdentities(seatStore, route.tenantId).find(
      (entry) => entry.identityId === resourceId,
    );
    if (!identity) {
      sendNotFound(res, "ENTERPRISE_IDENTITY_NOT_FOUND", "Identity not found.");
      return true;
    }
    sendJson(res, 200, {
      ok: true,
      identity: enrichOperationalIdentityApiView({
        identity,
        store: seatStore,
        tenantId: route.tenantId,
        nowIso,
      }),
      policies: listTenantIdentityUsagePolicies(seatStore, route.tenantId, resourceId),
      dataSourceBindings: listTenantDataSourceIdentityBindings(
        seatStore,
        route.tenantId,
        resourceId,
      ),
    });
    return true;
  }

  const parsedBody = await readJsonBody(req, ENTERPRISE_IDENTITY_BODY_LIMIT_BYTES);
  if (!parsedBody.ok) {
    sendBadRequest(res, "ENTERPRISE_IDENTITY_INVALID_BODY", "Invalid request body.");
    return true;
  }
  const body = parseRequestBody(parsedBody.value);
  if (!body) {
    sendBadRequest(res, "ENTERPRISE_IDENTITY_INVALID_BODY", "Invalid request body.");
    return true;
  }

  const seatStore = await loadSeatAssetsStoreForContext(context);
  const auditId = randomUUID();

  if (req.method === "POST" && resource === "identities" && resourceId === "create") {
    const credentialBindingId =
      typeof body.credentialBindingId === "string" ? body.credentialBindingId : "";
    let externalAccountId =
      typeof body.externalAccountId === "string" ? body.externalAccountId : undefined;
    if (!externalAccountId?.trim() && credentialBindingId) {
      const secretStore = await loadEnterpriseOperationalIdentityCredentialSecretStore();
      const secret = secretStore.secrets[credentialBindingId];
      externalAccountId =
        secret?.externalAccountId?.trim() || secret?.metadata?.appId?.trim() || undefined;
    }
    const result = registerEnterpriseIdentity({
      store: seatStore,
      tenantId: route.tenantId,
      displayName: typeof body.displayName === "string" ? body.displayName : "",
      credentialBindingId,
      connectorProfileId:
        typeof body.connectorProfileId === "string" ? body.connectorProfileId : undefined,
      externalAccountId,
      expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : undefined,
      nowIso,
      actorEmployeeId,
      auditId,
    });
    if (!result.ok) {
      sendBadRequest(res, result.code, result.error);
      return true;
    }
    await persistEnterpriseOiMutation({
      storePath: resolveSeatAssetsStorePathFromContext(context),
      store: seatStore,
      tenantId: route.tenantId,
      governedIdentityIds: [result.identity.identityId],
      providerByIdentityId: {
        [result.identity.identityId]: result.identity.provider,
      },
      credentialHandleByIdentityId: {
        [result.identity.identityId]: result.identity.credentialBindingId,
      },
    });
    sendJson(res, 200, { ok: true, identity: result.identity, auditId });
    return true;
  }

  if (req.method === "POST" && resource === "credentials" && resourceId === "upsert") {
    const connectorId = typeof body.connectorId === "string" ? body.connectorId.trim() : "";
    if (!connectorId) {
      sendBadRequest(res, "ENTERPRISE_IDENTITY_CONNECTOR_REQUIRED", "connectorId is required.");
      return true;
    }
    if (!isSupportedOperationalIdentityConnectorId(connectorId)) {
      sendBadRequest(
        res,
        "ENTERPRISE_IDENTITY_PROVIDER_UNSUPPORTED",
        "Connector is not registerable as an operational identity.",
      );
      return true;
    }
    const fields =
      body.fields && typeof body.fields === "object" && !Array.isArray(body.fields)
        ? Object.fromEntries(
            Object.entries(body.fields as Record<string, unknown>)
              .filter(([, value]) => typeof value === "string")
              .map(([key, value]) => [key, (value as string).trim()]),
          )
        : {};
    const result = await upsertEnterpriseOperationalIdentityCredential({
      store: seatStore,
      tenantId: route.tenantId,
      connectorId,
      ownerType: "employee",
      ownerId: actorEmployeeId ?? context.user.id,
      createdBy: actorEmployeeId,
      nowIso,
      allowMultiple: body.allowMultiple === true,
      credentialBindingId:
        typeof body.credentialBindingId === "string" ? body.credentialBindingId : undefined,
      accountLabel: typeof body.accountLabel === "string" ? body.accountLabel : undefined,
      externalAccountId:
        typeof body.externalAccountId === "string" ? body.externalAccountId : undefined,
      fields,
    });
    if (!result.ok) {
      sendBadRequest(res, result.code, result.error);
      return true;
    }
    await persistEnterpriseOiMutation({
      storePath: resolveSeatAssetsStorePathFromContext(context),
      store: seatStore,
      tenantId: route.tenantId,
      governedIdentityIds: [`cred-${result.binding.credentialBindingId}`],
      credentialHandleByIdentityId: {
        [`cred-${result.binding.credentialBindingId}`]: result.binding.credentialBindingId,
      },
    });
    sendJson(res, 200, {
      ok: true,
      credentialBindingId: result.binding.credentialBindingId,
      connectorId: result.binding.connectorId,
      externalAccountId: result.secret.externalAccountId,
      auditId,
    });
    return true;
  }

  if (req.method === "POST" && resource === "credentials" && resourceId === "create") {
    const connectorId = typeof body.connectorId === "string" ? body.connectorId.trim() : "";
    if (!connectorId) {
      sendBadRequest(res, "ENTERPRISE_IDENTITY_CONNECTOR_REQUIRED", "connectorId is required.");
      return true;
    }
    if (!isSupportedOperationalIdentityConnectorId(connectorId)) {
      sendBadRequest(
        res,
        "ENTERPRISE_IDENTITY_PROVIDER_UNSUPPORTED",
        "Connector is not registerable as an operational identity.",
      );
      return true;
    }
    const binding = registerConnectorCredentialBinding({
      store: seatStore,
      tenantId: route.tenantId,
      connectorId,
      ownerType: "employee",
      ownerId: actorEmployeeId ?? context.user.id,
      createdBy: actorEmployeeId,
      nowIso,
      auditId,
      allowMultiple: body.allowMultiple === true,
    });
    await persistEnterpriseOiMutation({
      storePath: resolveSeatAssetsStorePathFromContext(context),
      store: seatStore,
      tenantId: route.tenantId,
      governedIdentityIds: [`cred-${binding.credentialBindingId}`],
      credentialHandleByIdentityId: {
        [`cred-${binding.credentialBindingId}`]: binding.credentialBindingId,
      },
    });
    sendJson(res, 200, {
      ok: true,
      credentialBindingId: binding.credentialBindingId,
      connectorId: binding.connectorId,
      auditId,
    });
    return true;
  }

  if (req.method === "POST" && resource === "identities" && resourceId && action === "update") {
    const result = updateEnterpriseIdentity({
      store: seatStore,
      tenantId: route.tenantId,
      identityId: resourceId,
      displayName: typeof body.displayName === "string" ? body.displayName : undefined,
      connectorProfileId:
        body.connectorProfileId === null
          ? null
          : typeof body.connectorProfileId === "string"
            ? body.connectorProfileId
            : undefined,
      externalAccountId:
        body.externalAccountId === null
          ? null
          : typeof body.externalAccountId === "string"
            ? body.externalAccountId
            : undefined,
      expiresAt:
        body.expiresAt === null
          ? null
          : typeof body.expiresAt === "string"
            ? body.expiresAt
            : undefined,
      nowIso,
      actorEmployeeId,
      auditId,
    });
    if (!result.ok) {
      sendBadRequest(res, result.code, result.error);
      return true;
    }
    await persistEnterpriseOiMutation({
      storePath: resolveSeatAssetsStorePathFromContext(context),
      store: seatStore,
      tenantId: route.tenantId,
      governedIdentityIds: [resourceId],
      providerByIdentityId: { [resourceId]: result.identity.provider },
      credentialHandleByIdentityId: { [resourceId]: result.identity.credentialBindingId },
    });
    sendJson(res, 200, { ok: true, identity: result.identity, auditId });
    return true;
  }

  if (req.method === "POST" && resource === "identities" && resourceId && action === "verify") {
    const secretStore = await loadEnterpriseOperationalIdentityCredentialSecretStore();
    const identityRecord = seatStore.enterpriseIdentities[resourceId];
    let secret =
      identityRecord?.credentialBindingId != null
        ? (secretStore.secrets[identityRecord.credentialBindingId] ?? null)
        : null;
    const activeProvider = identityRecord
      ? resolveActiveEnterpriseOperationalIdentityProvider(identityRecord.provider)
      : null;
    if (identityRecord && secret && activeProvider) {
      secret = await maybeRefreshOperationalIdentityCredential({
        provider: activeProvider,
        credentialBindingId: identityRecord.credentialBindingId,
        secret,
        externalAccountId: identityRecord.externalAccountId,
        nowIso,
      });
    }
    const probeResults =
      identityRecord && activeProvider && !identityRecord.revokedAt
        ? await probeOperationalIdentityCredential({
            provider: activeProvider,
            secret,
            externalAccountId: identityRecord.externalAccountId,
          })
        : undefined;
    const capabilityDiscovery =
      identityRecord && activeProvider && !identityRecord.revokedAt
        ? await discoverOperationalIdentityCapabilities({
            provider: activeProvider,
            secret,
            externalAccountId: identityRecord.externalAccountId,
            probeResults,
            nowIso,
          })
        : undefined;
    const result = verifyEnterpriseIdentity({
      store: seatStore,
      tenantId: route.tenantId,
      identityId: resourceId,
      nowIso,
      actorEmployeeId,
      auditId,
      secret,
      probeResults,
      capabilityDiscovery,
    });
    if (!result.ok) {
      sendBadRequest(res, result.code, result.error);
      return true;
    }
    await persistEnterpriseOiMutation({
      storePath: resolveSeatAssetsStorePathFromContext(context),
      store: seatStore,
      tenantId: route.tenantId,
      governedIdentityIds: [resourceId],
      providerByIdentityId: { [resourceId]: result.identity.provider },
      credentialHandleByIdentityId: { [resourceId]: result.identity.credentialBindingId },
    });
    const enriched = enrichOperationalIdentityApiView({
      identity: result.identity,
      store: seatStore,
      tenantId: route.tenantId,
      nowIso,
    });
    sendJson(res, 200, {
      ok: true,
      identity: {
        ...enriched,
        statusHint: resolveEnterpriseOperationalIdentityStatusHint({
          provider: result.identity.provider,
          status: result.identity.status,
        }),
      },
      readiness: result.readiness,
      capabilities: enriched.capabilityDetails,
      agentReady: enriched.agentReady,
      auditId,
    });
    return true;
  }

  if (req.method === "POST" && resource === "identities" && resourceId && action === "revoke") {
    const result = revokeEnterpriseIdentity({
      store: seatStore,
      tenantId: route.tenantId,
      identityId: resourceId,
      nowIso,
      actorEmployeeId,
      auditId,
    });
    if (!result.ok) {
      sendBadRequest(res, result.code, result.error);
      return true;
    }
    await persistEnterpriseOiMutation({
      storePath: resolveSeatAssetsStorePathFromContext(context),
      store: seatStore,
      tenantId: route.tenantId,
      governedIdentityIds: [resourceId],
      providerByIdentityId: { [resourceId]: result.identity.provider },
      credentialHandleByIdentityId: { [resourceId]: result.identity.credentialBindingId },
    });
    sendJson(res, 200, { ok: true, identity: result.identity, auditId });
    return true;
  }

  if (
    req.method === "POST" &&
    resource === "identities" &&
    resourceId &&
    action === "reauthorize"
  ) {
    const result = reauthorizeEnterpriseIdentity({
      store: seatStore,
      tenantId: route.tenantId,
      identityId: resourceId,
      nowIso,
      actorEmployeeId,
      auditId,
    });
    if (!result.ok) {
      sendBadRequest(res, result.code, result.error);
      return true;
    }
    await persistEnterpriseOiMutation({
      storePath: resolveSeatAssetsStorePathFromContext(context),
      store: seatStore,
      tenantId: route.tenantId,
      governedIdentityIds: [resourceId],
      providerByIdentityId: { [resourceId]: result.identity.provider },
      credentialHandleByIdentityId: { [resourceId]: result.identity.credentialBindingId },
    });
    sendJson(res, 200, { ok: true, identity: result.identity, auditId });
    return true;
  }

  if (req.method === "POST" && resource === "identity-policies" && resourceId === "upsert") {
    const identityId = typeof body.identityId === "string" ? body.identityId : "";
    const result = upsertIdentityUsagePolicy({
      store: seatStore,
      tenantId: route.tenantId,
      identityId,
      policyId: typeof body.policyId === "string" ? body.policyId : undefined,
      seatIds: parseStringArray(body.seatIds),
      allowedAgentIds: [],
      allowedActions: parseStringArray(body.allowedActions),
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      nowIso,
      actorEmployeeId,
      auditId,
    });
    if (!result.ok) {
      sendBadRequest(res, result.code, result.error);
      return true;
    }
    await persistEnterpriseOiMutation({
      storePath: resolveSeatAssetsStorePathFromContext(context),
      store: seatStore,
      tenantId: route.tenantId,
      governedIdentityIds: [identityId],
    });
    sendJson(res, 200, { ok: true, policy: result.policy, auditId });
    return true;
  }

  if (req.method === "POST" && resource === "identity-bindings" && resourceId === "create") {
    const purpose = parseBindingPurpose(body.purpose);
    if (!purpose) {
      sendBadRequest(
        res,
        "ENTERPRISE_IDENTITY_BINDING_PURPOSE_INVALID",
        "purpose must be source_authentication, source_collection, or source_sync.",
      );
      return true;
    }
    const dataStore = await loadSeededEnterpriseDataStoreForTenant({
      tenantId: route.tenantId,
      nowIso,
    });
    const result = createDataSourceIdentityBinding({
      store: seatStore,
      tenantId: route.tenantId,
      identityId: typeof body.identityId === "string" ? body.identityId : "",
      dataSourceId: typeof body.dataSourceId === "string" ? body.dataSourceId : "",
      purpose,
      dataSourceStore: dataStore,
      nowIso,
      actorEmployeeId,
      auditId,
    });
    if (!result.ok) {
      sendBadRequest(res, result.code, result.error);
      return true;
    }
    await persistEnterpriseOiMutation({
      storePath: resolveSeatAssetsStorePathFromContext(context),
      store: seatStore,
      tenantId: route.tenantId,
      governedIdentityIds: [typeof body.identityId === "string" ? body.identityId : ""],
    });
    sendJson(res, 200, { ok: true, binding: result.binding, auditId });
    return true;
  }

  if (
    req.method === "POST" &&
    resource === "identity-bindings" &&
    resourceId &&
    action === "delete"
  ) {
    const existingBinding = seatStore.dataSourceIdentityBindings[resourceId];
    const governedIdentityId = existingBinding?.identityId?.trim() || resourceId;
    const result = removeDataSourceIdentityBinding({
      store: seatStore,
      tenantId: route.tenantId,
      bindingId: resourceId,
      nowIso,
      actorEmployeeId,
      auditId,
    });
    if (!result.ok) {
      sendBadRequest(res, result.code, result.error);
      return true;
    }
    await persistEnterpriseOiMutation({
      storePath: resolveSeatAssetsStorePathFromContext(context),
      store: seatStore,
      tenantId: route.tenantId,
      governedIdentityIds: [governedIdentityId],
    });
    sendJson(res, 200, { ok: true, auditId });
    return true;
  }

  if (
    req.method === "POST" &&
    resource === "oauth" &&
    resourceId === "wechat-official" &&
    action === "status"
  ) {
    expireEnterpriseWechatOAuthSessions(nowIso);
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
    if (!sessionId) {
      sendBadRequest(res, "ENTERPRISE_WECHAT_OAUTH_SESSION_INVALID", "sessionId is required.");
      return true;
    }
    const session = getEnterpriseWechatOAuthSessionById(sessionId);
    if (!session || session.tenantId !== route.tenantId) {
      sendBadRequest(res, "ENTERPRISE_WECHAT_OAUTH_SESSION_INVALID", "OAuth session is invalid.");
      return true;
    }
    sendJson(res, 200, {
      ok: true,
      sessionId: session.sessionId,
      status: session.status,
      authorizerAppId: session.authorizerAppId ?? null,
    });
    return true;
  }

  if (
    req.method === "POST" &&
    resource === "oauth" &&
    resourceId === "wechat-official" &&
    action === "start"
  ) {
    if (!isWechatComponentOAuthConfigured()) {
      sendBadRequest(
        res,
        "ENTERPRISE_WECHAT_OAUTH_NOT_CONFIGURED",
        "WeChat component OAuth env is not configured.",
      );
      return true;
    }
    if (!(await isWechatComponentVerifyTicketReady())) {
      sendBadRequest(
        res,
        "ENTERPRISE_WECHAT_OAUTH_TICKET_MISSING",
        "WeChat component_verify_ticket is missing. Configure the component event webhook or OPENBOT_ENTERPRISE_WECHAT_COMPONENT_VERIFY_TICKET.",
      );
      return true;
    }
    expireEnterpriseWechatOAuthSessions(nowIso);
    const origin = resolveRequestOrigin(req);
    const redirectUri = `${origin}${route.routeBase}/${route.tenantId}/oauth/wechat-official/callback`;
    const config = resolveWechatComponentOAuthConfig({ redirectUri });
    if (!config) {
      sendBadRequest(
        res,
        "ENTERPRISE_WECHAT_OAUTH_NOT_CONFIGURED",
        "WeChat component OAuth env is not configured.",
      );
      return true;
    }
    const session = createEnterpriseWechatOAuthSession({
      tenantId: route.tenantId,
      seatId: typeof body?.seatId === "string" ? body.seatId : undefined,
      createdByEmployeeId: actorEmployeeId,
      displayName: typeof body?.displayName === "string" ? body.displayName : undefined,
      targetIdentityId: typeof body?.identityId === "string" ? body.identityId : undefined,
      targetCredentialBindingId:
        typeof body?.credentialBindingId === "string" ? body.credentialBindingId : undefined,
      nowIso,
    });
    try {
      const { preAuthCode } = await createWechatComponentPreAuthCode(config);
      const authorizeUrl = buildWechatComponentAuthorizeUrl({
        config,
        preAuthCode,
        state: session.state,
        authType: "1",
      });
      sendJson(res, 200, {
        ok: true,
        sessionId: session.sessionId,
        authorizeUrl,
        callbackUrl: redirectUri,
      });
    } catch (error) {
      sendBadRequest(
        res,
        "ENTERPRISE_WECHAT_OAUTH_START_FAILED",
        error instanceof Error ? error.message : "WeChat OAuth start failed.",
      );
    }
    return true;
  }

  if (req.method === "POST" && resource === "oauth" && resourceId && action === "start") {
    const socialSpec = parseEnterpriseSocialOAuthProviderSlug(resourceId);
    if (socialSpec) {
      expireEnterpriseSocialOAuthSessions(nowIso);
      const origin = resolveRequestOrigin(req);
      const started = startEnterpriseSocialOAuthSession({
        tenantId: route.tenantId,
        spec: socialSpec,
        routeBase: route.routeBase,
        origin,
        seatId: typeof body?.seatId === "string" ? body.seatId : undefined,
        createdByEmployeeId: actorEmployeeId,
        displayName: typeof body?.displayName === "string" ? body.displayName : undefined,
        nowIso,
      });
      if (!started.ok) {
        sendBadRequest(res, started.code, started.error);
        return true;
      }
      sendJson(res, 200, {
        ok: true,
        sessionId: started.sessionId,
        authorizeUrl: started.authorizeUrl,
        callbackUrl: started.callbackUrl,
        provider: socialSpec.slug,
      });
      return true;
    }
  }

  return false;
}
