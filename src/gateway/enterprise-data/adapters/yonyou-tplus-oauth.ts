/**
 * Chanjet open-platform OAuth for 用友 T+ / T+Cloud.
 * Contracts: https://open.chanjet.com/docs/file/apiFile/common/app_settled/app_settled_auth
 * and https://open.chanjet.com/docs/file/apiFile/common/base_api/oauth2
 */

export const YONYOU_TPLUS_CONNECTOR_ID = "erp-yonyou-tplus";
export const YONYOU_TPLUS_GATEWAY_ORIGIN = "https://openapi.chanjet.com";
export const YONYOU_TPLUS_AUTHORIZE_ORIGIN = "https://market.chanjet.com";
export const YONYOU_TPLUS_DEFAULT_APP_NAME = "tpluscloud";
export const YONYOU_TPLUS_API_PREFIX = "/tplus/api/v2";
export const YONYOU_TPLUS_SIMULATED_TOKEN_PREFIX = "simulated-yonyou-tplus-token-";

export type YonyouTplusOAuthConfig = {
  appKey: string;
  appSecret: string;
  redirectUri: string;
  orgId: string;
  appName: string;
  gatewayOrigin: string;
};

export type YonyouTplusAppCredentials = {
  appKey: string;
  appSecret: string;
  gatewayOrigin: string;
  appName: string;
};

export type YonyouTplusTokenResult = {
  accessToken: string;
  refreshToken?: string;
  permanentCode?: string;
  orgId?: string;
  appName?: string;
  sid?: string;
  userId?: string;
  expiresIn?: number;
};

export type YonyouTplusCredentialInput = {
  appKey?: string;
  appSecret?: string;
  openToken?: string;
  refreshToken?: string;
  permanentCode?: string;
  orgPermanentAuthCode?: string;
  orgId?: string;
  appName?: string;
  sid?: string;
  idMarketingOrgan?: string;
};

function readTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function readYonyouTplusCredentialInput(
  params: Record<string, unknown>,
): YonyouTplusCredentialInput {
  return {
    appKey: readTrimmedString(params.appKey),
    appSecret: readTrimmedString(params.appSecret),
    openToken: readTrimmedString(params.openToken),
    refreshToken: readTrimmedString(params.refreshToken),
    permanentCode: readTrimmedString(params.permanentCode),
    orgPermanentAuthCode: readTrimmedString(params.orgPermanentAuthCode),
    orgId: readTrimmedString(params.orgId),
    appName: readTrimmedString(params.appName),
    sid: readTrimmedString(params.sid),
    idMarketingOrgan: readTrimmedString(params.idMarketingOrgan),
  };
}

export function yonyouTplusCredentialInputHasMaterial(input: YonyouTplusCredentialInput): boolean {
  return Boolean(
    input.appKey ||
    input.appSecret ||
    input.openToken ||
    input.refreshToken ||
    input.permanentCode ||
    input.orgPermanentAuthCode ||
    input.orgId ||
    input.appName ||
    input.sid ||
    input.idMarketingOrgan,
  );
}

function resolveGatewayOrigin(): string {
  return (
    process.env.OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_GATEWAY?.trim() || YONYOU_TPLUS_GATEWAY_ORIGIN
  ).replace(/\/+$/, "");
}

/** ISV app credentials. orgId is per customer and is resolved separately. */
export function resolveYonyouTplusAppCredentials(): YonyouTplusAppCredentials | null {
  const appKey = process.env.OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_APP_KEY?.trim();
  const appSecret = process.env.OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_APP_SECRET?.trim();
  if (!appKey || !appSecret) {
    return null;
  }
  const appName =
    process.env.OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_APP_NAME?.trim() ||
    YONYOU_TPLUS_DEFAULT_APP_NAME;
  return { appKey, appSecret, gatewayOrigin: resolveGatewayOrigin(), appName };
}

