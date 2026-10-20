/**
 * WeChat Open Platform third-party component OAuth for enterprise official accounts.
 *
 * Flow: component_access_token → pre_auth_code → admin scan → authorization_code →
 * authorizer_refresh_token / authorizer_access_token.
 *
 * Env:
 *   OPENBOT_ENTERPRISE_WECHAT_COMPONENT_APPID
 *   OPENBOT_ENTERPRISE_WECHAT_COMPONENT_SECRET
 *   OPENBOT_ENTERPRISE_WECHAT_COMPONENT_TOKEN
 *   OPENBOT_ENTERPRISE_WECHAT_COMPONENT_AES_KEY
 *   OPENBOT_ENTERPRISE_WECHAT_COMPONENT_VERIFY_TICKET (dev fallback when ticket push unavailable)
 *   OPENBOT_ENTERPRISE_WECHAT_OAUTH_REDIRECT_URI (optional; OAuth start uses request origin)
 */

import {
  loadWechatComponentTicketStore,
  resolveWechatComponentVerifyTicketFromEnvOrCache,
} from "./wechat-component-ticket-store.js";

export type WechatComponentOAuthConfig = {
  componentAppId: string;
  componentSecret: string;
  redirectUri: string;
};

export type WechatComponentWebhookConfig = {
  componentAppId: string;
  token: string;
  encodingAesKey?: string;
};

export function resolveWechatComponentCredentials(): {
  componentAppId: string;
  componentSecret: string;
} | null {
  const componentAppId = process.env.OPENBOT_ENTERPRISE_WECHAT_COMPONENT_APPID?.trim();
  const componentSecret = process.env.OPENBOT_ENTERPRISE_WECHAT_COMPONENT_SECRET?.trim();
  if (!componentAppId || !componentSecret) {
    return null;
  }
  return { componentAppId, componentSecret };
}

export function resolveWechatComponentWebhookConfig(): WechatComponentWebhookConfig | null {
  const credentials = resolveWechatComponentCredentials();
  const token = process.env.OPENBOT_ENTERPRISE_WECHAT_COMPONENT_TOKEN?.trim();
  if (!credentials || !token) {
    return null;
  }
  const encodingAesKey =
    process.env.OPENBOT_ENTERPRISE_WECHAT_COMPONENT_AES_KEY?.trim() || undefined;
  return {
    componentAppId: credentials.componentAppId,
    token,
    encodingAesKey,
  };
}

export function resolveWechatComponentOAuthConfig(params?: {
  redirectUri?: string;
}): WechatComponentOAuthConfig | null {
  const credentials = resolveWechatComponentCredentials();
  if (!credentials) {
    return null;
  }
  const redirectUri =
    params?.redirectUri?.trim() ||
    process.env.OPENBOT_ENTERPRISE_WECHAT_OAUTH_REDIRECT_URI?.trim() ||
    "";
  if (!redirectUri) {
    return null;
  }
  return {
    componentAppId: credentials.componentAppId,
    componentSecret: credentials.componentSecret,
    redirectUri,
  };
}

export async function resolveWechatComponentVerifyTicket(): Promise<string | null> {
  const store = await loadWechatComponentTicketStore();
  return resolveWechatComponentVerifyTicketFromEnvOrCache(store);
}

export function isWechatComponentOAuthCredentialsConfigured(): boolean {
  return resolveWechatComponentCredentials() !== null;
}

export async function isWechatComponentVerifyTicketReady(): Promise<boolean> {
  const ticket = await resolveWechatComponentVerifyTicket();
  return Boolean(ticket);
}

/** Catalog/UI：仅需 component appId + secret 即视为 OAuth 可展示。 */
export function isWechatComponentOAuthConfigured(_params?: { redirectUri?: string }): boolean {
  return isWechatComponentOAuthCredentialsConfigured();
}

