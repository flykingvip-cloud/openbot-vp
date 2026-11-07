/**
 * Slice 1b: Feishu employee connection as a child of the 企业通道 account.
 *
 * The identity lives in the existing user operational-identity store.
 * Tokens live in the existing credential secret vault.
 * Bind does not create a robot grant.
 */
import { randomUUID } from "node:crypto";
import {
  readFeishuEnterpriseChannelContract,
  type EnterpriseImEmployeeUiHint,
} from "./enterprise-im-channel-contract.js";
import { getTenantConfigOverride, loadTenantConfigStore } from "./tenant-config.js";
import { recordUserOperationalIdentityUsageEvent } from "./user-operational-identity-store.js";
import type {
  UserOperationalIdentity,
  UserOperationalIdentityCredentialSecret,
  UserOperationalIdentityCredentialSecretStore,
  UserOperationalIdentityOAuthSession,
  UserOperationalIdentityStore,
} from "./user-operational-identity-types.js";

const RECEIVE_SCOPES = new Set([
  "im:message",
  "im:message:readonly",
  "im:message.group_msg",
  "im:message.group_msg:readonly",
  "im:message.group_at_msg:readonly",
  "im:message.p2p_msg:readonly",
]);

const SEND_SCOPES = new Set(["im:message.send_as_user", "im:message:send_as_user"]);

const refreshFlights = new Map<string, Promise<FeishuEmployeePublicResult>>();

export type FeishuUserTokenObservation = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  openId: string;
  /** From the token exchange or user_info. Null means the token did not carry an enterprise id. */
  tenantKey: string | null;
  scopeNames: string[];
};

export type FeishuEmployeeChannelGate = {
  accountId: string;
  employeeUiHint: EnterpriseImEmployeeUiHint;
  loginEnabled: boolean;
  statusLabel: string;
  platformEnterpriseId: string | null;
  childExecutionBlocked: boolean;
};

export type FeishuEmployeePublicResult = {
  ok: boolean;
  code: string;
  message: string;
  identityId?: string;
  authorizationLevel?: "identity_only" | "authorized";
  userGrantedScopes?: string[];
  localCredentialsDeleted?: boolean;
  platformRevokeRecorded?: boolean;
};

export function feishuEmployeeIdentityId(params: {
  tenantId: string;
  ownerId: string;
  openId: string;
}): string {
  const part = (value: string) => value.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  return `feishu-employee.${part(params.tenantId)}.${part(params.ownerId)}.${part(params.openId)}`;
}

export function defaultEnterpriseImAccountId(tenantId: string): string {
  const normalized = tenantId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `t_${normalized || "tenant"}_default`;
}

/**
 * Only the tenant's own `t_<tenant>_default` account counts as an opened connection.
 * A platform-default account, or any other account id, is not selected.
 */
export function resolveFeishuEnterpriseAccountId(
  config: Record<string, unknown>,
  tenantId: string,
): string | null {
  const preferred = defaultEnterpriseImAccountId(tenantId);
  const channels = config.channels;
  const feishu =
    channels && typeof channels === "object" && !Array.isArray(channels)
      ? (channels as { feishu?: { accounts?: Record<string, unknown> } }).feishu
      : undefined;
  const accounts = feishu?.accounts;
  if (!accounts || typeof accounts !== "object" || Array.isArray(accounts)) {
    return null;
  }
  const account = accounts[preferred];
  if (!account || typeof account !== "object" || Array.isArray(account)) {
    return null;
  }
  return preferred;
}

export function feishuEmployeeChannelGate(params: {
  config: Record<string, unknown> | null | undefined;
  tenantId: string;
}): FeishuEmployeeChannelGate {
  const accountId = resolveFeishuEnterpriseAccountId(params.config ?? {}, params.tenantId);
  if (!accountId) {
    return {
      accountId: defaultEnterpriseImAccountId(params.tenantId),
      employeeUiHint: "enterprise_not_open",
      loginEnabled: false,
      statusLabel: "企业尚未开通",
      platformEnterpriseId: null,
      childExecutionBlocked: true,
    };
  }
  const contract = readFeishuEnterpriseChannelContract({
    config: params.config,
    accountId,
  });
  const loginEnabled =
    contract.employeeUiHint === "app_can_attempt" &&
    !contract.childExecutionBlocked &&
    Boolean(contract.platformEnterpriseId);
  const statusLabel =
    contract.employeeUiHint === "enterprise_not_open"
      ? "企业尚未开通"
      : contract.employeeUiHint === "waiting_admin_scopes"
        ? "等待管理员开通权限"
        : "可绑定";
  return {
    accountId,
    employeeUiHint: contract.employeeUiHint,
    loginEnabled,
    statusLabel,
    platformEnterpriseId: contract.platformEnterpriseId,
    childExecutionBlocked: contract.childExecutionBlocked,
  };
}

