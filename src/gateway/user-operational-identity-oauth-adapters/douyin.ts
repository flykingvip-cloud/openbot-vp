import type { UserOperationalIdentityOAuthAdapter } from "./types.js";
import { resolveOAuthEnvConfig } from "./types.js";

const DOUYIN_AUTHORIZE_URL = "https://open.douyin.com/platform/oauth/connect/";
const DOUYIN_ACCESS_TOKEN_URL = "https://open.douyin.com/oauth/access_token/";

export const douyinOAuthAdapter: UserOperationalIdentityOAuthAdapter = {
  provider: "douyin",
  envPrefix: "DOUYIN",
  resolveConfig: (params) =>
    resolveOAuthEnvConfig({
      envPrefix: "DOUYIN",
      redirectUri: params?.redirectUri,
      clientIdKeys: ["CLIENT_KEY", "CLIENT_ID"],
      clientSecretKeys: ["CLIENT_SECRET"],
    }),
  buildAuthorizeUrl: ({ config, state }) => {
    const scope =
      process.env.OPENBOT_USER_OPERATIONAL_IDENTITY_DOUYIN_SCOPE?.trim() ||
      "user_info,video.create.bind";
    const query = new URLSearchParams({
      client_key: config.clientId,
      response_type: "code",
      scope,
      redirect_uri: config.redirectUri,
      state,
    });
    return `${DOUYIN_AUTHORIZE_URL}?${query.toString()}`;
  },
  exchangeCode: async ({ config, code }) => {
    const body = JSON.stringify({
      client_key: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
    });
    const response = await fetch(DOUYIN_ACCESS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!response.ok) {
      throw new Error(`Douyin token exchange failed: HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      data?: {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        open_id?: string;
        scope?: string;
      };
      message?: string;
    };
    const data = payload.data;
    if (!data?.access_token) {
      throw new Error(payload.message ?? "Douyin token exchange failed.");
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      scope: data.scope,
      accountLabel: data.open_id,
      externalAccountId: data.open_id,
    };
  },
};