async function fetchWechatComponentAccessToken(
  config: WechatComponentOAuthConfig,
): Promise<string> {
  const verifyTicket = await resolveWechatComponentVerifyTicket();
  if (!verifyTicket) {
    throw new Error(
      "WeChat component_verify_ticket 缺失。请在微信开放平台配置授权事件接收 URL，或设置 OPENBOT_ENTERPRISE_WECHAT_COMPONENT_VERIFY_TICKET。",
    );
  }
  const response = await fetch("https://api.weixin.qq.com/cgi-bin/component/api_component_token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      component_appid: config.componentAppId,
      component_appsecret: config.componentSecret,
      component_verify_ticket: verifyTicket,
    }),
  });
  if (!response.ok) {
    throw new Error(`WeChat component token failed: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as {
    component_access_token?: string;
    errcode?: number;
    errmsg?: string;
  };
  if (!payload.component_access_token) {
    throw new Error(payload.errmsg ?? "WeChat component token exchange failed.");
  }
  return payload.component_access_token;
}

export async function createWechatComponentPreAuthCode(
  config: WechatComponentOAuthConfig,
): Promise<{
  preAuthCode: string;
  componentAccessToken: string;
}> {
  const componentAccessToken = await fetchWechatComponentAccessToken(config);
  const response = await fetch(
    `https://api.weixin.qq.com/cgi-bin/component/api_create_preauthcode?component_access_token=${encodeURIComponent(componentAccessToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ component_appid: config.componentAppId }),
    },
  );
  if (!response.ok) {
    throw new Error(`WeChat pre_auth_code failed: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as {
    pre_auth_code?: string;
    errcode?: number;
    errmsg?: string;
  };
  if (!payload.pre_auth_code) {
    throw new Error(payload.errmsg ?? "WeChat pre_auth_code failed.");
  }
  return { preAuthCode: payload.pre_auth_code, componentAccessToken };
}

export function buildWechatComponentAuthorizeUrl(params: {
  config: WechatComponentOAuthConfig;
  preAuthCode: string;
  state: string;
  authType?: "1" | "2" | "3";
}): string {
  const query = new URLSearchParams({
    component_appid: params.config.componentAppId,
    pre_auth_code: params.preAuthCode,
    redirect_uri: params.config.redirectUri,
    auth_type: params.authType ?? "1",
    state: params.state,
  });
  return `https://mp.weixin.qq.com/cgi-bin/componentloginpage?${query.toString()}`;
}

export async function exchangeWechatAuthorizerTokens(params: {
  config: WechatComponentOAuthConfig;
  authorizationCode: string;
}): Promise<{
  authorizerAppId: string;
  authorizerAccessToken: string;
  authorizerRefreshToken: string;
  expiresIn?: number;
}> {
  const { componentAccessToken } = await createWechatComponentPreAuthCode(params.config);
  const queryResponse = await fetch(
    `https://api.weixin.qq.com/cgi-bin/component/api_query_auth?component_access_token=${encodeURIComponent(componentAccessToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        component_appid: params.config.componentAppId,
        authorization_code: params.authorizationCode,
      }),
    },
  );
  if (!queryResponse.ok) {
    throw new Error(`WeChat query_auth failed: HTTP ${queryResponse.status}`);
  }
  const payload = (await queryResponse.json()) as {
    authorization_info?: {
      authorizer_appid?: string;
      authorizer_access_token?: string;
      authorizer_refresh_token?: string;
      expires_in?: number;
    };
    errcode?: number;
    errmsg?: string;
  };
  const info = payload.authorization_info;
  if (!info?.authorizer_appid || !info.authorizer_access_token || !info.authorizer_refresh_token) {
    throw new Error(payload.errmsg ?? "WeChat authorizer token exchange failed.");
  }
  return {
    authorizerAppId: info.authorizer_appid,
    authorizerAccessToken: info.authorizer_access_token,
    authorizerRefreshToken: info.authorizer_refresh_token,
    expiresIn: info.expires_in,
  };
}

export async function refreshWechatAuthorizerAccessToken(params: {
  authorizerAppId: string;
  authorizerRefreshToken: string;
}): Promise<{
  authorizerAccessToken: string;
  authorizerRefreshToken?: string;
  expiresIn?: number;
}> {
  const redirectUri =
    process.env.OPENBOT_ENTERPRISE_WECHAT_OAUTH_REDIRECT_URI?.trim() || "http://127.0.0.1";
  const config = resolveWechatComponentOAuthConfig({ redirectUri });
  if (!config) {
    throw new Error("WeChat component OAuth 未配置。");
  }
  const { componentAccessToken } = await createWechatComponentPreAuthCode(config);
  const response = await fetch(
    `https://api.weixin.qq.com/cgi-bin/component/api_authorizer_token?component_access_token=${encodeURIComponent(componentAccessToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        component_appid: config.componentAppId,
        authorizer_appid: params.authorizerAppId,
        authorizer_refresh_token: params.authorizerRefreshToken,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`api_authorizer_token HTTP ${response.status}`);
  }
  const payload = (await response.json()) as {
    authorizer_access_token?: string;
    authorizer_refresh_token?: string;
    expires_in?: number;
    errcode?: number;
    errmsg?: string;
  };
  if (!payload.authorizer_access_token) {
    throw new Error(payload.errmsg ?? "api_authorizer_token 失败。");
  }
  return {
    authorizerAccessToken: payload.authorizer_access_token,
    authorizerRefreshToken: payload.authorizer_refresh_token,
    expiresIn: payload.expires_in,
  };
}