export async function loadFeishuEmployeeChannelGate(params: {
  tenantId: string | null | undefined;
  storePath?: string;
}): Promise<FeishuEmployeeChannelGate> {
  const tenantId = params.tenantId?.trim() || "";
  if (!tenantId) {
    return feishuEmployeeChannelGate({ config: {}, tenantId: "tenant" });
  }
  const store = await loadTenantConfigStore(params.storePath);
  const override = getTenantConfigOverride(store, tenantId) ?? {};
  return feishuEmployeeChannelGate({
    config: override,
    tenantId,
  });
}

export async function loadFeishuEmployeeAppCredentials(params: {
  tenantId: string;
  storePath?: string;
  accountId: string;
}): Promise<{ appId: string; appSecret: string } | null> {
  const store = await loadTenantConfigStore(params.storePath);
  const override = (getTenantConfigOverride(store, params.tenantId) ?? {}) as Record<
    string,
    unknown
  >;
  return readFeishuAppCredentials(override, params.accountId);
}

function classifyUserScopes(scopeNames: string[]): "identity_only" | "authorized" {
  const names = new Set(scopeNames.map((name) => name.trim()).filter(Boolean));
  const receive = [...RECEIVE_SCOPES].some((scope) => names.has(scope));
  const send = [...SEND_SCOPES].some((scope) => names.has(scope));
  return receive || send ? "authorized" : "identity_only";
}

function audit(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  tenantId: string;
  identityId: string;
  action: string;
  ok: boolean;
  code?: string;
  nowIso: string;
  headline: string;
}): void {
  recordUserOperationalIdentityUsageEvent({
    store: params.store,
    ownerId: params.ownerId,
    tenantId: params.tenantId,
    identityId: params.identityId,
    provider: "feishu-personal",
    agentId: "employee-self",
    action: params.action,
    result: params.ok ? "allowed" : "denied",
    denialCode: params.code,
    nowIso: params.nowIso,
    summary: { headline: params.headline },
  });
}

function emptySecretStore(): UserOperationalIdentityCredentialSecretStore {
  return { version: 1, secrets: {} };
}

