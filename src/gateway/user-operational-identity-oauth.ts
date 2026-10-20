import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config/config.js";
import { isSharedTenantAddressingEnabled } from "../config/data-space.js";
import { resolveControlUiUserOperationalIdentityBasePath } from "./control-ui-contract.js";
import { resolvePlatformAuthSmtpConfig } from "./platform-auth-email.js";
import type { TenantContext } from "./tenant-context.js";
import {
  assertSafeTenantId,
  resolveTenantLiveRoot,
  resolveTenantUserOperationalIdentityStorePathForContext,
  resolveTenantsRoot,
} from "./tenant-store-paths.js";
import { completeOAuthForUserOperationalIdentityContinuation } from "./user-operational-identity-continuation.js";
import {
  buildUserOperationalIdentityPkcePair,
  getUserOperationalIdentityOAuthAdapter,
  resolveUserOperationalIdentityOAuthAdapterConfig,
} from "./user-operational-identity-oauth-adapters/index.js";
import {
  loadUserOperationalIdentityStore,
  withUserOperationalIdentityStoreWriteLockForOwner,
} from "./user-operational-identity-persistence.js";
import {
  isUserOperationalIdentityProviderManualAuth,
  isUserOperationalIdentityProviderQrChannelAuth,
  parseUserOperationalIdentityProvider,
} from "./user-operational-identity-providers.js";
import { withUserOperationalIdentityCredentialSecretStoreWriteLock } from "./user-operational-identity-secrets-persistence.js";
import {
  getUserOperationalIdentity,
  registerUserOperationalIdentity,
  registerUserOperationalIdentityCredentialHandleFromOAuth,
  rotateUserOperationalIdentityCredential,
} from "./user-operational-identity-store.js";
import type {
  UserOperationalIdentityCredentialSecret,
  UserOperationalIdentityOAuthMode,
  UserOperationalIdentityOAuthSession,
  UserOperationalIdentityProvider,
  UserOperationalIdentityStore,
} from "./user-operational-identity-types.js";

const DEFAULT_OAUTH_SESSION_TTL_MS = 15 * 60 * 1000;
const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";

export type UserOperationalIdentityGithubOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function resolveUserOperationalIdentityGithubOAuthConfig(params?: {
  redirectUri?: string;
}): UserOperationalIdentityGithubOAuthConfig | null {
  const clientId = process.env.OPENBOT_USER_OPERATIONAL_IDENTITY_GITHUB_CLIENT_ID?.trim();
  const clientSecret = process.env.OPENBOT_USER_OPERATIONAL_IDENTITY_GITHUB_CLIENT_SECRET?.trim();
  const redirectUri =
    params?.redirectUri?.trim() ||
    process.env.OPENBOT_USER_OPERATIONAL_IDENTITY_GITHUB_REDIRECT_URI?.trim() ||
    "";
  if (!clientId || !clientSecret || !redirectUri) {
    return null;
  }
  return { clientId, clientSecret, redirectUri };
}

export function resolveUserOperationalIdentityOAuthCallbackPath(basePath?: string): string {
  return `${resolveControlUiUserOperationalIdentityBasePath(basePath)}/oauth/callback`;
}

export function buildUserOperationalIdentityOAuthCallbackUrl(params: {
  origin: string;
  basePath?: string;
}): string {
  const origin = params.origin.trim().replace(/\/+$/, "");
  const callbackPath = resolveUserOperationalIdentityOAuthCallbackPath(params.basePath);
  return `${origin}${callbackPath}`;
}

function resolveOAuthModeForProvider(
  provider: UserOperationalIdentityProvider,
  redirectUri?: string,
): UserOperationalIdentityOAuthMode {
  if (
    provider === "github-personal" &&
    resolveUserOperationalIdentityGithubOAuthConfig({ redirectUri })
  ) {
    return "github_authorization_code";
  }
  const adapter = getUserOperationalIdentityOAuthAdapter(provider);
  if (
    adapter &&
    provider !== "github-personal" &&
    resolveUserOperationalIdentityOAuthAdapterConfig({ provider, redirectUri })
  ) {
    return "adapter_authorization_code";
  }
  return "simulated";
}

