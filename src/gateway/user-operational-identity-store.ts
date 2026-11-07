import { randomUUID } from "node:crypto";
import {
  getUserOperationalIdentityProviderAdapter,
  isUserOperationalIdentityPolicyAction,
  isUserOperationalIdentityProviderRegistrationReady,
  parseUserOperationalIdentityProvider,
} from "./user-operational-identity-providers.js";
import type {
  UserOperationalIdentity,
  UserOperationalIdentityGrant,
  UserOperationalIdentityStore,
  UserOperationalIdentityUsageEvent,
  UserOperationalIdentityUsageMetrics,
  UserOperationalIdentityUsageResult,
  UserOperationalIdentityUsageSummary,
  UserOperationalIdentityCredentialHandle,
  UserOperationalIdentityLifecycleAction,
  UserOperationalIdentityLifecycleEvent,
} from "./user-operational-identity-types.js";
import { filterXTwitterOperationalActionsByGrantedScope } from "./user-operational-identity-x-twitter-scope.js";

export function getUserOperationalIdentityCredentialHandle(
  store: UserOperationalIdentityStore,
  ownerId: string,
  handleId: string,
): UserOperationalIdentityCredentialHandle | null {
  const handle = store.credentialHandles[handleId];
  if (!handle || handle.ownerId !== ownerId || handle.status !== "active") {
    return null;
  }
  return handle;
}

function registerUserOperationalIdentityCredentialHandle(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  provider: UserOperationalIdentity["provider"];
  credentialHandleId: string;
  nowIso: string;
  oauthSessionId?: string;
  label?: string;
  secretVerifiedAt?: string;
}):
  | { ok: true; handle: UserOperationalIdentityCredentialHandle }
  | { ok: false; code: string; error: string } {
  const handleId = params.credentialHandleId.trim();
  if (!handleId) {
    return {
      ok: false,
      code: "USER_IDENTITY_CREDENTIAL_REQUIRED",
      error: "credentialHandleId is required.",
    };
  }
  const existing = params.store.credentialHandles[handleId];
  if (existing) {
    if (existing.ownerId !== params.ownerId) {
      return {
        ok: false,
        code: "USER_IDENTITY_CREDENTIAL_FORBIDDEN",
        error: "credentialHandleId belongs to another user.",
      };
    }
    if (existing.provider !== params.provider) {
      return {
        ok: false,
        code: "USER_IDENTITY_CREDENTIAL_PROVIDER_MISMATCH",
        error: "credentialHandleId provider mismatch.",
      };
    }
    if (existing.status !== "active") {
      return {
        ok: false,
        code: "USER_IDENTITY_CREDENTIAL_INACTIVE",
        error: "credentialHandleId is not active.",
      };
    }
    existing.updatedAt = params.nowIso;
    existing.lastVerifiedAt = params.nowIso;
    if (params.secretVerifiedAt) {
      existing.secretVerifiedAt = params.secretVerifiedAt;
    }
    return { ok: true, handle: existing };
  }
  const handle: UserOperationalIdentityCredentialHandle = {
    handleId,
    ownerId: params.ownerId,
    provider: params.provider,
    label: params.label,
    oauthSessionId: params.oauthSessionId,
    secretVerifiedAt: params.secretVerifiedAt,
    status: "active",
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
    lastVerifiedAt: params.nowIso,
  };
  params.store.credentialHandles[handleId] = handle;
  return { ok: true, handle };
}

export function assertUserOperationalIdentityCredentialHandleActive(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  identity: UserOperationalIdentity;
}): { ok: true } | { ok: false; code: string; error: string } {
  const handle = getUserOperationalIdentityCredentialHandle(
    params.store,
    params.ownerId,
    params.identity.credentialHandleId,
  );
  if (!handle) {
    return {
      ok: false,
      code: "USER_IDENTITY_CREDENTIAL_INACTIVE",
      error: "Operational identity credential handle is missing or inactive.",
    };
  }
  if (handle.provider !== params.identity.provider) {
    return {
      ok: false,
      code: "USER_IDENTITY_CREDENTIAL_PROVIDER_MISMATCH",
      error: "Operational identity credential handle provider mismatch.",
    };
  }
  if (!handle.secretVerifiedAt) {
    return {
      ok: false,
      code: "USER_IDENTITY_CREDENTIAL_SECRET_MISSING",
      error: "Operational identity credential has not completed OAuth verification.",
    };
  }
  return { ok: true };
}