export function resolveYonyouTplusOAuthConfig(params?: {
  redirectUri?: string;
  orgId?: string;
  appName?: string;
}): YonyouTplusOAuthConfig | null {
  const app = resolveYonyouTplusAppCredentials();
  if (!app) {
    return null;
  }
  const redirectUri =
    params?.redirectUri?.trim() ||
    process.env.OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_REDIRECT_URI?.trim() ||
    "";
  const orgId =
    params?.orgId?.trim() || process.env.OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_ORG_ID?.trim() || "";
  if (!redirectUri || !orgId) {
    return null;
  }
  return {
    ...app,
    redirectUri,
    orgId,
    appName: params?.appName?.trim() || app.appName,
  };
}

export function buildYonyouTplusAuthorizeUrl(params: {
  appKey: string;
  orgId: string;
  appName?: string;
  state: string;
}): string {
  const query = new URLSearchParams({
    appKey: params.appKey,
    orgId: params.orgId,
    appName: params.appName?.trim() || YONYOU_TPLUS_DEFAULT_APP_NAME,
    scope: "auth_all",
    state: params.state,
  });
  return `${YONYOU_TPLUS_AUTHORIZE_ORIGIN}/user/v2/authorize?${query.toString()}`;
}

type ChanjetTokenEnvelope = {
  code?: string | number;
  message?: string;
  result?: {
    access_token?: string;
    refresh_token?: string;
    user_auth_permanent_code?: string;
    org_id?: string;
    app_name?: string;
    sid?: string;
    user_id?: string;
    expires_in?: number | string;
  };
};

function chanjetCodeOk(code: string | number | undefined): boolean {
  return code == null || code === 200 || code === "200" || code === 0 || code === "0";
}

async function readChanjetTokenResponse(
  response: Response,
  label: string,
): Promise<YonyouTplusTokenResult> {
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`${label}失败（${response.status}）${text ? `：${text.slice(0, 160)}` : ""}`);
  }
  let payload: ChanjetTokenEnvelope;
  try {
    payload = JSON.parse(text) as ChanjetTokenEnvelope;
  } catch {
    throw new Error(`${label}返回了无法解析的响应。`);
  }
  if (!chanjetCodeOk(payload.code)) {
    throw new Error(
      `${label}失败（${String(payload.code)}）${payload.message ? `：${payload.message}` : ""}`,
    );
  }
  const accessToken = payload.result?.access_token?.trim();
  if (!accessToken) {
    throw new Error(`${label}未返回 access_token。`);
  }
  const expiresRaw = payload.result?.expires_in;
  const expiresIn =
    typeof expiresRaw === "number"
      ? expiresRaw
      : typeof expiresRaw === "string" && expiresRaw.trim()
        ? Number(expiresRaw)
        : undefined;
  return {
    accessToken,
    refreshToken: payload.result?.refresh_token?.trim() || undefined,
    permanentCode: payload.result?.user_auth_permanent_code?.trim() || undefined,
    orgId: payload.result?.org_id?.trim() || undefined,
    appName: payload.result?.app_name?.trim() || undefined,
    sid: payload.result?.sid?.trim() || undefined,
    userId: payload.result?.user_id?.trim() || undefined,
    expiresIn: Number.isFinite(expiresIn) ? expiresIn : undefined,
  };
}

export async function exchangeYonyouTplusAuthorizationCode(params: {
  appKey: string;
  appSecret: string;
  code: string;
  redirectUri: string;
  gatewayOrigin?: string;
}): Promise<YonyouTplusTokenResult> {
  const origin = (params.gatewayOrigin?.trim() || YONYOU_TPLUS_GATEWAY_ORIGIN).replace(/\/+$/, "");
  const query = new URLSearchParams({
    grantType: "authorization_code",
    redirectUri: params.redirectUri,
    code: params.code,
  });
  const response = await fetch(`${origin}/auth/v2/getToken?${query.toString()}`, {
    method: "GET",
    headers: {
      appKey: params.appKey,
      appSecret: params.appSecret,
      "Content-Type": "application/json",
    },
  });
  return readChanjetTokenResponse(response, "用友 T+ 授权码换 token");
}