function expireStaleOAuthSessions(store: UserOperationalIdentityStore, nowIso: string): void {
  for (const session of Object.values(store.oauthSessions)) {
    if (session.status === "pending" && session.expiresAt <= nowIso) {
      session.status = "expired";
    }
  }
}

export function getUserOperationalIdentityOAuthSession(
  store: UserOperationalIdentityStore,
  ownerId: string,
  sessionId: string,
): UserOperationalIdentityOAuthSession | null {
  const session = store.oauthSessions[sessionId];
  if (!session || session.ownerId !== ownerId) {
    return null;
  }
  return session;
}

export function getUserOperationalIdentityOAuthSessionByState(
  store: UserOperationalIdentityStore,
  state: string,
): UserOperationalIdentityOAuthSession | null {
  const normalized = state.trim();
  if (!normalized) {
    return null;
  }
  return (
    Object.values(store.oauthSessions).find(
      (session) => session.state === normalized && session.status === "pending",
    ) ?? null
  );
}

/** HTTP callback has no client ctx — locate pending OAuth session store by global state scan. */
async function resolveUserOperationalIdentityStoreByState(state: string): Promise<{
  storePath?: string;
  ownerId: string;
  tenantId: string | null;
} | null> {
  const normalized = state.trim();
  if (!normalized) {
    return null;
  }
  const cfg = loadConfig();
  if (!isSharedTenantAddressingEnabled(cfg)) {
    const store = await loadUserOperationalIdentityStore();
    const session = getUserOperationalIdentityOAuthSessionByState(store, normalized);
    return session
      ? {
          storePath: undefined,
          ownerId: session.ownerId,
          tenantId: session.tenantId?.trim() || null,
        }
      : null;
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
    const usersDir = path.join(resolveTenantLiveRoot(tenantId), "users");
    let userIds: string[] = [];
    try {
      userIds = fs.readdirSync(usersDir);
    } catch {
      continue;
    }
    for (const userId of userIds) {
      let storePath: string;
      try {
        const ctx: TenantContext = { tenantId, userId, domain: "employee" };
        storePath = resolveTenantUserOperationalIdentityStorePathForContext(ctx);
      } catch {
        continue;
      }
      const store = await loadUserOperationalIdentityStore(storePath);
      const session = getUserOperationalIdentityOAuthSessionByState(store, normalized);
      if (session && session.ownerId === userId && session.tenantId === tenantId) {
        return {
          storePath,
          ownerId: session.ownerId,
          tenantId,
        };
      }
    }
  }
  const legacyStore = await loadUserOperationalIdentityStore();
  const legacySession = getUserOperationalIdentityOAuthSessionByState(legacyStore, normalized);
  return legacySession
    ? {
        storePath: undefined,
        ownerId: legacySession.ownerId,
        tenantId: legacySession.tenantId?.trim() || null,
      }
    : null;
}