export function registerUserOperationalIdentityCredentialHandleFromOAuth(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  provider: UserOperationalIdentity["provider"];
  credentialHandleId: string;
  oauthSessionId: string;
  label?: string;
  nowIso: string;
}):
  | { ok: true; handle: UserOperationalIdentityCredentialHandle }
  | { ok: false; code: string; error: string } {
  return registerUserOperationalIdentityCredentialHandle({
    ...params,
    secretVerifiedAt: params.nowIso,
  });
}

export function listUserOperationalIdentities(
  store: UserOperationalIdentityStore,
  ownerId: string,
): UserOperationalIdentity[] {
  return Object.values(store.identities)
    .filter((identity) => identity.ownerId === ownerId && !identity.revokedAt)
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function getUserOperationalIdentity(
  store: UserOperationalIdentityStore,
  ownerId: string,
  identityId: string,
): UserOperationalIdentity | null {
  const identity = store.identities[identityId];
  if (!identity || identity.ownerId !== ownerId) {
    return null;
  }
  return identity;
}

export function listUserOperationalIdentityGrants(
  store: UserOperationalIdentityStore,
  ownerId: string,
  identityId?: string,
): UserOperationalIdentityGrant[] {
  return Object.values(store.grants)
    .filter(
      (grant) =>
        grant.ownerId === ownerId &&
        !grant.revokedAt &&
        (identityId ? grant.identityId === identityId : true),
    )
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/** Active grants targeting one agent, across owners. Used when the chat session has no user client. */
export function listUserOperationalIdentityGrantsForAgent(
  store: UserOperationalIdentityStore,
  params: { agentId: string; ownerId?: string },
): UserOperationalIdentityGrant[] {
  const agentId = params.agentId.trim();
  const ownerId = params.ownerId?.trim() ?? "";
  if (!agentId) {
    return [];
  }
  return Object.values(store.grants)
    .filter(
      (grant) =>
        grant.agentId === agentId &&
        grant.status === "active" &&
        !grant.revokedAt &&
        (!ownerId || grant.ownerId === ownerId),
    )
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function listUserOperationalIdentityUsageEvents(
  store: UserOperationalIdentityStore,
  ownerId: string,
  limit = 50,
  filter?: { identityId?: string; provider?: string; since?: string },
): UserOperationalIdentityUsageEvent[] {
  const identityId = filter?.identityId?.trim() || "";
  const provider = filter?.provider?.trim() || "";
  const sinceMs = filter?.since ? Date.parse(filter.since) : Number.NaN;
  return Object.values(store.usageEvents)
    .filter((event) => event.ownerId === ownerId)
    .filter((event) => !identityId || event.identityId === identityId)
    .filter((event) => !provider || event.provider === provider)
    .filter((event) => !Number.isFinite(sinceMs) || Date.parse(event.createdAt) >= sinceMs)
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
}

export function registerUserOperationalIdentity(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  displayName: string;
  provider: string;
  credentialHandleId: string;
  externalAccountId?: string;
  /** Managed tenant scope from call entry / OAuth session; omit for local/personal. */
  tenantId?: string | null;
  nowIso: string;
  skipPlaceholderSecret?: boolean;
  /** @internal test helper */
  credentialVerified?: boolean;
}): { ok: true; identity: UserOperationalIdentity } | { ok: false; code: string; error: string } {
  const provider = parseUserOperationalIdentityProvider(params.provider);
  if (!provider) {
    return {
      ok: false,
      code: "USER_IDENTITY_PROVIDER_INVALID",
      error: "provider is invalid.",
    };
  }
  if (!isUserOperationalIdentityProviderRegistrationReady(provider)) {
    const adapter = getUserOperationalIdentityProviderAdapter(provider);
    return {
      ok: false,
      code: "USER_IDENTITY_PROVIDER_NOT_READY",
      error: adapter?.degradedHint ?? "This provider is not available for binding yet.",
    };
  }
  const displayName = params.displayName.trim();
  const credentialHandleId = params.credentialHandleId.trim();
  if (!displayName) {
    return {
      ok: false,
      code: "USER_IDENTITY_DISPLAY_NAME_REQUIRED",
      error: "displayName is required.",
    };
  }
  if (!credentialHandleId) {
    return {
      ok: false,
      code: "USER_IDENTITY_CREDENTIAL_REQUIRED",
      error: "credentialHandleId is required.",
    };
  }
  const credential = registerUserOperationalIdentityCredentialHandle({
    store: params.store,
    ownerId: params.ownerId,
    provider,
    credentialHandleId,
    nowIso: params.nowIso,
    secretVerifiedAt: params.credentialVerified ? params.nowIso : undefined,
  });
  if (!credential.ok) {
    return credential;
  }
  const externalAccountId = params.externalAccountId?.trim() || undefined;
  if (externalAccountId) {
    const sameExternalAccount = Object.values(params.store.identities).find(
      (identity) =>
        identity.ownerId === params.ownerId &&
        identity.provider === provider &&
        identity.externalAccountId === externalAccountId &&
        !identity.revokedAt,
    );
    if (sameExternalAccount) {
      return {
        ok: false,
        code: "USER_IDENTITY_EXTERNAL_ACCOUNT_ALREADY_BOUND",
        error: "This external account is already bound for this provider.",
      };
    }
  }
  const duplicate = Object.values(params.store.identities).find(
    (identity) =>
      identity.ownerId === params.ownerId &&
      identity.provider === provider &&
      identity.credentialHandleId === credentialHandleId &&
      !identity.revokedAt,
  );
  if (duplicate) {
    return { ok: true, identity: duplicate };
  }
  const tenantId = params.tenantId?.trim() || undefined;
  const identity: UserOperationalIdentity = {
    identityId: randomUUID(),
    ownerType: "user",
    ownerId: params.ownerId,
    tenantId,
    provider,
    displayName,
    credentialHandleId,
    externalAccountId: params.externalAccountId?.trim() || undefined,
    status: "active",
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
    lastVerifiedAt: params.nowIso,
  };
  params.store.identities[identity.identityId] = identity;
  recordUserOperationalIdentityLifecycleEvent({
    store: params.store,
    ownerId: params.ownerId,
    identityId: identity.identityId,
    provider: identity.provider,
    action: "created",
    tenantId: identity.tenantId,
    nowIso: params.nowIso,
  });
  return { ok: true, identity };
}

export function revokeUserOperationalIdentity(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  identityId: string;
  nowIso: string;
}): { ok: true; identity: UserOperationalIdentity } | { ok: false; code: string; error: string } {
  const identity = getUserOperationalIdentity(params.store, params.ownerId, params.identityId);
  if (!identity || identity.revokedAt) {
    return { ok: false, code: "USER_IDENTITY_NOT_FOUND", error: "Identity not found." };
  }
  identity.status = "revoked";
  identity.revokedAt = params.nowIso;
  identity.updatedAt = params.nowIso;
  for (const grant of Object.values(params.store.grants)) {
    if (
      grant.identityId === identity.identityId &&
      grant.ownerId === params.ownerId &&
      !grant.revokedAt
    ) {
      grant.status = "revoked";
      grant.revokedAt = params.nowIso;
      grant.updatedAt = params.nowIso;
    }
  }
  recordUserOperationalIdentityLifecycleEvent({
    store: params.store,
    ownerId: params.ownerId,
    identityId: identity.identityId,
    provider: identity.provider,
    action: "revoked",
    tenantId: identity.tenantId,
    nowIso: params.nowIso,
  });
  return { ok: true, identity };
}

export function revokeUserOperationalIdentityCredentialHandle(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  handleId: string;
  nowIso: string;
}): { ok: true } | { ok: false; code: string; error: string } {
  const handle = params.store.credentialHandles[params.handleId];
  if (!handle || handle.ownerId !== params.ownerId) {
    return {
      ok: false,
      code: "USER_IDENTITY_CREDENTIAL_INACTIVE",
      error: "credentialHandleId is missing or inactive.",
    };
  }
  handle.status = "revoked";
  handle.updatedAt = params.nowIso;
  return { ok: true };
}

