/**
 * Feishu user-authorization code exchange for an existing OAuth session.
 * App id and app secret come from the 企业通道 account, never from the employee.
 */
import { loadConfig } from "../config/config.js";
import {
  beginFeishuEmployeeOAuthSession,
  bindFeishuEmployeeConnection,
  loadFeishuEmployeeChannelGate,
  readFeishuAppCredentials,
  type FeishuUserTokenObservation,
} from "./enterprise-im-employee-connection.js";
import {
  getTenantConfigOverride,
  loadTenantConfigStore,
  resolveConfigForTenant,
} from "./tenant-config.js";
import { withUserOperationalIdentityCredentialSecretStoreWriteLock } from "./user-operational-identity-secrets-persistence.js";
import type {
  UserOperationalIdentityOAuthSession,
  UserOperationalIdentityStore,
} from "./user-operational-identity-types.js";

export async function exchangeFeishuUserAuthorizationCode(params: {
  appId: string;
  appSecret: string;
  code: string;
  redirectUri: string;
}): Promise<FeishuUserTokenObservation> {
  const body = await feishuTokenRequest({
    grant_type: "authorization_code",
    client_id: params.appId,
    client_secret: params.appSecret,
    code: params.code,
    redirect_uri: params.redirectUri,
  });
  const accessToken = stringField(body, "access_token");
  if (!accessToken) {
    throw new Error("Feishu token response did not include an access token.");
  }
  let tenantKey = stringField(body, "tenant_key");
  let openId = stringField(body, "open_id");
  if (!tenantKey || !openId) {
    const profile = await feishuUserInfo(accessToken);
    tenantKey = tenantKey || stringField(profile, "tenant_key");
    openId = openId || stringField(profile, "open_id");
  }
  return {
    accessToken,
    refreshToken: stringField(body, "refresh_token"),
    expiresAt: expiresAtFrom(body),
    openId: openId ?? "",
    tenantKey,
    scopeNames: scopeNamesFrom(body),
  };
}

export async function startFeishuEmployeeOAuth(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  tenantId: string | null;
  redirectUri: string;
  displayName?: string;
  identityId?: string;
  nowIso: string;
}): Promise<
  | {
      ok: true;
      session: UserOperationalIdentityOAuthSession;
      authorizeUrl: string;
      simulateAllowed: false;
    }
  | { ok: false; code: string; error: string }
> {
  const tenantId = params.tenantId?.trim() || "";
  const gate = await loadFeishuEmployeeChannelGate({ tenantId: tenantId || null });
  if (!gate.loginEnabled) {
    return {
      ok: false,
      code: gate.childExecutionBlocked ? "ENTERPRISE_NOT_OPEN" : "WAITING_ADMIN_SCOPES",
      error: gate.statusLabel,
    };
  }
  const platformDefault = loadConfig();
  const tenantStore = await loadTenantConfigStore();
  const view = resolveConfigForTenant({
    platformDefault,
    override: getTenantConfigOverride(tenantStore, tenantId),
  }) as unknown as Record<string, unknown>;
  const credentials = readFeishuAppCredentials(view, gate.accountId);
  if (!credentials) {
    return {
      ok: false,
      code: "ENTERPRISE_APP_CREDENTIALS_MISSING",
      error: "企业通道飞书应用凭证不完整。",
    };
  }
  const started = beginFeishuEmployeeOAuthSession({
    store: params.store,
    ownerId: params.ownerId,
    tenantId,
    gate,
    appId: credentials.appId,
    redirectUri: params.redirectUri,
    displayName: params.displayName,
    identityId: params.identityId,
    nowIso: params.nowIso,
  });
  if (!started.ok) {
    return { ok: false, code: started.code, error: started.message };
  }
  return started;
}

export async function completeFeishuEmployeeOAuthFromSession(params: {
  store: UserOperationalIdentityStore;
  session: UserOperationalIdentityOAuthSession;
  code: string;
  redirectUri: string;
  nowIso: string;
  exchange?: typeof exchangeFeishuUserAuthorizationCode;
}): Promise<
  | { ok: true; session: UserOperationalIdentityOAuthSession; returnPath?: string }
  | { ok: false; code: string; error: string }
> {
  const tenantId = params.session.tenantId?.trim() || "";
  if (!tenantId) {
    return { ok: false, code: "ENTERPRISE_NOT_OPEN", error: "企业尚未开通" };
  }
  const gate = await loadFeishuEmployeeChannelGate({ tenantId });
  const platformDefault = loadConfig();
  const tenantStore = await loadTenantConfigStore();
  const view = resolveConfigForTenant({
    platformDefault,
    override: getTenantConfigOverride(tenantStore, tenantId),
  }) as unknown as Record<string, unknown>;
  const credentials = readFeishuAppCredentials(view, gate.accountId);
  if (!credentials) {
    return {
      ok: false,
      code: "ENTERPRISE_APP_CREDENTIALS_MISSING",
      error: "企业通道飞书应用凭证不完整。",
    };
  }
  let observation: FeishuUserTokenObservation;
  try {
    const exchange = params.exchange ?? exchangeFeishuUserAuthorizationCode;
    observation = await exchange({
      appId: credentials.appId,
      appSecret: credentials.appSecret,
      code: params.code,
      redirectUri: params.redirectUri,
    });
  } catch {
    return { ok: false, code: "FEISHU_TOKEN_EXCHANGE_FAILED", error: "飞书用户授权交换失败。" };
  }
  const bound = await withUserOperationalIdentityCredentialSecretStoreWriteLock((secretStore) =>
    bindFeishuEmployeeConnection({
      store: params.store,
      secretStore,
      ownerId: params.session.ownerId,
      tenantId,
      gate,
      observation,
      nowIso: params.nowIso,
      reauth: params.session.purpose === "reauthorize",
    }),
  );
  if (!bound.ok) {
    return { ok: false, code: bound.code, error: bound.message };
  }
  params.session.status = "completed";
  params.session.completedAt = params.nowIso;
  params.session.identityId = bound.identityId;
  params.session.externalAccountId = observation.openId;
  return { ok: true, session: params.session, returnPath: params.session.returnPath };
}

async function feishuTokenRequest(payload: Record<string, string>): Promise<unknown> {
  const response = await fetch("https://open.feishu.cn/open-apis/authen/v2/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return response.json() as Promise<unknown>;
}

async function feishuUserInfo(accessToken: string): Promise<unknown> {
  const response = await fetch("https://open.feishu.cn/open-apis/authen/v1/user_info", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return response.json() as Promise<unknown>;
}

function stringField(body: unknown, key: string): string | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const record = body as Record<string, unknown>;
  const nested =
    record.data && typeof record.data === "object"
      ? (record.data as Record<string, unknown>)
      : null;
  const value = record[key] ?? nested?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function scopeNamesFrom(body: unknown): string[] {
  const raw = stringField(body, "scope") ?? "";
  return raw
    .split(/[\s,]+/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function expiresAtFrom(body: unknown): string | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const record = body as Record<string, unknown>;
  const nested =
    record.data && typeof record.data === "object"
      ? (record.data as Record<string, unknown>)
      : null;
  const expires = record.expires_in ?? nested?.expires_in;
  const seconds = typeof expires === "number" ? expires : Number(expires);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return new Date(Date.now() + seconds * 1000).toISOString();
}