export function startUserOperationalIdentityOAuthSession(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  provider: string;
  displayName?: string;
  identityId?: string;
  /** Managed tenant from call entry; stamped onto the session for callback store routing. */
  tenantId?: string | null;
  continuationToken?: string;
  bindingRequestId?: string;
  returnPath?: string;
  callbackOrigin?: string;
  basePath?: string;
  nowIso: string;
}):
  | {
      ok: true;
      session: UserOperationalIdentityOAuthSession;
      authorizeUrl: string | null;
      simulateAllowed: boolean;
      callbackUrl: string | null;
    }
  | { ok: false; code: string; error: string } {
  const provider = parseUserOperationalIdentityProvider(params.provider);
  if (!provider) {
    return { ok: false, code: "USER_IDENTITY_PROVIDER_INVALID", error: "provider is invalid." };
  }
  if (isUserOperationalIdentityProviderManualAuth(provider)) {
    return {
      ok: false,
      code: "USER_IDENTITY_MANUAL_CREDENTIALS_REQUIRED",
      error: "Use user-operational-identity.credentials.bind for this provider.",
    };
  }
  if (isUserOperationalIdentityProviderQrChannelAuth(provider)) {
    return {
      ok: false,
      code: "USER_IDENTITY_QR_CHANNEL_REQUIRED",
      error:
        "Use user-operational-identity.wechat-personal.qr.start for WeChat personal QR binding.",
    };
  }
  const identityId = params.identityId?.trim() || undefined;
  let purpose: "bind" | "reauthorize" = "bind";
  if (identityId) {
    const identity = getUserOperationalIdentity(params.store, params.ownerId, identityId);
    if (!identity || identity.revokedAt) {
      return { ok: false, code: "USER_IDENTITY_NOT_FOUND", error: "Identity not found." };
    }
    if (identity.provider !== provider) {
      return {
        ok: false,
        code: "USER_IDENTITY_PROVIDER_MISMATCH",
        error: "Identity provider does not match OAuth provider.",
      };
    }
    purpose = "reauthorize";
  }
  expireStaleOAuthSessions(params.store, params.nowIso);
  const callbackUrl = params.callbackOrigin?.trim()
    ? buildUserOperationalIdentityOAuthCallbackUrl({
        origin: params.callbackOrigin,
        basePath: params.basePath,
      })
    : null;
  const mode = resolveOAuthModeForProvider(provider, callbackUrl ?? undefined);
  let codeVerifier: string | undefined;
  let codeChallenge: string | undefined;
  if (mode === "adapter_authorization_code") {
    const adapter = getUserOperationalIdentityOAuthAdapter(provider);
    if (adapter?.requiresPkce) {
      const pkce = buildUserOperationalIdentityPkcePair();
      codeVerifier = pkce.codeVerifier;
      codeChallenge = pkce.codeChallenge;
    }
  }

  const session: UserOperationalIdentityOAuthSession = {
    sessionId: randomUUID(),
    state: randomBytes(24).toString("hex"),
    ownerId: params.ownerId,
    tenantId: params.tenantId?.trim() || undefined,
    provider,
    displayName: params.displayName?.trim() || undefined,
    identityId,
    purpose,
    continuationToken: params.continuationToken?.trim() || undefined,
    bindingRequestId: params.bindingRequestId?.trim() || undefined,
    returnPath: params.returnPath?.trim() || undefined,
    mode,
    codeVerifier,
    status: "pending",
    createdAt: params.nowIso,
    expiresAt: new Date(
      new Date(params.nowIso).getTime() + DEFAULT_OAUTH_SESSION_TTL_MS,
    ).toISOString(),
  };
  params.store.oauthSessions[session.sessionId] = session;

  let authorizeUrl: string | null = null;
  if (mode === "github_authorization_code" && callbackUrl) {
    const github = resolveUserOperationalIdentityGithubOAuthConfig({ redirectUri: callbackUrl });
    if (github) {
      const query = new URLSearchParams({
        client_id: github.clientId,
        redirect_uri: github.redirectUri,
        state: session.state,
        scope: "read:user,user:email,repo",
      });
      authorizeUrl = `${GITHUB_AUTHORIZE_URL}?${query.toString()}`;
    }
  } else if (mode === "adapter_authorization_code" && callbackUrl) {
    const adapter = getUserOperationalIdentityOAuthAdapter(provider);
    const config = resolveUserOperationalIdentityOAuthAdapterConfig({
      provider,
      redirectUri: callbackUrl,
    });
    if (adapter && config) {
      authorizeUrl = adapter.buildAuthorizeUrl({
        config,
        state: session.state,
        codeChallenge,
      });
    }
  }

  return {
    ok: true,
    session,
    authorizeUrl,
    simulateAllowed: mode === "simulated",
    callbackUrl,
  };
}

async function exchangeGithubAuthorizationCode(params: {
  code: string;
  redirectUri: string;
}): Promise<{ accessToken: string; scope?: string; accountLabel?: string }> {
  const github = resolveUserOperationalIdentityGithubOAuthConfig({
    redirectUri: params.redirectUri,
  });
  if (!github) {
    throw new Error("GitHub OAuth is not configured.");
  }
  const body = new URLSearchParams({
    client_id: github.clientId,
    client_secret: github.clientSecret,
    code: params.code,
    redirect_uri: github.redirectUri,
  });
  const response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`GitHub token exchange failed: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as {
    access_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!payload.access_token) {
    throw new Error(payload.error_description ?? payload.error ?? "GitHub token exchange failed.");
  }
  let accountLabel: string | undefined;
  try {
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${payload.access_token}`,
        "User-Agent": "openbot-user-operational-identity",
      },
    });
    if (userResponse.ok) {
      const userPayload = (await userResponse.json()) as { login?: string };
      accountLabel = userPayload.login?.trim() || undefined;
    }
  } catch {
    // Best-effort account label.
  }
  return {
    accessToken: payload.access_token,
    scope: payload.scope,
    accountLabel,
  };
}