export function rotateUserOperationalIdentityCredential(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  identityId: string;
  credentialHandleId: string;
  oauthSessionId?: string;
  label?: string;
  nowIso: string;
}): { ok: true; identity: UserOperationalIdentity } | { ok: false; code: string; error: string } {
  const identity = getUserOperationalIdentity(params.store, params.ownerId, params.identityId);
  if (!identity || identity.revokedAt) {
    return { ok: false, code: "USER_IDENTITY_NOT_FOUND", error: "Identity not found." };
  }
  const previousHandleId = identity.credentialHandleId;
  const credential = registerUserOperationalIdentityCredentialHandleFromOAuth({
    store: params.store,
    ownerId: params.ownerId,
    provider: identity.provider,
    credentialHandleId: params.credentialHandleId,
    oauthSessionId: params.oauthSessionId ?? params.credentialHandleId,
    label: params.label,
    nowIso: params.nowIso,
  });
  if (!credential.ok) {
    return credential;
  }
  if (previousHandleId !== params.credentialHandleId) {
    revokeUserOperationalIdentityCredentialHandle({
      store: params.store,
      ownerId: params.ownerId,
      handleId: previousHandleId,
      nowIso: params.nowIso,
    });
  }
  identity.credentialHandleId = params.credentialHandleId;
  identity.status = "active";
  identity.lastVerifiedAt = params.nowIso;
  identity.updatedAt = params.nowIso;
  if (params.label?.trim()) {
    identity.externalAccountId = params.label.trim();
  }
  recordUserOperationalIdentityLifecycleEvent({
    store: params.store,
    ownerId: params.ownerId,
    identityId: identity.identityId,
    provider: identity.provider,
    action: "reauthorized",
    tenantId: identity.tenantId,
    nowIso: params.nowIso,
  });
  return { ok: true, identity };
}

