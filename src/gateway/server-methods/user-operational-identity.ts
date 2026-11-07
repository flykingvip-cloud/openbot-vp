import { loadConfig } from "../../config/config.js";
import {
  renewPersistedFeishuEmployeeConnection,
  startFeishuEmployeeOAuth,
} from "../enterprise-im-employee-connection-oauth.js";
import {
  allowFeishuEmployeeCredentialUse,
  disconnectFeishuEmployeeConnection,
  feishuEmployeeRowStatusLabel,
  loadFeishuEmployeeChannelGate,
} from "../enterprise-im-employee-connection.js";
import { loadEnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { resolvePlatformAuthSmtpConfig } from "../platform-auth-email.js";
import { loadPlatformAuthStore, resolvePlatformAuthConfig } from "../platform-auth.js";
import type { PlatformAuthStore } from "../platform-auth/store-types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { resolveQueryScope } from "../scope-attribution.js";
import {
  resolveControlPlaneStorePathForClient,
  resolveUserOperationalIdentitySecretsStorePathForClient,
  resolveUserOperationalIdentityStorePathForClient,
} from "../tenant-context.js";
import { TENANT_SEAT_ASSETS_FILE } from "../tenant-store-paths.js";
import {
  listUserOperationalIdentityAccessForAgent,
  resolveUserOperationalIdentity,
} from "../user-operational-identity-access.js";
import {
  cancelUserOperationalIdentityBindingRequest,
  completeUserOperationalIdentityBindingRequest,
  createUserOperationalIdentityBindingRequest,
  getUserOperationalIdentityBindingRequest,
  listPendingUserOperationalIdentityBindingRequests,
} from "../user-operational-identity-binding-request.js";
import {
  cancelUserOperationalIdentityContinuation,
  completeOAuthForUserOperationalIdentityContinuation,
  createUserOperationalIdentityContinuation,
  getUserOperationalIdentityContinuationByToken,
  listPendingUserOperationalIdentityContinuations,
  refreshUserOperationalIdentityContinuations,
  resumeUserOperationalIdentityContinuation,
} from "../user-operational-identity-continuation.js";
import {
  bindUserOperationalIdentityManualCredentials,
  verifyUserOperationalIdentityCredentials,
} from "../user-operational-identity-credentials.js";
import { resolveUserOperationalIdentityGatewayEgressIp } from "../user-operational-identity-egress.js";
import { loadEmployeeOperationalAuthorization } from "../user-operational-identity-enterprise-authorization.js";
import { listUserOperationalIdentityActivityForScope } from "../user-operational-identity-governance.js";
import {
  buildUserOperationalIdentityOAuthCallbackUrl,
  cancelUserOperationalIdentityOAuthSession,
  getUserOperationalIdentityOAuthSession,
  simulateCompleteUserOperationalIdentityOAuthSession,
  startUserOperationalIdentityOAuthSession,
} from "../user-operational-identity-oauth.js";
import {
  loadUserOperationalIdentityStore,
  withUserOperationalIdentityStoreWriteLockForOwner,
} from "../user-operational-identity-persistence.js";
import { isPersonalIdentityGrantEligibleForAgentScope } from "../user-operational-identity-personal-grant-eligibility.js";
import {
  isUserOperationalIdentityProviderManualAuth,
  isUserOperationalIdentityProviderQrChannelAuth,
  listUserOperationalIdentityProviderCatalog,
  parseUserOperationalIdentityProvider,
} from "../user-operational-identity-providers.js";
import { executeUserOperationalIdentityRuntimeAction } from "../user-operational-identity-runtime.js";
import {
  loadUserOperationalIdentityCredentialSecretStore,
  withUserOperationalIdentityCredentialSecretStoreWriteLock,
} from "../user-operational-identity-secrets-persistence.js";
import { loadUserOperationalIdentityCredentialSecretForHandle } from "../user-operational-identity-secrets.js";
import { resolveOperationalIdentityActorUserId } from "../user-operational-identity-session.js";
import { isXiaohongshuExecutionConfigured } from "../user-operational-identity-social.js";
import {
  getUserOperationalIdentity,
  listUserOperationalIdentityUsageEvents,
  registerUserOperationalIdentity,
  revokeUserOperationalIdentity,
  revokeUserOperationalIdentityGrant,
  summarizeUserOperationalIdentitySnapshot,
  upsertUserOperationalIdentityGrant,
} from "../user-operational-identity-store.js";
import { resolveTrustedUserOperationalIdentityAgentScope } from "../user-operational-identity-trusted-agent-scope.js";
import type { UserOperationalIdentityStore } from "../user-operational-identity-types.js";
import {
  bindExistingWechatPersonalNativeSession,
  bindWechatPersonalIdentityFromWxid,
  probeWechatPersonalWorker,
  startWechatLoginWithQr,
  USER_IDENTITY_WECHAT_PERSONAL_NOT_LOGGED_IN,
  USER_IDENTITY_WECHAT_PERSONAL_WORKER_OFFLINE,
  waitForWechatLogin,
} from "../user-operational-identity-wechat/index.js";
import { respondInvalid, stringValue } from "./billing-helpers.js";
import type { GatewayClient, GatewayRequestHandlers } from "./types.js";

function requirePlatformAuthUserId(
  client: Parameters<GatewayRequestHandlers[string]>[0]["client"],
  respond: Parameters<GatewayRequestHandlers[string]>[0]["respond"],
): Promise<string | null> {
  // 统一可信归属范式（Task 1.4）：写类接口仍要求已登录，无 owner 即拒绝。
  return resolveOperationalIdentityActorUserId({ client }).then((userId) => {
    if (!userId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "Platform auth user is required."),
      );
      return null;
    }
    return userId;
  });
}

/**
 * 只读接口的 owner 解析（Task 1.5）：无会话时返回 null 而不报错，
 * 调用方据此返回空快照 + needsLogin，引导登录而非刷错。
 */
function resolveOptionalOwnerId(
  client: Parameters<GatewayRequestHandlers[string]>[0]["client"],
): Promise<string | null> {
  return resolveOperationalIdentityActorUserId({ client });
}

/**
 * Best-effort platform-auth store load for owner→tenant backfill in the
 * governance overview. Returns null when platform auth is disabled (local
 * single-operator), in which case tenant attribution simply stays empty.
 */
async function loadPlatformAuthStoreBestEffort(): Promise<PlatformAuthStore | null> {
  const cfg = loadConfig();
  const authConfig = resolvePlatformAuthConfig(cfg.gateway?.auth?.trustedProxy);
  if (!authConfig?.enabled) {
    return null;
  }
  return loadPlatformAuthStore(authConfig);
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => String(entry).trim()).filter(Boolean);
}