export function bindFeishuEmployeeConnection(params: {
  store: UserOperationalIdentityStore;
  secretStore?: UserOperationalIdentityCredentialSecretStore;
  ownerId: string;
  tenantId: string;
  gate: FeishuEmployeeChannelGate;
  observation: FeishuUserTokenObservation;
  /** Present only when the employee posted an enterprise id. Never accepted as the source of truth. */
  employeePostedEnterpriseId?: string | null;
  nowIso: string;
  reauth?: boolean;
  auditAction?: string;
}): FeishuEmployeePublicResult {
  const secretStore = params.secretStore ?? emptySecretStore();
  const openId = params.observation.openId.trim();
  const identityId = openId
    ? feishuEmployeeIdentityId({
        tenantId: params.tenantId,
        ownerId: params.ownerId,
        openId,
      })
    : `feishu-employee.${params.tenantId}.${params.ownerId}.rejected`;
  const grantsBefore = Object.keys(params.store.grants).length;
  const fail = (code: string, message: string): FeishuEmployeePublicResult => {
    audit({
      store: params.store,
      ownerId: params.ownerId,
      tenantId: params.tenantId,
      identityId,
      action: params.auditAction ?? (params.reauth ? "reauth" : "bind"),
      ok: false,
      code,
      nowIso: params.nowIso,
      headline: message,
    });
    return { ok: false, code, message, identityId };
  };

  if (params.gate.childExecutionBlocked || params.gate.employeeUiHint === "enterprise_not_open") {
    return fail("ENTERPRISE_NOT_OPEN", "企业尚未开通");
  }
  if (!params.gate.loginEnabled || params.gate.employeeUiHint !== "app_can_attempt") {
    return fail("WAITING_ADMIN_SCOPES", "等待管理员开通权限");
  }
  const posted = params.employeePostedEnterpriseId?.trim() || "";
  if (posted && posted !== params.gate.platformEnterpriseId) {
    return fail("POSTED_ENTERPRISE_MISMATCH", "员工提交的企业标识与已开通连接不一致。");
  }
  const tenantKey = params.observation.tenantKey?.trim() || "";
  if (!tenantKey) {
    return fail(
      "ENTERPRISE_ID_NOT_ON_TOKEN",
      "令牌未携带平台企业标识，不能仅凭员工提交的企业号绑定。",
    );
  }
  if (!params.gate.platformEnterpriseId || tenantKey !== params.gate.platformEnterpriseId) {
    return fail("PLATFORM_ENTERPRISE_MISMATCH", "令牌上的平台企业与企业通道记录不一致。");
  }
  if (!params.observation.accessToken.trim() || !openId) {
    return fail("FEISHU_TOKEN_INCOMPLETE", "飞书用户令牌缺少访问凭证或用户标识。");
  }

  const authorizationLevel = classifyUserScopes(params.observation.scopeNames);
  const existing = params.store.identities[identityId];
  const handleId = existing?.credentialHandleId || randomUUID();
  const identity: UserOperationalIdentity = {
    identityId,
    ownerType: "user",
    ownerId: params.ownerId,
    tenantId: params.tenantId,
    provider: "feishu-personal",
    displayName: existing?.displayName || `飞书 ${openId}`,
    externalAccountId: openId,
    credentialHandleId: handleId,
    status: "active",
    createdAt: existing?.createdAt ?? params.nowIso,
    updatedAt: params.nowIso,
    lastVerifiedAt: params.nowIso,
    expiresAt: params.observation.expiresAt ?? undefined,
    enterpriseIm: {
      channel: "feishu",
      accountId: params.gate.accountId,
      platformEnterpriseId: tenantKey,
      platformUserId: openId,
      userGrantedScopes: [...params.observation.scopeNames],
      authorizationLevel,
      localCredentialsDeleted: false,
      platformRevokeRecorded: false,
    },
  };
  params.store.identities[identityId] = identity;
  params.store.credentialHandles[handleId] = {
    handleId,
    ownerId: params.ownerId,
    provider: "feishu-personal",
    status: "active",
    label: "feishu-user",
    createdAt: existing?.createdAt ?? params.nowIso,
    updatedAt: params.nowIso,
    lastVerifiedAt: params.nowIso,
    secretVerifiedAt: params.nowIso,
  };
  const secret: UserOperationalIdentityCredentialSecret = {
    handleId,
    ownerId: params.ownerId,
    provider: "feishu-personal",
    kind: "oauth_token",
    accessToken: params.observation.accessToken,
    refreshToken: params.observation.refreshToken?.trim() || undefined,
    accountLabel: openId,
    metadata: {
      tenantKey,
      openId,
      scopes: params.observation.scopeNames.join(" "),
    },
    createdAt: secretStore.secrets[handleId]?.createdAt ?? params.nowIso,
    updatedAt: params.nowIso,
    expiresAt: params.observation.expiresAt ?? undefined,
  };
  secretStore.secrets[handleId] = secret;
  audit({
    store: params.store,
    ownerId: params.ownerId,
    tenantId: params.tenantId,
    identityId,
    action: params.auditAction ?? (params.reauth ? "reauth" : "bind"),
    ok: true,
    nowIso: params.nowIso,
    headline: authorizationLevel === "authorized" ? "已授权" : "仅身份",
  });
  if (Object.keys(params.store.grants).length !== grantsBefore) {
    throw new Error("feishu employee bind must not create a robot grant");
  }
  return {
    ok: true,
    code: "BOUND",
    message: authorizationLevel === "authorized" ? "已授权" : "仅身份",
    identityId,
    authorizationLevel,
    userGrantedScopes: [...params.observation.scopeNames],
    localCredentialsDeleted: false,
    platformRevokeRecorded: false,
  };
}