export function reauthorizeUserOperationalIdentity(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  identityId: string;
  nowIso: string;
}): { ok: true; identity: UserOperationalIdentity } | { ok: false; code: string; error: string } {
  const identity = getUserOperationalIdentity(params.store, params.ownerId, params.identityId);
  if (!identity || identity.revokedAt) {
    return { ok: false, code: "USER_IDENTITY_NOT_FOUND", error: "Identity not found." };
  }
  const credential = assertUserOperationalIdentityCredentialHandleActive({
    store: params.store,
    ownerId: params.ownerId,
    identity,
  });
  if (!credential.ok) {
    return credential;
  }
  identity.status = "active";
  identity.lastVerifiedAt = params.nowIso;
  identity.updatedAt = params.nowIso;
  recordUserOperationalIdentityLifecycleEvent({
    store: params.store,
    ownerId: params.ownerId,
    identityId: identity.identityId,
    provider: identity.provider,
    action: "reauthorized",
    tenantId: identity.tenantId,
    nowIso: params.nowIso,
  });
  return { ok: true, identity };
}

export function upsertUserOperationalIdentityGrant(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  identityId: string;
  agentId: string;
  agentScope: UserOperationalIdentityGrant["agentScope"];
  allowedActions: string[];
  /** When set for x-twitter, publish actions are dropped unless tweet.write is present. */
  oauthScope?: string | null;
  grantMode: UserOperationalIdentityGrant["grantMode"];
  tenantId?: string;
  seatId?: string;
  confirmExplicit?: boolean;
  nowIso: string;
}): { ok: true; grant: UserOperationalIdentityGrant } | { ok: false; code: string; error: string } {
  const identity = getUserOperationalIdentity(params.store, params.ownerId, params.identityId);
  if (!identity || identity.revokedAt) {
    return { ok: false, code: "USER_IDENTITY_NOT_FOUND", error: "Identity not found." };
  }
  const agentId = params.agentId.trim();
  if (!agentId) {
    return { ok: false, code: "USER_IDENTITY_AGENT_REQUIRED", error: "agentId is required." };
  }
  if (params.agentScope === "owned" && params.grantMode !== "auto") {
    return {
      ok: false,
      code: "USER_IDENTITY_GRANT_MODE_INVALID",
      error: "owned agents must use auto grant mode.",
    };
  }
  if (params.agentScope !== "owned" && params.grantMode !== "explicit") {
    return {
      ok: false,
      code: "USER_IDENTITY_GRANT_MODE_INVALID",
      error: "shared/group agents must use explicit grant mode.",
    };
  }
  if (params.agentScope !== "owned" && !params.confirmExplicit) {
    return {
      ok: false,
      code: "USER_IDENTITY_GRANT_CONFIRMATION_REQUIRED",
      error: "shared/group agent grants require explicit confirmation.",
    };
  }
  let allowedActions = params.allowedActions
    .map((action) => action.trim())
    .filter((action) => action && isUserOperationalIdentityPolicyAction(identity.provider, action));
  if (identity.provider === "x-twitter") {
    allowedActions = filterXTwitterOperationalActionsByGrantedScope({
      actions: allowedActions,
      scope: params.oauthScope,
      allowAllIfScopeMissing: !params.oauthScope?.trim(),
    });
  }
  if (allowedActions.length === 0) {
    return {
      ok: false,
      code: "USER_IDENTITY_ACTIONS_REQUIRED",
      error: "At least one allowed action is required.",
    };
  }
  const existing = Object.values(params.store.grants).find(
    (grant) =>
      grant.ownerId === params.ownerId &&
      grant.identityId === params.identityId &&
      grant.agentId === agentId &&
      !grant.revokedAt,
  );
  if (existing) {
    existing.allowedActions = allowedActions;
    existing.agentScope = params.agentScope;
    existing.grantMode = params.grantMode;
    existing.tenantId = params.tenantId?.trim() || undefined;
    existing.seatId = params.seatId?.trim() || undefined;
    existing.status = "active";
    existing.updatedAt = params.nowIso;
    existing.confirmedAt = params.nowIso;
    return { ok: true, grant: existing };
  }
  const grant: UserOperationalIdentityGrant = {
    grantId: randomUUID(),
    identityId: params.identityId,
    ownerId: params.ownerId,
    tenantId: params.tenantId?.trim() || undefined,
    seatId: params.seatId?.trim() || undefined,
    agentId,
    agentScope: params.agentScope,
    allowedActions,
    grantMode: params.grantMode,
    status: "active",
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
    confirmedAt: params.nowIso,
  };
  params.store.grants[grant.grantId] = grant;
  return { ok: true, grant };
}