export async function refreshYonyouTplusAccessToken(params: {
  appKey: string;
  appSecret: string;
  refreshToken: string;
  gatewayOrigin?: string;
}): Promise<YonyouTplusTokenResult> {
  const origin = (params.gatewayOrigin?.trim() || YONYOU_TPLUS_GATEWAY_ORIGIN).replace(/\/+$/, "");
  const query = new URLSearchParams({
    grantType: "refresh_token",
    refreshToken: params.refreshToken,
  });
  const response = await fetch(`${origin}/auth/v2/refreshToken?${query.toString()}`, {
    method: "GET",
    headers: {
      appKey: params.appKey,
      appSecret: params.appSecret,
      "Content-Type": "application/json",
    },
  });
  return readChanjetTokenResponse(response, "用友 T+ 刷新 token");
}

function gatewayOriginOf(gatewayOrigin?: string): string {
  return (gatewayOrigin?.trim() || YONYOU_TPLUS_GATEWAY_ORIGIN).replace(/\/+$/, "");
}

function chanjetAppHeaders(appKey: string, appSecret: string): Record<string, string> {
  return {
    appKey,
    appSecret,
    "Content-Type": "application/json",
  };
}

async function readChanjetResult(
  response: Response,
  label: string,
): Promise<Record<string, unknown>> {
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`${label}失败（${response.status}）${text ? `：${text.slice(0, 160)}` : ""}`);
  }
  let payload: { code?: string | number; message?: string; result?: unknown };
  try {
    payload = JSON.parse(text) as { code?: string | number; message?: string; result?: unknown };
  } catch {
    throw new Error(`${label}返回了无法解析的响应。`);
  }
  if (!chanjetCodeOk(payload.code)) {
    const codeText =
      typeof payload.code === "string" || typeof payload.code === "number" ? `${payload.code}` : "";
    throw new Error(
      `${label}失败${codeText ? `（${codeText}）` : ""}${payload.message ? `：${payload.message}` : ""}`,
    );
  }
  if (!payload.result || typeof payload.result !== "object" || Array.isArray(payload.result)) {
    throw new Error(`${label}未返回 result。`);
  }
  return payload.result as Record<string, unknown>;
}