async function withActorUserOiWriteLock<T>(
  client: GatewayClient | null,
  ownerId: string,
  fn: (store: UserOperationalIdentityStore) => Promise<T> | T,
): Promise<T> {
  const scope = await resolveQueryScope(client);
  const tenantId = scope.kind === "tenant" ? scope.tenantId : null;
  const storePath = await resolveUserOperationalIdentityStorePathForClient(client);
  return withUserOperationalIdentityStoreWriteLockForOwner({ ownerId, tenantId, storePath }, fn);
}

async function resolveActorTenantId(client: GatewayClient | null): Promise<string | null> {
  const scope = await resolveQueryScope(client);
  return scope.kind === "tenant" ? scope.tenantId : null;
}

function resolveTrustedAgentScope(params: {
  client: GatewayClient | null;
  ownerId: string;
  agentId: string;
  sessionKey?: string | null;
}) {
  return resolveTrustedUserOperationalIdentityAgentScope({
    currentUserId: params.ownerId,
    currentUserEmail: params.client?.user,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
  });
}

function refreshContinuationsInStore(params: {
  store: import("../user-operational-identity-types.js").UserOperationalIdentityStore;
  ownerId: string;
  nowIso: string;
  client: GatewayClient | null;
}) {
  return refreshUserOperationalIdentityContinuations({
    store: params.store,
    ownerId: params.ownerId,
    nowIso: params.nowIso,
    currentUserEmail: params.client?.user,
  });
}