export function revokeUserOperationalIdentityGrant(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  grantId: string;
  nowIso: string;
}): { ok: true; grant: UserOperationalIdentityGrant } | { ok: false; code: string; error: string } {
  const grant = params.store.grants[params.grantId];
  if (!grant || grant.ownerId !== params.ownerId || grant.revokedAt) {
    return { ok: false, code: "USER_IDENTITY_GRANT_NOT_FOUND", error: "Grant not found." };
  }
  grant.status = "revoked";
  grant.revokedAt = params.nowIso;
  grant.updatedAt = params.nowIso;
  return { ok: true, grant };
}

export function recordUserOperationalIdentityUsageEvent(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  identityId: string;
  provider: UserOperationalIdentity["provider"];
  agentId: string;
  action: string;
  result: UserOperationalIdentityUsageResult;
  denialCode?: string;
  tenantId?: string;
  seatId?: string;
  sessionKey?: string | null;
  nowIso: string;
  summary?: UserOperationalIdentityUsageSummary;
  metrics?: UserOperationalIdentityUsageMetrics;
}): UserOperationalIdentityUsageEvent {
  const event: UserOperationalIdentityUsageEvent = {
    eventId: randomUUID(),
    ownerId: params.ownerId,
    tenantId: params.tenantId,
    seatId: params.seatId,
    agentId: params.agentId,
    identityId: params.identityId,
    provider: params.provider,
    action: params.action,
    result: params.result,
    denialCode: params.denialCode,
    sessionKey: params.sessionKey ?? null,
    createdAt: params.nowIso,
    ...(params.summary ? { summary: params.summary } : {}),
    ...(params.metrics ? { metrics: params.metrics } : {}),
  };
  params.store.usageEvents[event.eventId] = event;
  return event;
}

export function attachUsageMetricsToLatestMatchingEvent(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  identityId: string;
  actions: string[];
  metrics: UserOperationalIdentityUsageMetrics;
}): UserOperationalIdentityUsageEvent | null {
  const match = Object.values(params.store.usageEvents)
    .filter(
      (event) =>
        event.ownerId === params.ownerId &&
        event.identityId === params.identityId &&
        params.actions.includes(event.action) &&
        event.result === "allowed",
    )
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (!match) {
    return null;
  }
  match.metrics = { ...match.metrics, ...params.metrics };
  return match;
}