export async function fetchWechatAuthorizerProfile(params: {
  authorizerAppId: string;
  authorizerAccessToken: string;
}): Promise<
  | {
      ok: true;
      nickName?: string;
      principalName?: string;
      verifyType?: string;
      serviceType?: string;
      canBroadcast: boolean;
    }
  | { ok: false; error: string }
> {
  const redirectUri =
    process.env.OPENBOT_ENTERPRISE_WECHAT_OAUTH_REDIRECT_URI?.trim() || "http://127.0.0.1";
  const config = resolveWechatComponentOAuthConfig({ redirectUri });
  if (!config) {
    return { ok: false, error: "WeChat component OAuth 未配置。" };
  }
  try {
    const { componentAccessToken } = await createWechatComponentPreAuthCode(config);
    const response = await fetch(
      `https://api.weixin.qq.com/cgi-bin/component/api_get_authorizer_info?component_access_token=${encodeURIComponent(componentAccessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          component_appid: config.componentAppId,
          authorizer_appid: params.authorizerAppId,
        }),
      },
    );
    if (!response.ok) {
      return { ok: false, error: `get_authorizer_info HTTP ${response.status}` };
    }
    const payload = (await response.json()) as {
      authorizer_info?: {
        nick_name?: string;
        principal_name?: string;
        verify_type_info?: { id?: number; name?: string };
        service_type_info?: { id?: number; name?: string };
        func_info?: Array<{ funcscope_category?: { id?: number } }>;
      };
      errcode?: number;
      errmsg?: string;
    };
    if (payload.errcode && payload.errcode !== 0) {
      return { ok: false, error: payload.errmsg ?? "get_authorizer_info 失败。" };
    }
    const info = payload.authorizer_info;
    if (!info) {
      return { ok: false, error: "authorizer_info 为空。" };
    }
    const funcIds = new Set(
      (info.func_info ?? [])
        .map((entry) => entry.funcscope_category?.id)
        .filter((id): id is number => typeof id === "number"),
    );
    return {
      ok: true,
      nickName: info.nick_name,
      principalName: info.principal_name,
      verifyType: info.verify_type_info?.name,
      serviceType: info.service_type_info?.name,
      canBroadcast: funcIds.has(11) || funcIds.has(3),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "get_authorizer_info 失败。",
    };
  }
}
