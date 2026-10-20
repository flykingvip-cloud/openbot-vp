import type { UserOperationalIdentityOAuthAdapter } from "./types.js";
import { fetchAccountLabelFromBearer, resolveOAuthEnvConfig } from "./types.js";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";

export const githubPersonalOAuthAdapter: UserOperationalIdentityOAuthAdapter = {
  provider: "github-personal",
  envPrefix: "GITHUB",
  resolveConfig: (params) =>
    resolveOAuthEnvConfig({ envPrefix: "GITHUB", redirectUri: params?.redirectUri }),
  buildAuthorizeUrl: ({ config, state }) => {
    const query = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      state,
      scope: "read:user,user:email,repo",
    });
    return `${GITHUB_AUTHORIZE_URL}?${query.toString()}`;
  },
  exchangeCode: async ({ config, code }) => {
    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    });
    const response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!response.ok) {
      throw new Error(`GitHub token exchange failed: HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      access_token?: string;
      scope?: string;
      error?: string;
      error_description?: string;
    };
    if (!payload.access_token) {
      throw new Error(
        payload.error_description ?? payload.error ?? "GitHub token exchange failed.",
      );
    }
    const accountLabel = await fetchAccountLabelFromBearer({
      url: "https://api.github.com/user",
      accessToken: payload.access_token,
      userAgent: "openbot-user-operational-identity",
      pickLabel: (user) => (typeof user.login === "string" ? user.login.trim() : undefined),
    });
    return {
      accessToken: payload.access_token,
      scope: payload.scope,
      accountLabel,
      externalAccountId: accountLabel,
    };
  },
};