/**
 * Append a lifecycle audit event (create / reauthorize / revoke). Append-only
 * (Task 2.5 / R6 6B). `tenantId` is left to read-time owner→membership backfill
 * in the governance aggregator, consistent with Task 2.0 / D4.
 */
export function recordUserOperationalIdentityLifecycleEvent(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  identityId: string;
  provider: UserOperationalIdentity["provider"];
  action: UserOperationalIdentityLifecycleAction;
  tenantId?: string;
  nowIso: string;
}): UserOperationalIdentityLifecycleEvent {
  const event: UserOperationalIdentityLifecycleEvent = {
    eventId: randomUUID(),
    ownerId: params.ownerId,
    tenantId: params.tenantId,
    identityId: params.identityId,
    provider: params.provider,
    action: params.action,
    createdAt: params.nowIso,
  };
  params.store.lifecycleEvents[event.eventId] = event;
  return event;
}

export function listUserOperationalIdentityLifecycleEvents(
  store: UserOperationalIdentityStore,
  ownerId: string,
  limit = 50,
): UserOperationalIdentityLifecycleEvent[] {
  return Object.values(store.lifecycleEvents)
    .filter((event) => event.ownerId === ownerId)
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
}

function feishuEnterpriseImStatusLabel(
  link: {
    authorizationLevel: "identity_only" | "authorized";
    localCredentialsDeleted?: boolean;
    platformRevokeRecorded?: boolean;
  },
  status: string,
  expiresAt?: string,
): string {
  if (link.platformRevokeRecorded || status === "revoked") {
    return "已停用";
  }
  if (link.localCredentialsDeleted) {
    return "本地凭证已删除";
  }
  if (status === "reauth_required") {
    return "需重新认证";
  }
  const expiresMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  if (status === "expired" || (Number.isFinite(expiresMs) && expiresMs <= Date.now())) {
    return "已过期";
  }
  if (link.authorizationLevel === "identity_only") {
    return "仅身份";
  }
  return "已授权";
}

export function summarizeUserOperationalIdentitySnapshot(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  nowIso: string;
}) {
  const identities = listUserOperationalIdentities(params.store, params.ownerId).map((identity) => {
    const adapter = getUserOperationalIdentityProviderAdapter(identity.provider);
    return {
      identityId: identity.identityId,
      provider: identity.provider,
      providerLabel: adapter?.label ?? identity.provider,
      displayName: identity.displayName,
      externalAccountId: identity.externalAccountId,
      status: identity.status,
      grantCount: listUserOperationalIdentityGrants(
        params.store,
        params.ownerId,
        identity.identityId,
      ).length,
      createdAt: identity.createdAt,
      updatedAt: identity.updatedAt,
      lastVerifiedAt: identity.lastVerifiedAt,
      expiresAt: identity.expiresAt,
      enterpriseIm: identity.enterpriseIm
        ? {
            channel: identity.enterpriseIm.channel,
            accountId: identity.enterpriseIm.accountId,
            platformEnterpriseId: identity.enterpriseIm.platformEnterpriseId,
            platformUserId: identity.enterpriseIm.platformUserId,
            userGrantedScopes: [...identity.enterpriseIm.userGrantedScopes],
            authorizationLevel: identity.enterpriseIm.authorizationLevel,
            localCredentialsDeleted: identity.enterpriseIm.localCredentialsDeleted === true,
            platformRevokeRecorded: identity.enterpriseIm.platformRevokeRecorded === true,
            statusLabel: feishuEnterpriseImStatusLabel(
              identity.enterpriseIm,
              identity.status,
              identity.expiresAt,
            ),
          }
        : undefined,
    };
  });
  const grants = listUserOperationalIdentityGrants(params.store, params.ownerId).map((grant) => ({
    grantId: grant.grantId,
    identityId: grant.identityId,
    agentId: grant.agentId,
    agentScope: grant.agentScope,
    allowedActions: grant.allowedActions,
    grantMode: grant.grantMode,
    status: grant.status,
    confirmedAt: grant.confirmedAt,
  }));
  // Keep a per-identity window so a busy mailbox cannot starve other hubs.
  const usageHistory = identities
    .flatMap((identity) =>
      listUserOperationalIdentityUsageEvents(params.store, params.ownerId, 40, {
        identityId: identity.identityId,
      }),
    )
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
  return { identities, grants, usageHistory };
}