export function disconnectFeishuEmployeeConnection(params: {
  store: UserOperationalIdentityStore;
  secretStore?: UserOperationalIdentityCredentialSecretStore;
  ownerId: string;
  identityId: string;
  nowIso: string;
  platformRevokeRecorded?: boolean;
}): FeishuEmployeePublicResult {
  const identity = params.store.identities[params.identityId];
  if (!identity || identity.ownerId !== params.ownerId || identity.provider !== "feishu-personal") {
    return { ok: false, code: "USER_IDENTITY_NOT_FOUND", message: "Identity not found." };
  }
  const secretStore = params.secretStore ?? emptySecretStore();
  delete secretStore.secrets[identity.credentialHandleId];
  const platformRevokeRecorded = params.platformRevokeRecorded === true;
  identity.enterpriseIm = {
    channel: "feishu",
    accountId: identity.enterpriseIm?.accountId ?? "",
    platformEnterpriseId: identity.enterpriseIm?.platformEnterpriseId ?? "",
    platformUserId: identity.enterpriseIm?.platformUserId ?? identity.externalAccountId ?? "",
    userGrantedScopes: identity.enterpriseIm?.userGrantedScopes ?? [],
    authorizationLevel: identity.enterpriseIm?.authorizationLevel ?? "identity_only",
    localCredentialsDeleted: true,
    platformRevokeRecorded,
  };
  identity.status = platformRevokeRecorded ? "revoked" : "reauth_required";
  identity.updatedAt = params.nowIso;
  if (platformRevokeRecorded) {
    identity.revokedAt = params.nowIso;
  }
  const headline = platformRevokeRecorded ? "已在飞书侧撤销" : "本地凭证已删除";
  audit({
    store: params.store,
    ownerId: params.ownerId,
    tenantId: identity.tenantId ?? "",
    identityId: identity.identityId,
    action: "disconnect",
    ok: true,
    nowIso: params.nowIso,
    headline,
  });
  return {
    ok: true,
    code: platformRevokeRecorded ? "PLATFORM_REVOKED" : "LOCAL_CREDENTIALS_DELETED",
    message: headline,
    identityId: identity.identityId,
    localCredentialsDeleted: true,
    platformRevokeRecorded,
  };
}

export function feishuEmployeeRowStatusLabel(params: {
  gate?: Pick<
    FeishuEmployeeChannelGate,
    "employeeUiHint" | "childExecutionBlocked" | "statusLabel"
  > | null;
  status?: string | null;
  expiresAt?: string | null;
  enterpriseIm?: {
    authorizationLevel?: "identity_only" | "authorized";
    localCredentialsDeleted?: boolean;
    platformRevokeRecorded?: boolean;
  } | null;
  nowIso?: string;
}): string {
  const gate = params.gate;
  if (!gate || gate.childExecutionBlocked || gate.employeeUiHint === "enterprise_not_open") {
    return "企业尚未开通";
  }
  if (gate.employeeUiHint === "waiting_admin_scopes") {
    return "等待管理员开通权限";
  }
  const link = params.enterpriseIm;
  if (!link) {
    return gate.statusLabel;
  }
  if (link.platformRevokeRecorded) {
    return "已停用";
  }
  if (link.localCredentialsDeleted) {
    return "本地凭证已删除";
  }
  if (params.status === "reauth_required") {
    return "需重新认证";
  }
  if (params.status === "expired" || credentialExpired(params.expiresAt, params.nowIso)) {
    return "已过期";
  }
  if (params.status === "revoked") {
    return "已停用";
  }
  if (link.authorizationLevel === "identity_only") {
    return "仅身份";
  }
  return "已授权";
}

function credentialExpired(expiresAt: string | null | undefined, nowIso?: string): boolean {
  if (!expiresAt?.trim()) {
    return false;
  }
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs)) {
    return true;
  }
  const nowMs = Date.parse(nowIso ?? new Date().toISOString());
  return expiresMs <= nowMs;
}

/** Connection metadata. This does not authorize use of the access token. */
export function describeFeishuEmployeeConnection(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  identityId: string;
}): {
  found: boolean;
  status?: UserOperationalIdentity["status"];
  authorizationLevel?: "identity_only" | "authorized";
  expiresAt?: string;
  localCredentialsDeleted?: boolean;
  platformRevokeRecorded?: boolean;
} {
  const identity = params.store.identities[params.identityId];
  if (!identity || identity.ownerId !== params.ownerId || !identity.enterpriseIm) {
    return { found: false };
  }
  return {
    found: true,
    status: identity.status,
    authorizationLevel: identity.enterpriseIm.authorizationLevel,
    expiresAt: identity.expiresAt,
    localCredentialsDeleted: identity.enterpriseIm.localCredentialsDeleted === true,
    platformRevokeRecorded: identity.enterpriseIm.platformRevokeRecorded === true,
  };
}