function resolveCredentialSecretKind(
  mode: UserOperationalIdentityOAuthMode,
): UserOperationalIdentityCredentialSecret["kind"] {
  if (mode === "github_authorization_code") {
    return "github_token";
  }
  if (mode === "adapter_authorization_code") {
    return "oauth_token";
  }
  return "simulated";
}

function buildCredentialSecret(params: {
  handleId: string;
  ownerId: string;
  provider: UserOperationalIdentityProvider;
  mode: UserOperationalIdentityOAuthMode;
  accessToken: string;
  refreshToken?: string;
  accountLabel?: string;
  scope?: string;
  expiresAt?: string;
  nowIso: string;
}): UserOperationalIdentityCredentialSecret {
  if (params.provider === "personal-email" && params.mode === "simulated") {
    const smtp = resolvePlatformAuthSmtpConfig();
    if (smtp) {
      return {
        handleId: params.handleId,
        ownerId: params.ownerId,
        provider: params.provider,
        kind: "smtp",
        accessToken: smtp.pass ?? "env:platform",
        accountLabel: params.accountLabel ?? smtp.from,
        metadata: {
          source: "platform_env",
          smtpHost: smtp.host,
          smtpPort: String(smtp.port),
          smtpFrom: smtp.from,
        },
        createdAt: params.nowIso,
        updatedAt: params.nowIso,
      };
    }
  }
  return {
    handleId: params.handleId,
    ownerId: params.ownerId,
    provider: params.provider,
    kind: resolveCredentialSecretKind(params.mode),
    accessToken: params.accessToken,
    refreshToken: params.refreshToken,
    accountLabel: params.accountLabel,
    metadata: params.scope ? { scope: params.scope } : undefined,
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
    expiresAt: params.expiresAt,
  };
}

export async function finalizeUserOperationalIdentityOAuthSession(params: {
  store: UserOperationalIdentityStore;
  session: UserOperationalIdentityOAuthSession;
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  externalAccountId?: string;
  accountLabel?: string;
  scope?: string;
  nowIso: string;
  currentUserEmail?: string | null;
}): Promise<
  | {
      ok: true;
      session: UserOperationalIdentityOAuthSession;
      credentialHandleId: string;
      identityId?: string;
      continuationCompleted: boolean;
    }
  | { ok: false; code: string; error: string }