function requiredResultString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label}未返回 ${key}。`);
  }
  return value.trim();
}

function optionalResultString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** POST /auth/appAuth/getAppAccessToken — appTicket to an app credential. */
export async function getYonyouTplusAppAccessToken(params: {
  appKey: string;
  appSecret: string;
  appTicket: string;
  gatewayOrigin?: string;
}): Promise<{ appAccessToken: string; expireTime?: number }> {
  const response = await fetch(
    `${gatewayOriginOf(params.gatewayOrigin)}/auth/appAuth/getAppAccessToken`,
    {
      method: "POST",
      headers: chanjetAppHeaders(params.appKey, params.appSecret),
      body: JSON.stringify({ appTicket: params.appTicket }),
    },
  );
  const result = await readChanjetResult(response, "用友 T+ 获取应用凭证");
  const expireTime = result.expireTime;
  return {
    appAccessToken: requiredResultString(result, "appAccessToken", "用友 T+ 获取应用凭证"),
    expireTime: typeof expireTime === "number" ? expireTime : undefined,
  };
}

/** POST /auth/orgAuth/getPermanentAuthCode — enterprise temp code to a permanent code. */
export async function exchangeYonyouTplusOrgPermanentAuthCode(params: {
  appKey: string;
  appSecret: string;
  appAccessToken: string;
  tempAuthCode: string;
  gatewayOrigin?: string;
}): Promise<{ permanentAuthCode: string; orgId?: string; appName?: string; appId?: string }> {
  const response = await fetch(
    `${gatewayOriginOf(params.gatewayOrigin)}/auth/orgAuth/getPermanentAuthCode`,
    {
      method: "POST",
      headers: chanjetAppHeaders(params.appKey, params.appSecret),
      body: JSON.stringify({
        appAccessToken: params.appAccessToken,
        tempAuthCode: params.tempAuthCode,
      }),
    },
  );
  const result = await readChanjetResult(response, "用友 T+ 获取企业永久授权码");
  return {
    permanentAuthCode: requiredResultString(
      result,
      "permanentAuthCode",
      "用友 T+ 获取企业永久授权码",
    ),
    orgId: optionalResultString(result, "orgId"),
    appName: optionalResultString(result, "appName"),
    appId: optionalResultString(result, "appId"),
  };
}

/** POST /auth/orgAuth/getOrgAccessToken — app credential plus enterprise permanent code. */
export async function getYonyouTplusOrgAccessToken(params: {
  appKey: string;
  appSecret: string;
  appAccessToken: string;
  permanentAuthCode: string;
  gatewayOrigin?: string;
}): Promise<{ orgAccessToken: string; orgId?: string; appName?: string; appId?: string }> {
  const response = await fetch(
    `${gatewayOriginOf(params.gatewayOrigin)}/auth/orgAuth/getOrgAccessToken`,
    {
      method: "POST",
      headers: chanjetAppHeaders(params.appKey, params.appSecret),
      body: JSON.stringify({
        appAccessToken: params.appAccessToken,
        permanentAuthCode: params.permanentAuthCode,
      }),
    },
  );
  const result = await readChanjetResult(response, "用友 T+ 获取企业凭证");
  return {
    orgAccessToken: requiredResultString(result, "orgAccessToken", "用友 T+ 获取企业凭证"),
    orgId: optionalResultString(result, "orgId"),
    appName: optionalResultString(result, "appName"),
    appId: optionalResultString(result, "appId"),
  };
}

/** POST /auth/token/getTokenByPermanentCode — enterprise credential plus user permanent code. */
export async function exchangeYonyouTplusTokenByPermanentCode(params: {
  appKey: string;
  appSecret: string;
  orgAccessToken: string;
  userAuthPermanentCode: string;
  gatewayOrigin?: string;
}): Promise<YonyouTplusTokenResult> {
  const response = await fetch(
    `${gatewayOriginOf(params.gatewayOrigin)}/auth/token/getTokenByPermanentCode`,
    {
      method: "POST",
      headers: chanjetAppHeaders(params.appKey, params.appSecret),
      body: JSON.stringify({
        orgAccessToken: params.orgAccessToken,
        userAuthPermanentCode: params.userAuthPermanentCode,
      }),
    },
  );
  return readChanjetTokenResponse(response, "用友 T+ 永久授权码换 token");
}

/**
 * Headless renewal. Prefer the permanent-code chain when appTicket, the
 * enterprise permanent code, and the user permanent code are all present.
 * A failed permanent-code call falls back to refreshToken. A successful
 * refresh rotates both tokens and invalidates the previous openToken.
 */
export async function renewYonyouTplusOpenToken(params: {
  appKey: string;
  appSecret: string;
  gatewayOrigin?: string;
  refreshToken?: string;
  userAuthPermanentCode?: string;
  orgPermanentAuthCode?: string;
  appTicket?: string;
}): Promise<YonyouTplusTokenResult> {
  const refreshToken = params.refreshToken?.trim() || "";
  const userAuthPermanentCode = params.userAuthPermanentCode?.trim() || "";
  const orgPermanentAuthCode = params.orgPermanentAuthCode?.trim() || "";
  const appTicket = params.appTicket?.trim() || "";
  if (userAuthPermanentCode && orgPermanentAuthCode && appTicket) {
    try {
      const app = await getYonyouTplusAppAccessToken({
        appKey: params.appKey,
        appSecret: params.appSecret,
        appTicket,
        gatewayOrigin: params.gatewayOrigin,
      });
      const org = await getYonyouTplusOrgAccessToken({
        appKey: params.appKey,
        appSecret: params.appSecret,
        appAccessToken: app.appAccessToken,
        permanentAuthCode: orgPermanentAuthCode,
        gatewayOrigin: params.gatewayOrigin,
      });
      return await exchangeYonyouTplusTokenByPermanentCode({
        appKey: params.appKey,
        appSecret: params.appSecret,
        orgAccessToken: org.orgAccessToken,
        userAuthPermanentCode,
        gatewayOrigin: params.gatewayOrigin,
      });
    } catch (error) {
      if (!refreshToken) {
        throw error;
      }
    }
  }
  if (refreshToken) {
    return refreshYonyouTplusAccessToken({
      appKey: params.appKey,
      appSecret: params.appSecret,
      refreshToken,
      gatewayOrigin: params.gatewayOrigin,
    });
  }
  throw new Error("用友 T+ 无法续期：缺少 refresh token，或缺少 appTicket 与企业永久授权码。");
}