function refuseFeishuEmployeeBase(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  identityId: string;
  gate: FeishuEmployeeChannelGate;
}): FeishuEmployeePublicResult | { identity: UserOperationalIdentity } {
  if (params.gate.childExecutionBlocked || params.gate.employeeUiHint === "enterprise_not_open") {
    return {
      ok: false,
      code: "ENTERPRISE_CONNECTION_BLOCKED",
      message: "企业尚未开通",
      identityId: params.identityId,
    };
  }
  if (params.gate.employeeUiHint !== "app_can_attempt") {
    return {
      ok: false,
      code: "WAITING_ADMIN_SCOPES",
      message: "等待管理员开通权限",
      identityId: params.identityId,
    };
  }
  const identity = params.store.identities[params.identityId];
  if (!identity || identity.ownerId !== params.ownerId || !identity.enterpriseIm) {
    return { ok: false, code: "USER_IDENTITY_NOT_FOUND", message: "Identity not found." };
  }
  if (identity.enterpriseIm.platformEnterpriseId !== params.gate.platformEnterpriseId) {
    return {
      ok: false,
      code: "PLATFORM_ENTERPRISE_MISMATCH",
      message: "令牌上的平台企业与企业通道记录不一致。",
      identityId: identity.identityId,
    };
  }
  if (identity.enterpriseIm.platformRevokeRecorded || identity.status === "revoked") {
    return {
      ok: false,
      code: "PLATFORM_REVOKED",
      message: "已在飞书侧撤销",
      identityId: identity.identityId,
      platformRevokeRecorded: true,
    };
  }
  if (identity.enterpriseIm.localCredentialsDeleted) {
    return {
      ok: false,
      code: "LOCAL_CREDENTIALS_DELETED",
      message: "本地凭证已删除",
      identityId: identity.identityId,
      localCredentialsDeleted: true,
      platformRevokeRecorded: false,
    };
  }
  return { identity };
}

/** Whether a caller may use the access token. Refresh uses a separate check. */
export function allowFeishuEmployeeCredentialUse(params: {
  store: UserOperationalIdentityStore;
  secretStore?: UserOperationalIdentityCredentialSecretStore;
  ownerId: string;
  identityId: string;
  gate: FeishuEmployeeChannelGate;
  nowIso?: string;
}): FeishuEmployeePublicResult {
  const base = refuseFeishuEmployeeBase(params);
  if (!("identity" in base)) {
    return base;
  }
  const identity = base.identity;
  if (identity.status === "reauth_required") {
    return {
      ok: false,
      code: "REAUTH_REQUIRED",
      message: "需重新认证",
      identityId: identity.identityId,
    };
  }
  if (identity.status === "expired" || credentialExpired(identity.expiresAt, params.nowIso)) {
    return {
      ok: false,
      code: "TOKEN_EXPIRED",
      message: "已过期",
      identityId: identity.identityId,
    };
  }
  const secret = params.secretStore?.secrets[identity.credentialHandleId];
  if (credentialExpired(secret?.expiresAt, params.nowIso)) {
    return {
      ok: false,
      code: "TOKEN_EXPIRED",
      message: "已过期",
      identityId: identity.identityId,
    };
  }
  if (!secret?.accessToken) {
    return {
      ok: false,
      code: "LOCAL_CREDENTIALS_DELETED",
      message: "本地凭证已删除",
      identityId: identity.identityId,
      localCredentialsDeleted: true,
      platformRevokeRecorded: false,
    };
  }
  return {
    ok: true,
    code: "READ_ALLOWED",
    message: identity.enterpriseIm?.authorizationLevel === "authorized" ? "已授权" : "仅身份",
    identityId: identity.identityId,
    authorizationLevel: identity.enterpriseIm?.authorizationLevel,
    userGrantedScopes: [...(identity.enterpriseIm?.userGrantedScopes ?? [])],
    localCredentialsDeleted: false,
    platformRevokeRecorded: false,
  };
}