> {
  if (params.session.status !== "pending") {
    return {
      ok: false,
      code: "USER_IDENTITY_OAUTH_SESSION_INVALID",
      error: "OAuth session is not pending.",
    };
  }
  if (params.session.expiresAt <= params.nowIso) {
    params.session.status = "expired";
    return {
      ok: false,
      code: "USER_IDENTITY_OAUTH_SESSION_EXPIRED",
      error: "OAuth session has expired.",
    };
  }

  const handleId = randomUUID();
  const isReauthorize =
    params.session.purpose === "reauthorize" && params.session.identityId?.trim();
  let identityId: string | undefined;

  if (isReauthorize) {
    const rotated = rotateUserOperationalIdentityCredential({
      store: params.store,
      ownerId: params.session.ownerId,
      identityId: params.session.identityId!,
      credentialHandleId: handleId,
      oauthSessionId: params.session.sessionId,
      label: params.accountLabel ?? params.externalAccountId,
      nowIso: params.nowIso,
    });
    if (!rotated.ok) {
      return rotated;
    }
    identityId = rotated.identity.identityId;
  } else {
    const credential = registerUserOperationalIdentityCredentialHandleFromOAuth({
      store: params.store,
      ownerId: params.session.ownerId,
      provider: params.session.provider,
      credentialHandleId: handleId,
      oauthSessionId: params.session.sessionId,
      label: params.accountLabel ?? params.externalAccountId,
      nowIso: params.nowIso,
    });
    if (!credential.ok) {
      return credential;
    }
  }

  const expiresAt =
    typeof params.expiresIn === "number" && Number.isFinite(params.expiresIn)
      ? new Date(new Date(params.nowIso).getTime() + params.expiresIn * 1000).toISOString()
      : undefined;
  await withUserOperationalIdentityCredentialSecretStoreWriteLock((secretStore) => {
    secretStore.secrets[handleId] = buildCredentialSecret({
      handleId,
      ownerId: params.session.ownerId,
      provider: params.session.provider,
      mode: params.session.mode,
      accessToken: params.accessToken,
      refreshToken: params.refreshToken,
      accountLabel: params.accountLabel ?? params.externalAccountId,
      scope: params.scope,
      expiresAt,
      nowIso: params.nowIso,
    });
    return secretStore;
  });

  if (!isReauthorize) {
    const displayName =
      params.session.displayName?.trim() ||
      params.accountLabel?.trim() ||
      params.externalAccountId?.trim() ||
      params.session.provider;
    const registered = registerUserOperationalIdentity({
      store: params.store,
      ownerId: params.session.ownerId,
      displayName,
      provider: params.session.provider,
      credentialHandleId: handleId,
      tenantId: params.session.tenantId,
      externalAccountId:
        params.externalAccountId?.trim() || params.accountLabel?.trim() || undefined,
      nowIso: params.nowIso,
      skipPlaceholderSecret: true,
    });
    if (registered.ok) {
      identityId = registered.identity.identityId;
    }
  }

  params.session.status = "completed";
  params.session.completedAt = params.nowIso;
  params.session.credentialHandleId = handleId;
  params.session.identityId = identityId;
  params.session.externalAccountId =
    params.externalAccountId?.trim() || params.accountLabel?.trim() || undefined;

  let continuationCompleted = false;
  if (params.session.continuationToken) {
    const oauthResult = completeOAuthForUserOperationalIdentityContinuation({
      store: params.store,
      ownerId: params.session.ownerId,
      continuationToken: params.session.continuationToken,
      provider: params.session.provider,
      nowIso: params.nowIso,
      currentUserEmail: params.currentUserEmail,
    });
    continuationCompleted = oauthResult.ok;
  }

  return {
    ok: true,
    session: params.session,
    credentialHandleId: handleId,
    identityId,
    continuationCompleted,
  };
}

export async function completeUserOperationalIdentityOAuthCallback(params: {
  state: string;
  code: string;
  redirectUri: string;
  nowIso: string;
}): Promise<
  | {
      ok: true;
      session: UserOperationalIdentityOAuthSession;
      returnPath?: string;
    }
  | { ok: false; code: string; error: string }
