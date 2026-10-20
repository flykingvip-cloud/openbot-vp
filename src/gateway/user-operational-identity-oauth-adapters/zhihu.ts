import type { UserOperationalIdentityOAuthAdapter } from "./types.js";
import { fetchAccountLabelFromBearer, resolveOAuthEnvConfig } from "./types.js";

const DEFAULT_ZHIHU_AUTHORIZE_URL = "https://www.zhihu.com/oauth/authorize";
const DEFAULT_ZHIHU_TOKEN_URL = "https://www.zhihu.com/oauth/token";
const DEFAULT_ZHIHU_SCOPE = "read write";
const DEFAULT_ZHIHU_ME_URL = "https://api.zhihu.com/people/self";

function resolveZhihuOAuthEndpoint(envKey: string, fallback: string): string {
  return process.env[envKey]?.trim() || fallback;
}

function resolveZhihuOAuthScope(): string {
  return process.env.OPENBOT_USER_OPERATIONAL_IDENTITY_ZHIHU_SCOPE?.trim() || DEFAULT_ZHIHU_SCOPE;
}

export const zhihuOAuthAdapter: UserOperationalIdentityOAuthAdapter = {
  provider: "zhihu",
  envPrefix: "ZHIHU",
  resolveConfig: (params) =>
    resolveOAuthEnvConfig({
      envPrefix: "ZHIHU",
      redirectUri: params?.redirectUri,
      clientIdKeys: ["CLIENT_ID", "APP_ID", "APP_KEY"],
      clientSecretKeys: ["CLIENT_SECRET", "APP_SECRET"],
    }),
  buildAuthorizeUrl: ({ config, state }) => {
    const query = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      state,
      scope: resolveZhihuOAuthScope(),
    });
    const authorizeUrl = resolveZhihuOAuthEndpoint(
      "OPENBOT_USER_OPERATIONAL_IDENTITY_ZHIHU_AUTHORIZE_URL",
      DEFAULT_ZHIHU_AUTHORIZE_URL,
    );
    return `${authorizeUrl}?${query.toString()}`;
  },
  exchangeCode: async ({ config, code }) => {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
    });
    const tokenUrl = resolveZhihuOAuthEndpoint(
      "OPENBOT_USER_OPERATIONAL_IDENTITY_ZHIHU_TOKEN_URL",
      DEFAULT_ZHIHU_TOKEN_URL,
    );
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) {
      throw new Error(`Zhihu token exchange failed: HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      uid?: string | number;
      user_id?: string | number;
      error?: string;
      error_description?: string;
      message?: string;
    };
    if (!payload.access_token) {
      throw new Error(
        payload.error_description ??
          payload.message ??
          payload.error ??
          "Zhihu token exchange failed.",
      );
    }
    const externalAccountId =
      payload.uid !== undefined && payload.uid !== null
        ? String(payload.uid)
        : payload.user_id !== undefined && payload.user_id !== null
          ? String(payload.user_id)
          : undefined;
    const meUrl = resolveZhihuOAuthEndpoint(
      "OPENBOT_USER_OPERATIONAL_IDENTITY_ZHIHU_ME_URL",
      DEFAULT_ZHIHU_ME_URL,
    );
    const accountLabel =
      (await fetchAccountLabelFromBearer({
        url: meUrl,
        accessToken: payload.access_token,
        pickLabel: (profile) => {
          const name = typeof profile.name === "string" ? profile.name.trim() : "";
          const urlToken =
            typeof profile.url_token === "string" ? profile.url_token.trim() : undefined;
          if (name && urlToken) {
            return `${name} (${urlToken})`;
          }
          return name || urlToken;
        },
      })) ?? (externalAccountId ? `zhihu:${externalAccountId}` : undefined);
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresIn: payload.expires_in,
      scope: payload.scope,
      accountLabel,
      externalAccountId: externalAccountId ?? accountLabel,
    };
  },
};