export function readFeishuEmployeeConnection(params: {
  store: UserOperationalIdentityStore;
  secretStore?: UserOperationalIdentityCredentialSecretStore;
  ownerId: string;
  identityId: string;
  gate: FeishuEmployeeChannelGate;
  nowIso?: string;
}): FeishuEmployeePublicResult {
  return allowFeishuEmployeeCredentialUse(params);
}

function readFeishuEmployeeRefreshCredential(params: {
  store: UserOperationalIdentityStore;
  secretStore?: UserOperationalIdentityCredentialSecretStore;
  ownerId: string;
  identityId: string;
  gate: FeishuEmployeeChannelGate;
}): { ok: true; refreshToken: string } | FeishuEmployeePublicResult {
  const base = refuseFeishuEmployeeBase(params);
  if (!("identity" in base)) {
    return base;
  }
  const secret = params.secretStore?.secrets[base.identity.credentialHandleId];
  const refreshToken = secret?.refreshToken?.trim() || "";
  if (!refreshToken) {
    return {
      ok: false,
      code: "REFRESH_TOKEN_MISSING",
      message: "需重新认证",
      identityId: base.identity.identityId,
    };
  }
  return { ok: true, refreshToken };
}

export async function refreshFeishuEmployeeConnection(params: {
  store: UserOperationalIdentityStore;
  secretStore: UserOperationalIdentityCredentialSecretStore;
  ownerId: string;
  identityId: string;
  gate: FeishuEmployeeChannelGate;
  nowIso: string;
  exchange: (refreshToken: string) => Promise<FeishuUserTokenObservation>;
}): Promise<FeishuEmployeePublicResult> {
  const inflight = refreshFlights.get(params.identityId);
  if (inflight) {
    return inflight;
  }
  const flight = refreshFeishuEmployeeConnectionOnce(params).finally(() => {
    if (refreshFlights.get(params.identityId) === flight) {
      refreshFlights.delete(params.identityId);
    }
  });
  refreshFlights.set(params.identityId, flight);
  return flight;
}

async function refreshFeishuEmployeeConnectionOnce(params: {
  store: UserOperationalIdentityStore;
  secretStore: UserOperationalIdentityCredentialSecretStore;
  ownerId: string;
  identityId: string;
  gate: FeishuEmployeeChannelGate;
  nowIso: string;
  exchange: (refreshToken: string) => Promise<FeishuUserTokenObservation>;
}): Promise<FeishuEmployeePublicResult> {
  const refreshCredential = readFeishuEmployeeRefreshCredential(params);
  if (!refreshCredential.ok) {
    return refreshCredential;
  }
  const identity = params.store.identities[params.identityId];
  if (!identity) {
    return { ok: false, code: "USER_IDENTITY_NOT_FOUND", message: "Identity not found." };
  }
  let observation: FeishuUserTokenObservation;
  try {
    observation = await params.exchange(refreshCredential.refreshToken);
  } catch {
    identity.status = "reauth_required";
    identity.updatedAt = params.nowIso;
    audit({
      store: params.store,
      ownerId: params.ownerId,
      tenantId: identity.tenantId ?? "",
      identityId: identity.identityId,
      action: "refresh",
      ok: false,
      code: "REFRESH_FAILED",
      nowIso: params.nowIso,
      headline: "需重新认证",
    });
    return {
      ok: false,
      code: "REFRESH_FAILED",
      message: "需重新认证",
      identityId: identity.identityId,
    };
  }
  if (!observation.openId.trim()) {
    observation = {
      ...observation,
      openId: identity.enterpriseIm?.platformUserId || identity.externalAccountId || "",
    };
  }
  const rebound = bindFeishuEmployeeConnection({
    store: params.store,
    secretStore: params.secretStore,
    ownerId: params.ownerId,
    tenantId: identity.tenantId ?? "",
    gate: params.gate,
    observation,
    nowIso: params.nowIso,
    reauth: true,
    auditAction: "refresh",
  });
  if (!rebound.ok) {
    identity.status = "reauth_required";
    identity.updatedAt = params.nowIso;
    return rebound;
  }
  const stored = params.secretStore.secrets[identity.credentialHandleId];
  if (stored && observation.refreshToken && stored.refreshToken !== observation.refreshToken) {
    return {
      ok: false,
      code: "REFRESH_TOKEN_NOT_REPLACED",
      message: "刷新令牌未替换。",
      identityId: identity.identityId,
    };
  }
  return {
    ok: true,
    code: "REFRESHED",
    message: "已刷新",
    identityId: identity.identityId,
    authorizationLevel: rebound.authorizationLevel,
    userGrantedScopes: rebound.userGrantedScopes,
  };
}

