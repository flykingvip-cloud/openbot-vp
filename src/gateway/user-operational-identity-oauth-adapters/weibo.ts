import type { UserOperationalIdentityOAuthAdapter } from "./types.js";
import { resolveOAuthEnvConfig } from "./types.js";

const WEIBO_AUTHORIZE_URL = "https://api.weibo.com/oauth2/authorize";
const WEIBO_ACCESS_TOKEN_URL = "https://api.weibo.com/oauth2/access_token";

export const weiboOAuthAdapter: UserOperationalIdentityOAuthAdapter = {
  provider: "weibo",
  envPrefix: "WEIBO",
  resolveConfig: (params) =>
    resolveOAuthEnvConfig({
      envPrefix: "WEIBO",
      redirectUri: params?.redirectUri,
      clientIdKeys: ["CLIENT_ID", "APP_KEY"],
      clientSecretKeys: ["CLIENT_SECRET", "APP_SECRET"],
    }),
  buildAuthorizeUrl: ({ config, state }) => {
    const query = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      state,
    });
    return `${WEIBO_AUTHORIZE_URL}?${query.toString()}`;
  },
  exchangeCode: async ({ config, code }) => {
    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
    });
    const response = await fetch(WEIBO_ACCESS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) {
      throw new Error(`Weibo token exchange failed: HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      uid?: string;
      error?: string;
      error_description?: string;
    };
    if (!payload.access_token) {
      throw new Error(payload.error_description ?? payload.error ?? "Weibo token exchange failed.");
    }
    const uid = payload.uid ? String(payload.uid) : undefined;
    return {
      accessToken: payload.access_token,
      expiresIn: payload.expires_in,
      accountLabel: uid ? `weibo:${uid}` : undefined,
      externalAccountId: uid,
    };
  },
};
