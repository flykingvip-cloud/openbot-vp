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