export function projectFeishuEmployeeToolResult(
  result: FeishuEmployeePublicResult,
): FeishuEmployeePublicResult {
  return {
    ok: result.ok,
    code: result.code,
    message: result.message,
    identityId: result.identityId,
    authorizationLevel: result.authorizationLevel,
    userGrantedScopes: result.userGrantedScopes ? [...result.userGrantedScopes] : undefined,
    localCredentialsDeleted: result.localCredentialsDeleted,
    platformRevokeRecorded: result.platformRevokeRecorded,
  };
}

export function buildFeishuEmployeePromptContext(
  identity: UserOperationalIdentity | null | undefined,
): string {
  if (!identity?.enterpriseIm) {
    return "";
  }
  return [
    `identityId=${identity.identityId}`,
    `platformUserId=${identity.enterpriseIm.platformUserId}`,
    `authorizationLevel=${identity.enterpriseIm.authorizationLevel}`,
    `scopes=${identity.enterpriseIm.userGrantedScopes.join(",")}`,
  ].join("\n");
}

export function readFeishuAppCredentials(
  config: Record<string, unknown>,
  accountId: string,
): { appId: string; appSecret: string } | null {
  const channels = config.channels;
  const feishu =
    channels && typeof channels === "object" && !Array.isArray(channels)
      ? (channels as { feishu?: { accounts?: Record<string, Record<string, unknown>> } }).feishu
      : undefined;
  const account = feishu?.accounts?.[accountId];
  const appId = typeof account?.appId === "string" ? account.appId.trim() : "";
  const appSecret = typeof account?.appSecret === "string" ? account.appSecret.trim() : "";
  if (!appId || !appSecret) {
    return null;
  }
  return { appId, appSecret };
}

export function buildFeishuEmployeeAuthorizeUrl(params: {
  appId: string;
  redirectUri: string;
  state: string;
}): string {
  const query = new URLSearchParams({
    client_id: params.appId,
    redirect_uri: params.redirectUri,
    response_type: "code",
    state: params.state,
    scope: "offline_access",
  });
  return `https://accounts.feishu.cn/open-apis/authen/v1/authorize?${query.toString()}`;
}

export function beginFeishuEmployeeOAuthSession(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  tenantId: string;
  gate: FeishuEmployeeChannelGate;
  appId: string;
  redirectUri: string;
  displayName?: string;
  identityId?: string;
  nowIso: string;
}):
  | {
      ok: true;
      session: UserOperationalIdentityOAuthSession;
      authorizeUrl: string;
      simulateAllowed: false;
    }
  | FeishuEmployeePublicResult {
  if (!params.gate.loginEnabled) {
    return {
      ok: false,
      code: params.gate.childExecutionBlocked ? "ENTERPRISE_NOT_OPEN" : "WAITING_ADMIN_SCOPES",
      message: params.gate.statusLabel,
    };
  }
  const session: UserOperationalIdentityOAuthSession = {
    sessionId: randomUUID(),
    state: randomUUID(),
    ownerId: params.ownerId,
    tenantId: params.tenantId,
    provider: "feishu-personal",
    displayName: params.displayName?.trim() || "飞书",
    identityId: params.identityId,
    purpose: params.identityId ? "reauthorize" : "bind",
    mode: "adapter_authorization_code",
    status: "pending",
    createdAt: params.nowIso,
    expiresAt: new Date(Date.parse(params.nowIso) + 10 * 60 * 1000).toISOString(),
  };
  params.store.oauthSessions[session.sessionId] = session;
  return {
    ok: true,
    session,
    authorizeUrl: buildFeishuEmployeeAuthorizeUrl({
      appId: params.appId,
      redirectUri: params.redirectUri,
      state: session.state,
    }),
    simulateAllowed: false,
  };
}
