/**
 * Feishu user-authorization code exchange for an existing OAuth session.
 * App id and app secret come from the 企业通道 account, never from the employee.
 */
import {
  beginFeishuEmployeeOAuthSession,
  bindFeishuEmployeeConnection,
  loadFeishuEmployeeAppCredentials,
  loadFeishuEmployeeChannelGate,
  refreshFeishuEmployeeConnection,
  type FeishuUserTokenObservation,
} from "./enterprise-im-employee-connection.js";
import { withUserOperationalIdentityStoreWriteLockForOwner } from "./user-operational-identity-persistence.js";
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
  const credentials = await loadFeishuEmployeeAppCredentials({
    tenantId,
    accountId: gate.accountId,
  });
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
  const credentials = await loadFeishuEmployeeAppCredentials({
    tenantId,
    accountId: gate.accountId,
  });
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

export async function exchangeFeishuUserRefreshToken(params: {
  appId: string;
  appSecret: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}): Promise<FeishuUserTokenObservation> {
  const body = await feishuTokenRequest(
    {
      grant_type: "refresh_token",
      client_id: params.appId,
      client_secret: params.appSecret,
      refresh_token: params.refreshToken,
    },
    params.fetchImpl,
  );
  const code = numericCode(body);
  if (code !== null && code !== 0) {
    throw new Error("Feishu refresh was rejected.");
  }
  const accessToken = stringField(body, "access_token");
  const tenantKey = stringField(body, "tenant_key");
  if (!accessToken || !tenantKey) {
    throw new Error("Feishu refresh did not include an access token and platform enterprise id.");
  }
  return {
    accessToken,
    refreshToken: stringField(body, "refresh_token"),
    expiresAt: expiresAtFrom(body),
    openId: stringField(body, "open_id") ?? "",
    tenantKey,
    scopeNames: scopeNamesFrom(body),
  };
}

export async function renewPersistedFeishuEmployeeConnection(params: {
  ownerId: string;
  tenantId: string;
  identityId: string;
  nowIso: string;
  identityStorePath?: string;
  secretStorePath?: string;
  tenantConfigPath?: string;
  governanceStateDir?: string;
  fetchImpl?: typeof fetch;
}): Promise<import("./enterprise-im-employee-connection.js").FeishuEmployeePublicResult> {
  const gate = await loadFeishuEmployeeChannelGate({
    tenantId: params.tenantId,
    storePath: params.tenantConfigPath,
  });
  const credentials = await loadFeishuEmployeeAppCredentials({
    tenantId: params.tenantId,
    storePath: params.tenantConfigPath,
    accountId: gate.accountId,
  });
  if (!credentials) {
    return {
      ok: false,
      code: "ENTERPRISE_APP_CREDENTIALS_MISSING",
      message: "企业通道飞书应用凭证不完整。",
      identityId: params.identityId,
    };
  }
  return withUserOperationalIdentityStoreWriteLockForOwner(
    {
      ownerId: params.ownerId,
      tenantId: params.tenantId,
      storePath: params.identityStorePath,
      governanceStateDir: params.governanceStateDir,
    },
    (store) =>
      withUserOperationalIdentityCredentialSecretStoreWriteLock(
        (secretStore) =>
          refreshFeishuEmployeeConnection({
            store,
            secretStore,
            ownerId: params.ownerId,
            identityId: params.identityId,
            gate,
            nowIso: params.nowIso,
            exchange: (refreshToken) =>
              exchangeFeishuUserRefreshToken({
                appId: credentials.appId,
                appSecret: credentials.appSecret,
                refreshToken,
                fetchImpl: params.fetchImpl,
              }),
          }),
        params.secretStorePath,
      ),
  );
}

async function feishuTokenRequest(
  payload: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const response = await fetchImpl("https://open.feishu.cn/open-apis/authen/v2/oauth/token", {
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

function numericCode(body: unknown): number | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const value = (body as { code?: unknown }).code;
  return typeof value === "number" ? value : null;
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
