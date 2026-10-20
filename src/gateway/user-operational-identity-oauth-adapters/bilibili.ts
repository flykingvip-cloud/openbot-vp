import type { UserOperationalIdentityOAuthAdapter } from "./types.js";
import { resolveOAuthEnvConfig } from "./types.js";

const BILIBILI_AUTHORIZE_URL = "https://account.bilibili.com/pc/account-pc/auth/oauth";
const BILIBILI_TOKEN_URL = "https://api.bilibili.com/x/account-oauth2/v1/token";

export const bilibiliOAuthAdapter: UserOperationalIdentityOAuthAdapter = {
  provider: "bilibili",
  envPrefix: "BILIBILI",
  resolveConfig: (params) =>
    resolveOAuthEnvConfig({ envPrefix: "BILIBILI", redirectUri: params?.redirectUri }),
  buildAuthorizeUrl: ({ config, state }) => {
    const query = new URLSearchParams({
      client_id: config.clientId,
      gourl: config.redirectUri,
      state,
    });
    return `${BILIBILI_AUTHORIZE_URL}?${query.toString()}`;
  },
  exchangeCode: async ({ config, code }) => {
    const query = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "authorization_code",
      code,
    });
    const response = await fetch(`${BILIBILI_TOKEN_URL}?${query.toString()}`, { method: "POST" });
    if (!response.ok) {
      throw new Error(`Bilibili token exchange failed: HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      code?: number;
      message?: string;
      data?: {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
      };
    };
    if (payload.code !== 0 || !payload.data?.access_token) {
      throw new Error(payload.message ?? "Bilibili token exchange failed.");
    }
    return {
      accessToken: payload.data.access_token,
      refreshToken: payload.data.refresh_token,
      expiresIn: payload.data.expires_in,
      accountLabel: "bilibili-user",
      externalAccountId: undefined,
    };
  },
};