> {
  const located = await resolveUserOperationalIdentityStoreByState(params.state);
  if (!located) {
    return {
      ok: false,
      code: "USER_IDENTITY_OAUTH_SESSION_NOT_FOUND",
      error: "OAuth session not found.",
    };
  }
  return withUserOperationalIdentityStoreWriteLockForOwner(
    {
      ownerId: located.ownerId,
      tenantId: located.tenantId,
      storePath: located.storePath,
    },
    async (store) => {
      const session = getUserOperationalIdentityOAuthSessionByState(store, params.state);
      if (!session) {
        return {
          ok: false,
          code: "USER_IDENTITY_OAUTH_SESSION_NOT_FOUND",
          error: "OAuth session not found.",
        };
      }
      if (
        session.mode !== "github_authorization_code" &&
        session.mode !== "adapter_authorization_code"
      ) {
        return {
          ok: false,
          code: "USER_IDENTITY_OAUTH_MODE_INVALID",
          error: "OAuth session does not accept authorization codes.",
        };
      }
      try {
        let accessToken: string;
        let refreshToken: string | undefined;
        let expiresIn: number | undefined;
        let scope: string | undefined;
        let accountLabel: string | undefined;
        let externalAccountId: string | undefined;
        if (session.mode === "github_authorization_code") {
          const exchanged = await exchangeGithubAuthorizationCode({
            code: params.code,
            redirectUri: params.redirectUri,
          });
          accessToken = exchanged.accessToken;
          scope = exchanged.scope;
          accountLabel = exchanged.accountLabel;
          externalAccountId = exchanged.accountLabel;
        } else {
          const adapter = getUserOperationalIdentityOAuthAdapter(session.provider);
          if (!adapter) {
            return {
              ok: false,
              code: "USER_IDENTITY_OAUTH_ADAPTER_MISSING",
              error: "OAuth adapter is unavailable for this provider.",
            };
          }
          const config = adapter.resolveConfig({ redirectUri: params.redirectUri });
          if (!config) {
            return {
              ok: false,
              code: "USER_IDENTITY_OAUTH_NOT_CONFIGURED",
              error: "OAuth env is not configured for this provider.",
            };
          }
          const exchanged = await adapter.exchangeCode({
            config,
            code: params.code,
            codeVerifier: session.codeVerifier,
          });
          accessToken = exchanged.accessToken;
          refreshToken = exchanged.refreshToken;
          expiresIn = exchanged.expiresIn;
          scope = exchanged.scope;
          accountLabel = exchanged.accountLabel;
          externalAccountId = exchanged.externalAccountId ?? exchanged.accountLabel;
        }
        const finalized = await finalizeUserOperationalIdentityOAuthSession({
          store,
          session,
          accessToken,
          refreshToken,
          expiresIn,
          externalAccountId,
          accountLabel,
          scope,
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
        return {
          ok: false,
          code: "USER_IDENTITY_OAUTH_EXCHANGE_FAILED",
          error: error instanceof Error ? error.message : "OAuth exchange failed.",
        };
      }
    },
  );
}

function resolveCanonicalManagedOiStorePath(params: { ownerId: string; tenantId: string }): string {
  return resolveTenantUserOperationalIdentityStorePathForContext({
    tenantId: params.tenantId,
    userId: params.ownerId,
    domain: "employee",
  });
}

function sameStorePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

/**
 * Resolve the store opened by simulate-complete.
 * Managed mode: only the canonical {tenantId, ownerId} path — explicit storePath
 * is accepted only when it matches that canonical path (no arbitrary override).
 * Unauthenticated / null tenant cannot open a managed store via storePath alone.
 */
function resolveSimulateCompleteStorePath(params: {
  ownerId: string;
  tenantId: string | null;
  storePath?: string;
}): { ok: true; storePath?: string } | { ok: false; code: string; error: string } {
  const explicit = params.storePath?.trim() || undefined;
  const shared = isSharedTenantAddressingEnabled();

  if (params.tenantId && shared) {
    const canonical = resolveCanonicalManagedOiStorePath({
      ownerId: params.ownerId,
      tenantId: params.tenantId,
    });
    if (explicit && !sameStorePath(explicit, canonical)) {
      return {
        ok: false,
        code: "USER_IDENTITY_OAUTH_SESSION_NOT_FOUND",
        error: "OAuth session not found.",
      };
    }
    return { ok: true, storePath: canonical };
  }

  // No authenticated managed tenant: never honor an explicit path under shared addressing
  // (would otherwise let callers open another tenant's store).
  if (explicit && shared) {
    return {
      ok: false,
      code: "USER_IDENTITY_OAUTH_SESSION_NOT_FOUND",
      error: "OAuth session not found.",
    };
  }

  return { ok: true, storePath: explicit };
}

export async function simulateCompleteUserOperationalIdentityOAuthSession(params: {
  ownerId: string;
  sessionId: string;
  /**
   * Authenticated call-entry tenant. Required to open the managed per-tenant
   * identity store; must not be guessed by scanning tenant directories.
   */
  tenantId?: string | null;
  storePath?: string;
  governanceStateDir?: string;
  externalAccountId?: string;
  simulatedSecret?: string;
  nowIso: string;
  currentUserEmail?: string | null;
}): Promise<
  | {
      ok: true;
      session: UserOperationalIdentityOAuthSession;
      credentialHandleId: string;
      identityId?: string;
      continuationCompleted: boolean;
    }
  | { ok: false; code: string; error: string }
> {
  const tenantId = params.tenantId?.trim() || null;
  const resolved = resolveSimulateCompleteStorePath({
    ownerId: params.ownerId,
    tenantId,
    storePath: params.storePath,
  });
  if (!resolved.ok) {
    return resolved;
  }
  return withUserOperationalIdentityStoreWriteLockForOwner(
    {
      ownerId: params.ownerId,
      tenantId,
      storePath: resolved.storePath,
      governanceStateDir: params.governanceStateDir,
    },
    async (store) => {
      const session = getUserOperationalIdentityOAuthSession(
        store,
        params.ownerId,
        params.sessionId,
      );
      if (!session) {
        return {
          ok: false,
          code: "USER_IDENTITY_OAUTH_SESSION_NOT_FOUND",
          error: "OAuth session not found.",
        };
      }
      // Strict tenant stamp match (null !== "acme", and peer tenants diverge).
      const sessionTenantId = session.tenantId?.trim() || null;
      if (sessionTenantId !== tenantId) {
        return {
          ok: false,
          code: "USER_IDENTITY_OAUTH_SESSION_NOT_FOUND",
          error: "OAuth session not found.",
        };
      }
      if (session.mode !== "simulated") {
        return {
          ok: false,
          code: "USER_IDENTITY_OAUTH_MODE_INVALID",
          error: "OAuth session does not support simulation.",
        };
      }
      const accountLabel = params.externalAccountId?.trim() || `${session.provider}-simulated`;
      const accessToken =
        params.simulatedSecret?.trim() ||
        `simulated:${session.provider}:${accountLabel}:${params.nowIso}`;
      return finalizeUserOperationalIdentityOAuthSession({
        store,
        session,
        accessToken,
        externalAccountId: accountLabel,
        accountLabel,
        nowIso: params.nowIso,
        currentUserEmail: params.currentUserEmail,
      });
    },
  );
}

export function cancelUserOperationalIdentityOAuthSession(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  sessionId: string;
  nowIso: string;
}):
  | { ok: true; session: UserOperationalIdentityOAuthSession }
  | { ok: false; code: string; error: string } {
  const session = getUserOperationalIdentityOAuthSession(
    params.store,
    params.ownerId,
    params.sessionId,
  );
  if (!session || session.status !== "pending") {
    return {
      ok: false,
      code: "USER_IDENTITY_OAUTH_SESSION_NOT_FOUND",
      error: "OAuth session not found.",
    };
  }
  session.status = "cancelled";
  session.completedAt = params.nowIso;
  return { ok: true, session };
}

export function hasActiveUserOperationalIdentityCredentialSecret(params: {
  handleId: string;
  ownerId: string;
  secretStore: { secrets: Record<string, UserOperationalIdentityCredentialSecret> };
}): boolean {
  const secret = params.secretStore.secrets[params.handleId];
  return Boolean(secret && secret.ownerId === params.ownerId && secret.accessToken?.trim());
}

export async function assertUserOperationalIdentityCredentialSecretActive(params: {
  handleId: string;
  ownerId: string;
}): Promise<{ ok: true } | { ok: false; code: string; error: string }> {
  const secretStore = await import("./user-operational-identity-secrets-persistence.js").then(
    (mod) => mod.loadUserOperationalIdentityCredentialSecretStore(),
  );
  if (
    hasActiveUserOperationalIdentityCredentialSecret({
      handleId: params.handleId,
      ownerId: params.ownerId,
      secretStore,
    })
  ) {
    return { ok: true };
  }
  return {
    ok: false,
    code: "USER_IDENTITY_CREDENTIAL_SECRET_MISSING",
    error: "Operational identity credential secret is missing or inactive.",
  };
}

export function buildUserOperationalIdentityOAuthReturnUrl(params: {
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
  url.searchParams.set("userIdentityOAuth", params.status);
  url.searchParams.set("userIdentityOAuthSessionId", params.sessionId);
  if (params.message) {
    url.searchParams.set("userIdentityOAuthMessage", params.message);
  }
  if (params.basePath) {
    url.searchParams.set("userIdentityOAuthBasePath", params.basePath);
  }
  return url.toString();
}