export const userOperationalIdentityHandlers: GatewayRequestHandlers = {
  "user-operational-identity.list": async ({ client, respond }) => {
    const ownerId = await resolveOptionalOwnerId(client);
    if (!ownerId) {
      // Task 1.5: 无会话返回空快照 + needsLogin，前端引导登录而非刷错。
      respond(true, {
        ownerId: null,
        needsLogin: true,
        identities: [],
        grants: [],
        usageHistory: [],
        providerCatalog: listUserOperationalIdentityProviderCatalog(),
        gatewayEgressIp: null,
        platformSmtpConfigured: Boolean(resolvePlatformAuthSmtpConfig()),
        xiaohongshuApiConfigured: isXiaohongshuExecutionConfigured(),
      });
      return;
    }
    const nowIso = new Date().toISOString();
    const [snapshot, gatewayEgressIp] = await Promise.all([
      withActorUserOiWriteLock(client, ownerId, (store) =>
        summarizeUserOperationalIdentitySnapshot({ store, ownerId, nowIso }),
      ),
      resolveUserOperationalIdentityGatewayEgressIp(),
    ]);
    const feishuEmployeeChannel = await loadFeishuEmployeeChannelGate({
      tenantId: await resolveActorTenantId(client),
    });
    const identities = snapshot.identities.map((identity) => {
      if (identity.provider !== "feishu-personal" || !identity.enterpriseIm) {
        return identity;
      }
      return {
        ...identity,
        enterpriseIm: {
          ...identity.enterpriseIm,
          statusLabel: feishuEmployeeRowStatusLabel({
            gate: feishuEmployeeChannel,
            status: identity.status,
            expiresAt: identity.expiresAt,
            enterpriseIm: identity.enterpriseIm,
          }),
        },
      };
    });
    respond(true, {
      ownerId,
      ...snapshot,
      identities,
      feishuEmployeeChannel,
      providerCatalog: listUserOperationalIdentityProviderCatalog(),
      gatewayEgressIp,
      platformSmtpConfigured: Boolean(resolvePlatformAuthSmtpConfig()),
      xiaohongshuApiConfigured: isXiaohongshuExecutionConfigured(),
    });
  },

  "user-operational-identity.governance.overview": async ({ client, respond }) => {
    // Domain gate is "any" (D5): the single-valued METHOD_REQUIRED_DOMAIN cannot
    // express platform∪enterprise, so authorization is enforced here via
    // resolveQueryScope (derived from the trusted session, never request params).
    const scope = await resolveQueryScope(client);
    const [store, platformStore] = await Promise.all([
      loadUserOperationalIdentityStore(),
      loadPlatformAuthStoreBestEffort(),
    ]);
    const overview = listUserOperationalIdentityActivityForScope({ store, scope, platformStore });
    respond(true, overview);
  },

  "user-operational-identity.providers.catalog": async ({ client, respond }) => {
    const ownerId = await requirePlatformAuthUserId(client, respond);
    if (!ownerId) {
      return;
    }
    respond(true, {
      ownerId,
      catalog: listUserOperationalIdentityProviderCatalog(),
    });
  },

  "user-operational-identity.create": async ({ client, params, respond }) => {
    const ownerId = await requirePlatformAuthUserId(client, respond);
    if (!ownerId) {
      return;
    }
    const oauthSessionId = stringValue(params.oauthSessionId);
    const displayName = stringValue(params.displayName);
    const provider = stringValue(params.provider);
    const credentialHandleId = stringValue(params.credentialHandleId);
    const nowIso = new Date().toISOString();
    if (oauthSessionId) {
      const actorTenantId = await resolveActorTenantId(client);
      const result = await withActorUserOiWriteLock(client, ownerId, (store) => {
        const session = getUserOperationalIdentityOAuthSession(store, ownerId, oauthSessionId);
        if (!session || session.status !== "completed" || !session.credentialHandleId) {
          return {
            ok: false as const,
            code: "USER_IDENTITY_OAUTH_SESSION_INVALID",
            error: "Completed OAuth session is required before creating identity.",
          };
        }
        if (session.identityId) {
          const identity = store.identities[session.identityId];
          if (identity) {
            refreshContinuationsInStore({ store, ownerId, nowIso, client });
            return { ok: true as const, identity };
          }
        }
        const registered = registerUserOperationalIdentity({
          store,
          ownerId,
          displayName: displayName || session.displayName || session.provider,
          provider: session.provider,
          credentialHandleId: session.credentialHandleId,
          externalAccountId: session.externalAccountId,
          tenantId: session.tenantId ?? actorTenantId,
          nowIso,
          skipPlaceholderSecret: true,
        });
        if (registered.ok) {
          session.identityId = registered.identity.identityId;
          refreshContinuationsInStore({ store, ownerId, nowIso, client });
        }
        return registered;
      });
      if (!result.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, result.error, { details: { code: result.code } }),
        );
        return;
      }
      respond(true, { ownerId, identity: result.identity });
      return;
    }
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        "Use user-operational-identity.oauth.start or user-operational-identity.credentials.bind to bind credentials; manual credentialHandleId is not allowed.",
        { details: { code: "USER_IDENTITY_OAUTH_REQUIRED" } },
      ),
    );
    void credentialHandleId;
    void provider;
  },

  "user-operational-identity.credentials.bind": async ({ client, params, respond }) => {
    const ownerId = await requirePlatformAuthUserId(client, respond);
    if (!ownerId) {
      return;
    }
    const provider = stringValue(params.provider);
    const displayName = stringValue(params.displayName);
    const appId = stringValue(params.appId) || undefined;
    const appSecret = stringValue(params.appSecret) || undefined;
    const accountHandle = stringValue(params.accountHandle) || undefined;
    const accessToken = stringValue(params.accessToken) || undefined;
    const identityId = stringValue(params.identityId) || undefined;
    const smtpFrom = stringValue(params.smtpFrom) || undefined;
    const smtpHost = stringValue(params.smtpHost) || undefined;
    const smtpPort = stringValue(params.smtpPort) || undefined;
    const smtpUser = stringValue(params.smtpUser) || undefined;
    const smtpPass = stringValue(params.smtpPass) || undefined;
    const smtpSecure = stringValue(params.smtpSecure) || undefined;
    const smtpStartTls = stringValue(params.smtpStartTls) || undefined;
    const smtpReplyTo = stringValue(params.smtpReplyTo) || undefined;
    const imapHost = stringValue(params.imapHost) || undefined;
    const imapPort = stringValue(params.imapPort) || undefined;
    const imapUser = stringValue(params.imapUser) || undefined;
    const usePlatformSmtp =
      params.usePlatformSmtp === true ||
      params.usePlatformSmtp === 1 ||
      params.usePlatformSmtp === "1" ||
      params.usePlatformSmtp === "true";
    if (!provider) {
      respondInvalid(respond, "provider is required");
      return;
    }
    if (!displayName) {
      respondInvalid(respond, "displayName is required");
      return;
    }
    const nowIso = new Date().toISOString();
    const result = await withActorUserOiWriteLock(client, ownerId, (store) =>
      bindUserOperationalIdentityManualCredentials({
        store,
        ownerId,
        provider,
        displayName,
        appId,
        appSecret,
        accountHandle,
        accessToken,
        identityId,
        smtp: {
          from: smtpFrom || accountHandle || "",
          host: smtpHost,
          port: smtpPort,
          user: smtpUser,
          pass: smtpPass || accessToken || appSecret,
          secure: smtpSecure,
          startTls: smtpStartTls,
          replyTo: smtpReplyTo,
          usePlatformSmtp,
          imapHost,
          imapPort,
          imapUser,
        },
        nowIso,
      }),
    );
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.error, { details: { code: result.code } }),
      );
      return;
    }
    respond(true, {
      ownerId,
      identity: result.identity,
      credentialHandleId: result.credentialHandleId,
      ...(result.grantedAgentId ? { grantedAgentId: result.grantedAgentId } : {}),
    });
  },

  "user-operational-identity.credentials.verify": async ({ client, params, respond }) => {
    const ownerId = await requirePlatformAuthUserId(client, respond);
    if (!ownerId) {
      return;
    }
    const identityId = stringValue(params.identityId);
    if (!identityId) {
      respondInvalid(respond, "identityId is required");
      return;
    }
    const nowIso = new Date().toISOString();
    const result = await withActorUserOiWriteLock(client, ownerId, (store) =>
      verifyUserOperationalIdentityCredentials({
        store,
        ownerId,
        identityId,
        nowIso,
      }),
    );
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.error, { details: { code: result.code } }),
      );
      return;
    }
    respond(true, {
      ownerId,
      identity: result.identity,
      provider: result.provider,
      verified: true,
    });
  },

  "user-operational-identity.revoke": async ({ client, params, respond }) => {
    const ownerId = await requirePlatformAuthUserId(client, respond);
    if (!ownerId) {
      return;
    }
    const identityId = stringValue(params.identityId);
    if (!identityId) {
      respondInvalid(respond, "identityId is required");
      return;
    }
    const nowIso = new Date().toISOString();
    const result = await withActorUserOiWriteLock(client, ownerId, async (store) => {
      const identity = getUserOperationalIdentity(store, ownerId, identityId);
      if (identity?.provider === "feishu-personal") {
        return withUserOperationalIdentityCredentialSecretStoreWriteLock((secretStore) =>
          disconnectFeishuEmployeeConnection({
            store,
            secretStore,
            ownerId,
            identityId,
            nowIso,
          }),
        );
      }
      return revokeUserOperationalIdentity({ store, ownerId, identityId, nowIso });
    });
    if (!result.ok) {
      const error = "error" in result ? result.error : result.message;
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, error, { details: { code: result.code } }),
      );
      return;
    }
    if ("identity" in result) {
      respond(true, { ownerId, identity: result.identity });
      return;
    }
    respond(true, {
      ownerId,
      identityId: result.identityId,
      localCredentialsDeleted: result.localCredentialsDeleted === true,
      platformRevokeRecorded: result.platformRevokeRecorded === true,
      message: result.message,
    });
  },

  "user-operational-identity.reauthorize": async ({ client, params, respond }) => {
    const ownerId = await requirePlatformAuthUserId(client, respond);
    if (!ownerId) {
      return;
    }
    const identityId = stringValue(params.identityId);
    if (!identityId) {
      respondInvalid(respond, "identityId is required");
      return;
    }
    const nowIso = new Date().toISOString();
    const actorTenantId = await resolveActorTenantId(client);
    const result = await withActorUserOiWriteLock(client, ownerId, async (store) => {
      const identity = getUserOperationalIdentity(store, ownerId, identityId);
      if (!identity || identity.revokedAt) {
        return {
          ok: false as const,
          code: "USER_IDENTITY_NOT_FOUND",
          error: "Identity not found.",
        };
      }
      if (isUserOperationalIdentityProviderManualAuth(identity.provider)) {
        return {
          ok: true as const,
          authMode: "manual" as const,
          identity,
        };
      }
      if (isUserOperationalIdentityProviderQrChannelAuth(identity.provider)) {
        return {
          ok: true as const,
          authMode: "qr_channel" as const,
          identity,
        };
      }
      if (identity.provider === "feishu-personal") {
        const redirectUri = stringValue(params.callbackOrigin)
          ? buildUserOperationalIdentityOAuthCallbackUrl({
              origin: stringValue(params.callbackOrigin),
              basePath: stringValue(params.basePath) || undefined,
            })
          : "";
        const started = await startFeishuEmployeeOAuth({
          store,
          ownerId,
          tenantId: identity.tenantId ?? actorTenantId,
          redirectUri,
          displayName: identity.displayName,
          identityId,
          nowIso,
        });
        if (!started.ok) {
          return started;
        }
        return {
          ok: true as const,
          authMode: "oauth" as const,
          identity,
          oauth: {
            session: started.session,
            authorizeUrl: started.authorizeUrl,
            simulateAllowed: false as const,
            callbackUrl: redirectUri || null,
          },
        };
      }
      const oauth = startUserOperationalIdentityOAuthSession({
        store,
        ownerId,
        provider: identity.provider,
        displayName: identity.displayName,
        identityId,
        tenantId: identity.tenantId ?? actorTenantId,
        returnPath: stringValue(params.returnPath) || undefined,
        callbackOrigin: stringValue(params.callbackOrigin) || undefined,
        basePath: stringValue(params.basePath) || undefined,
        nowIso,
      });
      if (!oauth.ok) {
        return oauth;
      }
      return { ok: true as const, authMode: "oauth" as const, identity, oauth };
    });
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.error, { details: { code: result.code } }),
      );
      return;
    }
    if (result.authMode === "manual" || result.authMode === "qr_channel") {
      respond(true, {
        ownerId,
        identityId,
        purpose: "reauthorize",
        authMode: result.authMode,
        provider: result.identity.provider,
        displayName: result.identity.displayName,
        externalAccountId: result.identity.externalAccountId,
      });
      return;
    }
    respond(true, {
      ownerId,
      identityId,
      purpose: "reauthorize",
      authMode: "oauth",
      sessionId: result.oauth.session.sessionId,
      state: result.oauth.session.state,
      mode: result.oauth.session.mode,
      authorizeUrl: result.oauth.authorizeUrl,
      simulateAllowed: result.oauth.simulateAllowed,
      callbackUrl: result.oauth.callbackUrl,
      expiresAt: result.oauth.session.expiresAt,
    });
  },

  "user-operational-identity.history.list": async ({ client, params, respond }) => {
    const ownerId = await requirePlatformAuthUserId(client, respond);
    if (!ownerId) {
      return;
    }
    const limit = Number(params.limit ?? 20);
    const identityId = stringValue(params.identityId);
    const since = stringValue(params.since);
    const events = await withActorUserOiWriteLock(client, ownerId, (store) =>
      listUserOperationalIdentityUsageEvents(store, ownerId, Number.isFinite(limit) ? limit : 20, {
        identityId: identityId || undefined,
        since: since || undefined,
      }),
    );
    respond(true, { ownerId, events });
  },

  "user-operational-identity.grants.upsert": async ({ client, params, respond }) => {
    const ownerId = await requirePlatformAuthUserId(client, respond);
    if (!ownerId) {
      return;
    }
    const identityId = stringValue(params.identityId);
    const agentId = stringValue(params.agentId);
    const clientAgentScope =
      params.agentScope === "owned" ||
      params.agentScope === "shared" ||
      params.agentScope === "group"
        ? params.agentScope
        : null;
    const grantMode =
      params.grantMode === "auto" || params.grantMode === "explicit" ? params.grantMode : null;
    if (!identityId || !agentId || !clientAgentScope || !grantMode) {
      respondInvalid(respond, "identityId, agentId, agentScope, and grantMode are required");
      return;
    }
    const sessionKey = stringValue(params.sessionKey) || null;
    const trustedAgentScope = resolveTrustedAgentScope({ client, ownerId, agentId, sessionKey });
    if (clientAgentScope !== trustedAgentScope) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "该数字人的归属类型与服务器认定不一致，请刷新后重试。",
          {
            details: {
              code: "USER_IDENTITY_AGENT_SCOPE_MISMATCH",
              clientAgentScope,
              trustedAgentScope,
            },
          },
        ),
      );
      return;
    }
    const enterpriseAuthz = await loadEmployeeOperationalAuthorization(ownerId, client);
    let seatStore: Awaited<ReturnType<typeof loadEnterpriseSeatAssetsStore>> | null = null;
    try {
      const storePath = await resolveControlPlaneStorePathForClient(
        client,
        TENANT_SEAT_ASSETS_FILE,
      );
      seatStore = await loadEnterpriseSeatAssetsStore(storePath);
    } catch {
      seatStore = null;
    }
    if (
      !isPersonalIdentityGrantEligibleForAgentScope({
        ownerId,
        currentUserEmail: client?.user,
        agentId,
        agentScope: trustedAgentScope,
        tenantId: enterpriseAuthz.tenantId,
        seatStore,
      })
    ) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "Personal identity can only be granted to owned robots or seat-owned shared robots.",
          {
            details: { code: "USER_IDENTITY_GRANT_NOT_SEAT_OWNED" },
          },
        ),
      );
      return;
    }
    const nowIso = new Date().toISOString();
    const result = await withActorUserOiWriteLock(client, ownerId, async (store) => {
      const identity = getUserOperationalIdentity(store, ownerId, identityId);
      let oauthScope: string | null | undefined;
      if (identity?.provider === "x-twitter") {
        const secret = await loadUserOperationalIdentityCredentialSecretForHandle({
          handleId: identity.credentialHandleId,
          ownerId,
        });
        oauthScope = secret?.metadata?.scope ?? null;
      }
      const workplace = identity?.provider === "feishu-personal";
      const updated = upsertUserOperationalIdentityGrant({
        store,
        ownerId,
        identityId,
        agentId,
        agentScope: trustedAgentScope,
        grantMode: workplace ? "explicit" : grantMode,
        allowedActions: parseStringArray(params.allowedActions),
        oauthScope,
        tenantId: stringValue(params.tenantId) || enterpriseAuthz.tenantId || undefined,
        seatId: stringValue(params.seatId) || enterpriseAuthz.seatId || undefined,
        confirmExplicit: workplace || params.confirmExplicit === true,
        nowIso,
      });
      if (updated.ok) {
        refreshContinuationsInStore({ store, ownerId, nowIso, client });
      }
      return updated;
    });
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.error, { details: { code: result.code } }),
      );
      return;
    }
    respond(true, { ownerId, grant: result.grant, agentScope: trustedAgentScope });
  },

  "user-operational-identity.grants.revoke": async ({ client, params, respond }) => {
    const ownerId = await requirePlatformAuthUserId(client, respond);
    if (!ownerId) {
      return;
    }
    const grantId = stringValue(params.grantId);
    if (!grantId) {
      respondInvalid(respond, "grantId is required");
      return;
    }
    const nowIso = new Date().toISOString();
    const result = await withActorUserOiWriteLock(client, ownerId, (store) =>
      revokeUserOperationalIdentityGrant({ store, ownerId, grantId, nowIso }),
    );
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.error, { details: { code: result.code } }),
      );
      return;
    }
    respond(true, { ownerId, grant: result.grant });
  },

  "user-operational-identity.access.resolve": async ({ client, params, respond }) => {
    const ownerId = await requirePlatformAuthUserId(client, respond);
    if (!ownerId) {
      return;
    }
    const provider = stringValue(params.provider);
    const action = stringValue(params.action);
    const agentId = stringValue(params.agentId);
    if (!provider || !action || !agentId) {
      respondInvalid(respond, "provider, action, and agentId are required");
      return;
    }
    const nowIso = new Date().toISOString();
    // Task 3.2: apply the enterprise authorization gate here too (advisory parity
    // with the execution path); authoritative tenant/seat override untrusted params.
    const enterpriseAuthorization = await loadEmployeeOperationalAuthorization(ownerId);
    const result = await withActorUserOiWriteLock(client, ownerId, (store) =>
      resolveUserOperationalIdentity({
        store,
        provider,
        action,
        currentUserId: ownerId,
        currentUserEmail: client?.user,
        currentAgentId: agentId,
        currentSeatId: stringValue(params.seatId) || undefined,
        tenantId: stringValue(params.tenantId) || undefined,
        sessionKey: stringValue(params.sessionKey) || null,
        nowIso,
        enterpriseAuthorization,
      }),
    );
    respond(true, { ownerId, ...result });
  },

  "user-operational-identity.execute": async ({ client, params, respond }) => {
    const provider = stringValue(params.provider);
    const action = stringValue(params.action);
    const agentId = stringValue(params.agentId);
    const sessionKey = stringValue(params.sessionKey) || null;
    if (!provider || !action || !agentId) {
      respondInvalid(respond, "provider, action, and agentId are required");
      return;
    }
    const payload =
      params.payload && typeof params.payload === "object" && !Array.isArray(params.payload)
        ? (params.payload as Record<string, unknown>)
        : {};
    const result = await executeUserOperationalIdentityRuntimeAction({
      client,
      provider,
      action,
      payload,
      agentId,
      sessionKey,
    });
    if (!result.ok) {
      respond(true, {
        executed: false,
        code: result.code,
        message: result.message,
        ownerId: result.scope?.ownerId ?? null,
        agentId: result.scope?.agentId ?? agentId,
        needsBinding: result.needsBinding ?? false,
        needsGrantConfirmation: result.needsGrantConfirmation ?? false,
        bindingRequestId: result.bindingRequestId ?? null,
      });
      return;
    }
    respond(true, {
      executed: true,
      ownerId: result.scope.ownerId,
      agentId: result.scope.agentId,
      identityId: result.access.identity.identityId,
      provider: result.execution.provider,
      action: result.execution.action,
      simulated: result.execution.simulated,
      credential: result.execution.credential,
      output: result.execution.output,
    });
  },

  "user-operational-identity.access.list-for-agent": async ({ client, params, respond }) => {
    const ownerId = await requirePlatformAuthUserId(client, respond);
    if (!ownerId) {
      return;
    }
    const agentId = stringValue(params.agentId);
    if (!agentId) {
      respondInvalid(respond, "agentId is required");
      return;
    }
    const sessionKey = stringValue(params.sessionKey) || null;
    const agentScope = resolveTrustedAgentScope({ client, ownerId, agentId, sessionKey });
    const entries = await withActorUserOiWriteLock(client, ownerId, (store) =>
      listUserOperationalIdentityAccessForAgent({ store, ownerId, agentId }),
    );
    respond(true, { ownerId, agentId, agentScope, entries });
  },

  "user-operational-identity.binding-request.create": async ({ client, params, respond }) => {
    const ownerId = await requirePlatformAuthUserId(client, respond);
    if (!ownerId) {
      return;
    }
    const agentId = stringValue(params.agentId);
    const provider = stringValue(params.provider);
    const requestedAction = stringValue(params.requestedAction);
    if (!agentId || !provider || !requestedAction) {
      respondInvalid(respond, "agentId, provider, and requestedAction are required");
      return;
    }
    if (!parseUserOperationalIdentityProvider(provider)) {
      respondInvalid(respond, "provider is invalid");
      return;
    }
    const sessionKey = stringValue(params.sessionKey) || null;
    const agentScope = resolveTrustedAgentScope({ client, ownerId, agentId, sessionKey });
    const nowIso = new Date().toISOString();
    const result = await withActorUserOiWriteLock(client, ownerId, (store) =>
      createUserOperationalIdentityBindingRequest({
        store,
        ownerId,
        agentId,
        agentScope,
        provider,
        requestedAction,
        tenantId: stringValue(params.tenantId) || undefined,
        seatId: stringValue(params.seatId) || undefined,
        sessionKey,
        nowIso,
      }),
    );
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.error, { details: { code: result.code } }),
      );
      return;
    }
    respond(true, { ownerId, request: result.request, agentScope });
  },

  "user-operational-identity.binding-request.get": async ({ client, params, respond }) => {
    const ownerId = await requirePlatformAuthUserId(client, respond);
    if (!ownerId) {
      return;
    }
    const requestId = stringValue(params.requestId);
    if (!requestId) {
      respondInvalid(respond, "requestId is required");
      return;
    }
    const request = await withActorUserOiWriteLock(client, ownerId, (store) =>
      getUserOperationalIdentityBindingRequest(store, ownerId, requestId),
    );
    if (!request) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "Binding request not found."),
      );
      return;
    }
    respond(true, { ownerId, request });
  },

  "user-operational-identity.binding-request.cancel": async ({ client, params, respond }) => {
    const ownerId = await requirePlatformAuthUserId(client, respond);
    if (!ownerId) {
      return;
    }
    const requestId = stringValue(params.requestId);
    if (!requestId) {
      respondInvalid(respond, "requestId is required");
      return;
    }
    const nowIso = new Date().toISOString();
    const result = await withActorUserOiWriteLock(client, ownerId, (store) =>
      cancelUserOperationalIdentityBindingRequest({ store, ownerId, requestId, nowIso }),
    );
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.error, { details: { code: result.code } }),
      );
      return;
    }
    respond(true, { ownerId, request: result.request });
  },

  "user-operational-identity.binding-request.complete": async ({ client, params, respond }) => {
    const ownerId = await requirePlatformAuthUserId(client, respond);
    if (!ownerId) {
      return;
    }
    const requestId = stringValue(params.requestId);
    if (!requestId) {
      respondInvalid(respond, "requestId is required");
      return;
    }
    const nowIso = new Date().toISOString();
    const result = await withActorUserOiWriteLock(client, ownerId, (store) =>
      completeUserOperationalIdentityBindingRequest({
        store,
        ownerId,
        requestId,
        nowIso,
        currentUserEmail: client?.user,
      }),
    );
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.error, { details: { code: result.code } }),
      );
      return;
    }
    respond(true, { ownerId, request: result.request });
  },

  "user-operational-identity.binding-request.list-pending": async ({ client, respond }) => {
    const ownerId = await resolveOptionalOwnerId(client);
    if (!ownerId) {
      // Task 1.5: 无会话空快照（只读），不报错。
      respond(true, { ownerId: null, needsLogin: true, requests: [] });
      return;
    }
    const nowIso = new Date().toISOString();
    const requests = await withActorUserOiWriteLock(client, ownerId, (store) =>
      listPendingUserOperationalIdentityBindingRequests(store, ownerId, nowIso),
    );
    respond(true, { ownerId, requests });
  },

  "user-operational-identity.continuation.create": async ({ client, params, respond }) => {
    const ownerId = await requirePlatformAuthUserId(client, respond);
    if (!ownerId) {
      return;
    }
    const agentId = stringValue(params.agentId);
    const provider = stringValue(params.provider);
    const requestedAction = stringValue(params.requestedAction);
    if (!agentId || !provider || !requestedAction) {
      respondInvalid(respond, "agentId, provider, and requestedAction are required");
      return;
    }
    const sessionKey = stringValue(params.sessionKey) || null;
    const agentScope = resolveTrustedAgentScope({ client, ownerId, agentId, sessionKey });
    const nowIso = new Date().toISOString();
    const result = await withActorUserOiWriteLock(client, ownerId, (store) =>
      createUserOperationalIdentityContinuation({
        store,
        ownerId,
        agentId,
        agentScope,
        provider,
        requestedAction,
        sessionKey,
        workbenchModule: stringValue(params.workbenchModule) || null,
        resumeMessage: stringValue(params.resumeMessage) || undefined,
        resumeIntentId: stringValue(params.resumeIntentId) || undefined,
        executionPayload:
          params.executionPayload && typeof params.executionPayload === "object"
            ? (params.executionPayload as Record<string, unknown>)
            : undefined,
        requiredProviders: parseStringArray(params.requiredProviders),
        bindingRequestId: stringValue(params.bindingRequestId) || undefined,
        autoResume: params.autoResume !== false,
        nowIso,
      }),
    );
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.error, { details: { code: result.code } }),
      );
      return;
    }
    respond(true, { ownerId, continuation: result.continuation, agentScope });
  },

  "user-operational-identity.continuation.get": async ({ client, params, respond }) => {
    const ownerId = await requirePlatformAuthUserId(client, respond);
    if (!ownerId) {
      return;
    }
    const continuationToken = stringValue(params.continuationToken);
    if (!continuationToken) {
      respondInvalid(respond, "continuationToken is required");
      return;
    }
    const nowIso = new Date().toISOString();
    const continuation = await withActorUserOiWriteLock(client, ownerId, (store) => {
      refreshContinuationsInStore({ store, ownerId, nowIso, client });
      return getUserOperationalIdentityContinuationByToken(store, ownerId, continuationToken);
    });
    if (!continuation) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Continuation not found."));
      return;
    }
    respond(true, { ownerId, continuation });
  },

  "user-operational-identity.continuation.list-pending": async ({ client, respond }) => {
    const ownerId = await resolveOptionalOwnerId(client);
    if (!ownerId) {
      // Task 1.5: 无会话空快照（只读），不报错。
      respond(true, { ownerId: null, needsLogin: true, continuations: [] });
      return;
    }
    const nowIso = new Date().toISOString();
    const continuations = await withActorUserOiWriteLock(client, ownerId, (store) =>
      listPendingUserOperationalIdentityContinuations(store, ownerId, nowIso),
    );
    respond(true, { ownerId, continuations });
  },

  "user-operational-identity.continuation.complete-oauth": async ({ client, params, respond }) => {
    const ownerId = await requirePlatformAuthUserId(client, respond);
    if (!ownerId) {
      return;
    }
    const continuationToken = stringValue(params.continuationToken);
    const provider = stringValue(params.provider);
    if (!continuationToken || !provider) {
      respondInvalid(respond, "continuationToken and provider are required");
      return;
    }
    const nowIso = new Date().toISOString();
    const result = await withActorUserOiWriteLock(client, ownerId, (store) =>
      completeOAuthForUserOperationalIdentityContinuation({
        store,
        ownerId,
        continuationToken,
        provider,
        nowIso,
        currentUserEmail: client?.user,
      }),
    );
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.error, { details: { code: result.code } }),
      );
      return;
    }
    respond(true, { ownerId, continuation: result.continuation });
  },

  "user-operational-identity.continuation.resume": async ({ client, params, respond }) => {
    const ownerId = await requirePlatformAuthUserId(client, respond);
    if (!ownerId) {
      return;
    }
    const continuationToken = stringValue(params.continuationToken);
    if (!continuationToken) {
      respondInvalid(respond, "continuationToken is required");
      return;
    }
    const nowIso = new Date().toISOString();
    const result = await withActorUserOiWriteLock(client, ownerId, (store) =>
      resumeUserOperationalIdentityContinuation({
        store,
        ownerId,
        continuationToken,
        nowIso,
        currentUserEmail: client?.user,
        force: params.force === true,
      }),
    );
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.error, { details: { code: result.code } }),
      );
      return;
    }
    respond(true, { ownerId, continuation: result.continuation, resume: result.resume });
  },

  "user-operational-identity.continuation.cancel": async ({ client, params, respond }) => {
    const ownerId = await requirePlatformAuthUserId(client, respond);
    if (!ownerId) {
      return;
    }
    const continuationToken = stringValue(params.continuationToken);
    if (!continuationToken) {
      respondInvalid(respond, "continuationToken is required");
      return;
    }
    const nowIso = new Date().toISOString();
    const result = await withActorUserOiWriteLock(client, ownerId, (store) =>
      cancelUserOperationalIdentityContinuation({ store, ownerId, continuationToken, nowIso }),
    );
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.error, { details: { code: result.code } }),
      );
      return;
    }
    respond(true, { ownerId, continuation: result.continuation });
  },

  "user-operational-identity.wechat-personal.status": async ({ client, respond, context }) => {
    const ownerId = await requirePlatformAuthUserId(client, respond);
    if (!ownerId) {
      return;
    }
    const probe = await probeWechatPersonalWorker({
      nodeRegistry: context.nodeRegistry,
      allowLocalSidecar: Boolean(client?.upgradeRequestLocalDirect),
    });
    respond(true, {
      ownerId,
      workerOnline: probe.online,
      loggedIn: Boolean(probe.loggedIn),
      wxid: probe.wxid,
      nickname: probe.nickname,
      error: probe.error,
    });
  },

  "user-operational-identity.wechat-personal.qr.start": async ({
    client,
    params,
    respond,
    context,
  }) => {
    const ownerId = await requirePlatformAuthUserId(client, respond);
    if (!ownerId) {
      return;
    }
    const accountId = stringValue(params.accountId) || undefined;
    const started = await startWechatLoginWithQr({
      accountId,
      force: Boolean(params.force),
      timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : undefined,
      nodeRegistry: context.nodeRegistry,
      allowLocalSidecar: Boolean(client?.upgradeRequestLocalDirect),
    });
    if (!started.qrDataUrl) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, started.message, {
          details: { code: "USER_IDENTITY_WECHAT_PERSONAL_WORKER_OFFLINE" },
        }),
      );
      return;
    }
    respond(true, {
      ownerId,
      qrDataUrl: started.qrDataUrl,
      message: started.message,
      status: "scanning",
    });
  },

  "user-operational-identity.wechat-personal.qr.wait": async ({
    client,
    params,
    respond,
    context,
  }) => {
    const ownerId = await requirePlatformAuthUserId(client, respond);
    if (!ownerId) {
      return;
    }
    const accountId = stringValue(params.accountId) || undefined;
    const waited = await waitForWechatLogin({
      accountId,
      timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : undefined,
      nodeRegistry: context.nodeRegistry,
      allowLocalSidecar: Boolean(client?.upgradeRequestLocalDirect),
    });
    if (!waited.connected || !waited.wxid) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, waited.message, {
          details: { code: "USER_IDENTITY_WECHAT_PERSONAL_QR_PENDING" },
        }),
      );
      return;
    }
    const nowIso = new Date().toISOString();
    const actorTenantId = await resolveActorTenantId(client);
    const displayName = stringValue(params.displayName) || waited.nickname || waited.wxid;
    const agentId = stringValue(params.agentId) || undefined;
    const result = await withActorUserOiWriteLock(client, ownerId, (store) =>
      bindWechatPersonalIdentityFromWxid({
        store,
        ownerId,
        displayName,
        wxid: waited.wxid ?? "",
        agentId,
        accountId,
        tenantId: actorTenantId,
        nowIso,
      }),
    );
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.error, { details: { code: result.code } }),
      );
      return;
    }
    respond(true, {
      ownerId,
      connected: true,
      wxid: waited.wxid,
      nickname: waited.nickname,
      message: waited.message,
      identity: result.identity,
      grant: result.grant,
      status: "logged_in",
    });
  },

  "user-operational-identity.wechat-personal.bind-existing": async ({
    client,
    params,
    respond,
    context,
  }) => {
    const ownerId = await requirePlatformAuthUserId(client, respond);
    if (!ownerId) {
      return;
    }
    const nowIso = new Date().toISOString();
    const actorTenantId = await resolveActorTenantId(client);
    const accountId = stringValue(params.accountId) || undefined;
    const displayName = stringValue(params.displayName) || undefined;
    const agentId = stringValue(params.agentId) || undefined;
    const result = await bindExistingWechatPersonalNativeSession({
      writeLock: (fn) => withActorUserOiWriteLock(client, ownerId, fn),
      ownerId,
      displayName,
      agentId,
      accountId,
      tenantId: actorTenantId,
      nowIso,
      nodeRegistry: context.nodeRegistry,
      allowLocalSidecar: Boolean(client?.upgradeRequestLocalDirect),
    });
    if (!result.ok) {
      const unavailable =
        result.code === USER_IDENTITY_WECHAT_PERSONAL_WORKER_OFFLINE ||
        result.code === USER_IDENTITY_WECHAT_PERSONAL_NOT_LOGGED_IN;
      respond(
        false,
        undefined,
        errorShape(
          unavailable ? ErrorCodes.UNAVAILABLE : ErrorCodes.INVALID_REQUEST,
          result.error,
          {
            details: { code: result.code },
          },
        ),
      );
      return;
    }
    respond(true, {
      ownerId,
      connected: true,
      wxid: result.wxid,
      nickname: result.nickname,
      identity: result.identity,
      grant: result.grant,
    });
  },

  "user-operational-identity.oauth.start": async ({ client, params, respond }) => {
    const ownerId = await requirePlatformAuthUserId(client, respond);
    if (!ownerId) {
      return;
    }
    const provider = stringValue(params.provider);
    if (!provider) {
      respondInvalid(respond, "provider is required");
      return;
    }
    const nowIso = new Date().toISOString();
    const actorTenantId = await resolveActorTenantId(client);
    const result = await withActorUserOiWriteLock(client, ownerId, async (store) => {
      if (provider === "feishu-personal") {
        const redirectUri = stringValue(params.callbackOrigin)
          ? buildUserOperationalIdentityOAuthCallbackUrl({
              origin: stringValue(params.callbackOrigin),
              basePath: stringValue(params.basePath) || undefined,
            })
          : "";
        const started = await startFeishuEmployeeOAuth({
          store,
          ownerId,
          tenantId: actorTenantId,
          redirectUri,
          displayName: stringValue(params.displayName) || undefined,
          identityId: stringValue(params.identityId) || undefined,
          nowIso,
        });
        if (!started.ok) {
          return { ok: false as const, code: started.code, error: started.error };
        }
        return {
          ok: true as const,
          session: started.session,
          authorizeUrl: started.authorizeUrl,
          simulateAllowed: false,
          callbackUrl: redirectUri || null,
        };
      }
      return startUserOperationalIdentityOAuthSession({
        store,
        ownerId,
        provider,
        displayName: stringValue(params.displayName) || undefined,
        identityId: stringValue(params.identityId) || undefined,
        tenantId: actorTenantId,
        continuationToken: stringValue(params.continuationToken) || undefined,
        bindingRequestId: stringValue(params.bindingRequestId) || undefined,
        returnPath: stringValue(params.returnPath) || undefined,
        callbackOrigin: stringValue(params.callbackOrigin) || undefined,
        basePath: stringValue(params.basePath) || undefined,
        nowIso,
      });
    });
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.error, { details: { code: result.code } }),
      );
      return;
    }
    respond(true, {
      ownerId,
      sessionId: result.session.sessionId,
      state: result.session.state,
      mode: result.session.mode,
      authorizeUrl: result.authorizeUrl,
      simulateAllowed: result.simulateAllowed,
      callbackUrl: result.callbackUrl,
      expiresAt: result.session.expiresAt,
    });
  },

  "user-operational-identity.oauth.status": async ({ client, params, respond }) => {
    const ownerId = await requirePlatformAuthUserId(client, respond);
    if (!ownerId) {
      return;
    }
    const sessionId = stringValue(params.sessionId);
    if (!sessionId) {
      respondInvalid(respond, "sessionId is required");
      return;
    }
    const session = await withActorUserOiWriteLock(client, ownerId, (store) =>
      getUserOperationalIdentityOAuthSession(store, ownerId, sessionId),
    );
    if (!session) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "OAuth session not found."));
      return;
    }
    respond(true, {
      ownerId,
      session: {
        sessionId: session.sessionId,
        provider: session.provider,
        mode: session.mode,
        status: session.status,
        credentialHandleId: session.credentialHandleId,
        identityId: session.identityId,
        externalAccountId: session.externalAccountId,
        expiresAt: session.expiresAt,
        completedAt: session.completedAt,
      },
    });
  },

  "user-operational-identity.oauth.simulate-complete": async ({ client, params, respond }) => {
    const ownerId = await requirePlatformAuthUserId(client, respond);
    if (!ownerId) {
      return;
    }
    const sessionId = stringValue(params.sessionId);
    if (!sessionId) {
      respondInvalid(respond, "sessionId is required");
      return;
    }
    const nowIso = new Date().toISOString();
    const actorTenantId = await resolveActorTenantId(client);
    const storePath = await resolveUserOperationalIdentityStorePathForClient(client);
    const result = await simulateCompleteUserOperationalIdentityOAuthSession({
      ownerId,
      sessionId,
      tenantId: actorTenantId,
      storePath,
      externalAccountId: stringValue(params.externalAccountId) || undefined,
      simulatedSecret: stringValue(params.simulatedSecret) || undefined,
      nowIso,
      currentUserEmail: client?.user,
    });
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.error, { details: { code: result.code } }),
      );
      return;
    }
    await withActorUserOiWriteLock(client, ownerId, (store) => {
      refreshContinuationsInStore({ store, ownerId, nowIso, client });
      return store;
    });
    respond(true, {
      ownerId,
      sessionId: result.session.sessionId,
      credentialHandleId: result.credentialHandleId,
      identityId: result.identityId,
      continuationCompleted: result.continuationCompleted,
      status: result.session.status,
    });
  },

  "user-operational-identity.feishu-employee.refresh": async ({ client, params, respond }) => {
    const ownerId = await requirePlatformAuthUserId(client, respond);
    if (!ownerId) {
      return;
    }
    const identityId = stringValue(params.identityId);
    if (!identityId) {
      respondInvalid(respond, "identityId is required");
      return;
    }
    const tenantId = await resolveActorTenantId(client);
    if (!tenantId) {
      respondInvalid(respond, "企业尚未开通");
      return;
    }
    const [identityStorePath, secretStorePath] = await Promise.all([
      resolveUserOperationalIdentityStorePathForClient(client),
      resolveUserOperationalIdentitySecretsStorePathForClient(client),
    ]);
    const preview = await loadUserOperationalIdentityStore(identityStorePath);
    const existing = preview.identities[identityId];
    if (!existing || existing.ownerId !== ownerId || existing.provider !== "feishu-personal") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "Identity not found.", {
          details: { code: "USER_IDENTITY_NOT_FOUND" },
        }),
      );
      return;
    }
    const result = await renewPersistedFeishuEmployeeConnection({
      ownerId,
      tenantId,
      identityId,
      nowIso: new Date().toISOString(),
      identityStorePath,
      secretStorePath,
    });
    respond(
      result.ok,
      result.ok ? result : undefined,
      result.ok
        ? undefined
        : errorShape(ErrorCodes.INVALID_REQUEST, result.message, {
            details: { code: result.code },
          }),
    );
  },

  "user-operational-identity.feishu-employee.use": async ({ client, params, respond }) => {
    const ownerId = await requirePlatformAuthUserId(client, respond);
    if (!ownerId) {
      return;
    }
    const identityId = stringValue(params.identityId);
    if (!identityId) {
      respondInvalid(respond, "identityId is required");
      return;
    }
    const tenantId = await resolveActorTenantId(client);
    const gate = await loadFeishuEmployeeChannelGate({ tenantId });
    const [identityStorePath, secretStorePath] = await Promise.all([
      resolveUserOperationalIdentityStorePathForClient(client),
      resolveUserOperationalIdentitySecretsStorePathForClient(client),
    ]);
    const [store, secretStore] = await Promise.all([
      loadUserOperationalIdentityStore(identityStorePath),
      loadUserOperationalIdentityCredentialSecretStore(secretStorePath),
    ]);
    const result = allowFeishuEmployeeCredentialUse({
      store,
      secretStore,
      ownerId,
      identityId,
      gate,
      nowIso: new Date().toISOString(),
    });
    const projected = {
      ok: result.ok,
      code: result.code,
      message: result.message,
      identityId: result.identityId,
      authorizationLevel: result.authorizationLevel,
      userGrantedScopes: result.userGrantedScopes,
    };
    respond(
      result.ok,
      result.ok ? projected : undefined,
      result.ok
        ? undefined
        : errorShape(ErrorCodes.INVALID_REQUEST, result.message, {
            details: { code: result.code },
          }),
    );
  },

  "user-operational-identity.oauth.cancel": async ({ client, params, respond }) => {
    const ownerId = await requirePlatformAuthUserId(client, respond);
    if (!ownerId) {
      return;
    }
    const sessionId = stringValue(params.sessionId);
    if (!sessionId) {
      respondInvalid(respond, "sessionId is required");
      return;
    }
    const nowIso = new Date().toISOString();
    const result = await withActorUserOiWriteLock(client, ownerId, (store) =>
      cancelUserOperationalIdentityOAuthSession({ store, ownerId, sessionId, nowIso }),
    );
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, result.error, { details: { code: result.code } }),
      );
      return;
    }
    respond(true, { ownerId, session: result.session });
  },
};
